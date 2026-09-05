import { SignalingClient } from "signaling/client";
import { decodeSignal, encodeSignal } from "signaling/copyPaste";
import { stunOnlyServers } from "signaling/iceConfig";

export interface IceConfig {
  iceServers?: RTCIceServer[];
}

export interface RtcConnection {
  pc: RTCPeerConnection;
  gameChannel: RTCDataChannel;
  controlChannel: RTCDataChannel;
}

export function createPeerConnection(iceConfig: IceConfig = {}): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: iceConfig.iceServers ?? stunOnlyServers(),
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

async function offerSdpOf(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceComplete(pc);
  return localSdp(pc);
}

// ---- Host room (signaling transport, multi-guest) ----

/**
 * Host side of a room: holds the signaling WS all session (spec §10 —
 * discoverable for between-match joins), one RTCPeerConnection per guest.
 * `connectGuest` fires per finished connection keyed by guest index.
 */
export interface HostRoom {
  /** Resolves when the signaling connection is established. */
  ready(): Promise<void>;
  /** Live signaling events (guest-joined / guest-left / host-left). */
  onEvent(cb: (ev: HostRoomEvent) => void): void;
  /** Stop accepting guests and close signaling. */
  close(): void;
}

export type HostRoomEvent =
  | { type: "guest-joined"; guestIndex: number }
  | { type: "guest-left"; guestIndex: number }
  | { type: "host-left" };

export interface HostRoomOptions {
  code: string;
  iceConfig?: IceConfig;
  /** Called with the finished connection for that guest index. */
  connectGuest?: (guestIndex: number, conn: RtcConnection) => void;
}

export function openHostRoom(opts: HostRoomOptions): HostRoom {
  let eventCb: ((ev: HostRoomEvent) => void) | null = null;
  let closed = false;
  const pendingEvents: HostRoomEvent[] = [];

  const signalingPromise = (async (): Promise<SignalingClient> => {
    const signaling = await SignalingClient.connect(opts.code, { role: "host" });
    signaling.onMessage((msg) => {
      if (msg.type === "guest-joined" && msg.guestIndex !== undefined) {
        void connectGuest(msg.guestIndex);
        emit({ type: "guest-joined", guestIndex: msg.guestIndex });
      } else if (msg.type === "guest-left" && msg.guestIndex !== undefined) {
        emit({ type: "guest-left", guestIndex: msg.guestIndex });
      } else if (msg.type === "error" && msg.reason === "host left") {
        emit({ type: "host-left" });
      }
    });
    return signaling;
  })();

  async function connectGuest(guestIndex: number): Promise<void> {
    try {
      const signaling = await signalingPromise;
      const pc = createPeerConnection(opts.iceConfig);
      const { gameChannel, controlChannel } = createChannelPair(pc);
      const sdp = await offerSdpOf(pc);
      // Targeted offer: one PC per guest, keyed by guestIndex (spec §9).
      signaling.send({ type: "host-offer", guestIndex, sdp });

      // Await this guest's answer on the shared event stream (multi-handler).
      const answer = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error("guest answer timeout"));
        }, 30000);
        const off = signaling.onMessage((msg) => {
          if (msg.type === "guest-answer" && msg.guestIndex === guestIndex && msg.sdp !== undefined) {
            clearTimeout(timer);
            off();
            resolve(msg.sdp);
          }
        });
      });
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      await channelOpen(gameChannel, controlChannel);
      opts.connectGuest?.(guestIndex, { pc, gameChannel, controlChannel });
    } catch {
      emit({ type: "guest-left", guestIndex });
    }
  }

  function emit(ev: HostRoomEvent): void {
    if (eventCb === null) {
      pendingEvents.push(ev);
      return;
    }
    eventCb(ev);
  }

  return {
    ready: () => signalingPromise.then(() => undefined),
    onEvent(cb) {
      eventCb = cb;
      while (pendingEvents.length > 0) {
        const ev = pendingEvents.shift();
        if (ev === undefined) break;
        cb(ev);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      void signalingPromise.then((s) => { s.close(); }).catch(() => undefined);
    },
  };
}

// ---- Guest (signaling transport) ----

export async function connectViaSignalingGuest(code: string, iceConfig?: IceConfig): Promise<RtcConnection> {
  const signaling = await SignalingClient.connect(code, { role: "guest" });
  await signaling.joinedAck();
  const pc = createPeerConnection(iceConfig);
  const offerSdpStr = await signaling.offer();
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdpStr });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceComplete(pc);
  signaling.sendAnswer(localSdp(pc));
  const { gameChannel, controlChannel } = await waitForChannels(pc);
  signaling.close();
  return { pc, gameChannel, controlChannel };
}

// ---- Copy-paste transport (fallback + dev connector) ----

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
