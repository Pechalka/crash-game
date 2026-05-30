# Инфраструктура для разработки

## Запуск
```bash
cd infra
docker-compose up -d
```

## Сервисы
- Redis: `localhost:6379``
- Redis Commander (Web UI): `http://localhost:8081`
- ClickHouse: `localhost:8123` (HTTP), `localhost:9000` (native)
- ClickHouse Web UI: `http://localhost:8123/play`

## Остановка
```bash
cd infra
docker-compose down -v   # удалит также данные (volumes)
```

## База для логов

создание базы и таблиц
```bash
cd packages/backend
node init-clickhouse.js

```