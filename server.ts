import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { createClient } from 'redis'; // v4 이상에서 사용
import dotenv from 'dotenv'; 
import { instrument } from '@socket.io/admin-ui';

dotenv.config();

// Redis 연결 관련 코드
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  }
});

redisClient.connect().catch((err) => {
  console.error('Redis 연결 중 오류 발생:', err);
});


redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('error', (err) => {
  console.log('Something went wrong ' + err);
});

redisClient.subscribe('room-channel', (err, count) => {
  if (err) {
    console.error('Failed to subscribe: ', err);
  } else {
    console.log(`Subscribed successfully! This client is currently subscribed to ${count} channels.`);
  }
});

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

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomName) => {
    socket.join(roomName);
    socket.to(roomName).emit('welcome');
  });
  socket.on ('offer', (offer, roomName) => {
    socket.to(roomName).emit('offer', offer);

  });
  socket.on ('answer', (answer, roomName) => {
    socket.to(roomName).emit('answer', answer);
  });
  socket.on('ice', (ice, roomName) => {
    socket.to(roomName).emit('ice', ice);
   });
});

server.listen(3000, () => {
  console.log('Socket IO server listening on port 3000');
});
