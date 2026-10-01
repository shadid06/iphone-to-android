"use client";

import { useEffect, useRef, useState } from "react";
import { answerCall, declineCall, flipCamera, hangUp, toggleCam, toggleMic, useStore, type CallState } from "@/lib/store";
import { formatDuration } from "@/lib/util";
import { Icon, PlatformIcon, type IconName } from "./icons";

function useTicker(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function Media({ stream, muted, mirror, className }: { stream?: MediaStream; muted?: boolean; mirror?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    v.play().then(
      () => setBlocked(false),
      () => setBlocked(!muted),
    );
  }, [stream, muted]);
  return (
    <>
      <video ref={ref} autoPlay playsInline muted={muted} className={`${className ?? ""} ${mirror ? "-scale-x-100" : ""}`} />
      {blocked && (
        <button
          className="btn btn-primary absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          onClick={() => ref.current?.play().then(() => setBlocked(false))}
        >
          Tap to enable sound
        </button>
      )}
    </>
  );
}

export function CallLayer() {
  const call = useStore((s) => s.call);
  // Mounted only during a call, so local UI state resets with each call.
  return call ? <CallView call={call} /> : null;
}

function CallView({ call }: { call: CallState }) {
  const peer = useStore((s) => s.peer);
  const [minimized, setMinimized] = useState(false);
  const now = useTicker(call.status === "active");
  const name = peer?.name ?? "Other device";

  if (call.status === "incoming") {
    return (
      <div className="anim-pop fixed inset-0 z-50 flex flex-col items-center justify-between bg-[var(--bg)]/80 px-6 py-16 backdrop-blur-2xl">
        <div className="flex flex-col items-center text-center">
          <Avatar platform={peer?.platform} ringing />
          <p className="mt-8 text-sm font-medium uppercase tracking-[0.16em] text-accent">Incoming {call.kind} call</p>
          <h2 className="mt-2 text-3xl font-semibold">{name}</h2>
          <p className="mt-1 text-sm text-muted">Over your local Wi-Fi</p>
        </div>
        <div className="flex w-full max-w-xs justify-between">
          <RoundButton icon="hangup" label="Decline" tone="danger" onClick={declineCall} />
          <RoundButton icon={call.kind === "video" ? "video" : "phone"} label="Accept" tone="ok" onClick={() => void answerCall()} pulse />
        </div>
      </div>
    );
  }

  const active = call.status === "active";
  const showRemoteVideo = active && call.peerCam;
  const elapsed = call.startedAt ? formatDuration((now - call.startedAt) / 1000) : "";
  const status = active ? elapsed : call.status === "outgoing" ? "Calling…" : "Connecting…";

  return (
    <div
      className={
        minimized
          ? "anim-pop fixed right-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 w-36 overflow-hidden rounded-3xl bg-black shadow-2xl sm:w-48"
          : "anim-pop fixed inset-0 z-50 overflow-hidden bg-[#05060c]"
      }
    >
      {/* Remote: one element plays audio and (when on) video, and never unmounts during the call. */}
      <div className={minimized ? "relative aspect-[3/4]" : "absolute inset-0"}>
        <Media stream={call.remote} className={`h-full w-full object-cover transition-opacity ${showRemoteVideo ? "opacity-100" : "opacity-0"}`} />
        {!showRemoteVideo && (
          <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_35%,rgba(115,87,255,0.35),transparent_60%)]">
            {minimized ? (
              <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white">
                <PlatformIcon platform={peer?.platform} size={24} />
              </span>
            ) : (
              <div className="flex flex-col items-center text-center text-white">
                <Avatar platform={peer?.platform} ringing={!active} />
                <h2 className="mt-6 text-2xl font-semibold">{name}</h2>
                <p className="mt-1 text-sm text-white/60">{active && !call.peerCam && call.kind === "video" ? "Camera off" : status}</p>
              </div>
            )}
          </div>
        )}
        {minimized && (
          <button className="absolute inset-0" onClick={() => setMinimized(false)} aria-label="Expand call">
            <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">{status}</span>
          </button>
        )}
      </div>

      {!minimized && (
        <>
          {/* Top bar */}
          <div className="safe-top absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center justify-between p-3 text-white">
              <button className="icon-btn text-white hover:bg-white/10" onClick={() => setMinimized(true)} aria-label="Minimize call" title="Back to chat">
                <Icon name="back" className="-rotate-90" />
              </button>
              {showRemoteVideo && (
                <div className="text-center">
                  <p className="text-sm font-semibold">{name}</p>
                  <p className="text-xs text-white/70">{status}</p>
                </div>
              )}
              <span className="w-10" />
            </div>
            {active && !call.peerMic && (
              <p className="mx-auto w-fit rounded-full bg-black/50 px-3 py-1 text-xs text-white/80">
                <Icon name="micOff" size={12} className="mr-1 inline" /> {name} is muted
              </p>
            )}
          </div>

          {/* Local preview */}
          {call.cam && call.local && (
            <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+4rem)] aspect-[3/4] w-28 overflow-hidden rounded-2xl border border-white/15 shadow-xl sm:w-40">
              <Media stream={call.local} muted mirror={call.facing === "user"} className="h-full w-full object-cover" />
            </div>
          )}

          {/* Controls */}
          <div className="safe-bottom absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent pt-16">
            <div className="mx-auto mb-6 flex max-w-sm items-center justify-center gap-4 px-6">
              <ControlButton icon={call.mic ? "mic" : "micOff"} label={call.mic ? "Mute" : "Unmute"} on={!call.mic} onClick={toggleMic} />
              <ControlButton icon={call.cam ? "video" : "videoOff"} label={call.cam ? "Camera off" : "Camera on"} on={!call.cam} onClick={() => void toggleCam()} />
              {call.cam && <ControlButton icon="flip" label="Flip" onClick={() => void flipCamera()} />}
              <RoundButton icon="hangup" label="End" tone="danger" onClick={hangUp} compact />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Avatar({ platform, ringing }: { platform?: string; ringing?: boolean }) {
  return (
    <div className="relative grid h-32 w-32 place-items-center">
      {ringing && (
        <>
          <span className="pulse-ring absolute inset-0 rounded-full bg-accent/35" />
          <span className="pulse-ring absolute inset-0 rounded-full bg-accent-2/30" style={{ animationDelay: "0.6s" }} />
        </>
      )}
      <span className="relative grid h-28 w-28 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white shadow-[0_20px_60px_-15px_var(--accent)]">
        <PlatformIcon platform={platform} size={48} />
      </span>
    </div>
  );
}

