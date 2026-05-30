const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), '.env') });
const { v4: uuidv4 } = require('uuid');

const redis = require('redis');
const GameService = require('./GameService');
const UserService = require('./UserService');

const { createBullQueue } = require('./queue');

const CASINO_API_URL = process.env.CASINO_API_URL || 'http://localhost:4000';

// TODO: внегний rollback не реализован для простаты

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
      console.log(`Bet confirmed: ${betId}`);
    } catch (err) {
      console.error(
        `Bet attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed for ${betId}:`,
        err.message,
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
      console.log(`[Worker] Cashout confirmed: ${betId}`);
    } catch (err) {
      console.error(
        `[Worker] Cashout attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed for ${betId}:`,
        err.message,
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
    for (const [userId, amount] of Object.entries(bets)) {
      if (!cashouts[userId]) {
        await loseQueue.add({
          userId,
          betId: `${roundId}:${userId}`,
          amount,
          roundId,
          idempotencyKey: uuidv4(),
        });
      }
    }
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
      console.log(`[Worker] Lose confirmed: ${betId}`);
    } catch (err) {
      console.error(
        `[Worker] Lose attempt ${job.attemptsMade + 1}/${job.opts.attempts} failed for ${betId}:`,
        err.message,
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
