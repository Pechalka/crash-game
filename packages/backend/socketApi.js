// socketApi.js
const initSoketApi = (io, { gameService, userService }) => {
  io.on('connection', async (socket) => {
    let userId = socket.handshake.query.userId;
    if (!userId || userId === 'undefined' || userId === 'null') userId = null;
    socket.data.userId = userId;

    const userInfo = await userService.getUserInfo(userId);
    const gameState = await gameService.getGameState(userId);

    socket.emit('user_info', { user: userInfo, game: gameState });

    // ----- BET -----
    socket.on('bet', async ({ amount }) => {
      if (!userInfo.exists) {
        return socket.emit('error', 'Guest cannot bet');
      }
      if (amount <= 0) {
        return socket.emit('error', 'Invalid amount');
      }

      const result = await gameService.placeBet(userId, amount, userInfo.name);
      if (!result.success) {
        let msg = 'Cannot bet';
        if (result.reason === 'balance') msg = 'Insufficient balance';
        else if (result.reason === 'phase') msg = 'Betting phase is over';
        else if (result.reason === 'time') msg = 'Betting phase is over';
        else if (result.reason === 'duplicate') msg = 'Bet already placed';
        else if (result.reason === 'guest') msg = 'Guest cannot bet';
        return socket.emit('error', msg);
      }

      socket.emit('balance_update', { balance: result.newBalance });
      socket.emit('bet_accepted', { amount });
    });

    // ----- CASHOUT -----
    socket.on('cashout', async () => {
      if (!userInfo.exists) {
        return socket.emit('error', 'Guest cannot cashout');
      }

      const result = await gameService.cashOut(userId);
      if (!result.success) {
        let msg = 'Cannot cashout';
        if (result.reason === 'no_bet') msg = 'No bet placed';
        else if (result.reason === 'phase') msg = 'Cannot cashout now';
        else if (result.reason === 'duplicate') msg = 'Already cashed out';
        else if (result.reason === 'crashed') msg = 'Game crashed';
        else if (result.reason === 'guest') msg = 'Guest cannot cashout';
        return socket.emit('error', msg);
      }

      socket.emit('balance_update', { balance: result.newBalance });
      socket.emit('cashout_success', { win: result.win });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${userId || 'guest'}`);
    });
  });
};

module.exports = { initSoketApi };