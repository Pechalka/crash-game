import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

function App() {
  const [phase, setPhase] = useState('betting');
  const [multiplier, setMultiplier] = useState(1.0);
  const [countdown, setCountdown] = useState(0);
  const [balance, setBalance] = useState(0);
  const [betAmount, setBetAmount] = useState(10);
  const [hasBet, setHasBet] = useState(false);
  const [hasCashedOut, setHasCashedOut] = useState(false);
  const [message, setMessage] = useState('');
  const [userId] = useState(
    () => new URLSearchParams(window.location.search).get('userId'),
  );
  const [userName, setUserName] = useState('');
  const [liveTable, setLiveTable] = useState([]);
  const [userExists, setUserExists] = useState(true);

  const socketRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const cooldownTimeoutRef = useRef(null);
  const [cooldownDuration, setCooldownDuration] = useState(3);

  // Функция для запуска обратного отсчёта
  const startCountdown = (seconds) => {
    if (countdownIntervalRef.current)
      clearInterval(countdownIntervalRef.current);
    setCountdown(seconds);
    let remaining = seconds;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownIntervalRef.current);
      }
    }, 1000);
  };

  useEffect(() => {
    socketRef.current = io('/', { query: { userId } });
    const socket = socketRef.current;

    socket.on('user_info', ({ user, game }) => {
      // Данные пользователя
      setBalance(user.balance);
      setUserName(user.name);
      setUserExists(user.exists);
      if (!user.exists) setMessage('User not found, you cannot bet');

      // Восстановление состояния игры
      setPhase(game.phase);
      setMultiplier(game.multiplier);
      setHasBet(game.hasBet);
      setHasCashedOut(game.hasCashedOut);
      if (game.betAmount) setBetAmount(game.betAmount);

      // Таймеры
      if (game.phase === 'betting' && game.remainingBettingTime > 0) {
        const seconds = Math.ceil(game.remainingBettingTime / 1000);
        startCountdown(seconds);
      } else if (game.phase === 'flying') {
        setCountdown(0);
      } else if (game.phase === 'crashed') {
        setMessage(`CRASH at ${game.multiplier.toFixed(2)}x!`);
        if (game.remainingCooldownTime > 0) {
          // можно показать таймер до следующего раунда, но не обязательно
        }
      }
    });

    socket.on('game_event', (event) => {
      switch (event.type) {
        case 'betting_start':
          if (countdownIntervalRef.current)
            clearInterval(countdownIntervalRef.current);
          if (cooldownTimeoutRef.current)
            clearTimeout(cooldownTimeoutRef.current);
          setPhase('betting');
          setHasBet(false);
          setHasCashedOut(false);
          setMultiplier(1.0);
          setMessage('Place your bets!');
          if (event.duration) {
            startCountdown(event.duration);
          }
          if (event.cooldownDuration)
            setCooldownDuration(event.cooldownDuration);
          break;
        case 'flight_start':
          if (countdownIntervalRef.current)
            clearInterval(countdownIntervalRef.current);
          setPhase('flying');
          setCountdown(0);
          setMessage('Flight started!');
          break;
        case 'multiplier':
          setMultiplier(event.value);
          break;
        case 'crash':
          setPhase('crashed');
          setMessage(`CRASH at ${event.value.toFixed(2)}x!`);
          if (cooldownTimeoutRef.current)
            clearTimeout(cooldownTimeoutRef.current);
          cooldownTimeoutRef.current = setTimeout(
            () => {},
            cooldownDuration * 1000,
          );
          break;
        default:
          break;
      }
    });

    socket.on('balance_update', ({ balance: newBalance }) =>
      setBalance(newBalance),
    );
    socket.on('bet_accepted', ({ amount }) => {
      setHasBet(true);
      setMessage(`Bet ${amount} accepted!`);
    });
    socket.on('cashout_success', ({ win }) => {
      setHasCashedOut(true);
      setMessage(`You cashed out ${win.toFixed(2)}!`);
    });
    socket.on('error', (err) => setMessage(`Error: ${err}`));
    socket.on('live_table', (entries) => {
        console.log('entries ', entries);
        setLiveTable(entries)
    });

    return () => {
      socket.disconnect();
      if (countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
      if (cooldownTimeoutRef.current) clearTimeout(cooldownTimeoutRef.current);
    };
  }, [userId, cooldownDuration]);

  const placeBet = () => {
    if (!socketRef.current) return;
    if (phase !== 'betting') {
      setMessage('Betting phase is over');
      return;
    }
    if (hasBet) {
      setMessage('Bet already placed');
      return;
    }
    if (betAmount <= 0) {
      setMessage('Bet amount must be positive');
      return;
    }
    if (balance < betAmount) {
      setMessage('Insufficient balance');
      return;
    }
    socketRef.current.emit('bet', { amount: betAmount });
  };

  const cashout = () => {
    if (!socketRef.current) return;
    if (phase !== 'flying') {
      setMessage('Cannot cashout now');
      return;
    }
    if (!hasBet) {
      setMessage('No bet placed');
      return;
    }
    if (hasCashedOut) {
      setMessage('Already cashed out');
      return;
    }
    socketRef.current.emit('cashout');
  };

  const isBetDisabled = phase !== 'betting' || hasBet || !userExists;
  const isCashoutDisabled =
    phase !== 'flying' || !hasBet || hasCashedOut || !userExists;

  return (
    <div className='app'>
      <div className='history-panel'>
        <h3>📋 Игроки (первые 50)</h3>
        <div className='table-wrapper'>
          <table>
            <thead>
              <tr>
                <th>Игрок</th>
                <th>Ставка</th>
                <th>Выигрыш</th>
                <th>Множитель</th>
              </tr>
            </thead>
            <tbody>
              {liveTable.map((player) => (
                <tr key={player.userId}>
                  <td>{player.name}</td>
                  <td>{player.betAmount.toFixed(2)}</td>
                  <td>{player.win ? player.win.toFixed(2) : '-'}</td>
                  <td>{player.multiplier ? `${player.multiplier}x` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className='game-panel'>
        <div className='user-id'>👤 {userName}</div>
        <div className='balance'>💎 Баланс: {balance.toFixed(2)}</div>
        <div className='multiplier'>
          {phase === 'betting' && countdown > 0
            ? `${countdown} сек`
            : `${multiplier.toFixed(2)}x`}
        </div>
        <div className='message'>{message}</div>
        <div className='controls'>
          <input
            type='number'
            value={betAmount}
            onChange={(e) => setBetAmount(parseFloat(e.target.value))}
            disabled={isBetDisabled}
            step='1'
            min='1'
          />
          <button onClick={placeBet} disabled={isBetDisabled}>
            СТАВКА
          </button>
          <button onClick={cashout} disabled={isCashoutDisabled}>
            ЗАБРАТЬ
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
