const socket = io();

const myFace = document.getElementById('myFace');
const muteBtn = document.getElementById('mute');
const cameraBtn = document.getElementById('camera');
const camerasSelect = document.getElementById('cameras');

const call = document.getElementById('call');
call.hidden = true;

let myStream;
let muted = false;
let cameraOff = false;
let roomName;
let myPeerConnection;

async function getCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices(); //api call that shows all devices
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const currentCamera = myStream.getVideoTracks()[0];
    cameras.forEach((camera) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.innerText = camera.label;
      if (currentCamera.label === camera.label) {
        option.selected = true;
      }
      camerasSelect.appendChild(option);
    });
  } catch (e) {
    console.log(e);
  }
}

async function getMedia(deviceId) {
  const initialConstrains = {
    audio: true,
    video: { facingMode: 'user' },
  };
  const cameraConstraints = {
    audio: true,
    video: { deviceId: { exact: deviceId } },
  };
  try {
    myStream = await navigator.mediaDevices.getUserMedia(
      deviceId ? cameraConstraints : initialConstrains
    ); // api call that gets the media
    myFace.srcObject = myStream; // setting the video stream to the video element
    if (!deviceId) {
      await getCameras(); 
    } 
  } catch (e) {
    console.log(e);
  }
}


muteBtn.addEventListener('click', () => {
  myStream.getAudioTracks().forEach((track) => {
    track.enabled = !track.enabled;
  });
  if (!muted) {
    muteBtn.innerText = 'Unmute';
    muted = true;
  } else {
    muteBtn.innerText = 'Mute';
    muted = false;
  }
});

cameraBtn.addEventListener('click', () => {
  myStream.getVideoTracks().forEach((track) => {
    track.enabled = !track.enabled;
  });
  if (!cameraOff) {
    cameraBtn.innerText = 'Turn Camera On';
    cameraOff = true;
  } else {
    cameraBtn.innerText = 'Turn Camera Off';
    cameraOff = false;
  }
});

camerasSelect.addEventListener('input', async () => {
  await getMedia(camerasSelect.value);
  if (myPeerConnection) {
    const videoTrack = myStream.getVideoTracks()[0];
    const videoSender = myPeerConnection
      .getSenders()
      .find((sender) => sender.track.kind === 'video');
    videoSender.replaceTrack(videoTrack);
  }
});


// Welcome Form (Choose a room)
const welcome = document.getElementById('welcome');
welcomeForm = welcome.querySelector('form');

async function initCall() {
  welcome.hidden = true;
  call.hidden = false;
  await getMedia();
  makeConnection();
}

welcomeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = welcomeForm.querySelector('input');
  await initCall();
  socket.emit('join_room', input.value);
  roomName = input.value;
  input.value = "";
});

// Socket Code

// in Brave
socket.on('welcome', async () => {
  const offer = await myPeerConnection.createOffer();
  myPeerConnection.setLocalDescription(offer);
  console.log('sent the offer');
  socket.emit('offer', offer, roomName);
});

// in FireFox
socket.on('offer', async(offer) => {
  console.log('received the offer');
  myPeerConnection.setRemoteDescription(offer);
  const answer = await myPeerConnection.createAnswer();
  myPeerConnection.setLocalDescription(answer);
  socket.emit('answer', answer, roomName);
  console.log('sent the answer');
});

// back in Brave
socket.on('answer', (answer) => {
  myPeerConnection.setRemoteDescription(answer);
  console.log('received the answer');
});

socket.on('ice', (ice) => {
  myPeerConnection.addIceCandidate(ice);
  console.log('received candidate');
});

// RTC code
function makeConnection() {
  myPeerConnection = new RTCPeerConnection( {
    iceServers: [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun3.l.google.com:19302',
          'stun:stun4.l.google.com:19302',
          // We need to implement our own STUN server as we make our web app
        ],
      },
    ],
  });
  myPeerConnection.addEventListener('icecandidate', handleIce);
  myPeerConnection.addEventListener('addstream', handleAddStream);
  myStream.getTracks().forEach((track) => {
    myPeerConnection.addTrack(track, myStream);
  });
}

function handleIce(data)  {
  socket.emit('ice', data.candidate, roomName);
  console.log('sent candidate');
}

function handleAddStream(data) {
  const peersFace = document.getElementById('peersFace');
  peersFace.srcObject = data.stream; 
}