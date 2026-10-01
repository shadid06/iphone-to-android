"use client";

import { useSyncExternalStore } from "react";
import { startHosting, startJoining } from "@/lib/store";
import { AndroidLogo, AppleLogo, Icon, Logo, type IconName } from "./icons";

const features: { icon: IconName; title: string; text: string }[] = [
  { icon: "image", title: "Photos & videos", text: "Original quality, no compression" },
  { icon: "file", title: "Any file", text: "PDFs, docs, archives, audio" },
  { icon: "link", title: "Text & links", text: "Paste once, open on the other phone" },
  { icon: "video", title: "Audio & video calls", text: "HD calling over your Wi-Fi" },
];

const steps = [
  { title: "Join the same Wi-Fi", text: "Both phones on one router. No internet required." },
  { title: "Show a code", text: "Tap “Show pairing code” on either phone." },
  { title: "Scan & scan back", text: "Scan it from the other phone, then let the first phone scan the reply." },
];

const subscribeNoop = () => () => {};

export function Home() {
  const insecure = useSyncExternalStore(
    subscribeNoop,
    () => !window.isSecureContext,
    () => false,
  );

  return (
    <main className="safe-top mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-24 sm:px-8">
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={34} />
          <span className="text-lg font-semibold tracking-tight">Crossbeam</span>
        </div>
        <span className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted">
          <Icon name="lock" size={13} /> Local & private
        </span>
      </header>

      {insecure && (
        <div className="anim-rise mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Icon name="alert" className="mt-0.5 shrink-0 text-amber-500" />
          <p>
            This page isn’t on <b>https://</b>, so the camera and calls are disabled by your browser. Run <code className="font-mono">npm run dev:lan</code> and open the
            https link it prints.
          </p>
        </div>
      )}

      <section className="grid flex-1 items-center gap-10 py-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div className="anim-rise">
          <DevicesVisual />
          <h1 className="mt-8 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            iPhone ⇄ Android,
            <br />
            <span className="text-gradient">no cables. no cloud.</span>
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
            Send photos, videos, files, text and links — and call each other — straight across your Wi-Fi. Nothing is uploaded. Nothing to install.
          </p>
        </div>

        <div className="anim-rise flex flex-col gap-4" style={{ animationDelay: "80ms" }}>
          <ActionCard
            primary
            icon="qr"
            title="Show pairing code"
            text="Start here on one device"
            onClick={() => void startHosting()}
          />
          <ActionCard icon="scan" title="Scan pairing code" text="Then use this on the other device" onClick={startJoining} />

          <div className="mt-2 grid grid-cols-2 gap-3">
            {features.map((f) => (
              <div key={f.title} className="glass rounded-2xl p-4">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon name={f.icon} size={18} />
                </span>
                <p className="mt-3 text-sm font-semibold">{f.title}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="anim-rise mt-6" style={{ animationDelay: "160ms" }}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-faint">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="glass flex gap-4 rounded-2xl p-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold">{s.title}</p>
                <p className="mt-0.5 text-sm text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-faint">
          <span className="flex items-center gap-1.5">
            <Icon name="lock" size={13} /> End-to-end encrypted (DTLS)
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="wifi" size={13} /> Stays on your local network
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="bolt" size={13} /> Wi-Fi speed, no size limits
          </span>
        </p>
      </section>
    </main>
  );
}

function ActionCard({ icon, title, text, onClick, primary }: { icon: IconName; title: string; text: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-4 rounded-3xl p-5 text-left transition-transform active:scale-[0.98] ${
        primary ? "bg-gradient-to-br from-accent to-accent-2 text-white shadow-[0_20px_50px_-20px_var(--accent)]" : "glass"
      }`}
    >
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${primary ? "bg-white/20" : "bg-accent-soft text-accent"}`}>
        <Icon name={icon} size={26} />
      </span>
      <span className="flex-1">
        <span className="block text-lg font-semibold">{title}</span>
        <span className={`block text-sm ${primary ? "text-white/80" : "text-muted"}`}>{text}</span>
      </span>
      <Icon name="back" className="rotate-180 opacity-60 transition-transform group-hover:translate-x-1" />
    </button>
  );
}

function DevicesVisual() {
  return (
    <div className="flex items-center gap-3 sm:gap-5" aria-hidden>
      <Phone label="iPhone">
        <AppleLogo size={26} />
      </Phone>
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-surface-2 sm:w-32">
        <span className="beam absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-accent to-accent-2" />
      </div>
      <Phone label="Android">
        <AndroidLogo size={26} />
      </Phone>
    </div>
  );
}

function Phone({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="glass grid h-24 w-14 place-items-center rounded-[18px] sm:h-28 sm:w-16">
        <span className="text-ink">{children}</span>
      </div>
      <span className="text-xs font-medium text-muted">{label}</span>
    </div>
  );
}
