/**
 * Compact signaling codec.
 *
 * There is no signaling server: the two devices exchange their WebRTC session
 * descriptions through QR codes. A raw SDP is ~1–2 KB, which makes a dense QR
 * that phone cameras struggle with. A data-channel-only SDP, however, is fully
 * described by a handful of fields (ICE credentials, DTLS fingerprint, setup
 * role and candidates). We pack just those into ~100 bytes and rebuild a valid
 * SDP on the other side.
 */

const MAGIC = 0xcb; // lets us tell our codes apart from any other QR
const VERSION = 1;

export type SignalType = "offer" | "answer";

type Candidate =
  | { kind: "ip4"; type: "host" | "srflx"; addr: string; port: number }
  | { kind: "ip6"; type: "host" | "srflx"; addr: string; port: number }
  | { kind: "mdns"; addr: string; port: number }
  | { kind: "name"; addr: string; port: number };

interface Signal {
  type: SignalType;
  setup: "actpass" | "active" | "passive";
  mid: string;
  ufrag: string;
  pwd: string;
  fingerprint: Uint8Array; // sha-256, 32 bytes
  candidates: Candidate[];
}

const SETUPS = ["actpass", "active", "passive"] as const;
const MAX_CANDIDATES = 8;
const UUID_LOCAL =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

/* ----------------------------- SDP parsing ------------------------------ */

function line(sdp: string, re: RegExp): string {
  const m = sdp.match(re);
  if (!m) throw new Error(`Malformed session description (${re.source})`);
  return m[1].trim();
}

function parseCandidates(sdp: string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const raw of sdp.split(/\r?\n/)) {
    if (!raw.startsWith("a=candidate:")) continue;
    const p = raw.slice(12).split(" ");
    // foundation component transport priority address port "typ" type ...
    const [, component, transport, , addr, portStr, , type] = p;
    if (component !== "1" || transport.toLowerCase() !== "udp") continue;
    if (type !== "host" && type !== "srflx") continue;
    const port = Number(portStr);
    const key = `${addr}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) out.push({ kind: "ip4", type, addr, port });
    else if (addr.includes(":")) out.push({ kind: "ip6", type, addr, port });
    else if (UUID_LOCAL.test(addr)) out.push({ kind: "mdns", addr, port });
    else out.push({ kind: "name", addr, port });
  }
  // Same-network transfer: plain IPv4 host candidates are the most useful.
  const rank = (c: Candidate) =>
    c.kind === "ip4" ? (c.type === "host" ? 0 : 3) : c.kind === "mdns" ? 1 : c.kind === "ip6" ? 2 : 4;
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_CANDIDATES);
}

function parseSdp(type: SignalType, sdp: string): Signal {
  const fpLine = line(sdp, /a=fingerprint:(.+)/);
  const [algo, hex] = fpLine.split(" ");
  if (algo.toLowerCase() !== "sha-256") throw new Error(`Unsupported fingerprint ${algo}`);
  const fingerprint = new Uint8Array(hex.split(":").map((h) => parseInt(h, 16)));
  const setup = line(sdp, /a=setup:(\w+)/) as Signal["setup"];
  return {
    type,
    setup: SETUPS.includes(setup) ? setup : type === "offer" ? "actpass" : "active",
    mid: line(sdp, /a=mid:(.+)/),
    ufrag: line(sdp, /a=ice-ufrag:(.+)/),
    pwd: line(sdp, /a=ice-pwd:(.+)/),
    fingerprint,
    candidates: parseCandidates(sdp),
  };
}

function buildSdp(s: Signal): string {
  const fp = Array.from(s.fingerprint, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const cands = s.candidates.map((c, i) => {
    const typ = c.kind === "ip4" || c.kind === "ip6" ? c.type : "host";
    const pref = typ === "host" ? 126 : 100;
    const priority = ((pref << 24) | ((65535 - i) << 8) | 255) >>> 0;
    return `a=candidate:${i + 1} 1 udp ${priority} ${c.addr} ${c.port} typ ${typ}`;
  });
  return [
    "v=0",
    `o=- ${Date.now()} 2 IN IP4 127.0.0.1`,
    "s=-",
    "t=0 0",
    `a=group:BUNDLE ${s.mid}`,
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...cands,
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${s.setup}`,
    `a=mid:${s.mid}`,
    "a=sctp-port:5000",
    "a=max-message-size:262144",
    "",
  ].join("\r\n");
}

/* --------------------------- binary packing ----------------------------- */

class Writer {
  private bytes: number[] = [];
  u8(n: number) { this.bytes.push(n & 0xff); }
  u16(n: number) { this.u8(n >> 8); this.u8(n); }
  raw(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.u8(b[i]); }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    if (b.length > 255) throw new Error("Field too long");
    this.u8(b.length);
    this.raw(b);
  }
  done() { return new Uint8Array(this.bytes); }
}

