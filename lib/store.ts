"use client";

import { useSyncExternalStore } from "react";
import { extractCode } from "./codec";
import { Peer, uid, type CallKind, type FileMeta, type PeerEvent, type PeerInfo } from "./peer";
import { describeDevice, firstLink, keepAwake, startRingtone } from "./util";

export type Phase = "home" | "hosting" | "joining" | "connected" | "lost";

export type FileStatus = "queued" | "active" | "done" | "canceled";

export type Item =
  | { kind: "text"; id: string; from: "me" | "peer"; text: string; ts: number; link?: string }
  | {
      kind: "file";
      id: string;
      from: "me" | "peer";
      name: string;
      size: number;
      mime: string;
      bytes: number;
      status: FileStatus;
      speed: number; // bytes/sec, smoothed
      url?: string;
      blob?: Blob;
      ts: number;
    }
  | { kind: "event"; id: string; text: string; ts: number; tone?: "call" | "info" | "warn" };

export interface CallState {
  status: "outgoing" | "incoming" | "connecting" | "active";
  kind: CallKind;
  local?: MediaStream;
  remote?: MediaStream;
  mic: boolean;
  cam: boolean;
  facing: "user" | "environment";
  peerMic: boolean;
  peerCam: boolean;
  startedAt?: number;
}

export interface Toast {
  id: string;
  text: string;
  tone: "info" | "error" | "success";
}

export interface State {
  phase: Phase;
  busy: boolean;
  code?: string; // QR payload shown during pairing
  pairError?: string;
  lostReason?: string;
  me?: PeerInfo;
  peer?: PeerInfo;
  items: Item[];
  call: CallState | null;
  toasts: Toast[];
}

const initial: State = { phase: "home", busy: false, items: [], call: null, toasts: [] };

let state: State = initial;
const subs = new Set<() => void>();

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((fn) => fn());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => select(state),
    () => select(initial),
  );
}

export const getState = () => state;

/* ------------------------------- helpers -------------------------------- */

let peer: Peer | null = null;
let unlisten: (() => void) | null = null;
let releaseWake: (() => void) | null = null;
let stopRing: (() => void) | null = null;
let ringTimeout: ReturnType<typeof setTimeout> | undefined;
const speedSamples = new Map<string, { t: number; b: number }>();

function patchItem(id: string, patch: Partial<Item>) {
  set((s) => ({ items: s.items.map((it) => (it.id === id ? ({ ...it, ...patch } as Item) : it)) }));
}

function addItem(item: Item) {
  set((s) => ({ items: [...s.items, item] }));
}

function event(text: string, tone: "call" | "info" | "warn" = "info") {
  addItem({ kind: "event", id: uid(), text, ts: Date.now(), tone });
}

