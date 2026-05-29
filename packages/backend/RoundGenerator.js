const redis = require('redis');
const { getEmitter } = require('./socket-io-setup');
const GameService = require('./GameService');

const config = {
  bettingDuration: 7000,
  flightDuration: 10000,
  cooldownDuration: 3000,
  maxCrashPoint: 100,
  minCrashPoint: 1.01,
  distributionPower: 2,
};

let gameService;
let emitter;
let redisClient;
let roundActive = false;
let bettingTimer = null;
let flightInterval = null;
let nextRoundTimeout = null;
let currentRoundId = null;
let currentCrashPoint = null;

function generateCrashPoint() {
  const r = Math.random();
  const point =
    config.minCrashPoint +
    Math.pow(r, config.distributionPower) *
      (config.maxCrashPoint - config.minCrashPoint);
  return Math.min(config.maxCrashPoint, Math.max(config.minCrashPoint, point));
}

async function publishEvent(event) {
  if (emitter) {
    emitter.emit('game_event', event);
    // console.log(`[Generator] Published: ${event.type}`);
  }
}

async function startRound() {
  if (roundActive) return;
  roundActive = true;

  const roundId = Date.now().toString();
  currentRoundId = roundId;
  currentCrashPoint = generateCrashPoint();

  // Сохраняем состояние через GameService (очистит live_events)
  await gameService.startRound(
    roundId,
    currentCrashPoint,
    config.bettingDuration,
  );

  // Публикуем событие для клиентов
  await publishEvent({
    type: 'betting_start',
    duration: Math.floor(config.bettingDuration / 1000),
    cooldownDuration: Math.floor(config.cooldownDuration / 1000),
    roundId,
    crashPoint: currentCrashPoint,
  });

  // Таймер на окончание ставок
  if (bettingTimer) clearTimeout(bettingTimer);
  bettingTimer = setTimeout(() => startFlight(), config.bettingDuration);
}

async function startFlight() {
  if (!roundActive) return;

  // Уведомляем GameService
  await gameService.startFlight(currentRoundId);

  // Публикуем событие
  await publishEvent({ type: 'flight_start', roundId: currentRoundId });

  const startTime = Date.now();
  const durationSec = config.flightDuration / 1000;
  if (flightInterval) clearInterval(flightInterval);
  flightInterval = setInterval(async () => {
    if (!roundActive) return;
    const elapsed = (Date.now() - startTime) / 1000;
    let multiplier = 1 + (elapsed / durationSec) * (currentCrashPoint - 1);
    if (multiplier >= currentCrashPoint) {
      multiplier = currentCrashPoint;
      await gameService.updateMultiplier(currentRoundId, multiplier);
      await publishEvent({
        type: 'multiplier',
        value: multiplier,
        roundId: currentRoundId,
      });
      await crash();
      return;
    }
    await gameService.updateMultiplier(currentRoundId, multiplier);
    await publishEvent({
      type: 'multiplier',
      value: multiplier,
      roundId: currentRoundId,
    });
  }, 100);
}

async function crash() {
  if (flightInterval) {
    clearInterval(flightInterval);
    flightInterval = null;
  }

  const finalMultiplier = await gameService.getCurrentMultiplier(); // или из переменной, но проще взять из Redis
  await gameService.crashRound(currentRoundId, finalMultiplier);
  await publishEvent({
    type: 'crash',
    value: finalMultiplier,
    roundId: currentRoundId,
  });

  roundActive = false;

  if (nextRoundTimeout) clearTimeout(nextRoundTimeout);
  nextRoundTimeout = setTimeout(() => {
    startRound();
  }, config.cooldownDuration);
}

async function main() {
  emitter = await getEmitter();

  redisClient = redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });
  await redisClient.connect();
  // Генератору не нужен io, передаём null
  gameService = new GameService(redisClient);
  console.log('[Generator] Started');
  startRound();

  setInterval(async () => {
    const states = await gameService.getPlayerStates(50);
    emitter.emit('live_table', states);
  }, 500);
}

main().catch(console.error);
