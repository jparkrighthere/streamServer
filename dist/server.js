"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const admin_ui_1 = require("@socket.io/admin-ui");
//import mediasoup from 'mediasoup';
// 서버 생성 및 Socket.io 연결
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
// 서버 객체 생성
const io = new socket_io_1.Server(server, {
    cors: { origin: '*' },
});
// Socket.io Admin UI 활성화
(0, admin_ui_1.instrument)(io, {
    auth: false
});
let worker;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];
// const createWorker = async () => {
//   worker = await mediasoup.createWorker({
//     rtcMinPort: 2000,
//     rtcMaxPort: 2100,
//   });
//   console.log(`worker pid=${worker.pid}`);
//   // mediasoup 내장 함수. worker process 가 예상치 않게 끊겼을 때 'died' 이벤트가 emit
//   worker.on('died', error => {
//     console.error('mediasoup worker died:', error);
//     setTimeout(() => process.exit(1), 2000);
//   });
//   return worker;
// }
// worker = createWorker();
// const mediaCodecs = [
//   {
//     kind: 'audio',
//     mimeType: 'audio/opus',
//     clockRate: 48000,
//     channels: 2,
//   },
//   {
//     kind: 'video',
//     mimeType: 'video/VP8',
//     clockRate: 90000,
//     parameters: {
//       'x-google-start-bitrate': 1000,
//     },
//   },
// ];
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