class Reader {
  private i = 0;
  constructor(private b: Uint8Array) {}
  u8() {
    if (this.i >= this.b.length) throw new Error("Code is incomplete");
    return this.b[this.i++];
  }
  u16() { return (this.u8() << 8) | this.u8(); }
  raw(n: number) {
    if (this.i + n > this.b.length) throw new Error("Code is incomplete");
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  str() { return new TextDecoder().decode(this.raw(this.u8())); }
}

function ip6ToBytes(addr: string): Uint8Array {
  const [head, tail = ""] = addr.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = addr.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g || "0", 16);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 0xff;
  });
  return out;
}

function bytesToIp6(b: Uint8Array): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((b[i] << 8) | b[i + 1]).toString(16));
  return groups.join(":");
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function pack(s: Signal): Uint8Array {
  const w = new Writer();
  w.u8(MAGIC);
  w.u8((VERSION << 4) | ((s.type === "answer" ? 1 : 0) << 2) | SETUPS.indexOf(s.setup));
  w.str(s.mid);
  w.str(s.ufrag);
  w.str(s.pwd);
  w.raw(s.fingerprint);
  w.u8(s.candidates.length);
  for (const c of s.candidates) {
    switch (c.kind) {
      case "ip4":
        w.u8(c.type === "host" ? 0 : 1);
        w.raw(c.addr.split(".").map(Number));
        break;
      case "ip6":
        w.u8(c.type === "host" ? 2 : 3);
        w.raw(ip6ToBytes(c.addr));
        break;
      case "mdns": {
        w.u8(4);
        const m = c.addr.match(UUID_LOCAL)!;
        const h = m.slice(1).join("");
        w.raw(h.match(/../g)!.map((x) => parseInt(x, 16)));
        break;
      }
      case "name":
        w.u8(5);
        w.str(c.addr);
        break;
    }
    w.u16(c.port);
  }
  return w.done();
}

function unpack(bytes: Uint8Array): Signal {
  const r = new Reader(bytes);
  if (r.u8() !== MAGIC) throw new Error("Not a Crossbeam code");
  const head = r.u8();
  if (head >> 4 !== VERSION) throw new Error("This code was made by a different app version");
  const type: SignalType = (head >> 2) & 1 ? "answer" : "offer";
  const setup = SETUPS[head & 3] ?? "actpass";
  const mid = r.str();
  const ufrag = r.str();
  const pwd = r.str();
  const fingerprint = r.raw(32);
  const n = r.u8();
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const k = r.u8();
    let c: Candidate;
    if (k === 0 || k === 1) c = { kind: "ip4", type: k === 0 ? "host" : "srflx", addr: Array.from(r.raw(4)).join("."), port: 0 };
    else if (k === 2 || k === 3) c = { kind: "ip6", type: k === 2 ? "host" : "srflx", addr: bytesToIp6(r.raw(16)), port: 0 };
    else if (k === 4) {
      const h = hex(r.raw(16));
      c = { kind: "mdns", addr: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`, port: 0 };
    } else if (k === 5) c = { kind: "name", addr: r.str(), port: 0 };
    else throw new Error("Unknown candidate in code");
    c.port = r.u16();
    candidates.push(c);
  }
  return { type, setup, mid, ufrag, pwd, fingerprint, candidates };
}

/* ------------------------------- base64url ------------------------------ */

function toB64Url(b: Uint8Array): string {
  let s = "";
  b.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/* --------------------------------- API ---------------------------------- */

export function encodeDescription(desc: RTCSessionDescriptionInit): string {
  const type = desc.type === "answer" ? "answer" : "offer";
  const signal = parseSdp(type, desc.sdp ?? "");
  if (signal.candidates.length === 0) {
    throw new Error("No network found. Make sure this device is connected to Wi-Fi.");
  }
  return toB64Url(pack(signal));
}

export function decodeDescription(code: string): RTCSessionDescriptionInit & { type: SignalType } {
  let signal: Signal;
  try {
    signal = unpack(fromB64Url(code.trim()));
  } catch (e) {
    throw new Error(e instanceof Error && e.message.includes("version") ? e.message : "That doesn't look like a Crossbeam code");
  }
  return { type: signal.type, sdp: buildSdp(signal) };
}

/** Offers travel as a link so the phone's native camera app can open them directly. */
export function offerLink(code: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#join=${code}`;
}

/** Accepts a bare code, or a link produced by {@link offerLink}. */
export function extractCode(text: string): string {
  const t = text.trim();
  const m = t.match(/#join=([A-Za-z0-9_-]+)/);
  return m ? m[1] : t;
}
