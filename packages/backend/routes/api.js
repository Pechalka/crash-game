// routes/api.js
const express = require('express');
const { createClient } = require('@clickhouse/client');
const router = express.Router();

// Инициализируем клиент ClickHouse (один раз для этого роутера)
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'changeme',
  database: 'crash',
});

// Эндпоинт для создания тестовых пользователей (принимает userService)
module.exports = (userService) => {
  router.get('/api/test-users', async (req, res) => {
    const testUsers = [
      { id: '1', name: 'Alice', balance: 1000 },
      { id: '2', name: 'Bob', balance: 5000 },
      { id: '3', name: 'Charlie', balance: 2000 },
    ];
    for (const u of testUsers) {
      await userService.createTestUser(u.id, u.name, u.balance);
    }
    res.json({ message: 'Test users created', users: testUsers });
  });

  // Эндпоинт истории пользователя
  // routes/api.js – исправленный эндпоинт истории
  router.get('/api/user/:userId/history', async (req, res) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    try {
      const result = await clickhouse.query({
        query: `
        SELECT 
          event_time, 
          event_type, 
          bet_id,
          round_id,
          amount, 
          win_amount, 
          multiplier, 
          status
        FROM game_events
        WHERE user_id = '${userId}'
        ORDER BY event_time DESC
        LIMIT ${limit}
      `,
        format: 'JSONEachRow',
      });
      const rows = await result.json();
      res.json(rows);
    } catch (err) {
      console.error('History error:', err);
      res
        .status(500)
        .json({ error: 'Unable to fetch history', details: err.message });
    }
  });

  return router;
};
