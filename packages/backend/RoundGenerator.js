// RoundGenerator.js
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

let gameService, emitter, redisClient;
let roundActive = false;
let bettingTimer = null, flightInterval = null, nextRoundTimeout = null;
let currentCrashPoint = null;

function generateCrashPoint() {
  const r = Math.random();
  const point = config.minCrashPoint + Math.pow(r, config.distributionPower) * (config.maxCrashPoint - config.minCrashPoint);
  return Math.min(config.maxCrashPoint, Math.max(config.minCrashPoint, point));
}

async function startRound() {
  if (roundActive) return;
  roundActive = true;
  currentCrashPoint = generateCrashPoint();

  await gameService.startRound(currentCrashPoint, config.bettingDuration);
  emitter.emit('game_event', {
    type: 'betting_start',
    duration: Math.floor(config.bettingDuration / 1000),
    cooldownDuration: Math.floor(config.cooldownDuration / 1000),
  });

  bettingTimer = setTimeout(() => startFlight(), config.bettingDuration);
}

async function startFlight() {
  if (!roundActive) return;
  await gameService.startFlight();
  emitter.emit('game_event', { type: 'flight_start' });

  const startTime = Date.now();
  const durationSec = config.flightDuration / 1000;
  if (flightInterval) clearInterval(flightInterval);
  flightInterval = setInterval(async () => {
    if (!roundActive) return;
    const elapsed = (Date.now() - startTime) / 1000;
    let multiplier = 1 + (elapsed / durationSec) * (currentCrashPoint - 1);
    if (multiplier >= currentCrashPoint) {
      multiplier = currentCrashPoint;
      await gameService.updateMultiplier(multiplier);
      emitter.emit('game_event', { type: 'multiplier', value: multiplier });
      await crash();
      return;
    }
    await gameService.updateMultiplier(multiplier);
    emitter.emit('game_event', { type: 'multiplier', value: multiplier });
  }, 100);
}

async function crash() {
  if (flightInterval) clearInterval(flightInterval);
  flightInterval = null;
  await gameService.crashRound(currentCrashPoint, config.cooldownDuration);
  emitter.emit('game_event', { type: 'crash', value: currentCrashPoint });
  roundActive = false;
  nextRoundTimeout = setTimeout(() => startRound(), config.cooldownDuration);
}

async function main() {
  emitter = await getEmitter();
  redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  await redisClient.connect();
  gameService = new GameService(redisClient);
  console.log('[Generator] Started');

  // Рассылка live_table каждые 500 мс
  setInterval(async () => {
    const table = await gameService.getLiveTable(50);
    emitter.emit('live_table', table);
  }, 500);

  startRound();
}

main().catch(console.error);