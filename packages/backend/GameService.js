// GameService.js
class GameService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async startRound(roundId, crashPoint, bettingDurationMs) {
    const oldRoundId = await this.redis.get('current_round');
    if (oldRoundId && oldRoundId !== roundId) {
      await this.redis.del(`round:${oldRoundId}:bets`);
      await this.redis.del(`round:${oldRoundId}:cashouts`);
    }
    await this.redis.set('current_round', roundId);
    await this.redis.set('crash_point', crashPoint);
    await this.redis.set('current_multiplier', 1.0);
    await this.redis.set('current_phase', 'betting');
    await this.redis.set('betting_end_time', Date.now() + bettingDurationMs);
    await this.redis.del('cooldown_end_time');

    await this.resetPlayerStates();
    console.log(`[GameService] Round ${roundId} started`);
  }

  async startFlight(roundId) {
    await this.redis.set('current_phase', 'flying');
    await this.redis.del('betting_end_time');
    console.log(`[GameService] Flight started for round ${roundId}`);
  }

  async updateMultiplier(roundId, multiplier) {
    await this.redis.set('current_multiplier', multiplier);
  }

  async crashRound(roundId, finalMultiplier) {
    await this.redis.set('current_phase', 'crashed');
    await this.redis.set('current_multiplier', finalMultiplier);
    const cooldownDurationMs = 7 * 1000;
    const cooldownEndTime = Date.now() + cooldownDurationMs;
    await this.redis.set('cooldown_end_time', cooldownEndTime);
    console.log(`[GameService] Round ${roundId} crashed, cooldown until ${new Date(cooldownEndTime).toISOString()}`);
  }

  async getCurrentMultiplier() {
    const val = await this.redis.get('current_multiplier');
    return val ? parseFloat(val) : 1.0;
  }

  async getCurrentPhase() {
    const phase = await this.redis.get('current_phase');
    return phase || 'betting';
  }

async getGameState(userId) {
  const roundId = await this.redis.get('current_round');
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
  const phase = (await this.redis.get('current_phase')) || 'betting';
  const multiplier = parseFloat((await this.redis.get('current_multiplier')) || 1.0);
  const betAmount = await this.getBet(userId);
  const hasBet = betAmount !== null;
  const hasCashedOut = await this.hasCashedOut(userId);

  let remainingBettingTime = 0;
  if (phase === 'betting') {
    const bettingEnd = await this.redis.get('betting_end_time');
    if (bettingEnd) {
      remainingBettingTime = Math.max(0, parseInt(bettingEnd) - Date.now());
    }
  }

  return {
    phase,
    multiplier,
    hasBet,
    hasCashedOut,
    betAmount,
    remainingBettingTime,   
  };
}

  async registerBet(userId, betAmount, userName) {
    const roundId = await this.redis.get('current_round');
    if (!roundId) return false;
    const betsKey = `round:${roundId}:bets`;
    const existing = await this.redis.hGet(betsKey, userId);
    if (existing) return false;
    await this.redis.hSet(betsKey, userId, betAmount);
    await this.updatePlayerState(userId, 'bet', userName, betAmount);
    return true;
  }

  async registerCashout(userId, win, multiplier, userName) {
    const roundId = await this.redis.get('current_round');
    if (!roundId) return false;
    const cashoutsKey = `round:${roundId}:cashouts`;
    const existing = await this.redis.hExists(cashoutsKey, userId);
    if (existing) return false;
    const betAmount = await this.getBet(userId);
    if (!betAmount) return false;
    await this.redis.hSet(cashoutsKey, userId, win);
    await this.updatePlayerState(userId, 'cashout', userName, betAmount, win, multiplier);
    return true;
  }

  async getBet(userId) {
    const roundId = await this.redis.get('current_round');
    if (!roundId) return null;
    const betsKey = `round:${roundId}:bets`;
    const bet = await this.redis.hGet(betsKey, userId);
    return bet ? parseFloat(bet) : null;
  }

  async hasCashedOut(userId) {
    const roundId = await this.redis.get('current_round');
    if (!roundId) return false;
    const cashoutsKey = `round:${roundId}:cashouts`;
    return await this.redis.hExists(cashoutsKey, userId);
  }

  async updatePlayerState(userId, type, userName, betAmount = null, win = null, multiplier = null) {
    const stateKey = `player_state:${userId}`;
    const now = Date.now();

    let state = await this.redis.hGetAll(stateKey);
    if (!state || Object.keys(state).length === 0) {
      state = { name: userName, timestamp: now.toString() };
    }

    if (type === 'bet') {
      state.betAmount = betAmount !== null ? betAmount.toString() : null;
      state.win = null;
      state.multiplier = null;
    } else if (type === 'cashout') {
      if (state.betAmount) {
        state.win = win !== null ? win.toString() : null;
        state.multiplier = multiplier !== null ? multiplier.toString() : null;
      }
    }
    state.timestamp = now.toString();

    const args = [];
    for (const [key, val] of Object.entries(state)) {
      if (val !== null && val !== undefined) {
        args.push(key, val);
      }
    }
    if (args.length) {
      await this.redis.hSet(stateKey, args);
    }

    await this.redis.zAdd('player_index', { score: now, value: userId });
    const count = await this.redis.zCard('player_index');
    if (count > 50) {
      const oldest = await this.redis.zRange('player_index', 0, 0);
      if (oldest && oldest.length) {
        await this.redis.zRem('player_index', oldest[0]);
        await this.redis.del(`player_state:${oldest[0]}`);
      }
    }
  }

  async getPlayerStates(limit = 50) {
    let userIds = await this.redis.zRange('player_index', 0, limit - 1, { REV: true });

    const states = [];
    for (const userId of userIds) {
      const data = await this.redis.hGetAll(`player_state:${userId}`);
      if (Object.keys(data).length) {
        states.push({
          userId,
          name: data.name,
          betAmount: parseFloat(data.betAmount || 0),
          win: data.win ? parseFloat(data.win) : null,
          multiplier: data.multiplier ? parseFloat(data.multiplier) : null,
        });
      }
    }
    return states;
  }

async resetPlayerStates() {
  const keys = await this.redis.keys('player_state:*');
  console.log(`[GameService] resetPlayerStates: found ${keys.length} keys`);
  if (keys && keys.length) {
    await this.redis.del(keys);
    console.log(`[GameService] resetPlayerStates: deleted ${keys.length} keys`);
  }
  await this.redis.del('player_index');
}

}

module.exports = GameService;