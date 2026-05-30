const { placeBetScript, cashOutScript } = require('./scripts');

// GameService.js
class GameService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.placeBetScript = placeBetScript;
    this.cashOutScript = cashOutScript;
  }

  // метод для получения результата раунда ставки и кешауты
  async getRoundData(roundId) {
    const bets = await this.redis.hGetAll(`round:${roundId}:bets`);
    const cashouts = await this.redis.hGetAll(`round:${roundId}:cashouts`);
    // Преобразуем строки в числа (значения приходят как строки)
    const betsNum = {};
    for (const [userId, amount] of Object.entries(bets)) {
      betsNum[userId] = parseFloat(amount);
    }
    const cashoutsNum = {};
    for (const [userId, win] of Object.entries(cashouts)) {
      cashoutsNum[userId] = parseFloat(win);
    }
    return { bets: betsNum, cashouts: cashoutsNum };
  }

  // ---------- Атомарные операции (Lua) ----------
  async placeBet(userId, betAmount, userName, roundId) {
    if (!userId) return { success: false, reason: 'guest' };
    if (!roundId) {
      roundId = await this.redis.get('game:current_round');
      if (!roundId) return { success: false, reason: 'no_round' };
    }
    const betId = `${roundId}:${userId}`;

    const res = await this.redis.eval(this.placeBetScript, {
      arguments: [
        userId,
        betAmount.toString(),
        Date.now().toString(),
        userName,
      ],
    });

    if (res && res[0] === 1) {
      return { success: true, newBalance: res[1], betId, roundId };
    }
    return { success: false, reason: res?.[1] || 'unknown' };
  }

  async cashOut(userId, roundId) {
    if (!userId) return { success: false, reason: 'guest' };
    if (!roundId) {
      roundId = await this.redis.get('game:current_round');
      if (!roundId) return { success: false, reason: 'no_round' };
    }
    const betId = `${roundId}:${userId}`;

    const res = await this.redis.eval(this.cashOutScript, {
      arguments: [userId, Date.now().toString()],
    });

    if (res && res[0] === 1) {
      return { success: true, newBalance: res[1], win: res[2], betId, roundId };
    }
    return { success: false, reason: res?.[1] || 'unknown' };
  }

  // ---------- Чтение состояния игры ----------
  async getGameState(userId) {
    const roundId = await this.redis.get('game:current_round');
    if (!roundId) {
      return {
        phase: 'betting',
        multiplier: 1.0,
        hasBet: false,
        hasCashedOut: false,
        betAmount: null,
        remainingBettingTime: 0,
      };
    }

    // Получаем фазу и множитель
    const phase = (await this.redis.get('game:phase')) || 'betting';
    const multiplier = parseFloat(
      (await this.redis.get('game:multiplier')) || 1.0,
    );

    // Если userId нет (гость), пропускаем проверку ставок
    let betAmount = null;
    let hasCashedOut = false;
    if (userId) {
      const betsKey = `round:${roundId}:bets`;
      const cashoutsKey = `round:${roundId}:cashouts`;
      // Одновременно получаем оба значения (можно через multi, но оставим последовательно для простоты)
      betAmount = await this.redis.hGet(betsKey, userId);
      hasCashedOut = await this.redis.hExists(cashoutsKey, userId);
    }

    let remainingBettingTime = 0;
    if (phase === 'betting') {
      const bettingEnd = await this.redis.get('game:betting_end_time');
      if (bettingEnd) {
        remainingBettingTime = Math.max(0, parseInt(bettingEnd) - Date.now());
      }
    }

    return {
      phase,
      multiplier,
      hasBet: betAmount !== null,
      hasCashedOut,
      betAmount: betAmount ? parseFloat(betAmount) : null,
      remainingBettingTime,
    };
  }

  async getLiveTable(limit = 50) {
    const userIds = await this.redis.zRange('live:index', 0, limit - 1, {
      REV: true,
    });
    const table = [];
    for (const userId of userIds) {
      const data = await this.redis.hGetAll(`live:state:${userId}`);
      if (data && Object.keys(data).length) {
        table.push({
          userId,
          name: data.name || 'Guest',
          betAmount: parseFloat(data.betAmount || 0),
          win: data.win ? parseFloat(data.win) : null,
          multiplier: data.multiplier ? parseFloat(data.multiplier) : null,
        });
      }
    }
    return table;
  }

  // ---------- Методы для генератора ----------
  async startRound(crashPoint, bettingDurationMs) {
    const roundId = Date.now().toString();
    await this.redis.set('game:current_round', roundId);
    await this.redis.set('game:crash_point', crashPoint);
    await this.redis.set('game:multiplier', 1.0);
    await this.redis.set('game:phase', 'betting');
    await this.redis.set(
      'game:betting_end_time',
      Date.now() + bettingDurationMs,
    );
    await this.redis.del('game:cooldown_end_time');

    // Очистка live table
    const lua = `
    local keys = redis.call('keys', 'live:state:*')
    if #keys > 0 then
      redis.call('del', unpack(keys))
    end
    redis.call('del', 'live:index')
    return 1
  `;
    await this.redis.eval(lua);
    console.log(
      `[GameService] Round ${roundId} started, crash point ${crashPoint}`,
    );
    return roundId;
  }

  async startFlight() {
    await this.redis.set('game:phase', 'flying');
    await this.redis.del('game:betting_end_time');
    console.log('[GameService] Flight started');
  }

  async updateMultiplier(multiplier) {
    await this.redis.set('game:multiplier', multiplier);
  }

  async crashRound(finalMultiplier, cooldownDurationMs) {
    await this.redis.set('game:phase', 'crashed');
    await this.redis.set('game:multiplier', finalMultiplier);
    await this.redis.set(
      'game:cooldown_end_time',
      Date.now() + cooldownDurationMs,
    );
    console.log(`[GameService] Crashed at ${finalMultiplier}`);
  }

  /// ---

  async rollbackBetInternally(betId) {
    const [roundId, userId] = betId.split(':');
    if (!roundId || !userId) return false;

    const betsKey = `round:${roundId}:bets`;
    const betAmount = await this.redis.hGet(betsKey, userId);
    if (!betAmount) return false;

    const balanceKey = `user:${userId}:balance`;
    // Исправлено: incrByFloat (camelCase, B большая)
    await this.redis.incrByFloat(balanceKey, parseFloat(betAmount));

    await this.redis.hDel(betsKey, userId);
    await this.redis.del(`bet:${betId}`);

    console.log(
      `[rollbackBetInternally] Rolled back bet ${betId}, returned ${betAmount}`,
    );
    return true;
  }
}

module.exports = GameService;
