import io from "socket.io-client";
import { Device } from "mediasoup-client";
import { useEffect, useState, useRef } from "react";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [device, setDevice] = useState(null);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [localCameraStream, setLocalCameraStream] = useState(null);
  const [sendTransports, setSendTransports] = useState({});
  const [recvTransports, setRecvTransports] = useState({});
  const [messages, setMessages] = useState([]);
  const [username, setUsername] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef(null);

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

    socket.on("chat-message", (data) => {
      setMessages((prev) => [...prev, data]);
    });

    return () => {
      socket.off("joined-room");
      socket.off("new-stream");
      socket.off("chat-message");
    };
  }, [socket, device, recvTransports]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    const usernameInput = prompt("Enter your username:") || "Anonymous";
    setUsername(usernameInput);
    setRoomId("room1");
    const socketConnection = io("http://localhost:4000", { query: { roomId: "room1" } });
    socketConnection.on("connect", () => {
      console.log("✅ WebSocket connected");
      socketConnection.emit("join-room", { roomId: "room1" });
    });
    setSocket(socketConnection);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !socket) return;

    socket.emit("chat-message", {
      roomId,
      message: newMessage,
      username,
    });
    setNewMessage("");
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
    <div style={{ display: "flex", gap: "20px", padding: "20px" }}>
      <div style={{ flex: 2 }}>
        <h1>React Mediasoup SFU Client</h1>
        <button onClick={handleConnect}>Connect to Streaming</button>
        {roomId && <p>Connected to Room: {roomId}</p>}
        <button onClick={() => startStream("screen")}>Start Screen Share</button>
        <button onClick={() => startStream("camera")}>Start Camera</button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
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
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", border: "1px solid #ddd", borderRadius: "8px" }}>
        <div style={{ padding: "10px", borderBottom: "1px solid #ddd" }}>
          <h2>Chat</h2>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px", background: "#f9f9f9" }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ marginBottom: "10px", padding: "8px", background: "#fff", borderRadius: "4px", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
              <div style={{ fontWeight: "bold", color: "#333" }}>{msg.username}</div>
              <div>{msg.message}</div>
              <div style={{ fontSize: "0.8em", color: "#666" }}>
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={handleSendMessage} style={{ padding: "10px", borderTop: "1px solid #ddd", display: "flex", gap: "10px" }}>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            style={{ flex: 1, padding: "8px", border: "1px solid #ddd", borderRadius: "4px" }}
          />
          <button type="submit" style={{ padding: "8px 16px", background: "#007bff", color: "white", border: "none", borderRadius: "4px", cursor: "pointer" }}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}