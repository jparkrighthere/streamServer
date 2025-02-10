import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { instrument } from '@socket.io/admin-ui';

// 서버 생성 및 Socket.io 연결
const app = express();
const server = http.createServer(app);

// 서버 객체 생성
const io = new Server(server, {
  cors: { origin: '*' },
});

// Socket.io Admin UI 활성화
instrument(io, {
  auth: false
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomName, userName) => {
    // 클라이언트를 특정 방에 참가시킴
    socket.join(roomName);
    // 해당 방에 있는 다른 클라이언트들에게 환영 메시지 전송
    socket.to(roomName).emit('welcome', `${userName} has joined the room`);
  });

  socket.on('offer', (offer, roomName) => {
    socket.to(roomName).emit('offer', offer);
  });

  socket.on('answer', (answer, roomName) => {
    socket.to(roomName).emit('answer', answer);
  });

  socket.on('ice', (ice, roomName) => {
    socket.to(roomName).emit('ice', ice);
  });
});

// 서버 실행
server.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});