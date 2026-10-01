import type { PeerInfo } from "./peer";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

type UAData = { getHighEntropyValues(h: string[]): Promise<{ model?: string }> };

export async function describeDevice(): Promise<PeerInfo> {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return { name: "iPhone", platform: "ios" };
  if (isIOS()) return { name: "iPad", platform: "ios" };
  if (/Android/.test(ua)) {
    let model = "";
    try {
      const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
      model = (await data?.getHighEntropyValues(["model"]))?.model ?? "";
    } catch {
      /* not available */
    }
    if (!model) model = ua.match(/Android [\d.]+; ([^;)]+)/)?.[1] ?? "";
    return { name: model && model !== "K" ? model : "Android phone", platform: "android" };
  }
  if (/Mac/.test(ua)) return { name: "Mac", platform: "desktop" };
  if (/Windows/.test(ua)) return { name: "Windows PC", platform: "desktop" };
  return { name: "Computer", platform: "desktop" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export type MediaKind = "image" | "video" | "audio" | "text" | "pdf" | "archive" | "file";

export function mediaKind(mime: string, name: string): MediaKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "archive";
  return "file";
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    const raw = m[1];
    parts.push({ text: raw, href: raw.startsWith("www.") ? `https://${raw}` : raw });
    last = m.index! + raw.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function firstLink(text: string): string | undefined {
  return splitLinks(text).find((p) => p.href)?.href;
}

/**
 * iPhone: the share sheet is the only way to put media into Photos, so prefer it.
 * Elsewhere: a regular download (Android puts it in Downloads / Gallery).
 */
export async function saveBlob(blob: Blob, name: string, preferShare = isIOS()): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  if (preferShare && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [new File([""], "x.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
}

/** Keeps the screen awake while connected — iOS drops the connection when it locks. */
export function keepAwake(): () => void {
  let sentinel: WakeLockSentinel | null = null;
  let stopped = false;
  const acquire = async () => {
    try {
      if (!stopped && document.visibilityState === "visible" && "wakeLock" in navigator) {
        sentinel = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* unsupported or denied */
    }
  };
  const onVis = () => void acquire();
  void acquire();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVis);
    void sentinel?.release().catch(() => {});
  };
}

/** Soft two-tone ring, synthesized so there is no asset to load. */
export function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    ctx = new AudioContext();
    const beep = () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      [0, 0.22].forEach((offset, i) => {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.frequency.value = i ? 660 : 880;
        gain.gain.setValueAtTime(0, t + offset);
        gain.gain.linearRampToValueAtTime(0.12, t + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.2);
        osc.connect(gain).connect(ctx!.destination);
        osc.start(t + offset);
        osc.stop(t + offset + 0.22);
      });
      navigator.vibrate?.([200, 100, 200]);
    };
    beep();
    timer = setInterval(beep, 1800);
  } catch {
    /* audio blocked — visual ring only */
  }
  return () => {
    clearInterval(timer);
    navigator.vibrate?.(0);
    void ctx?.close().catch(() => {});
    ctx = null;
  };
}
