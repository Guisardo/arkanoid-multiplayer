import { SignalingClient } from "signaling/client";
import { decodeSignal, encodeSignal } from "signaling/copyPaste";

export interface IceConfig {
  iceServers?: RTCIceServer[];
}

export interface RtcConnection {
  pc: RTCPeerConnection;
  gameChannel: RTCDataChannel;
  controlChannel: RTCDataChannel;
}

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:openrelay.metered.ca:80" },
];

export function createPeerConnection(iceConfig: IceConfig = {}): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: iceConfig.iceServers ?? STUN_SERVERS,
  });
}

export function createChannelPair(pc: RTCPeerConnection): { gameChannel: RTCDataChannel; controlChannel: RTCDataChannel } {
  const gameChannel = pc.createDataChannel("game", {
    ordered: false,
    maxRetransmits: 0,
  });
  const controlChannel = pc.createDataChannel("control", {
    ordered: true,
  });
  return { gameChannel, controlChannel };
}

interface GuestChannelTracker {
  gameChannel: RTCDataChannel | null;
  controlChannel: RTCDataChannel | null;
}

export function waitForChannels(pc: RTCPeerConnection): Promise<{ gameChannel: RTCDataChannel; controlChannel: RTCDataChannel }> {
  return new Promise((resolve, reject) => {
    const tracker: GuestChannelTracker = { gameChannel: null, controlChannel: null };
    const timer = setTimeout(() => {
      pc.removeEventListener("datachannel", onDataChannel);
      reject(new Error("data channel open timeout"));
    }, 30000);
    const check = (): void => {
      if (tracker.gameChannel !== null && tracker.controlChannel !== null) {
        clearTimeout(timer);
        pc.removeEventListener("datachannel", onDataChannel);
        resolve({ gameChannel: tracker.gameChannel, controlChannel: tracker.controlChannel });
      }
    };
    const onDataChannel = (ev: RTCDataChannelEvent): void => {
      if (ev.channel.label === "game") tracker.gameChannel = ev.channel;
      if (ev.channel.label === "control") tracker.controlChannel = ev.channel;
      check();
    };
    pc.addEventListener("datachannel", onDataChannel);
  });
}

export async function waitForIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 5000);
    const check = (): void => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function channelOpen(gameChannel: RTCDataChannel, controlChannel: RTCDataChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("data channel open timeout"));
    }, 30000);
    const check = (): void => {
      if (gameChannel.readyState === "open" && controlChannel.readyState === "open") {
        clearTimeout(timer);
        resolve();
      }
    };
    gameChannel.addEventListener("open", check, { once: true });
    controlChannel.addEventListener("open", check, { once: true });
    check();
  });
}

function localSdp(pc: RTCPeerConnection): string {
  const desc = pc.localDescription;
  if (desc === null) {
    throw new Error("local description not set");
  }
  return desc.sdp;
}

export async function connectViaSignalingHost(code: string, iceConfig?: IceConfig): Promise<RtcConnection> {
  const signaling = await SignalingClient.connect(code, { role: "host" });
  const pc = createPeerConnection(iceConfig);
  const { gameChannel, controlChannel } = createChannelPair(pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceComplete(pc);
  const answerSdp = await signaling.host(localSdp(pc));
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  await channelOpen(gameChannel, controlChannel);
  return { pc, gameChannel, controlChannel };
}

export async function connectViaSignalingGuest(code: string, iceConfig?: IceConfig): Promise<RtcConnection> {
  const signaling = await SignalingClient.connect(code, { role: "guest" });
  const pc = createPeerConnection(iceConfig);
  const offerSdp = await signaling.guest();
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceComplete(pc);
  signaling.sendAnswer(localSdp(pc));
  const { gameChannel, controlChannel } = await waitForChannels(pc);
  signaling.close();
  return { pc, gameChannel, controlChannel };
}

export interface CopyPasteHostFlow {
  offerCode: string;
  connection: Promise<RtcConnection>;
}

export async function connectViaCopyPasteHost(
  receiveAnswerCode: Promise<string>,
  iceConfig?: IceConfig,
): Promise<CopyPasteHostFlow> {
  const pc = createPeerConnection(iceConfig);
  const { gameChannel, controlChannel } = createChannelPair(pc);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceComplete(pc);
  const offerCode = await encodeSignal({ type: offer.type, sdp: localSdp(pc) });
  const connection = (async (): Promise<RtcConnection> => {
    const answerInit = await decodeSignal(await receiveAnswerCode);
    await pc.setRemoteDescription(answerInit);
    await channelOpen(gameChannel, controlChannel);
    return { pc, gameChannel, controlChannel };
  })();
  return { offerCode, connection };
}

export async function connectViaCopyPasteGuest(
  offerCode: string,
  iceConfig?: IceConfig,
): Promise<{ answerCode: string; connection: Promise<RtcConnection> }> {
  const offerInit = await decodeSignal(offerCode);
  const pc = createPeerConnection(iceConfig);
  await pc.setRemoteDescription(offerInit);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceComplete(pc);
  const answerCode = await encodeSignal({ type: answer.type, sdp: localSdp(pc) });
  const connection = (async (): Promise<RtcConnection> => {
    const { gameChannel, controlChannel } = await waitForChannels(pc);
    return { pc, gameChannel, controlChannel };
  })();
  return { answerCode, connection };
}
