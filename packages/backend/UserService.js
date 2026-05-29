// UserService.js
class UserService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  // Получение информации о пользователе (всегда возвращает объект, даже если не существует)
  async getUserInfo(userId) {
    if (!userId || userId === 'undefined' || userId === 'null') {
      return { exists: false, name: 'Guest', balance: 0 };
    }
    const balance = await this.redis.get(`user:${userId}:balance`);
    if (balance === null) {
      return { exists: false, name: 'Guest', balance: 0 };
    }
    const name = await this.redis.get(`user:${userId}:name`) || `User${userId}`;
    return { exists: true, name, balance: parseFloat(balance) };
  }

  // Создание тестового пользователя (если ещё не существует)
  async createTestUser(userId, name, initialBalance) {
    const exists = await this.redis.exists(`user:${userId}:balance`);
    if (!exists) {
      await this.redis.set(`user:${userId}:balance`, initialBalance);
      await this.redis.set(`user:${userId}:name`, name);
      console.log(`[UserService] Created test user: ${userId} (${name}) with balance ${initialBalance}`);
    }
    return { userId, name, balance: initialBalance };
  }
}

module.exports = UserService;