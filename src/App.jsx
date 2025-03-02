import io from "socket.io-client";
import { Device } from "mediasoup-client";
import { useEffect, useState } from "react";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [device, setDevice] = useState(null);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [localCameraStream, setLocalCameraStream] = useState(null);
  const [sendTransports, setSendTransports] = useState({});
  const [recvTransports, setRecvTransports] = useState({});

  useEffect(() => {
    if (!socket) return;

    socket.on("joined-room", async (data) => {
      console.log(`✅ Joined room: ${data.roomId}`);
      if (!device) await initializeDevice();
    });

    socket.on("new-stream", async ({ producerId, streamType }) => {
      console.log(`📡 New ${streamType} stream received`, producerId);

      if (!device) return;

      const transportKey = streamType === "screen" ? "screen" : "camera";
      let transport = recvTransports[transportKey];
      if (!transport) {
        socket.emit("create-transport", { roomId, direction: "recv", streamType }, (data) => {
          if (data.error) return console.error("❌ Transport creation failed:", data.error);

          transport = device.createRecvTransport({
            id: data.transportId,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            dtlsParameters: data.dtlsParameters,
          });

          transport.on("connect", ({ dtlsParameters }, callback) => {
            socket.emit("connect-transport", { roomId, transportId: data.transportId, dtlsParameters }, ({ error }) => {
              if (error) console.error(error);
            });
            callback();
          });

          setRecvTransports((prev) => ({ ...prev, [transportKey]: transport }));
          consumeStream(transport, producerId, streamType);
        });
      } else {
        consumeStream(transport, producerId, streamType);
      }
    });

    return () => {
      socket.off("joined-room");
      socket.off("new-stream");
    };
  }, [socket, device, recvTransports]);

  const initializeDevice = async () => {
    socket.emit("get-rtp-capabilities", { roomId }, async (capabilities) => {
      if (!capabilities) return console.error("❌ Failed to get RTP capabilities.");
      const newDevice = new Device();
      await newDevice.load({ routerRtpCapabilities: capabilities });
      setDevice(newDevice);
      console.log("✅ Mediasoup Device initialized.");
    });
  };

  const handleConnect = async () => {
    setRoomId("room1");
    const socketConnection = io("http://localhost:4000", { query: { roomId: "room1" } });
    socketConnection.on("connect", () => {
      console.log("✅ WebSocket connected");
      socketConnection.emit("join-room", { roomId: "room1" });
    });
    setSocket(socketConnection);
  };

  const startStream = async (type) => {
    if (!roomId || !socket || !device) return;

    const isScreen = type === "screen";
    const stream = await (isScreen
      ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      : navigator.mediaDevices.getUserMedia({ video: true, audio: true }));

    if (isScreen) setLocalScreenStream(stream);
    else setLocalCameraStream(stream);

    const videoElement = document.getElementById(isScreen ? "localScreenVideo" : "localCameraVideo");
    if (videoElement) {
      videoElement.srcObject = stream;
      videoElement.play();
    }

    socket.emit("create-transport", { roomId, direction: "send", streamType: type }, (data) => {
      if (data.error) return console.error("❌ Transport creation failed:", data.error);

      const transport = device.createSendTransport({
        id: data.transportId,
        iceParameters: data.iceParameters,
        iceCandidates: data.iceCandidates,
        dtlsParameters: data.dtlsParameters,
      });

      transport.on("connect", ({ dtlsParameters }, callback) => {
        socket.emit("connect-transport", { roomId, transportId: data.transportId, dtlsParameters }, ({ error }) => {
          if (error) console.error(error);
        });
        callback();
      });

      transport.on("produce", ({ kind, rtpParameters }, callback) => {
        socket.emit("produce", { roomId, kind, rtpParameters, streamType: type }, ({ id }) => {
          callback({ id });
        });
      });

      const videoTrack = stream.getVideoTracks()[0];
      transport.produce({ track: videoTrack });
      setSendTransports((prev) => ({ ...prev, [type]: transport }));
    });
  };

  const consumeStream = async (transport, producerId, streamType) => {
    socket.emit(
      "consume",
      { roomId, transportId: transport.id, rtpCapabilities: device.rtpCapabilities, producerId },
      async (response) => {
        if (response.error) return console.error("❌ Consume error:", response.error);

        const consumer = await transport.consume({
          id: response.id,
          producerId: response.producerId,
          kind: response.kind,
          rtpParameters: response.rtpParameters,
        });

        const videoElement = document.getElementById(streamType === "screen" ? "remoteScreenVideo" : "remoteCameraVideo");
        videoElement.srcObject = new MediaStream([consumer.track]);
        videoElement.play();
      }
    );
  };

  return (
    <div>
      <h1>React Mediasoup SFU Client</h1>
      <button onClick={handleConnect}>Connect to Streaming</button>
      {roomId && <p>Connected to Room: {roomId}</p>}
      <button onClick={() => startStream("screen")}>Start Screen Share</button>
      <button onClick={() => startStream("camera")}>Start Camera</button>
      <div>
        <h2>📺 My Screen</h2>
        <video id="localScreenVideo" autoPlay playsInline muted style={{ width: "320px", height: "240px" }}></video>
      </div>
      <div>
        <h2>📹 My Camera</h2>
        <video id="localCameraVideo" autoPlay playsInline muted style={{ width: "320px", height: "240px" }}></video>
      </div>
      <div>
        <h2>📡 Remote Screen</h2>
        <video id="remoteScreenVideo" autoPlay playsInline style={{ width: "320px", height: "240px" }}></video>
      </div>
      <div>
        <h2>📡 Remote Camera</h2>
        <video id="remoteCameraVideo" autoPlay playsInline style={{ width: "320px", height: "240px" }}></video>
      </div>
    </div>
  );
}