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

// Redis 연결
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  }
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

redisClient
  .connect()
  .then(() => {
    console.log('Connected to Redis');

    redisClient.pSubscribe('room:*', (message, channel) => {
      console.log(`Received message: ${message} on channel: ${channel}`);

      const roomName = channel.split(':')[1];
      const userName = message;

      // 특정 방의 존재 여부 확인 후 생성/참가
      const socketsInRoom = io.sockets.adapter.rooms.get(roomName);

      if (!socketsInRoom) {
        // 방이 존재하지 않으면 새로 생성
        io.emit('join_room', roomName, userName); // 방 생성 후 참가
      } else {
        // 방이 이미 존재하면 참가
        io.to(roomName).emit('welcome', `${userName} has joined the room`);
      }
    });
  })
  .catch((err) => {
    console.error('Redis connection failed:', err);
  });
