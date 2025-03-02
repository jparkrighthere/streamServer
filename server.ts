import { Server, Socket } from "socket.io";
import * as mediasoup from "mediasoup";
import express from "express";
import http from "http";

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = 4000;

interface Room {
  router: mediasoup.types.Router;
  peers: string[];
}

interface Peer {
  socket: Socket;
  roomName: string;
  transports: string[];
  producers: string[];
  consumers: string[];
}

interface TransportData {
  socketId: string;
  transport: mediasoup.types.WebRtcTransport;
  roomName: string;
  consumer: boolean;
}

interface ProducerData {
  socketId: string;
  producer: mediasoup.types.Producer;
  roomName: string;
}

interface ConsumerData {
  socketId: string;
  consumer: mediasoup.types.Consumer;
  roomName: string;
}

let worker: mediasoup.types.Worker;
const rooms: { [roomName: string]: Room } = {};
const peers: { [socketId: string]: Peer } = {};
const transports: TransportData[] = [];
const producers: ProducerData[] = [];
const consumers: ConsumerData[] = [];

const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
  { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 1000 } },
];

const createWorker = async (): Promise<mediasoup.types.Worker> => {
  const worker = await mediasoup.createWorker({ rtcMinPort: 2000, rtcMaxPort: 2100 });
  worker.on("died", () => {
    console.error("Mediasoup worker died");
    setTimeout(() => process.exit(1), 2000);
  });
  return worker;
};

(async () => {
  worker = await createWorker();
  httpServer.listen(PORT, () => console.log(`Server listening on port: ${PORT}`));
})();

io.on("connection", (socket: Socket) => {
  socket.emit("connection-success", { socketId: socket.id });

  socket.on("disconnect", () => {
    const peer = peers[socket.id];
    if (!peer) return;
  
    const { roomName } = peer;
  
    // Transport 정리
    transports
      .filter((t) => t.socketId === socket.id)
      .forEach((t) => {
        t.transport.close();
        transports.splice(transports.indexOf(t), 1);
      });
  
    // Producer 정리 및 알림
    producers
      .filter((p) => p.socketId === socket.id)
      .forEach((p) => {
        p.producer.close();
        rooms[roomName]?.peers
          .filter((peerId) => peerId !== socket.id)
          .forEach((peerId) => peers[peerId].socket.emit("producer-closed", { remoteProducerId: p.producer.id }));
        producers.splice(producers.indexOf(p), 1);
      });
  
    // Consumer 정리
    consumers
      .filter((c) => c.socketId === socket.id)
      .forEach((c) => {
        c.consumer.close();
        consumers.splice(consumers.indexOf(c), 1);
      });
  
    if (rooms[roomName]) {
      rooms[roomName].peers = rooms[roomName].peers.filter((id) => id !== socket.id);
      if (rooms[roomName].peers.length === 0) delete rooms[roomName];
    }
    delete peers[socket.id];
  });

  socket.on("joinRoom", ({ roomName, userName }: { roomName: string; userName: string }, callback) => {
    createRoom(roomName, socket.id).then((router) => {
      peers[socket.id] = { socket, roomName, transports: [], producers: [], consumers: [] };
      callback({ rtpCapabilities: router.rtpCapabilities });
    });
  });

  socket.on("createWebRtcTransport", ({ consumer }: { consumer: boolean }, callback) => {
    const { roomName } = peers[socket.id];
    const router = rooms[roomName].router;

    createWebRtcTransport(router).then((transport) => {
      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
      addTransport(transport, roomName, consumer, socket.id);
    });
  });

  socket.on("transport-connect", async ({ dtlsParameters }: { dtlsParameters: mediasoup.types.DtlsParameters }, callback) => {
    const transport = getTransport(socket.id);
    if (!transport) return callback({ success: false });

    await transport.connect({ dtlsParameters });
    callback({ success: true });
  });

  socket.on("transport-produce", async (
    { kind, rtpParameters, appData }: { kind: mediasoup.types.MediaKind; rtpParameters: mediasoup.types.RtpParameters; appData: any },
    callback
  ) => {
    const transport = getTransport(socket.id);
    if (!transport) return;

    const producer = await transport.produce({ kind, rtpParameters, appData });
    const { roomName } = peers[socket.id];
    addProducer(producer, roomName, socket.id);
    informConsumers(roomName, socket.id, producer.id);

    producer.on("transportclose", () => producer.close());
    const roomProducers = producers.filter((p) => p.roomName === roomName);
    callback({ id: producer.id, producersExist: roomProducers.length > 1 });
  });

  socket.on("getProducers", (callback: (producerList: any) => void) => {
    const { roomName } = peers[socket.id];
    const producerList = producers
      .filter((p) => p.socketId !== socket.id && p.roomName === roomName)
      .map((p) => [p.producer.id, peers[p.socketId].socket.id]);
    callback(producerList);
  });

  socket.on("transport-recv-connect", async (
    { dtlsParameters, serverConsumerTransportId }: { dtlsParameters: mediasoup.types.DtlsParameters; serverConsumerTransportId: string }
  ) => {
    const transport = transports.find((t) => t.consumer && t.transport.id === serverConsumerTransportId)?.transport;
    if (transport) await transport.connect({ dtlsParameters });
  });

  socket.on("consume", async (
    { rtpCapabilities, remoteProducerId, serverConsumerTransportId }: {
      rtpCapabilities: mediasoup.types.RtpCapabilities;
      remoteProducerId: string;
      serverConsumerTransportId: string;
    },
    callback
  ) => {
    const { roomName } = peers[socket.id];
    const router = rooms[roomName].router;
    const consumerTransport = transports.find((t) => t.consumer && t.transport.id === serverConsumerTransportId)?.transport;

    if (!consumerTransport || !router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
      return callback({ params: { error: "Cannot consume" } });
    }

    const consumer = await consumerTransport.consume({ producerId: remoteProducerId, rtpCapabilities, paused: true });
    addConsumer(consumer, roomName, socket.id);

    consumer.on("transportclose", () => consumer.close());
    consumer.on("producerclose", () => {
      socket.emit("producer-closed", { producerId: remoteProducerId });
      consumer.close();
      consumers.splice(consumers.findIndex((c) => c.consumer.id === consumer.id), 1);
    });

    callback({
      params: {
        id: consumer.id,
        producerId: remoteProducerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        serverConsumerId: consumer.id,
      },
    });
  });

  socket.on("consumer-resume", ({ serverConsumerId }: { serverConsumerId: string }) => {
    const consumer = consumers.find((c) => c.consumer.id === serverConsumerId)?.consumer;
    if (consumer) consumer.resume();
  });
});