export function toast(text: string, tone: Toast["tone"] = "info") {
  const id = uid();
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fileItem(meta: FileMeta, from: "me" | "peer", status: FileStatus, url?: string): Item {
  return { kind: "file", ...meta, from, bytes: 0, status, speed: 0, url, ts: Date.now() };
}

function revokeAll() {
  for (const it of state.items) if (it.kind === "file" && it.url) URL.revokeObjectURL(it.url);
}

/* ------------------------------ peer events ----------------------------- */

function bind(p: Peer) {
  unlisten?.();
  peer = p;
  unlisten = p.on(onPeerEvent);
}

function onPeerEvent(e: PeerEvent) {
  switch (e.type) {
    case "open":
      set({ phase: "connected", busy: false, code: undefined, pairError: undefined });
      releaseWake = keepAwake();
      if (state.me) peer?.hello(state.me);
      event("Connected securely over your local network");
      break;

    case "closed":
      endCallLocally();
      releaseWake?.();
      releaseWake = null;
      if (state.phase === "connected") set({ phase: "lost", lostReason: e.reason });
      break;

    case "hello":
      set({ peer: e.info });
      break;

    case "message":
      addItem({ kind: "text", id: e.id, from: "peer", text: e.text, ts: e.ts, link: firstLink(e.text) });
      break;

    case "incoming-start":
      speedSamples.set(e.meta.id, { t: performance.now(), b: 0 });
      addItem(fileItem(e.meta, "peer", "active"));
      break;

    case "progress": {
      const prev = speedSamples.get(e.id);
      const now = performance.now();
      let speed: number | undefined;
      if (prev && now > prev.t) {
        const inst = ((e.bytes - prev.b) * 1000) / (now - prev.t);
        const old = (state.items.find((i) => i.id === e.id) as { speed?: number } | undefined)?.speed ?? 0;
        speed = old ? old * 0.7 + inst * 0.3 : inst;
      }
      speedSamples.set(e.id, { t: now, b: e.bytes });
      patchItem(e.id, { bytes: e.bytes, status: "active", ...(speed !== undefined ? { speed } : {}) });
      break;
    }

    case "incoming-done":
      speedSamples.delete(e.id);
      patchItem(e.id, { status: "done", blob: e.blob, url: URL.createObjectURL(e.blob) });
      break;

    case "outgoing-done": {
      speedSamples.delete(e.id);
      const it = state.items.find((i) => i.id === e.id);
      patchItem(e.id, { status: "done", bytes: it?.kind === "file" ? it.size : 0 });
      break;
    }

    case "canceled":
      speedSamples.delete(e.id);
      patchItem(e.id, { status: "canceled" });
      if (e.byPeer) toast("Transfer canceled by the other device");
      break;

    case "call-ring":
      if (state.call) {
        peer?.declineCall("busy");
        break;
      }
      set({
        call: { status: "incoming", kind: e.kind, mic: true, cam: e.kind === "video", facing: "user", peerMic: true, peerCam: e.kind === "video" },
      });
      stopRing = startRingtone();
      break;

    case "call-accept":
      clearTimeout(ringTimeout);
      if (state.call) set({ call: { ...state.call, status: "active", startedAt: Date.now() } });
      break;

    case "call-decline":
      event(e.reason === "busy" ? "They're on another call" : e.reason === "unavailable" ? "Call failed on the other device" : "Call declined", "call");
      endCallLocally();
      break;

    case "call-end":
      if (state.call?.status === "incoming") event(`Missed ${state.call.kind} call`, "call");
      else if (state.call?.startedAt) callEndedEvent();
      endCallLocally();
      break;

    case "call-media":
      if (state.call) set({ call: { ...state.call, peerMic: e.mic, peerCam: e.cam } });
      break;
  }
}

/* -------------------------------- pairing ------------------------------- */

async function ensureMe() {
  if (!state.me) set({ me: await describeDevice() });
}

export async function startHosting() {
  teardown();
  set({ phase: "hosting", busy: true, code: undefined, pairError: undefined });
  try {
    await ensureMe();
    const { peer: p, code } = await Peer.host();
    if (state.phase !== "hosting") return p.close();
    bind(p);
    set({ code, busy: false });
  } catch (e) {
    set({ busy: false, pairError: errText(e) });
  }
}

/** Host: the guest's reply code was scanned. */
export async function completeHosting(text: string) {
  if (!peer) return;
  set({ busy: true, pairError: undefined });
  try {
    await peer.accept(extractCode(text));
    // `open` flips us to "connected"; if ICE can't find a path, surface that.
    setTimeout(() => {
      if (state.phase === "hosting" && state.busy) {
        set({ busy: false, pairError: "Couldn't reach the other device. Check that both are on the same Wi-Fi (not a guest network) and try again." });
      }
    }, 15000);
  } catch (e) {
    set({ busy: false, pairError: errText(e) });
  }
}

export function startJoining() {
  teardown();
  set({ phase: "joining", busy: false, code: undefined, pairError: undefined });
}

/** Guest: the host's code was scanned (in-app, or via the camera app opening our link). */
export async function joinWith(text: string) {
  teardown();
  set({ phase: "joining", busy: true, code: undefined, pairError: undefined });
  try {
    await ensureMe();
    const { peer: p, code } = await Peer.join(extractCode(text));
    if (state.phase !== "joining") return p.close();
    bind(p);
    set({ code, busy: false });
  } catch (e) {
    set({ busy: false, pairError: errText(e) });
  }
}

function teardown() {
  endCallLocally();
  unlisten?.();
  unlisten = null;
  peer?.close("Reset");
  peer = null;
  releaseWake?.();
  releaseWake = null;
}

export function goHome() {
  teardown();
  revokeAll();
  set({ ...initial, me: state.me });
}

export function disconnect() {
  peer?.close("You disconnected", true);
  goHome();
}

/* --------------------------------- chat --------------------------------- */

export function sendText(text: string) {
  const t = text.trim();
  if (!t || !peer?.isOpen) return;
  const { id, ts } = peer.sendText(t);
  addItem({ kind: "text", id, from: "me", text: t, ts, link: firstLink(t) });
}

export function sendFiles(files: File[]) {
  if (!peer?.isOpen || files.length === 0) return;
  const metas = peer.sendFiles(files);
  metas.forEach((meta, i) => {
    const previewable = /^(image|video|audio)\//.test(meta.mime);
    addItem(fileItem(meta, "me", "queued", previewable ? URL.createObjectURL(files[i]) : undefined));
  });
}

export function cancelTransfer(id: string) {
  peer?.cancel(id);
}

/* --------------------------------- calls -------------------------------- */

function constraints(kind: CallKind, facing: "user" | "environment"): MediaStreamConstraints {
  return {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === "video" ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  };
}

function endCallLocally() {
  stopRing?.();
  stopRing = null;
  clearTimeout(ringTimeout);
  const c = state.call;
  if (!c) return;
  c.local?.getTracks().forEach((t) => t.stop());
  void peer?.detachMedia().catch(() => {});
  set({ call: null });
}

/** Reads the call fresh (defeats TS narrowing across awaits). */
const liveCall = (): CallState | null => state.call;

function callEndedEvent() {
  const c = state.call;
  if (!c?.startedAt) return;
  const secs = Math.round((Date.now() - c.startedAt) / 1000);
  const m = Math.floor(secs / 60);
  event(`${c.kind === "video" ? "Video" : "Audio"} call · ${m ? `${m}m ` : ""}${secs % 60}s`, "call");
}

export async function startCall(kind: CallKind) {
  if (!peer?.isOpen || state.call) return;
  set({ call: { status: "outgoing", kind, mic: true, cam: kind === "video", facing: "user", peerMic: true, peerCam: kind === "video" } });
  try {
    peer.prepareCall();
    const local = await navigator.mediaDevices.getUserMedia(constraints(kind, "user"));
    // Re-read after each await: the call may have been hung up meanwhile.
    let c = liveCall();
    if (!c) return local.getTracks().forEach((t) => t.stop());
    set({ call: { ...c, local } });
    const remote = await peer.attachMedia(local);
    c = liveCall();
    if (!c) return;
    set({ call: { ...c, remote } });
    peer.ring(kind);
    ringTimeout = setTimeout(() => {
      if (state.call?.status === "outgoing") {
        peer?.endCall();
        event("No answer", "call");
        endCallLocally();
      }
    }, 45_000);
  } catch (e) {
    toast(e instanceof DOMException && e.name === "NotAllowedError" ? "Camera/microphone permission denied" : `Call failed: ${errText(e)}`, "error");
    endCallLocally();
  }
}

export async function answerCall() {
  const c = state.call;
  if (!peer || c?.status !== "incoming") return;
  stopRing?.();
  stopRing = null;
  set({ call: { ...c, status: "connecting" } });
  try {
    const local = await navigator.mediaDevices.getUserMedia(constraints(c.kind, "user"));
    if (!state.call) return local.getTracks().forEach((t) => t.stop());
    set({ call: { ...state.call, local } });
    const remote = await peer.attachMedia(local);
    peer.acceptCall();
    if (state.call) set({ call: { ...state.call, remote, status: "active", startedAt: Date.now() } });
  } catch (e) {
    peer.declineCall("unavailable");
    toast(e instanceof DOMException && e.name === "NotAllowedError" ? "Camera/microphone permission denied" : `Couldn't join call: ${errText(e)}`, "error");
    endCallLocally();
  }
}

export function declineCall() {
  if (state.call?.status !== "incoming") return;
  peer?.declineCall();
  event(`Declined ${state.call.kind} call`, "call");
  endCallLocally();
}

export function hangUp() {
  if (!state.call) return;
  peer?.endCall();
  if (state.call.startedAt) callEndedEvent();
  else if (state.call.status === "outgoing") event("Call canceled", "call");
  endCallLocally();
}

export function toggleMic() {
  const c = state.call;
  if (!c?.local) return;
  const mic = !c.mic;
  c.local.getAudioTracks().forEach((t) => (t.enabled = mic));
  set({ call: { ...c, mic } });
  peer?.mediaState(mic, c.cam);
}

export async function toggleCam() {
  const c = state.call;
  if (!c?.local || !peer) return;
  if (c.cam) {
    // Fully stop the camera (turns the privacy light off), keep audio going.
    c.local.getVideoTracks().forEach((t) => t.stop());
    await peer.replaceVideo(null);
    const local = new MediaStream(c.local.getAudioTracks());
    set({ call: { ...c, cam: false, local } });
    peer.mediaState(c.mic, false);
    return;
  }
  try {
    const v = await navigator.mediaDevices.getUserMedia({ video: (constraints("video", c.facing).video as MediaTrackConstraints) });
    const track = v.getVideoTracks()[0];
    await peer.replaceVideo(track);
    const cur = state.call;
    if (!cur) return track.stop();
    set({ call: { ...cur, cam: true, local: new MediaStream([...cur.local!.getAudioTracks(), track]) } });
    peer.mediaState(cur.mic, true);
  } catch (e) {
    toast(`Camera unavailable: ${errText(e)}`, "error");
  }
}

export async function flipCamera() {
  const c = state.call;
  if (!c?.local || !c.cam || !peer) return;
  const facing = c.facing === "user" ? "environment" : "user";
  try {
    // Phones can only open one camera at a time: release the current one first.
    c.local.getVideoTracks().forEach((t) => t.stop());
    const v = await navigator.mediaDevices.getUserMedia({ video: (constraints("video", facing).video as MediaTrackConstraints) });
    const track = v.getVideoTracks()[0];
    await peer.replaceVideo(track);
    const cur = state.call;
    if (!cur) return track.stop();
    set({ call: { ...cur, facing, local: new MediaStream([...cur.local!.getAudioTracks(), track]) } });
  } catch (e) {
    toast(`Couldn't switch camera: ${errText(e)}`, "error");
  }
}