function ControlButton({ icon, label, on, onClick }: { icon: IconName; label: string; on?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 text-white" aria-label={label} aria-pressed={on}>
      <span
        className={`grid h-14 w-14 place-items-center rounded-full backdrop-blur-xl transition-all active:scale-90 ${on ? "bg-white text-black" : "bg-white/15 hover:bg-white/25"}`}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="text-[11px] text-white/75">{label}</span>
    </button>
  );
}

function RoundButton({ icon, label, tone, onClick, pulse, compact }: { icon: IconName; label: string; tone: "ok" | "danger"; onClick: () => void; pulse?: boolean; compact?: boolean }) {
  const size = compact ? "h-14 w-14" : "h-[72px] w-[72px]";
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5" aria-label={label}>
      <span className={`relative grid ${size} place-items-center`}>
        {pulse && <span className="pulse-ring absolute inset-0 rounded-full bg-ok/40" />}
        <span
          className={`relative grid ${size} place-items-center rounded-full text-white shadow-lg transition-transform active:scale-90 ${tone === "ok" ? "bg-ok" : "bg-danger"}`}
        >
          <Icon name={icon} size={compact ? 22 : 28} />
        </span>
      </span>
      <span className={`text-xs ${compact ? "text-white/75" : "font-medium"}`}>{label}</span>
    </button>
  );
}
