/**
 * P2P Signaling for Hunt Data Transfer
 *
 * Uses WebRTC for direct host-to-player data transfer.
 * Nostr is used only for signaling (connection negotiation).
 * Hunt location data never touches Nostr relays.
 */

import type { GeoFence, Monster, SatStop } from './gameTypes';

// Nostr event kinds for P2P signaling
// Reversed flow: Player creates offer, Host responds with answer
// This ensures each player gets their own unique peer connection
export const P2P_OFFER_KIND = 29001;  // Ephemeral: Player publishes WebRTC offer
export const P2P_ANSWER_KIND = 29002; // Ephemeral: Host responds with answer

// ICE servers for NAT traversal
const ICE_SERVERS: RTCIceServer[] = [
  // STUN servers
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Free TURN from Xirsys (backup)
  {
    urls: 'turn:turn.bistri.com:80',
    username: 'homeo',
    credential: 'homeo',
  },
  // Free TURN from OpenRelay
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

// Data sent from host to player via P2P
export interface HuntLocationData {
  geoFence: GeoFence;
  monsters: Monster[];
  satStops: SatStop[];
}

// Signaling message types
export interface SignalOffer {
  type: 'offer';
  huntId: string;
  shareCode: string;
  sdp: string;
  hostPubkey: string;
}

export interface SignalAnswer {
  type: 'answer';
  huntId: string;
  sdp: string;
  playerPubkey: string;
}

export interface SignalCandidate {
  type: 'candidate';
  huntId: string;
  candidate: string;
}

/**
 * Create a WebRTC peer connection with standard config
 */
export function createPeerConnection(): RTCPeerConnection {
  console.log('[P2P] Creating peer connection with', ICE_SERVERS.length, 'ICE servers');
  return new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  });
}

/**
 * Host: Create offer and data channel for sending hunt data
 */
export async function createHostConnection(): Promise<{
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  offer: RTCSessionDescriptionInit;
}> {
  console.log('[P2P] createHostConnection: creating offer with data channel');
  const peerConnection = createPeerConnection();

  // Set up ALL handlers BEFORE any SDP operations
  peerConnection.onconnectionstatechange = () => {
    console.log('[P2P createHostConnection] Connection state:', peerConnection.connectionState);
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('[P2P createHostConnection] ICE state:', peerConnection.iceConnectionState);
  };

  // Create data channel for sending hunt data
  const dataChannel = peerConnection.createDataChannel('hunt-data', {
    ordered: true,
  });
  console.log('[P2P] Data channel created');

  dataChannel.onopen = () => {
    console.log('[P2P] Data channel opened (player side)');
  };

  dataChannel.onerror = (e) => {
    console.log('[P2P] Data channel error (player side):', e);
  };

  // Create offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log('[P2P] Local description set, waiting for ICE gathering');

  // Wait for ICE gathering to complete (or timeout)
  await waitForIceGathering(peerConnection);

  const finalSdp = peerConnection.localDescription!;
  const candidateLines = finalSdp.sdp?.match(/a=candidate/g)?.length || 0;
  console.log('[P2P] Offer ready with', candidateLines, 'ICE candidate lines in SDP');

  return {
    peerConnection,
    dataChannel,
    offer: finalSdp,
  };
}

/**
 * Player: Connect to host using their offer
 */
export async function createPlayerConnection(
  offer: RTCSessionDescriptionInit,
  onDataChannel?: (channel: RTCDataChannel) => void
): Promise<{
  peerConnection: RTCPeerConnection;
  answer: RTCSessionDescriptionInit;
}> {
  console.log('[P2P] createPlayerConnection: processing offer and creating answer');
  const peerConnection = createPeerConnection();

  // Set up ALL handlers BEFORE any SDP operations
  // This ensures we don't miss any state changes

  // Connection state handler
  peerConnection.onconnectionstatechange = () => {
    console.log('[P2P createPlayerConnection] Connection state:', peerConnection.connectionState);
  };

  // ICE connection state handler
  peerConnection.oniceconnectionstatechange = () => {
    console.log('[P2P createPlayerConnection] ICE state:', peerConnection.iceConnectionState);
  };

  // Data channel handler - fires when remote offer contains a data channel
  if (onDataChannel) {
    peerConnection.ondatachannel = (event) => {
      console.log('[P2P] Data channel received in createPlayerConnection');
      onDataChannel(event.channel);
    };
  }

  // Log offer candidate count
  const offerCandidates = offer.sdp?.match(/a=candidate/g)?.length || 0;
  console.log('[P2P] Offer has', offerCandidates, 'ICE candidate lines');

  // Set remote description (player's offer) - may trigger ondatachannel
  await peerConnection.setRemoteDescription(offer);
  console.log('[P2P] Remote description set');

  // Create answer
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  console.log('[P2P] Local description set, waiting for ICE gathering');

  // Wait for ICE gathering
  await waitForIceGathering(peerConnection);

  const finalSdp = peerConnection.localDescription!;
  const answerCandidates = finalSdp.sdp?.match(/a=candidate/g)?.length || 0;
  console.log('[P2P] Answer ready with', answerCandidates, 'ICE candidate lines in SDP');

  return {
    peerConnection,
    answer: finalSdp,
  };
}

