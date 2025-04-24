const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let gameData = {
  head: {},
  tale: {},
  gameHistory: [],
  activePlayers: new Set(),
  currentBets: {},
  isRoundActive: false,
  roundEndTime: null,
  roundStartTime: null // store round start time for syncing
};

const GAME_DURATION = 10; // 10 seconds

const startNewRound = () => {
  gameData.isRoundActive = true;
  gameData.roundStartTime = Date.now();
  gameData.roundEndTime = gameData.roundStartTime + (GAME_DURATION * 1000);

  io.emit("game-start", {
    duration: GAME_DURATION,
    startTime: gameData.roundStartTime
  });

  // End round after GAME_DURATION
  setTimeout(() => endRound(), GAME_DURATION * 1000);
};

const endRound = () => {
  if (!gameData.isRoundActive) return;

  const totalHead = Object.values(gameData.head).reduce((acc, val) => acc + val, 0);
  const totalTale = Object.values(gameData.tale).reduce((acc, val) => acc + val, 0);

  let winner = "";
  if (totalTale < totalHead) winner = "tale";
  else if (totalHead < totalTale) winner = "head";
  else winner = "draw";

  gameData.gameHistory = [...gameData.gameHistory.slice(-9), winner];
  const streak = calculateStreak(gameData.gameHistory);
  const multiplier = calculateMultiplier(streak);

  const playerResults = {};
  for (const [playerId, betData] of Object.entries(gameData.currentBets)) {
    const didWin = betData.side === winner;
    const winAmount = didWin ? betData.amount * parseFloat(multiplier) : 0;
    playerResults[playerId] = {
      won: didWin,
      amount: winAmount,
      originalBet: betData.amount,
      side: betData.side
    };
  }

  io.emit("game-result", {
    totalHead,
    totalTale,
    winner,
    streak,
    multiplier,
    history: gameData.gameHistory,
    playerResults
  });

  // Prepare for next round
  setTimeout(() => {
    gameData.head = {};
    gameData.tale = {};
    gameData.currentBets = {};
    gameData.isRoundActive = false;
    gameData.roundEndTime = null;
    gameData.roundStartTime = null;

    io.emit("reset-game");

    if (gameData.activePlayers.size > 0) {
      startNewRound();
    }
  }, 3000);
};

const calculateStreak = (history) => {
  if (history.length === 0) return 0;
  let streak = 1;
  const lastWinner = history[history.length - 1];
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i] === lastWinner) {
      streak++;
    } else break;
  }
  return streak;
};

const calculateMultiplier = (streak) => {
  const baseMultiplier = 1.5;
  const additionalMultiplier = Math.min(streak - 1, 9) * 0.5;
  return (baseMultiplier + additionalMultiplier).toFixed(2);
};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  gameData.activePlayers.add(socket.id);

  socket.emit("game-history", {
    history: gameData.gameHistory,
    activePlayers: Array.from(gameData.activePlayers)
  });

  // Start game if it's the first player
  if (gameData.activePlayers.size === 1 && !gameData.isRoundActive) {
    startNewRound();
  } else if (gameData.isRoundActive) {
    socket.emit("game-start", {
      duration: GAME_DURATION,
      startTime: gameData.roundStartTime,
      currentBets: gameData.currentBets
    });
  }

  socket.on("play", ({ side, point }) => {
    if (!gameData.isRoundActive) return;

    if (gameData.currentBets[socket.id]) return; // Prevent same player from betting twice

    if (side === "head") {
      gameData.head[socket.id] = point;
    } else if (side === "tale") {
      gameData.tale[socket.id] = point;
    }

    gameData.currentBets[socket.id] = {
      side,
      amount: point
    };

    const totalHead = Object.values(gameData.head).reduce((acc, val) => acc + val, 0);
    const totalTale = Object.values(gameData.tale).reduce((acc, val) => acc + val, 0);

    io.emit("bet-update", {
      head: totalHead,
      tale: totalTale,
      newBet: {
        playerId: socket.id,
        side,
        amount: point
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    gameData.activePlayers.delete(socket.id);
    delete gameData.currentBets[socket.id];
    delete gameData.head[socket.id];
    delete gameData.tale[socket.id];

    io.emit("player-left", {
      playerId: socket.id,
      activePlayers: Array.from(gameData.activePlayers)
    });

    if (gameData.activePlayers.size === 0) {
      gameData.isRoundActive = false;
      gameData.roundEndTime = null;
      gameData.roundStartTime = null;
    }
  });
});

server.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});
