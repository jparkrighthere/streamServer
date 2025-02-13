import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { instrument } from '@socket.io/admin-ui';
import * as mediasoup from 'mediasoup';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

type Producer = mediasoup.types.Producer;
type Consumer = mediasoup.types.Consumer;
type Worker = mediasoup.types.Worker;
type Router = mediasoup.types.Router;
type WebRtcTransport = mediasoup.types.WebRtcTransport;

let worker: Worker;
const rooms: Record<string, { router: Router; peers: string[] }> = {};
const peers: Record<string, {
    socket: any;
    roomName: string;
    transports: string[];
    producers: Producer[];
    consumers: Consumer[];
    peerDetails: {
        name: string;
        isAdmin: boolean;
    };
}> = {};

let transports: {
    socketId: string;
    transport: WebRtcTransport;
    roomName: string;
    consumer: Consumer;
}[] = [];

let consumers: {
  socketId: string;
  roomName: string;
  consumer: Consumer;
}[] = [];

let producers: {
  socketId: string;
  roomName: string;
  producer: Producer;
}[] = [];

// Worker 생성
async function initMediasoup() {
    worker = await mediasoup.createWorker({
      rtcMinPort: 2000,
      rtcMaxPort: 2100,
    });
    console.log('✅ Mediasoup initialized');
}

