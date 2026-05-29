

const initSoketApi =  (io, { gameService, userService }) => {
  io.on('connection', async (socket) => {
    let userId = socket.handshake.query.userId;
    if (!userId || userId === 'undefined' || userId === 'null') {
      userId = null;
    }
    socket.data.userId = userId;

    const { balance, name, exists } = await userService.getUserById(userId);
    const gameState = await gameService.getGameState(userId); // получаем состояние игры

    // Отправляем одним событием пользователя и состояние игры
    socket.emit('user_info', {
      user: { balance, name, exists },
      game: gameState,
    });

    console.log(
      `[Socket] Connected: userId=${userId}, name=${name}, exists=${exists}`,
    );

    // --- Обработчики bet / cashout пока пустые (добавим позже) ---
    socket.on('bet', async ({ amount }) => {
      const user = await userService.getUserById(userId);

      if (!user) return socket.emit('error', 'User not found');
      const ok = await gameService.registerBet(userId, amount, user.name);
      if (!ok) return socket.emit('error', 'Cannot bet');

      const balance = await userService.updateBalance(userId, -amount);

      socket.emit('balance_update', { balance });
      socket.emit('bet_accepted', { amount }); // ← вот здесь
    });

    socket.on('cashout', async () => {
      const user = await userService.getUserById(userId);

      if (!user) return socket.emit('error', 'User not found');

      const betAmount = await gameService.getBet(userId);
      if (!betAmount) return socket.emit('error', 'No bet placed');

      const multiplier = await gameService.getCurrentMultiplier();
      const win = betAmount * multiplier;

      const ok = await gameService.registerCashout(
        userId,
        win,
        multiplier,
        user.name,
      );
      if (!ok) return socket.emit('error', 'Cannot cashout');

      const balance = await userService.updateBalance(userId, +win);

      socket.emit('balance_update', { balance });
      socket.emit('cashout_success', { win });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${userId || 'anonymous'}`);
    });
  });
};

module.exports = { initSoketApi };
