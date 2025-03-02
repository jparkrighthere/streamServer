import { useRef, useState, useEffect } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import './App.css';

const socket = io("http://localhost:4000");
// ! mediasoup 디버깅 보고 싶으면 enable() 호출
mediasoupClient.debug.disable();

function App() {
  const localVideoRef = useRef(null);
  const [remoteVideos, setRemoteVideos] = useState({});
  const [remoteAudios, setRemoteAudios] = useState({});
  const [isConnected, setIsConnected] = useState(false);
  const [consumerTransports, setConsumerTransports] = useState([]);
  const [myStream, setMyStream] = useState(null);
  const consumingTransports = useRef([]);
  let device = null;
  const roomName = "test";
  const userName = `user${Math.floor(Math.random() * 100)}`;

  const audioParams = {
    track: null,
    codecOptions: { opusStereo: 1, opusDtx: 1 },
  };

  const videoParams = {
    track: null,
    encodings: [
      { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" },
      { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" },
      { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" },
    ],
    codecOptions: { videoGoogleStartBitrate: 1000 },
  };

  let producerTransport;
  let audioProducer;
  let videoProducer;

  useEffect(() => {
    socket.on("connection-success", ({ socketId }) => {
      console.log(socketId);
      setIsConnected(true);
      getLocalStream();
    });

    return () => {
      socket.off("connection-success");
    };
  }, []);

  useEffect(() => {
    if (!device) return;

    socket.on("new-producer", ({ producerId, socketName }) => {
      signalNewConsumerTransport(producerId, socketName);
    });

    socket.on("producer-closed", ({ remoteProducerId }) => {
      const transportData = consumerTransports.find((t) => t.producerId === remoteProducerId);
      if (transportData) {
        transportData.consumerTransport.close();
        transportData.consumer.close();
        setConsumerTransports((prev) => prev.filter((t) => t.producerId !== remoteProducerId));
        setRemoteVideos((prev) => {
          const newVideos = { ...prev };
          delete newVideos[remoteProducerId];
          return newVideos;
        });
        setRemoteAudios((prev) => {
          const newAudios = { ...prev };
          delete newAudios[remoteProducerId];
          return newAudios;
        });
      }
    });

    return () => {
      socket.off("new-producer");
      socket.off("producer-closed");
    };
  }, [device, consumerTransports]);

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: { width: { min: 640, max: 1920 }, height: { min: 400, max: 1080 } },
      })
      .then(streamSuccess)
      .catch((error) => {
        alert(`Failed to get local stream: ${error.message}`);
      });
  };

  const streamSuccess = (stream) => {
    setMyStream(stream);
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];
    audioParams.track = audioTrack;
    videoParams.track = videoTrack;
    // audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    // videoParams = { track: stream.getVideoTracks()[0], ...videoParams };
    joinRoom();
  };

  const joinRoom = () => {
    socket.emit("joinRoom", { roomName, userName }, (data) => {
      createDevice(data.rtpCapabilities);
    });
  };

  const createDevice = async (rtpCapabilities) => {
    try {
      device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      createSendTransport(device);
    } catch (error) {
      alert(`Device creation failed: ${error.message}`);
    }
  };

  const createSendTransport = (device) => {
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
      if (!params) return;

      producerTransport = device.createSendTransport(params);
      producerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
        socket.emit("transport-connect", { dtlsParameters }, (response) => {
          response.error ? errback(new Error(response.error)) : callback();
        });
      });

      producerTransport.on("produce", async(parameters, callback) => {
        socket.emit("transport-produce", {
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData,
        }, ({ id, producersExist }) => {
          callback({ id });
          if (producersExist) getProducers();
        });
      });
      connectSendTransport();
    });
  };

  const connectSendTransport = async () => {
    try {
      audioProducer = await producerTransport.produce(audioParams);
      videoProducer = await producerTransport.produce(videoParams);

      audioProducer.on("trackended", () => audioProducer.close());
      audioProducer.on("transportclose", () => audioProducer.close());
      videoProducer.on("trackended", () => videoProducer.close());
      videoProducer.on("transportclose", () => videoProducer.close());
    } catch (error) {
      alert(`Failed to connect send transport: ${error.message}`);
    }
  };

  const getProducers = () => {
    socket.emit("getProducers", (producerIds) => {
      producerIds.forEach(([id, socketName]) => signalNewConsumerTransport(id, socketName));
    });
  };

  const signalNewConsumerTransport = (remoteProducerId, socketName) => {
    if (consumingTransports.current.includes(remoteProducerId) || !device) return;
    socket.emit("createWebRtcTransport", { consumer: true }, ({ params }) => {
      if (!params) return;

      const consumerTransport = device.createRecvTransport(params);
      consumerTransport.on("connect", ({ dtlsParameters }, callback) => {
        socket.emit("transport-recv-connect", {
          dtlsParameters,
          serverConsumerTransportId: params.id,
        }, () => callback());
      });
      connectRecvTransport(consumerTransport, remoteProducerId, params.id, socketName);
    });
  };

  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId,
    socketName
  ) => {
    socket.emit("consume", {
      rtpCapabilities: device.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    }, async ({ params }) => {
      if (params.error) return;
      
      //TODO: Consume 함수를 호출하고 다음 출력이 나오지 않음
      const consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      console.log(consumer);
      setConsumerTransports((prev) => [
        ...prev,
        { consumerTransport, serverConsumerTransportId: params.id, producerId: remoteProducerId, consumer },
      ]);

      const stream = new MediaStream([consumer.track]);
      if (consumer.kind === "video") {
        setRemoteVideos((prev) => ({ ...prev, [remoteProducerId]: { stream, socketName } }));
      } else if (consumer.kind === "audio") {
        setRemoteAudios((prev) => ({ ...prev, [remoteProducerId]: { stream, socketName } }));
      }

      socket.emit("consumer-resume", { serverConsumerId: params.serverConsumerId });
      console.log(remoteVideos);
    });
  };

  return (
    <div className="app-container">
      <h1>Video Conference</h1>
      <p>Status: {isConnected ? "Connected" : "Disconnected"}</p>

      <div className="video-section">
        <h2>My Video</h2>
        <div className="video-item">
          <p>{userName} (Me)</p>
          <video ref={localVideoRef} autoPlay muted className="local-video" />
        </div>
      </div>

      <div className="video-section">
        <h2>Participants</h2>
        <div className="video-grid">
          {Object.entries(remoteVideos).map(([producerId, { stream, socketName }]) => (
            <div key={producerId} className="video-item">
              <p>{socketName}</p>
              <video
                ref={(ref) => ref && (ref.srcObject = stream)}
                autoPlay
                className="remote-video"
              />
              {remoteAudios[producerId] && (
                <audio
                  ref={(ref) => ref && (ref.srcObject = remoteAudios[producerId].stream)}
                  autoPlay
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;