const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), '.env') });
const { v4: uuidv4 } = require('uuid');

const redis = require('redis');
const GameService = require('./GameService');
const UserService = require('./UserService');

const { createBullQueue } = require('./queue');

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
    console.log('[Worker] Bet job:', job.data);
    // TODO: реальный вызов API казино
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`[Worker] Bet processed: ${job.data.betId}`);
  });

  // Обработчик cashout-queue
  cashoutQueue.process(async (job) => {
    console.log('[Worker] Cashout job:', job.data);
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`[Worker] Cashout processed: ${job.data.betId}`);
  });

  // Обработчик resolve-round-queue
  // конец раунда
  resolveRoundQueue.process(async (job) => {
    const { roundId } = job.data;
    const { bets, cashouts } = await gameService.getRoundData(roundId);
    console.log('bets ', bets);
    console.log('cashouts ', cashouts);

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

  // Обработчик lose-queue (win=0) – пока заглушка
  loseQueue.process(async (job) => {
    console.log('[Worker] Lose job (win=0):', job.data);
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(`[Worker] Lose processed: ${job.data.betId}`);
  });

  console.log(`Worker ${process.pid} started, listening for jobs`);
}

main().catch(console.error);
