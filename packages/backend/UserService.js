// ---- Хранилище пользователей (в памяти) ----
const players = {
  1: { balance: 1000, name: 'Alice' },
  2: { balance: 5000, name: 'Bob' },
  3: { balance: 2000, name: 'Charlie' },
};

class UserService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  getUserById = (userId) => {
    let name = 'Guest';
    let balance = 0;
    let exists = false;

    const userInfo = players[userId] || null;

    if (userId && userInfo) {
      exists = true;
      name = userInfo.name;
      balance = userInfo.balance;
    } else if (userId) {
      // userId передан, но не существует
      exists = false;
      name = 'Guest';
      balance = 0;
    } else {
      // userId отсутствует
      exists = false;
      name = 'Guest (no id)';
      balance = 0;
    }

    return { exists, name, balance };
  };

  updateBalance(userId, amount) {
    players[userId].balance += amount;

    return players[userId].balance; 
  }
}

module.exports = UserService;