io.on('connection', (socket) => {
    console.log(`🔥 New client connected: ${socket.id}`);
    socket.emit('connection-success', {
      socketId: socket.id,
    });
    
    // rtpCapabilities 전송
    socket.on('joinRoom', async ({ roomName, userName, isHost }, callback) => {
        socket.join(roomName);
        const router = await createRoom(roomName, socket.id);
        peers[socket.id] = {
            socket,
            roomName,
            transports: [],
            producers: [],
            consumers: [],
            peerDetails: {
              name: userName,
              isAdmin: isHost, 
            }
        };

        const rtpCapabilities = router.rtpCapabilities;
        socket.emit(socket.id);
        callback({ rtpCapabilities });
    });
    
    // Router(방) 생성
    const createRoom = async (roomName: string, socketId: string) => {
      let router: Router;
      let roomPeers: string[] = [];
      
      if (rooms[roomName]) {
          router = rooms[roomName].router;
          roomPeers = rooms[roomName].peers;
      } 
      else {
        router = await worker.createRouter({
            mediaCodecs: [
                { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
                { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } }
            ]
        });
      }
      rooms[roomName] = { router, peers: [...roomPeers, socketId] };
      return router;
    };

    // WebRtcTransport 생성
    socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
      if (!consumer) {
        console.log("Producer로써 createWebRtcTransport 호출");
      }
      else {
        console.log("Consumer로써 createWebRtcTransport 호출");
      }
      
      const roomName = peers[socket.id].roomName;
      const router = rooms[roomName].router;
      
      createWebRtcTransport(router).then(transport => {
        callback({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            }
        })
        addTransport(transport, roomName, consumer);
      }), (error: any) => {
        console.log(error);
      }
    });

    // Transport 생성
    const createWebRtcTransport = async (router : Router): Promise<WebRtcTransport> => {
      return new Promise(async (resolve, reject) => {
        try {
          const webRtcTransport_options = {
            listenIps: [ { ip: "127.0.0.1",  announcedIp: undefined } ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
          }
          let transport = await router.createWebRtcTransport(webRtcTransport_options)
          transport.on('dtlsstatechange', dtlsState => {
            if (dtlsState === 'closed') { transport.close() }
          })
          transport.on('@close', () => { console.log('transport closed') })
          resolve(transport)
        } catch (error) {
          reject(error)
        }
      })
    };

    // Transport 추가
    const addTransport = (transport: WebRtcTransport, roomName: string, consumer: Consumer) => {
      transports = [...transports, {socketId: socket.id, consumer, transport, roomName}];
      peers[socket.id] = {...peers[socket.id], transports: [...peers[socket.id].transports, transport.id]};
    };

    let socketConnect: Record<string, boolean> = {}; 
    let socketAudioProduce: Record<string, boolean> = {};
    let socketVideoProduce: Record<string, boolean> = {};

    // transport 연결
    socket.on('transport-connect', async ({ dtlsParameters }) => {
      if (getTransport(socket.id).dtlsState === 'connected' || getTransport(socket.id).dtlsState === 'connecting') {
        const tempTransport = getTransport(socket.id);
        if (tempTransport) {
          if (!socketConnect.socketId) {
            tempTransport.connect({ dtlsParameters });
            socketConnect[socket.id] = true;
            console.log(tempTransport.dtlsParameters);
          }
        }
      }
    });

    const getTransport = (socketId: string) => {
      const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer);
      return producerTransport.transport;
    };


    socket.on('transport-produce', async ({ transportId, kind, rtpParameters }, callback) => {
      if ((kind === 'audio' && !socketAudioProduce[socket.id]) || (kind === 'video' && !socketVideoProduce[socket.id])) {
        const producer = await getTransport(socket.id).produce({ kind, rtpParameters });

        if (kind === 'audio') {
          socketAudioProduce[socket.id] = true;
        }
        if (kind === 'video') {
          socketVideoProduce[socket.id] = true;
        }
        console.log('Producer created:', producer.id, producer.kind);

        const roomName = peers[socket.id].roomName;
        addProducer(producer, roomName);
        informConsumers(roomName, socket.id, producer.id);
        producer.on('transportclose', () => {
          console.log('Transport closed from producer');
        });
        callback({ id: producer.id, producerExist: producers.length > 0 });
      }
    });

    const addProducer = (producer: Producer, roomName: string) => {
      producers = [...producers, { socketId: socket.id, producer, roomName }];
      peers[socket.id] = { ...peers[socket.id], producers: [...peers[socket.id].producers, producer] };
    };

    // 새로운 producer가 생긴 경우 new-producer 를 emit 해서 consume 할 수 있게 알려줌 
    const informConsumers = (roomName: string, socketId: string, producerId: string) => {
      producers.forEach(p => {
        if (p.socketId !== socketId && p.roomName === roomName) {
          const producerSocket = peers[p.socketId].socket;
          const socketName = peers[socketId].peerDetails.name;
          const isNewSocketHost = peers[socketId].peerDetails.isAdmin;
          producerSocket.emit('new-producer', { producerId, socketName, socketId, isNewSocketHost });
        }
      });
    };

    socket.on('getProducers', (callback) => {
        const roomName = peers[socket.id].roomName;
        const socketName = peers[socket.id].peerDetails.name;
        const producerList: { producerId: string; peerName: string; peerId: string }[] = [];

        producers.forEach(p => {
          if (p.socketId !== socket.id && p.roomName === roomName) {
            producerList.push({ producerId: p.producer.id, peerName: socketName, peerId: socket.id });
          }
        });
        callback(producerList);
    });

    socket.on('consume', async ({ remoteProducerId, rtpCapabilities, serverConsumerTransportId }, callback) => {
      try {
        const { roomName } = peers[socket.id];
        const userName = peers[socket.id].peerDetails.name;
        const router = rooms[roomName].router;

        let consumerTransport = transports.find(t => t.consumer && t.transport.id === serverConsumerTransportId)?.transport;
        if (!consumerTransport) {
          return callback({ error: 'Consumer transport not found' });
        }

        if (router.canConsume({producerId: remoteProducerId, rtpCapabilities})) {
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: false,
          });

          consumer.on('transportclose', () => {
            console.log('Consumer transport closed');
          });

          consumer.on('producerclose', () => {
            console.log('Producer closed');
            socket.emit('producer-closed', { remoteProducerId });

            consumerTransport.close();
            transports = transports.filter(t => t.transport.id !== consumerTransport.id);
            consumer.close();
            consumers = consumers.filter(c => c.consumer.id !== consumer.id);
          });

          addConsumer(consumer, roomName);

          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
            userName: userName,
          };

          callback({params});
        }
      } catch (error) {
        console.error(error);
        callback({ error: error });
      }
    });

    const addConsumer = (consumer: Consumer, roomName: string) => {
      consumers = [...consumers, { socketId: socket.id, consumer, roomName }];
      peers[socket.id] = { ...peers[socket.id], consumers: [...peers[socket.id].consumers, consumer] };
    };

    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        consumers = consumers.filter(c => c.socketId !== socket.id);
        transports = transports.filter(t => t.socketId !== socket.id);
        producers = producers.filter(p => p.socketId !== socket.id);

        try {
          const { roomName } = peers[socket.id];
          delete peers[socket.id];

          rooms[roomName] = {
            router: rooms[roomName].router,
            peers: rooms[roomName].peers.filter(peerId => peerId !== socket.id)
          };
        }
        catch (error) {
          console.log(error);
        }
    });
});

server.listen(3000, async () => {
    await initMediasoup();
    console.log('🚀 SFU Server running on http://localhost:3000');
});