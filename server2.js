const { Server } = require("socket.io");
const mediasoup = require("mediasoup");

const io = new Server(4000, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let workers = [];
let rooms = {}; // { roomId: { router, peers: {}, producers: {}, transports: {}, recvTransports: {} } }

// Create Mediasoup workers
(async () => {
  console.log("Creating Mediasoup workers...");
  for (let i = 0; i < 2; i++) {
    workers.push(await createWorker());
  }
})();

async function createWorker() {
  const worker = await mediasoup.createWorker();
  console.log("Worker created");
  return worker;
}

// Handle socket connections
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Join a room
  socket.on("join-room", async ({ roomId }) => {
    console.log(`Join request for roomId: ${roomId}`);

    if (!rooms[roomId]) {
      const router = await workers[0].createRouter({
        mediaCodecs: [
          {
            kind: "audio",
            mimeType: "audio/opus",
            clockRate: 48000,
            channels: 2,
          },
          {
            kind: "video",
            mimeType: "video/VP8",
            clockRate: 90000,
          },
        ],
      });
      rooms[roomId] = { 
        router, 
        peers: [], 
        producers: {}, 
        sendTransports: {}, 
        recvTransports: {} 
      };
    }

    rooms[roomId].peers.push(socket.id);
    socket.join(roomId);

    // Emit join-room confirmation to the client
    socket.emit("joined-room", { roomId });
  });

  // Get RTP capabilities for a room
  socket.on("get-rtp-capabilities", ({ roomId }, callback) => {
    if (rooms[roomId]) {
      callback(rooms[roomId].router.rtpCapabilities);
    }else{
      console.log("get-rtp-capabilities : invaild room id");
    }
  });
  const createWebRtcTransport = async (router)=>{
    return new Promise(async (resolve, reject) => {
      try{
        transport = await router.createWebRtcTransport({
          listenIps: [{ ip: "127.0.0.1", announcedIp: null }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          appData: { socketId: socket.id },
        });
        resolve(transport);
      }catch(err){
        reject(err);
      }
    })
  }
  // Create a WebRTC transport (send or receive direction)
  socket.on("create-transport", async ({ roomId, direction }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      return callback({ error: "Room not found" });
    }
  
    let transport;
    if (direction === "recv") {
      if (!room.recvTransports[socket.id]) {
        transport = room.recvTransports[socket.id] = await createWebRtcTransport(room.router);

        transport.on("connect", ({ dtlsParameters }, callback) => {
          socket.emit("connect-transport", { roomId, dtlsParameters });
          callback();
        });
      } else {
        transport = room.recvTransports[socket.id];
      }
    } else if (direction === "send") {
      if (!room.sendTransports[socket.id]) {
        room.sendTransports[socket.id] = await createWebRtcTransport(room.router);
      }
      transport = room.sendTransports[socket.id];

      console.log("🚀 Created send transport:", transport.id); // 디버깅 로그 추가
    }

    callback({
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
});

  // Connect the transport
  socket.on("connect-transport", ({ roomId, dtlsParameters,direction }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      return callback({ error: "Room not found" });
    }
    console.log("이순간의 room ",room);
    let transport;
    if(direction==="send"){
      transport = room.sendTransports[socket.id];
    }else if(direction==="recv"){
      transport = room.recvTransports[socket.id]; // 해당 소켓에 대한 transport
    }
    if (!transport) {
      return callback({ error: "Transport not found" });
    }
  
    // 이미 연결이 된 상태라면 connect를 다시 호출하지 않습니다.
    if (!transport.connected) {
      transport.connect({ dtlsParameters }).then(() => {
        callback({error: "connected success"});
      }).catch((err) => {
        console.error("❌ Transport connection error:", err);
        callback({ error: err.message });
      });
    } else {
      // 이미 연결된 경우
      callback({error: "connected success"});
    }
  });

  // Start producing a media stream (screen share)
  socket.on("produce", async ({ roomId, kind, rtpParameters }, callback) => {
    try {
      const transport = rooms[roomId].sendTransports[socket.id];
      if (!transport) {
        return callback({ error: "Transport not found" });
      }

      const producer = await transport.produce({
        kind,
        rtpParameters,
      });

      rooms[roomId].producers[socket.id] = producer;
      callback({ id: producer.id });

      // Notify other peers about the new producer (screen share)
      rooms[roomId].peers.forEach((peerId) => {
        if (peerId !== socket.id) {
          io.to(peerId).emit("new-screen-share", { producerId: producer.id });
        }
      });
    } catch (err) {
      console.error("❌ Error producing media:", err);
      callback({ error: err.message });
    }
  });

  // Handle consumption of media (receiving screen share)
  socket.on("consume", async ({ roomId, transportId, rtpCapabilities, producerId }, callback) => {
    try {
      const room = rooms[roomId];
      if (!room) {
        return callback({ error: "Room not found" });
      }

      const transport = room.recvTransports?.[socket.id];
      if (!transport) {
        return callback({ error: "Receive transport not found" });
      }
      console.log("producerId " ,producerId);
      console.log("socketId ",socket.id);
      console.log(room.producers);
      
      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false,
      });

      callback({
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error("❌ Error consuming:", err);
      callback({ error: err.message });
    }
  });

  // Disconnect a peer
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    for (const room in rooms) {
      rooms[room].peers = rooms[room].peers.filter((id) => id !== socket.id);
      delete rooms[room].sendTransports[socket.id];
      delete rooms[room].producers[socket.id];
      delete rooms[room].recvTransports[socket.id];

      if (rooms[room].peers.length === 0) {
        delete rooms[room];
      }
    }
  });
});

console.log("🚀 Node.js Mediasoup SFU Socket server running on port 4000");
