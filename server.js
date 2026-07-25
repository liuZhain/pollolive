const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  // ===== JOIN ROOM =====
  socket.on('join-room', ({ roomCode, username, isAdmin, password }) => {
    if (!rooms[roomCode]) {
      rooms[roomCode] = {
        users: [],
        votes: {},
        votedUsers: [],
        options: ['A', 'B', 'C', 'D'],
        optionLabels: ['Opsi A', 'Opsi B', 'Opsi C', 'Opsi D'],
        isActive: false,
        adminId: null,
        maxVotes: 1,
        password: null,
        createdAt: new Date()
      };
    }

    const room = rooms[roomCode];

    // Cek password
    if (room.password && room.password !== password) {
      socket.emit('error', '❌ Password room salah!');
      return;
    }

    if (!room.password && password) {
      room.password = password;
    }

    // Cek admin
    let userIsAdmin = isAdmin;
    if (isAdmin && room.adminId) {
      userIsAdmin = false;
      socket.emit('warning', '⚠️ Room sudah punya admin! Kamu masuk sebagai peserta.');
    }

    if (isAdmin && !room.adminId) {
      room.adminId = socket.id;
    }

    const userData = {
      id: socket.id,
      username: username,
      isAdmin: userIsAdmin || false,
      hasVoted: false
    };

    room.users.push(userData);
    socket.join(roomCode);
    socket.data.room = roomCode;
    socket.data.username = username;

    io.to(roomCode).emit('room-update', {
      users: room.users,
      options: room.options,
      optionLabels: room.optionLabels,
      isActive: room.isActive,
      votes: room.votes,
      isAdmin: userIsAdmin || false,
      maxVotes: room.maxVotes,
      hasVoted: false,
      adminId: room.adminId
    });

    io.to(roomCode).emit('voted-users', room.votedUsers);
  });

  // ===== ADMIN: UPDATE OPSI =====
  socket.on('update-options', ({ roomCode, options, optionLabels, maxVotes }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const user = room.users.find(u => u.id === socket.id);
    if (!user || !user.isAdmin) {
      socket.emit('error', '❌ Anda bukan admin!');
      return;
    }

    room.options = options;
    room.optionLabels = optionLabels;
    room.maxVotes = maxVotes || 1;
    room.votes = {};
    room.votedUsers = [];
    room.users.forEach(u => u.hasVoted = false);

    io.to(roomCode).emit('room-update', {
      users: room.users,
      options: room.options,
      optionLabels: room.optionLabels,
      isActive: room.isActive,
      votes: room.votes,
      isAdmin: true,
      maxVotes: room.maxVotes,
      hasVoted: false,
      adminId: room.adminId
    });

    io.to(roomCode).emit('voted-users', []);
    io.to(roomCode).emit('notification', {
      message: '📋 Opsi polling telah diupdate oleh admin!',
      type: 'info'
    });
  });

  // ===== ADMIN: START/STOP POLLING =====
  socket.on('toggle-polling', ({ roomCode, isActive }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const user = room.users.find(u => u.id === socket.id);
    if (!user || !user.isAdmin) {
      socket.emit('error', '❌ Anda bukan admin!');
      return;
    }

    room.isActive = isActive;
    if (!isActive) {
      room.votes = {};
      room.votedUsers = [];
      room.users.forEach(u => u.hasVoted = false);
      io.to(roomCode).emit('voted-users', []);
    }

    io.to(roomCode).emit('room-update', {
      users: room.users,
      options: room.options,
      optionLabels: room.optionLabels,
      isActive: room.isActive,
      votes: room.votes,
      isAdmin: true,
      maxVotes: room.maxVotes,
      hasVoted: false,
      adminId: room.adminId
    });

    io.to(roomCode).emit('notification', {
      message: isActive ? '🟢 Polling dimulai! Silakan vote.' : '🔴 Polling dihentikan!',
      type: isActive ? 'success' : 'warning'
    });
  });

  // ===== VOTE (MULTIPLE) =====
  socket.on('send-vote', ({ roomCode, options }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error', '❌ Room tidak ditemukan!');
      return;
    }
    
    if (!room.isActive) {
      socket.emit('error', '❌ Polling belum dimulai!');
      return;
    }

    const user = room.users.find(u => u.id === socket.id);
    if (!user) {
      socket.emit('error', '❌ User tidak ditemukan!');
      return;
    }
    
    if (user.hasVoted) {
      socket.emit('error', '❌ Anda sudah vote!');
      return;
    }

    if (options.length > room.maxVotes) {
      socket.emit('error', `❌ Maksimal pilih ${room.maxVotes} opsi!`);
      return;
    }

    options.forEach(option => {
      if (!room.options.includes(option)) {
        socket.emit('error', `❌ Opsi ${option} tidak valid!`);
        return;
      }

      if (!room.votes[option]) {
        room.votes[option] = 0;
      }
      room.votes[option]++;
    });

    user.hasVoted = true;
    room.votedUsers.push(socket.id);

    io.to(roomCode).emit('vote-update', room.votes);
    io.to(roomCode).emit('voted-users', room.votedUsers);
    io.to(roomCode).emit('notification', {
      message: `🗳️ ${user.username} telah vote (${options.length} pilihan)!`,
      type: 'vote'
    });
  });

  // ===== ADMIN: RESET POLLING =====
  socket.on('reset-poll', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;

    const user = room.users.find(u => u.id === socket.id);
    if (!user || !user.isAdmin) {
      socket.emit('error', '❌ Anda bukan admin!');
      return;
    }

    room.votes = {};
    room.votedUsers = [];
    room.users.forEach(u => u.hasVoted = false);

    io.to(roomCode).emit('vote-update', room.votes);
    io.to(roomCode).emit('voted-users', []);
    io.to(roomCode).emit('notification', {
      message: '🔄 Semua suara telah direset oleh admin!',
      type: 'warning'
    });
  });

  // ===== CHANGE THEME =====
  socket.on('change-theme', ({ roomCode, color }) => {
    io.to(roomCode).emit('theme-updated', { color });
  });

  // ===== DISCONNECT =====
  socket.on('disconnect', () => {
    const roomCode = socket.data.room;
    if (!roomCode || !rooms[roomCode]) return;

    const room = rooms[roomCode];
    const username = socket.data.username || 'Unknown';
    
    room.users = room.users.filter(u => u.id !== socket.id);

    if (room.adminId === socket.id) {
      room.adminId = null;
    }

    io.to(roomCode).emit('room-update', {
      users: room.users,
      options: room.options,
      optionLabels: room.optionLabels,
      isActive: room.isActive,
      votes: room.votes,
      isAdmin: false,
      maxVotes: room.maxVotes,
      hasVoted: false,
      adminId: room.adminId
    });

    io.to(roomCode).emit('notification', {
      message: `👋 ${username} meninggalkan room`,
      type: 'info'
    });
  });
});

// ===== PORT UNTUK DEPLOY =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Pollive running on port ${PORT}`);
});