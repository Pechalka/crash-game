// index.js
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), '.env') });

const redis = require('redis');
const express = require('express');
const http = require('http');
const GameService = require('./GameService');
const UserService = require('./UserService');
const { initRediceAdapter, createServer } = require('./socket-io-setup');
const { initSoketApi } = require('./socketApi');
const { createBullQueue } = require('./queue');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = createServer(server);

initRediceAdapter(io).then(async () => {
  const redisClient = redis.createClient({ url: process.env.REDIS_URL });
  await redisClient.connect();

  const gameService = new GameService(redisClient);
  const userService = new UserService(redisClient);
  const betQueue = createBullQueue('bet-queue');
  const cashoutQueue = createBullQueue('cashout-queue');

  // REST: создание тестовых пользователей
  app.get('/api/test-users', async (req, res) => {
    const testUsers = [
      { id: '1', name: 'Alice', balance: 1000 },
      { id: '2', name: 'Bob', balance: 5000 },
      { id: '3', name: 'Charlie', balance: 2000 }
    ];
    for (const u of testUsers) {
      await userService.createTestUser(u.id, u.name, u.balance);
    }
    res.json({ message: 'Test users created', users: testUsers });
  });

  initSoketApi(io, { gameService, userService, betQueue, cashoutQueue  });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(`Test users endpoint: GET http://localhost:${PORT}/api/test-users`);
  });
});