/**
 * Host: Apply player's answer to complete connection
 */
export async function applyAnswer(
  peerConnection: RTCPeerConnection,
  answer: RTCSessionDescriptionInit
): Promise<void> {
  const answerCandidates = answer.sdp?.match(/a=candidate/g)?.length || 0;
  console.log('[P2P] Applying answer with', answerCandidates, 'ICE candidate lines');
  await peerConnection.setRemoteDescription(answer);
  console.log('[P2P] Remote description (answer) applied');
}

/**
 * Send hunt location data over data channel
 */
export function sendHuntData(
  dataChannel: RTCDataChannel,
  data: HuntLocationData
): void {
  if (dataChannel.readyState !== 'open') {
    throw new Error('Data channel not open');
  }
  dataChannel.send(JSON.stringify(data));
}

/**
 * Wait for data channel message (player side)
 */
export function waitForHuntData(
  peerConnection: RTCPeerConnection,
  timeoutMs: number = 30000
): Promise<HuntLocationData> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for hunt data'));
    }, timeoutMs);

    peerConnection.ondatachannel = (event) => {
      const channel = event.channel;

      channel.onmessage = (msgEvent) => {
        clearTimeout(timeout);
        try {
          const data = JSON.parse(msgEvent.data) as HuntLocationData;
          resolve(data);
        } catch {
          reject(new Error('Invalid hunt data received'));
        }
      };

      channel.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    };
  });
}

/**
 * Wait for ICE gathering to complete
 */
function waitForIceGathering(
  peerConnection: RTCPeerConnection,
  timeoutMs: number = 10000
): Promise<void> {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      console.log('[P2P] ICE gathering already complete');
      resolve();
      return;
    }

    let candidateCount = 0;

    // Log each ICE candidate as it's gathered
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        candidateCount++;
        console.log('[P2P] ICE candidate gathered:', event.candidate.type, event.candidate.protocol);
      } else {
        console.log('[P2P] ICE gathering complete, total candidates:', candidateCount);
      }
    };

    const timeout = setTimeout(() => {
      console.log('[P2P] ICE gathering timeout, candidates so far:', candidateCount);
      resolve(); // Resolve anyway after timeout, we'll use what we have
    }, timeoutMs);

    peerConnection.onicegatheringstatechange = () => {
      console.log('[P2P] ICE gathering state:', peerConnection.iceGatheringState);
      if (peerConnection.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
}

/**
 * Build Nostr event for signaling offer (from player to host)
 */
export function buildOfferEvent(
  huntId: string,
  shareCode: string,
  offer: RTCSessionDescriptionInit,
  hostPubkey: string,
  playerPubkey: string
): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: P2P_OFFER_KIND,
    content: JSON.stringify({
      type: 'offer',
      sdp: offer.sdp,
    }),
    tags: [
      ['d', `p2p-offer-${shareCode}-${playerPubkey.slice(0, 8)}`],
      ['h', huntId],
      ['p', hostPubkey], // Tag host so they receive it
      ['player', playerPubkey],
    ],
  };
}

/**
 * Build Nostr event for signaling answer (from host to player)
 */
export function buildAnswerEvent(
  huntId: string,
  shareCode: string,
  answer: RTCSessionDescriptionInit,
  playerPubkey: string
): {
  kind: number;
  content: string;
  tags: string[][];
} {
  return {
    kind: P2P_ANSWER_KIND,
    content: JSON.stringify({
      type: 'answer',
      sdp: answer.sdp,
    }),
    tags: [
      ['d', `p2p-answer-${shareCode}-${playerPubkey.slice(0, 8)}`],
      ['h', huntId],
      ['p', playerPubkey], // Tag player so they receive it
    ],
  };
}

/**
 * Parse offer from Nostr event (player's offer)
 */
export function parseOfferFromEvent(event: { content: string; pubkey: string; tags: string[][] }): {
  sdp: string;
  playerPubkey: string;
} {
  const parsed = JSON.parse(event.content);
  const playerTag = event.tags.find(t => t[0] === 'player');
  return {
    sdp: parsed.sdp,
    playerPubkey: playerTag?.[1] || event.pubkey,
  };
}

/**
 * Parse answer from Nostr event
 */
export function parseAnswerFromEvent(event: { content: string; tags: string[][] }): {
  sdp: string;
  playerPubkey: string;
} {
  const parsed = JSON.parse(event.content);
  const playerTag = event.tags.find(t => t[0] === 'player');
  return {
    sdp: parsed.sdp,
    playerPubkey: playerTag?.[1] || '',
  };
}

/**
 * Connection state helper
 */
export function getConnectionState(
  peerConnection: RTCPeerConnection
): 'connecting' | 'connected' | 'disconnected' | 'failed' {
  switch (peerConnection.connectionState) {
    case 'new':
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
    case 'closed':
      return 'disconnected';
    case 'failed':
      return 'failed';
    default:
      return 'connecting';
  }
}
