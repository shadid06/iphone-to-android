import { decodeDescription, encodeDescription } from "./codec";

/**
 * One peer-to-peer session between two devices on the same network.
 *
 * Channels (both pre-negotiated, so no in-band setup is needed):
 *  - `ctl` (id 0): JSON control messages — chat, hello, call signaling, and
 *    SDP/ICE for renegotiation once the session is up.
 *  - `bin` (id 1): file data. Each file is a JSON header followed by binary
 *    chunks on the same ordered channel, so header and body can never race.
 */

const CHUNK = 64 * 1024;
const READ_BLOCK = 1024 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;
const PROGRESS_MS = 120;

export interface PeerInfo {
  name: string;
  platform: string;
}

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  mime: string;
}

export type CallKind = "audio" | "video";

type Ctl =
  | { t: "hello"; info: PeerInfo }
  | { t: "msg"; id: string; text: string; ts: number }
  | { t: "cancel"; id: string }
  | { t: "sdp"; d: RTCSessionDescriptionInit }
  | { t: "ice"; c: RTCIceCandidateInit | null }
  | { t: "call-ring"; kind: CallKind }
  | { t: "call-accept" }
  | { t: "call-decline"; reason?: string }
  | { t: "call-end" }
  | { t: "call-media"; mic: boolean; cam: boolean }
  | { t: "bye" };

export type PeerEvent =
  | { type: "open" }
  | { type: "closed"; reason: string }
  | { type: "hello"; info: PeerInfo }
  | { type: "message"; id: string; text: string; ts: number }
  | { type: "incoming-start"; meta: FileMeta }
  | { type: "progress"; id: string; bytes: number }
  | { type: "incoming-done"; id: string; blob: Blob }
  | { type: "outgoing-done"; id: string }
  | { type: "canceled"; id: string; byPeer: boolean }
  | { type: "call-ring"; kind: CallKind }
  | { type: "call-accept" }
  | { type: "call-decline"; reason?: string }
  | { type: "call-end" }
  | { type: "call-media"; mic: boolean; cam: boolean };

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Browsers hide private IPs behind random mDNS names unless the page holds
 * capture permission. mDNS works on most home networks, but some routers block
 * multicast — holding a mic grant while ICE gathers exposes real LAN addresses
 * and makes pairing far more reliable. Failure here is non-fatal.
 */
async function unlockLocalAddresses(): Promise<() => void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    return () => s.getTracks().forEach((t) => t.stop());
  } catch {
    return () => {};
  }
}

function gatheringComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

interface Outgoing {
  file: File;
  meta: FileMeta;
  canceled: boolean;
}

interface Incoming {
  meta: FileMeta;
  chunks: ArrayBuffer[];
  bytes: number;
  canceled: boolean;
  lastEmit: number;
}

export class Peer {
  readonly pc: RTCPeerConnection;
  private ctl: RTCDataChannel;
  private bin: RTCDataChannel;
  private polite: boolean;
  private ready = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private listeners = new Set<(e: PeerEvent) => void>();
  private queue: Outgoing[] = [];
  private pumping = false;
  private current: Incoming | null = null;
  private canceledIds = new Set<string>();
  private closed = false;

