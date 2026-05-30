// mock-casino.js
const express = require('express');
const app = express();
app.use(express.json());

// Хранилище для идемпотентности
const processedRequests = new Map(); // key -> { status, response }

// Настройки (можно через env)
const LATENCY_MS = parseInt(process.env.MOCK_LATENCY_MS || '100');
const ERROR_RATE = parseFloat(process.env.MOCK_ERROR_RATE || '0'); // 0 = нет ошибок, 0.1 = 10% ошибок

function randomError() {
  return Math.random() < ERROR_RATE;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Общий обработчик для идемпотентности
async function handleWithIdempotency(req, res, operation) {
  const idempotencyKey = req.body.idempotencyKey || req.body.betId;
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'idempotencyKey or betId required' });
  }

  if (processedRequests.has(idempotencyKey)) {
    const cached = processedRequests.get(idempotencyKey);
    console.log(`[Mock] Idempotent hit for ${idempotencyKey}, returning cached response`);
    return res.status(cached.status).json(cached.response);
  }

  if (randomError()) {
    const errStatus = 500;
    const errResponse = { error: 'Random simulated error' };
    processedRequests.set(idempotencyKey, { status: errStatus, response: errResponse });
    return res.status(errStatus).json(errResponse);
  }

  await delay(LATENCY_MS);
  const result = operation(req.body);
  processedRequests.set(idempotencyKey, { status: 200, response: result });
  res.json(result);
}

// POST /bet
app.post('/bet', async (req, res) => {
  await handleWithIdempotency(req, res, (body) => {
    console.log('[Mock] Bet request:', body);
    return { status: 'ok', transactionId: `tx_${Date.now()}` };
  });
});

// POST /win
app.post('/win', async (req, res) => {
  await handleWithIdempotency(req, res, (body) => {
    console.log('[Mock] Win request:', body);
    return { status: 'ok', winTransactionId: `win_${Date.now()}` };
  });
});

const PORT = process.env.MOCK_CASINO_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mock casino running on http://localhost:${PORT}`);
  console.log(`Latency: ${LATENCY_MS}ms, Error rate: ${ERROR_RATE * 100}%`);
});