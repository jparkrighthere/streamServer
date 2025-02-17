import axios from "axios";
import io from "socket.io-client";
import { Device } from "mediasoup-client";
import { useEffect, useState } from "react";

export default function Home() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [device, setDevice] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [recvTransport, setRecvTransport] = useState(null);
  const [sendTransport, setSendTransport] = useState(null);

  useEffect(() => {
    if (!socket) return;

    socket.on("joined-room", async (data) => {
      console.log(`✅ Joined room: ${data.roomId}`);
      if (!device) {
        await initializeDevice(); // room 참여 시 device 초기화
      }
    });

    socket.on("new-screen-share", async ({ producerId }) => {
      console.log("📡 New screen share received", producerId);

      if (!device) {
        console.warn("⚠️ Device is not initialized yet. Waiting...");
        return;
      }

      // 서버에서 transport 생성 요청
      socket.emit("create-transport", { roomId, direction: "recv" }, ({transportId,iceParameters,iceCandidates,dtlsParameters}) => {
        console.log(transportId);
        if (!transportId) {
          console.error("❌ No transport options received!");
          return;
        }
        const transport = device.createRecvTransport({
          id: transportId, // ✅ transportId를 id로 전달
          iceParameters,
          iceCandidates,
          dtlsParameters,
        });

        transport.on("connect", ({ dtlsParameters }, callback) => {
          socket.emit("connect-transport", { roomId, dtlsParameters, direction: "recv"},({error})=>{
            console.log(error);
          });
          callback();
        });

        setRecvTransport(transport);

        socket.emit("consume", {
          roomId,
          transportId: transport.id,
          rtpCapabilities: device.rtpCapabilities,
          producerId,
        }, async (response) => {
          if (response.error) {
            console.error("❌ Consume error:", response.error);
            return;
          }
          console.log("waiting consume...");
          const consumer = await transport.consume({
            id: response.id,
            producerId: response.producerId,
            kind: response.kind,
            rtpParameters: response.rtpParameters,
          });

          const videoElement = document.getElementById("remoteVideo");
          videoElement.srcObject = new MediaStream([consumer.track]);
          videoElement.play();
        });
      });
    });

    return () => {
      socket.off("joined-room");
      socket.off("new-screen-share");
    };
  }, [socket, device]);

  const initializeDevice = async () => {
    try {
      socket.emit("get-rtp-capabilities", { roomId }, async (capabilities) => {
        if (!capabilities) {
          console.error("❌ Failed to get RTP capabilities.");
          return;
        }
        console.log("✅ capabilities:",capabilities);
        const newDevice = new Device();
        await newDevice.load({ routerRtpCapabilities: capabilities });
        setDevice(newDevice);
        console.log("✅ Mediasoup Device initialized.");
      });
    } catch (err) {
      console.error("❌ Device initialization failed:", err);
    }
  };

  const handleConnect = async () => {
    try {
      setRoomId("room1");

      const socketConnection = io("http://localhost:4000", {
        query: { roomId: "room1" },
      });

      socketConnection.on("connect", () => {
        console.log("✅ WebSocket connected");
        socketConnection.emit("join-room", { roomId: "room1" });
      });

      setSocket(socketConnection);
    } catch (err) {
      console.error("❌ Failed to connect:", err);
    }
  };

  const handleScreenShare = async () => {
    if (!roomId || !socket) return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      setLocalStream(stream);

      const localVideo = document.getElementById("localVideo");
      if (localVideo) {
        localVideo.srcObject = stream;
        localVideo.play();
      }

      if (!device) {
        console.warn("⚠️ Device is not ready. Initializing...");
        await initializeDevice();
      }

      socket.emit("create-transport", { roomId, direction: "send" }, ({transportId,iceParameters,iceCandidates,dtlsParameters}) => {
        console.log(transportId);
        if (!transportId) {
          console.error("❌ No transport options received!");
          return;
        }
        const transport = device.createSendTransport({
          id: transportId, // ✅ transportId를 id로 전달
          iceParameters,
          iceCandidates,
          dtlsParameters,
        });
        setSendTransport(transport);

        transport.on("connect", ({ dtlsParameters }, callback) => {
          socket.emit("connect-transport", { roomId, dtlsParameters, direction: "send" },({error})=>{
            console.log(error);
          });
          callback();
        });

        transport.on("produce", ({ kind, rtpParameters }, callback) => {
          socket.emit("produce", { roomId, kind, rtpParameters }, ({ id }) => {
            callback({ id });
          });
        });

        const videoTrack = stream.getVideoTracks()[0];
        transport.produce({ track: videoTrack });
      });

      console.log("📡 Screen share started!");
    } catch (err) {
      console.error("❌ Screen share failed:", err);
    }
  };

  return (
    <div>
      <h1>React Mediasoup SFU Client</h1>
      <button onClick={handleConnect}>Connect to Streaming</button>
      {roomId && <p>Connected to Room: {roomId}</p>}
      <button onClick={handleScreenShare}>Start Screen Share</button>
      <div>
        <h2>📺 My Screen</h2>
        <video id="localVideo" autoPlay playsInline muted></video>
      </div>
      <div>
        <h2>📡 Remote Screen</h2>
        <video id="remoteVideo" autoPlay playsInline></video>
      </div>
    </div>
  );
}