  private constructor(role: "host" | "guest") {
    this.polite = role === "guest";
    // Same-network only: no STUN/TURN, nothing ever leaves the LAN.
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.ctl = this.pc.createDataChannel("ctl", { negotiated: true, id: 0 });
    this.bin = this.pc.createDataChannel("bin", { negotiated: true, id: 1 });
    this.bin.binaryType = "arraybuffer";
    this.bin.bufferedAmountLowThreshold = LOW_WATER;

    this.ctl.onopen = () => this.onOpen();
    this.ctl.onmessage = (e) => this.onCtl(JSON.parse(e.data as string) as Ctl);
    this.ctl.onclose = () => this.close("Connection closed");
    this.bin.onmessage = (e) => this.onBin(e.data as string | ArrayBuffer);

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === "failed") this.close("Connection lost");
      if (s === "closed") this.close("Connection closed");
    };
  }

  /* ------------------------------ pairing ------------------------------- */

  /** Host side: returns the offer code to show as a QR. */
  static async host(): Promise<{ peer: Peer; code: string }> {
    const release = await unlockLocalAddresses();
    const peer = new Peer("host");
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      await gatheringComplete(peer.pc);
      return { peer, code: encodeDescription(peer.pc.localDescription!) };
    } catch (e) {
      peer.close("Setup failed");
      throw e;
    } finally {
      release();
    }
  }

  /** Guest side: consumes the host's code, returns the answer code to show back. */
  static async join(offerCode: string): Promise<{ peer: Peer; code: string }> {
    const offer = decodeDescription(offerCode);
    if (offer.type !== "offer") throw new Error("This is a reply code — scan the code on the other device's first screen.");
    const release = await unlockLocalAddresses();
    const peer = new Peer("guest");
    try {
      await peer.pc.setRemoteDescription(offer);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      await gatheringComplete(peer.pc);
      return { peer, code: encodeDescription(peer.pc.localDescription!) };
    } catch (e) {
      peer.close("Setup failed");
      throw e;
    } finally {
      release();
    }
  }

  /** Host side: completes pairing with the guest's answer code. */
  async accept(answerCode: string): Promise<void> {
    const answer = decodeDescription(answerCode);
    if (answer.type !== "answer") throw new Error("That's a pairing code, not a reply. Scan the code shown on the other device after it joined.");
    await this.pc.setRemoteDescription(answer);
  }

  /* ------------------------------- events ------------------------------- */

  on(fn: (e: PeerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PeerEvent) {
    this.listeners.forEach((fn) => fn(e));
  }

  private send(m: Ctl) {
    if (this.ctl.readyState === "open") this.ctl.send(JSON.stringify(m));
  }

  private onOpen() {
    this.ready = true;
    // Perfect negotiation for everything after the initial QR handshake
    // (adding call media). Attached only now so the initial offer — made by
    // hand for the QR — doesn't trigger it.
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.send({ t: "sdp", d: this.pc.localDescription!.toJSON() });
      } catch (err) {
        console.error("negotiation failed", err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onicecandidate = ({ candidate }) => {
      if (this.ready) this.send({ t: "ice", c: candidate ? candidate.toJSON() : null });
    };
    this.emit({ type: "open" });
  }

  private async onCtl(m: Ctl) {
    switch (m.t) {
      case "hello":
        return this.emit({ type: "hello", info: m.info });
      case "msg":
        return this.emit({ type: "message", id: m.id, text: m.text, ts: m.ts });
      case "cancel":
        return this.cancel(m.id, true);
      case "sdp": {
        const d = m.d;
        const collision = d.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(d);
        if (d.type === "offer") {
          await this.pc.setLocalDescription();
          this.send({ t: "sdp", d: this.pc.localDescription!.toJSON() });
        }
        return;
      }
      case "ice":
        try {
          await this.pc.addIceCandidate(m.c ?? undefined);
        } catch (err) {
          if (!this.ignoreOffer) console.warn("ice candidate rejected", err);
        }
        return;
      case "call-ring":
        return this.emit({ type: "call-ring", kind: m.kind });
      case "call-accept":
        return this.emit({ type: "call-accept" });
      case "call-decline":
        return this.emit({ type: "call-decline", reason: m.reason });
      case "call-end":
        return this.emit({ type: "call-end" });
      case "call-media":
        return this.emit({ type: "call-media", mic: m.mic, cam: m.cam });
      case "bye":
        return this.close("The other device disconnected");
    }
  }

  /* ------------------------------- chat -------------------------------- */

  hello(info: PeerInfo) {
    this.send({ t: "hello", info });
  }

  sendText(text: string): { id: string; ts: number } {
    const id = uid();
    const ts = Date.now();
    this.send({ t: "msg", id, text, ts });
    return { id, ts };
  }

  /* ------------------------------- files -------------------------------- */

  /** Queues files for sending; returns their metadata immediately. */
  sendFiles(files: File[]): FileMeta[] {
    const metas = files.map((file) => {
      const meta: FileMeta = { id: uid(), name: file.name || "file", size: file.size, mime: file.type || "application/octet-stream" };
      this.queue.push({ file, meta, canceled: false });
      return meta;
    });
    void this.pump();
    return metas;
  }

  cancel(id: string, byPeer = false) {
    const out = this.queue.find((o) => o.meta.id === id) ?? (this.sending?.meta.id === id ? this.sending : undefined);
    if (out) out.canceled = true;
    this.queue = this.queue.filter((o) => o.meta.id !== id);
    if (this.current?.meta.id === id) {
      this.current.canceled = true;
      this.current = null;
    } else {
      // Header may not have arrived yet (control and data channels are not ordered with each other).
      this.canceledIds.add(id);
    }
    if (!byPeer) this.send({ t: "cancel", id });
    this.emit({ type: "canceled", id, byPeer });
  }

  private sending: Outgoing | null = null;

  private waitForDrain(): Promise<void> {
    if (this.bin.bufferedAmount <= HIGH_WATER) return Promise.resolve();
    return new Promise((resolve) => {
      const ok = () => {
        this.bin.removeEventListener("bufferedamountlow", ok);
        clearInterval(poll);
        resolve();
      };
      // Some Safari versions occasionally skip `bufferedamountlow`; poll as a fallback.
      const poll = setInterval(() => this.bin.bufferedAmount <= LOW_WATER && ok(), 250);
      this.bin.addEventListener("bufferedamountlow", ok);
    });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.closed) {
        const job = this.queue.shift()!;
        if (job.canceled) continue;
        this.sending = job;
        this.bin.send(JSON.stringify(job.meta));
        const { file } = job;
        const live = () => !job.canceled && !this.closed;
        // Disk reads are the bottleneck with small slices: read 1 MB blocks,
        // prefetching the next block while the current one is being sent.
        const read = (at: number) => (at < file.size ? file.slice(at, at + READ_BLOCK).arrayBuffer() : null);
        let next = read(0);
        let offset = 0;
        let lastEmit = 0;
        while (next && live()) {
          const block = await next;
          next = read(offset + block.byteLength);
          for (let i = 0; i < block.byteLength && live(); i += CHUNK) {
            await this.waitForDrain();
            if (!live()) break;
            const chunk = block.slice(i, i + CHUNK);
            this.bin.send(chunk);
            offset += chunk.byteLength;
            const now = performance.now();
            if (now - lastEmit > PROGRESS_MS || offset >= file.size) {
              lastEmit = now;
              this.emit({ type: "progress", id: job.meta.id, bytes: offset });
            }
          }
        }
        next?.catch(() => {}); // abandoned prefetch after a cancel
        this.sending = null;
        if (!job.canceled && !this.closed) this.emit({ type: "outgoing-done", id: job.meta.id });
      }
    } catch (err) {
      console.error("send failed", err);
      if (!this.closed) this.close("Transfer interrupted");
    } finally {
      this.pumping = false;
    }
  }

  private onBin(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const meta = JSON.parse(data) as FileMeta;
      // A new header always supersedes an unfinished file (it was canceled by the sender).
      this.current = { meta, chunks: [], bytes: 0, canceled: this.canceledIds.delete(meta.id), lastEmit: 0 };
      if (this.current.canceled) return;
      this.emit({ type: "incoming-start", meta });
      if (meta.size === 0) this.finishIncoming();
      return;
    }
    const cur = this.current;
    if (!cur || cur.canceled) return;
    cur.chunks.push(data);
    cur.bytes += data.byteLength;
    const now = performance.now();
    if (now - cur.lastEmit > PROGRESS_MS) {
      cur.lastEmit = now;
      this.emit({ type: "progress", id: cur.meta.id, bytes: cur.bytes });
    }
    if (cur.bytes >= cur.meta.size) this.finishIncoming();
  }

  private finishIncoming() {
    const cur = this.current!;
    this.current = null;
    const blob = new Blob(cur.chunks, { type: cur.meta.mime });
    this.emit({ type: "progress", id: cur.meta.id, bytes: cur.meta.size });
    this.emit({ type: "incoming-done", id: cur.meta.id, blob });
  }

  /* ------------------------------- calls -------------------------------- */
  /*
   * Media uses one audio + one video transceiver created on the first call and
   * kept for the session. Later calls only swap tracks with replaceTrack(),
   * which needs no renegotiation and keeps the SDP from growing every call.
   */

  private audioTx?: RTCRtpTransceiver;
  private videoTx?: RTCRtpTransceiver;

  private findTransceivers() {
    for (const t of this.pc.getTransceivers()) {
      const kind = t.receiver.track?.kind;
      if (kind === "audio" && !this.audioTx) this.audioTx = t;
      if (kind === "video" && !this.videoTx) this.videoTx = t;
    }
    return Boolean(this.audioTx && this.videoTx);
  }

  /** Caller: create transceivers if the session has none yet. */
  prepareCall() {
    if (this.findTransceivers()) return;
    this.audioTx ??= this.pc.addTransceiver("audio", { direction: "sendrecv" });
    this.videoTx ??= this.pc.addTransceiver("video", { direction: "sendrecv" });
  }

  /** Callee: wait for the caller's transceivers to arrive via renegotiation. */
  private async awaitTransceivers(timeoutMs = 8000) {
    const start = Date.now();
    while (!this.findTransceivers()) {
      if (Date.now() - start > timeoutMs) throw new Error("Call setup timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async attachMedia(stream: MediaStream): Promise<MediaStream> {
    await this.awaitTransceivers();
    for (const tx of [this.audioTx!, this.videoTx!]) {
      const track = stream.getTracks().find((t) => t.kind === tx.receiver.track.kind) ?? null;
      if (tx.direction !== "sendrecv") tx.direction = "sendrecv";
      await tx.sender.replaceTrack(track);
    }
    return new MediaStream([this.audioTx!.receiver.track, this.videoTx!.receiver.track]);
  }

  async replaceVideo(track: MediaStreamTrack | null) {
    await this.videoTx?.sender.replaceTrack(track);
  }

  async detachMedia() {
    await Promise.all([this.audioTx?.sender.replaceTrack(null), this.videoTx?.sender.replaceTrack(null)]);
  }

  ring(kind: CallKind) { this.send({ t: "call-ring", kind }); }
  acceptCall() { this.send({ t: "call-accept" }); }
  declineCall(reason?: string) { this.send({ t: "call-decline", reason }); }
  endCall() { this.send({ t: "call-end" }); }
  mediaState(mic: boolean, cam: boolean) { this.send({ t: "call-media", mic, cam }); }

  /* ------------------------------ teardown ------------------------------ */

  get isOpen() {
    return this.ready && !this.closed;
  }

  close(reason = "Disconnected", notify = false) {
    if (this.closed) return;
    if (notify) {
      try {
        this.send({ t: "bye" });
      } catch {
        /* channel already gone */
      }
    }
    this.closed = true;
    this.queue = [];
    this.current = null;
    // Give the "bye" a moment to flush before tearing down.
    setTimeout(() => this.pc.close(), notify ? 150 : 0);
    this.emit({ type: "closed", reason });
  }
}
