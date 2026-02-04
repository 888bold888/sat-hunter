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
  // STUN servers (work for ~80% of connections)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Free TURN servers as fallback for restrictive NATs (Open Relay Project)
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
  const peerConnection = createPeerConnection();

  // Create data channel for sending hunt data
  const dataChannel = peerConnection.createDataChannel('hunt-data', {
    ordered: true,
  });

  // Create offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout)
  await waitForIceGathering(peerConnection);

  return {
    peerConnection,
    dataChannel,
    offer: peerConnection.localDescription!,
  };
}

/**
 * Player: Connect to host using their offer
 */
export async function createPlayerConnection(
  offer: RTCSessionDescriptionInit
): Promise<{
  peerConnection: RTCPeerConnection;
  answer: RTCSessionDescriptionInit;
}> {
  const peerConnection = createPeerConnection();

  // Set remote description (host's offer)
  await peerConnection.setRemoteDescription(offer);

  // Create answer
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  // Wait for ICE gathering
  await waitForIceGathering(peerConnection);

  return {
    peerConnection,
    answer: peerConnection.localDescription!,
  };
}

/**
 * Host: Apply player's answer to complete connection
 */
export async function applyAnswer(
  peerConnection: RTCPeerConnection,
  answer: RTCSessionDescriptionInit
): Promise<void> {
  await peerConnection.setRemoteDescription(answer);
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
  timeoutMs: number = 5000
): Promise<void> {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      resolve(); // Resolve anyway after timeout, we'll use what we have
    }, timeoutMs);

    peerConnection.onicegatheringstatechange = () => {
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
