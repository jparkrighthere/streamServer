import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// DB 연결
const client = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  }
});

client.on('connect', () => {
  console.log('Redis client connected');
});

client.on('error', (err) => {
  console.log('Something went wrong ' + err);
});


// 서버 생성 및 Socket.io 연결
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*" },
  });

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index-room.html');
  });
  

const chat = io.of('/chat').on('connection', (socket) => {
  console.log('a user connected to /chat');

  // 클라이언트로부터 'chat message' 이벤트를 받을 때
  socket.on('chat message', (data: { name: string, room: string, msg: string }) => {
    console.log('message from client: ', data);

    const { name, room, msg } = data;

    // 소켓에 name과 room 저장
    socket.data.name = name;
    socket.data.room = room;

    // 방에 join
    socket.join(room);

    // 방에 있는 클라이언트들에게 메시지를 전송
    chat.to(room).emit('chat message', msg);
  });

  // 클라이언트가 연결을 끊었을 때
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});
  
// 서버를 3000번 포트에서 실행
server.listen(3000, () => {
  console.log('Socket IO server listening on port 3000');
});