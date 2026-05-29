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

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = createServer(server);

initRediceAdapter(io).then(async () => {
  const redisClient = redis.createClient({ url: process.env.REDIS_URL });
  await redisClient.connect();

  const gameService = new GameService(redisClient);
  const userService = new UserService(redisClient);
  // init services if need
  initSoketApi(io, { gameService, userService });

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
});
