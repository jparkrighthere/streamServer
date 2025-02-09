import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);

// WebSocket server (direct connection with Spring)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Connected to Spring WebSocket server.');

  ws.on('message', (message) => {
    console.log('Received message from Spring:', message.toString());
  });

  ws.on('close', () => {
    console.log('Connection with Spring WebSocket server closed.');
  });
});

// Socket.IO server (connection with client)
const io = new Server(server, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  console.log('Connected to Socket.IO client.');

  socket.on('message', (message) => {
    console.log('Received message from client:', message);
    const [userName, roomId] = parseMessage(message);
    if (roomId) {
      handleRoomCreation(socket, roomId, userName);
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket.IO client disconnected.');
  });
});

// Message parsing
function parseMessage(message : any) {
  const parts = message.split(',');
  const userName = parts[0];
  const roomId = parts[1];
  return [userName, roomId];
}

// Room creation/participation handling
function handleRoomCreation(socket : any, roomId : any, userName : any) {
  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);

  if (!socketsInRoom) {
    socket.join(roomId);
    io.to(roomId).emit('welcome', `${userName} has created room ${roomId}`);
  } else {
    io.to(roomId).emit('welcome', `${userName} has joined room ${roomId}`);
  }
}

server.listen(3000, () => {
  console.log('Node.js server is running on port 3000');
});
