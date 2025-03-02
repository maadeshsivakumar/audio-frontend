import React, { useEffect, useState, useRef } from 'react';

const configuration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function App() {
  const [status, setStatus] = useState("Initializing...");
  const [log, setLog] = useState([]);
  const remoteAudioRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  // Guard to prevent duplicate initialization (e.g. in React 18 StrictMode)
  const initialized = useRef(false);

  const appendLog = (message) => {
    setLog((prevLog) => [...prevLog, message]);
    console.log(message);
  };

  const sendSignal = (data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = { type: "signal", payload: data };
      wsRef.current.send(JSON.stringify(msg));
      appendLog("Sent signal: " + JSON.stringify(msg));
    }
  };

  const initPeerConnection = () => {
    pcRef.current = new RTCPeerConnection(configuration);

    // Relay ICE candidates.
    pcRef.current.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ ice: event.candidate });
      }
    };

    // When a remote track is received, attach it to the audio element.
    pcRef.current.ontrack = (event) => {
      appendLog("Received remote track.");
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };
  };

  const createOffer = async () => {
    try {
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      sendSignal({ sdp: pcRef.current.localDescription });
      appendLog("Offer sent.");
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  };

  const endCall = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setStatus("Call ended.");
  };

  useEffect(() => {
    // Ensure this initialization code runs only once.
    if (initialized.current) return;
    initialized.current = true;

    async function start() {
      try {
        // Obtain local audio stream.
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        appendLog("Local audio stream obtained.");

        // Initialize RTCPeerConnection and add local audio tracks.
        initPeerConnection();
        localStreamRef.current.getTracks().forEach((track) => {
          pcRef.current.addTrack(track, localStreamRef.current);
        });

        // Connect to the backend WebSocket signaling server.
        const ws = new WebSocket("ws://localhost:8000/ws");
        wsRef.current = ws;

        ws.onopen = () => {
          appendLog("WebSocket connected.");
          setStatus("Connected to signaling server.");
        };

        ws.onmessage = async (event) => {
          const msg = JSON.parse(event.data);
          appendLog("Received: " + event.data);

          if (msg.type === "waiting") {
            appendLog("Waiting for a partner...");
          } else if (msg.type === "matched") {
            appendLog("Matched with partner: " + msg.payload.partner);
            // Only the designated initiator creates the offer.
            if (msg.payload.initiator) {
              await createOffer();
            }
          } else if (msg.type === "signal") {
            const signal = msg.payload;
            if (signal.sdp) {
              if (signal.sdp.type === "offer") {
                // Received an offer; set remote description and create an answer.
                await pcRef.current.setRemoteDescription(signal.sdp);
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
                sendSignal({ sdp: pcRef.current.localDescription });
                appendLog("Answer sent.");
              } else if (signal.sdp.type === "answer") {
                // Only set remote description if in the proper signaling state.
                if (pcRef.current.signalingState === "have-local-offer") {
                  await pcRef.current.setRemoteDescription(signal.sdp);
                  appendLog("Answer received and set.");
                } else {
                  appendLog("Ignored answer due to invalid signaling state.");
                }
              }
            } else if (signal.ice) {
              try {
                await pcRef.current.addIceCandidate(signal.ice);
                appendLog("Added ICE candidate.");
              } catch (e) {
                console.error("Error adding ICE candidate", e);
              }
            }
          } else if (msg.type === "call_end") {
            appendLog("Call ended: " + msg.payload.reason);
            endCall();
          } else if (msg.type === "error") {
            appendLog("Error: " + msg.payload.message);
          }
        };

        ws.onerror = (err) => {
          appendLog("WebSocket error: " + err);
        };

        ws.onclose = () => {
          appendLog("WebSocket closed.");
        };
      } catch (err) {
        console.error("Error during initialization:", err);
        appendLog("Error: " + err);
      }
    }

    start();

    // Cleanup on unmount.
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  return (
    <div style={{ padding: "20px", fontFamily: "Arial, sans-serif" }}>
      <h1>React WebRTC Audio Call</h1>
      <div>Status: {status}</div>
      <div style={{ border: "1px solid #ccc", padding: "10px", height: "200px", overflowY: "scroll", marginTop: "10px" }}>
        {log.map((item, index) => <div key={index}>{item}</div>)}
      </div>
      <audio ref={remoteAudioRef} autoPlay controls style={{ marginTop: "10px" }} />
    </div>
  );
}

export default App;
