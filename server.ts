// import express from 'express';
// import http from 'http';
// import { Server } from 'socket.io';
// import { createClient } from 'redis';
// import dotenv from 'dotenv'; 
// import { instrument } from '@socket.io/admin-ui';

// dotenv.config();

// // 서버 생성 및 Socket.io 연결
// const app = express();
// const server = http.createServer(app);

// // 서버 객체 생성
// const io = new Server(server, {
//   cors: { origin: '*' },
// });

// // Socket.io Admin UI 활성화
// instrument(io, {
//   auth: false
// });
// app.use(express.static('public'));

// app.get('/', (req, res) => {
//   res.sendFile(__dirname + '/index.html');
// });

// io.on('connection', (socket) => {
//   socket.on('join_room', (roomName) => {
//     socket.join(roomName);
//     socket.to(roomName).emit('welcome');
//   });
//   socket.on ('offer', (offer, roomName) => {
//     socket.to(roomName).emit('offer', offer);

//   });
//   socket.on ('answer', (answer, roomName) => {
//     socket.to(roomName).emit('answer', answer);
//   });
//   socket.on('ice', (ice, roomName) => {
//     socket.to(roomName).emit('ice', ice);
//    });
// });

// server.listen(3000, () => {
//   console.log('Socket IO server listening on port 3000');
// });

// // Redis 연결 관련 코드
// const redisClient = createClient({
//   socket: {
//     host: process.env.REDIS_HOST,
//     port: Number(process.env.REDIS_PORT),
//   }
// });

// redisClient.on('connect', () => {
//   console.log('Connected to Redis');
// });

// redisClient.on('error', (err) => {
//   console.error('Redis error:', err);
// });

// redisClient.subscribe('test-channel', (message) => {
//   console.log(`Received message from channel "test-channel": ${message}`);
// });

import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Redis 연결
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  }
});

redisClient.connect().then(() => {
  console.log('Connected to Redis');
  
  // 연결 후 Redis ping 테스트
  redisClient.ping().then((response) => {
    console.log(`Redis ping response: ${response}`);  // PONG 응답 확인
  }).catch((err) => {
    console.error('Error during Redis ping:', err);
  });
}).catch((err) => {
  console.error('Redis connection failed:', err);
});

// Redis 메시지 수신
redisClient.subscribe('test-channel', (message) => {
  console.log(`Received message from channel "test-channel": ${message}`);
});
