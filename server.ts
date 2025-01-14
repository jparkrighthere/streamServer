import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import dotenv from 'dotenv'; 
import { instrument } from '@socket.io/admin-ui';

dotenv.config();

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
  socket.on('join_room', (roomName, userName) => {
    socket.join(roomName);
    socket.to(roomName).emit(`welcome ${userName}`);
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

// Redis 연결
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  }
});

redisClient.connect()
  .then(() => {
    console.log('Connected to Redis');
    // 패턴 기반 구독 (room:*)
    redisClient.pSubscribe('room:*', (message, channel) => {
      console.log(message);

      const roomName = channel.split(':')[1];
      const userName = message;

      //TODO: 실제로 생성이 되었는지 확인을 해봐야함
      io.emit('join_room', roomName, userName); 
    });
  })
  .catch((err) => {
    console.error('Redis connection failed:', err);
  });