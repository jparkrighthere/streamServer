import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import * as mediasoup from 'mediasoup';
import { MediaKind } from 'mediasoup/node/lib/rtpParametersTypes';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

type Worker = mediasoup.types.Worker;
type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;
type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;

type Room = {
  router: Router;
  peers: Peer[];
};

type Peer = {
  socket: Socket;
  roomName: string;
  sendtransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producer?: Producer;
  consumers: Consumer[];
};

let worker: Worker;
const rooms: Record<string, Room> = {};
const peers: Record<string, Peer> = {};

async function initMediasoup() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2100,
  });
  console.log('✅ Mediasoup initialized');
}

io.on('connection', (socket: Socket) => {
  console.log(`🔥 New client connected: ${socket.id}`);

  // Join room
  socket.on('join-room', async ({ roomName }: { roomName: string }, callback) => {
    socket.join(roomName);
    const router = await getOrCreateRoom(roomName);
    peers[socket.id] = {
      socket,
      roomName: roomName,
      sendtransport: undefined,
      recvTransport: undefined,
      producer: undefined,
      consumers: [],
    };
    rooms[roomName].peers.push(peers[socket.id]);
    socket.emit('room-joined', { success: true });
  });
  const getOrCreateRoom = async (roomName: string): Promise<Router> => {
    if (rooms[roomName]) return rooms[roomName].router;
    
    const router = await worker.createRouter({
      mediaCodecs: [
        { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
        { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
      ],
    });
    rooms[roomName] = { router, peers: [] };
    return router;
  };


  // Get RTP capabilities
  socket.on('get-rtp-capabilities', async ({ roomName }: { roomName: string }, callback) => {
    const router = rooms[roomName].router;
    if (!router) return callback({ error: 'Room not found' });
    callback({ rtpCapabilities: router.rtpCapabilities });
  });


  // Create transport
  socket.on('create-transport', async ({ roomName, direction }: { roomName: string; direction: 'send' | 'recv' }, callback) => {
    const room = rooms[roomName];
    if (!room) return callback({ error: 'Room not found' });

    let transport: WebRtcTransport | undefined;
    if (direction === 'recv') {
      if (!peers[socket.id].recvTransport) {
        transport = await createWebRtcTransport(room.router);
        peers[socket.id].recvTransport = transport;

        transport.on('dtlsstatechange', (dtlsParameters) => {
          socket.emit('connect-transport', { roomName, dtlsParameters });
        });
      } else {
        transport = peers[socket.id].recvTransport;
      }
    }
    else if (direction === 'send') {
      if (!peers[socket.id].sendtransport) {
        transport = await createWebRtcTransport(room.router);
        peers[socket.id].sendtransport = transport;

        transport.on('dtlsstatechange', (dtlsParameters) => {
          socket.emit('connect-transport', { roomName, dtlsParameters });
        });
      } else {
        transport = peers[socket.id].sendtransport;
      }
    }

    if (transport) {
      callback({
        transportId: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } 
    else {
      callback({ error: 'Transport could not be created' });
    }
  });

  const createWebRtcTransport = async (router: Router): Promise<WebRtcTransport> => {
    return new Promise(async (resolve, reject) => {
      try {
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: '127.0.0.1', announcedIp: undefined }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });
        resolve(transport);
      }
      catch (error) {
        reject(error);
      }
    });
  };

  // Connect transport
  socket.on('connect-transport', async ({ roomName, dtlsParameters, direction }: { roomName: string; dtlsParameters: any, direction : 'send' | 'recv' }, callback) => {
    const room = rooms[roomName];
    if (!room) return callback({ error: 'Room not found' });

    let transport: WebRtcTransport | undefined;
    if (direction === 'recv') {
      transport = peers[socket.id].recvTransport;
    } else if (direction === 'send') {  
      transport = peers[socket.id].sendtransport;
    }
    if (!transport) return callback({ error: 'Transport not found' });

    transport.connect({ dtlsParameters }).then(() => {
      callback({ success: true });
    }).catch((error) => {
      callback({ error: error });
    });
  });

  // Produce
  socket.on('produce', async ({ roomName, kind, rtpParameters }: { roomName: string; kind: MediaKind; rtpParameters: any }, callback) => {
    try {
      const transport = peers[socket.id].sendtransport;
      if (!transport) return callback({ error: 'Transport not found' });

      const producer = await transport.produce({ kind, rtpParameters });
      peers[socket.id].producer = producer;
      callback({ id: producer.id });
    } catch (error) {
      callback({ error: error });
    }
  });

  // Consume
  socket.on('consume', async ({ roomName, transportId, producerId, rtpCapabilities }: { roomName: string; transportId: string; producerId: string; rtpCapabilities: mediasoup.types.RtpCapabilities }, callback) => {
    try {
      const transport = peers[socket.id].recvTransport;
      if (!transport) return callback({ error: 'Transport not found' });

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false,
      });
      peers[socket.id].consumers.push(consumer);
      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        producerPaused: consumer.producerPaused,
      });
    } catch (error) {
      callback({ error: error });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
    const peer = peers[socket.id];
    const roomName = peer.roomName;

    if (!peer) return;
    delete peers[socket.id];
    delete peers[socket.id].sendtransport;
    delete peers[socket.id].recvTransport;
    peer.producer?.close();
    delete peers[socket.id].producer;
    peer.consumers.forEach(consumer => consumer.close());
    rooms[roomName].peers = rooms[roomName].peers.filter(peer => peer.socket.id !== socket.id);

    if (rooms[roomName].peers.length === 0) {
      rooms[roomName].router.close();
      delete rooms[roomName];
    }
  });
});

server.listen(3000, async () => {
  await initMediasoup();
  console.log('🚀 Server running on http://localhost:3000');
});
