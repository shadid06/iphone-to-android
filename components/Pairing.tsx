"use client";

import { useState } from "react";
import { offerLink } from "@/lib/codec";
import { completeHosting, goHome, joinWith, startHosting, startJoining, useStore } from "@/lib/store";
import { Icon } from "./icons";
import { QrCode } from "./QrCode";
import { Scanner } from "./Scanner";

/**
 * Two-step QR handshake (no server):
 *   Host shows code ① → Guest scans it and shows reply ② → Host scans reply → connected.
 */
export function Pairing() {
  const { phase, code, busy, pairError } = useStore((s) => s);
  const isHost = phase === "hosting";
  const [hostScanning, setHostScanning] = useState(false);
  const [scanKey, setScanKey] = useState(0);

  // Which sub-view are we in?
  const view: "loading" | "show" | "scan" | "connecting" | "error" =
    pairError && !code ? "error"
    : isHost
      ? !code ? "loading" : busy ? "connecting" : hostScanning ? "scan" : "show"
      : busy ? "loading" : code ? "show" : "scan";

  const step = isHost ? (view === "show" || view === "loading" ? 1 : 2) : view === "scan" || view === "loading" ? 1 : 2;

  const onScan = (text: string) => (isHost ? void completeHosting(text) : void joinWith(text));
  const retryScan = () => setScanKey((k) => k + 1);

  const title =
    view === "connecting" ? "Connecting…"
    : isHost
      ? view === "scan" ? "Scan the reply" : "Show this to the other phone"
      : view === "show" ? "Show this back" : "Scan the pairing code";

  const subtitle =
    view === "connecting" ? "Establishing an encrypted link over your Wi-Fi."
    : isHost
      ? view === "scan"
        ? "Point this camera at the code now showing on the other phone."
        : "On the other phone, tap “Scan pairing code” — or just point its Camera app here."
      : view === "show"
        ? "Let the first phone scan this. You'll connect automatically."
        : "Point your camera at the code on the other phone.";

  return (
    <main className="safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-24">
      <header className="flex items-center justify-between py-4">
        <button className="icon-btn" onClick={goHome} aria-label="Back">
          <Icon name="back" />
        </button>
        <StepDots step={step} />
        <span className="w-10" />
      </header>

      <div key={view} className="anim-rise flex flex-1 flex-col items-center text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Step {step} of 2</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">{subtitle}</p>

        <div className="mt-7 w-full max-w-[300px]">
          {view === "loading" && <Placeholder text={isHost ? "Preparing secure code…" : "Creating reply…"} />}
          {view === "show" && code && <QrCode value={isHost ? offerLink(code) : code} size={300} />}
          {view === "scan" && <Scanner key={scanKey} onResult={onScan} />}
          {view === "connecting" && <Connecting />}
          {view === "error" && <ErrorCard text={pairError!} />}
        </div>

        {pairError && view !== "error" && (
          <div className="mt-5 w-full max-w-[300px]">
            <ErrorCard text={pairError} />
          </div>
        )}

        <div className="mt-6 flex w-full max-w-[300px] flex-col gap-3">
          {isHost && view === "show" && (
            <button className="btn btn-primary w-full" onClick={() => setHostScanning(true)}>
              <Icon name="scan" /> Next: scan their reply
            </button>
          )}
          {isHost && view === "scan" && (
            <button className="btn btn-ghost w-full" onClick={() => setHostScanning(false)}>
              <Icon name="qr" /> Show my code again
            </button>
          )}
          {view === "scan" && pairError && (
            <button className="btn btn-ghost w-full" onClick={retryScan}>
              <Icon name="refresh" /> Scan again
            </button>
          )}
          {!isHost && view === "show" && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted">
              <span className="relative flex h-2.5 w-2.5">
                <span className="pulse-ring absolute inline-flex h-full w-full rounded-full bg-accent" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
              Waiting for the other phone…
            </p>
          )}
          {view === "error" && (
            <button className="btn btn-primary w-full" onClick={() => (isHost ? void startHosting() : startJoining())}>
              <Icon name="refresh" /> Try again
            </button>
          )}
        </div>

        {(view === "show" || view === "scan") && <ManualCode mode={view} code={code} isHost={isHost} onSubmit={onScan} />}
      </div>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-faint">
        <Icon name="wifi" size={13} /> Both devices must be on the same Wi-Fi network
      </p>
    </main>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden>
      {[1, 2].map((i) => (
        <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-accent" : i < step ? "w-1.5 bg-accent/60" : "w-1.5 bg-faint/40"}`} />
      ))}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="glass grid aspect-square w-full place-items-center rounded-3xl">
      <div className="flex flex-col items-center gap-3 text-sm text-muted">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
        {text}
      </div>
    </div>
  );
}

function Connecting() {
  return (
    <div className="glass grid aspect-square w-full place-items-center rounded-3xl">
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="pulse-ring absolute inset-0 rounded-full bg-accent/30" />
        <span className="pulse-ring absolute inset-0 rounded-full bg-accent-2/30" style={{ animationDelay: "0.6s" }} />
        <span className="relative grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white">
          <Icon name="wifi" size={28} />
        </span>
      </div>
    </div>
  );
}

function ErrorCard({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger/10 p-4 text-left text-sm">
      <Icon name="alert" className="mt-0.5 shrink-0 text-danger" />
      <p>{text}</p>
    </div>
  );
}

/** Fallback for when cameras can't be used: copy/paste the code over any channel. */
function ManualCode({ mode, code, isHost, onSubmit }: { mode: "show" | "scan"; code?: string; isHost: boolean; onSubmit: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(isHost ? offerLink(code) : code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked; the code is selectable */
    }
  };

  return (
    <div className="mt-6 w-full max-w-[300px]">
      <button className="mx-auto flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink" onClick={() => setOpen((o) => !o)}>
        <Icon name="keyboard" size={14} /> {open ? "Hide" : "Can't scan? Use a text code"}
      </button>
      {open && (
        <div className="anim-rise glass mt-3 rounded-2xl p-3 text-left">
          {mode === "show" && code ? (
            <>
              <p className="break-all rounded-xl bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-muted select-all">{code}</p>
              <button className="btn btn-ghost mt-3 h-10 w-full text-sm" onClick={copy}>
                <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copied" : "Copy code"}
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) onSubmit(text);
              }}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the code from the other device"
                rows={3}
                className="w-full resize-none rounded-xl bg-surface-2 p-3 font-mono text-xs outline-none ring-accent/40 focus:ring-2"
              />
              <button className="btn btn-primary mt-2 h-10 w-full text-sm" disabled={!text.trim()}>
                Connect
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