const createRoom = async (roomName: string, socketId: string): Promise<mediasoup.types.Router> => {
  let router = rooms[roomName]?.router;
  if (!router) {
    router = await worker.createRouter({ mediaCodecs });
    rooms[roomName] = { router, peers: [socketId] };
  } else {
    rooms[roomName].peers.push(socketId);
  }
  return router;
};

const createWebRtcTransport = async (router: mediasoup.types.Router): Promise<mediasoup.types.WebRtcTransport> => {
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: "127.0.0.1", announcedIp: undefined }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  transport.on("dtlsstatechange", (dtlsState) => {
    if (dtlsState === "closed") transport.close();
  });
  return transport;
};

const addTransport = (transport: mediasoup.types.WebRtcTransport, roomName: string, consumer: boolean, socketId: string): void => {
  transports.push({ socketId, transport, roomName, consumer });
  peers[socketId].transports.push(transport.id);
};

const addProducer = (producer: mediasoup.types.Producer, roomName: string, socketId: string): void => {
  producers.push({ socketId, producer, roomName });
  peers[socketId].producers.push(producer.id);
};

const addConsumer = (consumer: mediasoup.types.Consumer, roomName: string, socketId: string): void => {
  consumers.push({ socketId, consumer, roomName });
  peers[socketId].consumers.push(consumer.id);
};

const informConsumers = (roomName: string, socketId: string, producerId: string): void => {
  rooms[roomName].peers
    .filter((peerId) => peerId !== socketId)
    .forEach((peerId) => peers[peerId].socket.emit("new-producer", { producerId, socketName: socketId }));
};

const getTransport = (socketId: string): mediasoup.types.WebRtcTransport | undefined => {
  const transport = transports.find((t) => t.socketId === socketId && !t.consumer)?.transport;
  if (!transport) console.warn(`No producer transport found for socketId: ${socketId}`);
  return transport;
};