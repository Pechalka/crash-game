const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), '.env') });
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@clickhouse/client');

const redis = require('redis');
const GameService = require('./GameService');
const UserService = require('./UserService');
let logQueue;

const { createBullQueue } = require('./queue');

const CASINO_API_URL = process.env.CASINO_API_URL || 'http://localhost:4000';

// TODO: внегний rollback не реализован для простаты

// Клиент ClickHouse
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'changeme',
  database: 'crash',
});

// Вспомогательная функция отправки события в лог-очередь
async function emitLog(eventType, data, error = null) {
  await logQueue.add({
    eventType,
    data: {
      ...data,
      error_message: error?.message || null,
      timestamp: Date.now(),
    },
  });
}

async function callCasino(endpoint, data, timeoutMs = 2000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${CASINO_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Helper для отправки алерта (заглушка, можно позже заменить на Sentry/telegram)
async function sendAlert(message) {
  console.error(`[ALERT] ${message}`);
  // TODO: отправить в Telegram, Slack, Sentry и т.д.
}

async function main() {
  const redisClient = redis.createClient({ url: process.env.REDIS_URL });
  await redisClient.connect();
  const gameService = new GameService(redisClient);
  const userService = new UserService(redisClient);

  const betQueue = createBullQueue('bet-queue');
  const cashoutQueue = createBullQueue('cashout-queue');
  const resolveRoundQueue = createBullQueue('resolve-round-queue');
  const loseQueue = createBullQueue('lose-queue');
  logQueue = createBullQueue('log-queue');

  // Обработчик logQueue
  logQueue.process(async (job) => {
    const { eventType, data } = job.data;
    try {
      await clickhouse.insert({
        table: 'game_events',
        values: [
          {
            event_time: new Date(data.timestamp),
            event_type: eventType,
            user_id: data.userId,
            bet_id: data.betId,
            round_id: data.roundId,
            amount: data.amount,
            win_amount: data.winAmount || null,
            multiplier: data.multiplier || null,
            status: data.status,
            error_message: data.error_message,
          },
        ],
        format: 'JSONEachRow',
      });
      console.log(
        `[LogWorker] Inserted ${eventType} for ${data.betId || data.roundId}`,
      );
    } catch (err) {
      console.error(`[LogWorker] ClickHouse insert failed:`, err);
      throw err;
    }
  });

  // Обработчик bet-queue
  betQueue.process(async (job) => {
    const { betId, userId, amount, roundId, idempotencyKey } = job.data;
    try {
      await callCasino('/bet', {
        userId,
        betId,
        amount,
        roundId,
        idempotencyKey,
      });
      await emitLog('bet', {
        userId,
        betId,
        amount,
        roundId,
        status: 'confirmed',
      });

      console.log(`Bet confirmed: ${betId}`);
    } catch (err) {
      console.error(
        `Bet attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed for ${betId}:`,
        err.message,
      );
      await emitLog(
        'bet_failed',
        { userId, betId, amount, roundId, status: 'failed' },
        err,
      );

      if (job.attemptsMade + 1 >= job.opts.attempts) {
        // последняя попытка – делаем откат и завершаем задачу успешно
        console.log(`Last attempt failed, rolling back bet ${betId}`);
        await gameService.rollbackBetInternally(betId);
        // задача не будет повторяться и не попадёт в failed
        return;
      }
      throw err; // Bull повторит попытку
    }
  });

  // --- Обработчик cashoutQueue (win > 0) ---
  cashoutQueue.process(async (job) => {
    const { betId, userId, winAmount, roundId, idempotencyKey } = job.data;
    console.log(`[Worker] Cashout job: ${betId}, win=${winAmount}`);

    try {
      await callCasino('/win', {
        userId,
        betId,
        winAmount,
        roundId,
        idempotencyKey,
        timestamp: Date.now(),
      });
      await emitLog('cashout', {
        userId,
        betId,
        winAmount,
        roundId,
        status: 'confirmed',
      });
      console.log(`[Worker] Cashout confirmed: ${betId}`);
    } catch (err) {
      console.error(
        `[Worker] Cashout attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed for ${betId}:`,
        err.message,
      );
      await emitLog(
        'cashout_failed',
        { userId, betId, winAmount, roundId, status: 'failed' },
        err,
      );
      if (job.attemptsMade + 1 >= job.opts.attempts) {
        // Последняя попытка не удалась – отправляем алерт, деньги уже начислены
        await sendAlert(
          `Cashout notification FAILED for bet ${betId}, user ${userId}, amount ${winAmount}. Manual reconciliation required.`,
        );
        // Задача попадёт в failed, так как мы выбрасываем ошибку (это видно в админке)
        throw err;
      }
      throw err; // Bull повторит попытку
    }
  });

  // Обработчик resolve-round-queue
  // конец раунда
  resolveRoundQueue.process(async (job) => {
    const { roundId } = job.data;
    const { bets, cashouts } = await gameService.getRoundData(roundId);
    let loseCount = 0;
    for (const [userId, amount] of Object.entries(bets)) {
      if (!cashouts[userId]) {
        await loseQueue.add({
          userId,
          betId: `${roundId}:${userId}`,
          amount,
          roundId,
          idempotencyKey: uuidv4(),
        });
        loseCount++;
      }
    }
    await emitLog('round_resolved', {
      roundId,
      betsCount: Object.keys(bets).length,
      cashoutsCount: Object.keys(cashouts).length,
      loseCount,
    });
    console.log(`Round ${roundId} resolved, ${loseCount} lose tasks added`);
  });

  // --- Обработчик loseQueue (win = 0) ---
  loseQueue.process(async (job) => {
    const { userId, betId, amount, roundId, idempotencyKey } = job.data;
    console.log(`[Worker] Lose job (win=0): ${betId}`);

    try {
      await callCasino('/win', {
        userId,
        betId,
        winAmount: 0,
        roundId,
        idempotencyKey,
        timestamp: Date.now(),
      });
      await emitLog('lose', {
        userId,
        betId,
        amount,
        roundId,
        status: 'confirmed',
        winAmount: 0,
      });
      console.log(`[Worker] Lose confirmed: ${betId}`);
    } catch (err) {
      console.error(
        `[Worker] Lose attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed for ${betId}:`,
        err.message,
      );
      await emitLog(
        'lose_failed',
        { userId, betId, amount, roundId, status: 'failed' },
        err,
      );
      if (job.attemptsMade + 1 >= job.opts.attempts) {
        // Последняя попытка не удалась – логируем, но не откатываем (деньги уже списаны)
        await sendAlert(
          `Lose notification (win=0) FAILED for bet ${betId}, user ${userId}. Casino may not be aware of loss.`,
        );
        // Не выбрасываем ошибку, чтобы задача не попала в failed (чистая очередь)
        return;
      }
      throw err; // Bull повторит попытку
    }
  });

  console.log(`Worker ${process.pid} started, listening for jobs`);
}

main().catch(console.error);
