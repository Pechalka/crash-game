const { createClient } = require('@clickhouse/client');

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'changeme',
});

async function initClickHouse() {
  try {
    // 1. Создаём базу данных, если её нет
    await clickhouse.command({
      query: 'CREATE DATABASE IF NOT EXISTS crash',
    });
    console.log('Database "crash" is ready');

    // 2. Создаём таблицу game_events, если её нет
    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS crash.game_events (
          event_time DateTime,
          event_type String,
          user_id String,
          bet_id String,
          round_id String,
          amount Float64,
          win_amount Float64,
          multiplier Float64,
          status String,
          error_message String
        ) ENGINE = MergeTree()
        ORDER BY (event_time, user_id)
        TTL event_time + INTERVAL 90 DAY
      `,
    });
    console.log('Table "crash.game_events" is ready');

    console.log('ClickHouse initialization completed');
  } catch (err) {
    console.error('ClickHouse initialization failed:', err);
    process.exit(1);
  }
}

initClickHouse();