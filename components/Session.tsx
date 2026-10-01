"use client";

import { useEffect, useRef, useState } from "react";
import { disconnect, goHome, sendFiles, sendText, startCall, startHosting, toast, useStore, type Item } from "@/lib/store";
import { Icon, PlatformIcon, type IconName } from "./icons";
import { FileBubble, Lightbox, TextBubble } from "./Bubbles";

export function Session() {
  const phase = useStore((s) => s.phase);
  const peer = useStore((s) => s.peer);
  const items = useStore((s) => s.items);
  const lostReason = useStore((s) => s.lostReason);
  const inCall = useStore((s) => Boolean(s.call));
  const live = phase === "connected";

  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Extract<Item, { kind: "file" }> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);

  // Stick to the bottom as new items arrive.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!live) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) sendFiles(files);
    else {
      const text = e.dataTransfer.getData("text/plain");
      if (text) sendText(text);
    }
  };

  return (
    <div
      className="fixed inset-0 flex flex-col"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {/* Header */}
      <header className="glass safe-top z-20 border-x-0 border-t-0">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-3 sm:px-5">
          <button className="icon-btn" onClick={() => (live ? disconnect() : goHome())} aria-label={live ? "Disconnect" : "Back"} title={live ? "Disconnect" : "Back"}>
            <Icon name={live ? "power" : "back"} />
          </button>
          <div className="relative">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white">
              <PlatformIcon platform={peer?.platform} size={20} />
            </span>
            <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[var(--surface-solid)] ${live ? "bg-ok" : "bg-faint"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{peer?.name ?? "Other device"}</p>
            <p className="truncate text-xs text-muted">{live ? "Connected · same Wi-Fi · encrypted" : "Disconnected"}</p>
          </div>
          <button className="icon-btn text-accent" onClick={() => void startCall("audio")} disabled={!live || inCall} aria-label="Audio call" title="Audio call">
            <Icon name="phone" />
          </button>
          <button className="icon-btn text-accent" onClick={() => void startCall("video")} disabled={!live || inCall} aria-label="Video call" title="Video call">
            <Icon name="video" />
          </button>
        </div>
      </header>

      {!live && (
        <div className="anim-rise mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-3xl items-center gap-3 rounded-2xl border border-danger/25 bg-danger/10 p-3 text-sm">
          <Icon name="alert" className="shrink-0 text-danger" />
          <p className="flex-1">
            {lostReason ?? "Disconnected"}. Received files are still here to save.
          </p>
          <button className="btn btn-primary h-9 px-4 text-sm" onClick={() => void startHosting()}>
            Reconnect
          </button>
        </div>
      )}

      {/* Timeline */}
      <div ref={scroller} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-2 px-3 py-4 sm:px-5">
          {items.filter((i) => i.kind !== "event").length === 0 && live && <EmptyState />}
          {items.map((it) =>
            it.kind === "event" ? (
              <EventRow key={it.id} text={it.text} tone={it.tone} />
            ) : it.kind === "text" ? (
              <TextBubble key={it.id} item={it} />
            ) : (
              <FileBubble key={it.id} item={it} onOpen={() => setPreview(it)} />
            ),
          )}
        </div>
      </div>

      {live && <Composer />}

      {dragging && live && (
        <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-accent bg-[var(--bg)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-accent">
            <Icon name="upload" size={40} />
            <p className="text-lg font-semibold">Drop to send to {peer?.name ?? "the other device"}</p>
          </div>
        </div>
      )}

      {preview && <Lightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function EventRow({ text, tone }: { text: string; tone?: "call" | "info" | "warn" }) {
  return (
    <div className="anim-rise my-2 flex justify-center">
      <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">
        <Icon name={tone === "call" ? "phone" : tone === "warn" ? "alert" : "lock"} size={12} />
        {text}
      </span>
    </div>
  );
}

const pickers: { icon: IconName; label: string; accept: string }[] = [
  { icon: "image", label: "Photos & videos", accept: "image/*,video/*" },
  { icon: "file", label: "Files", accept: "" },
  { icon: "music", label: "Audio", accept: "audio/*" },
];

function useFilePicker() {
  const input = useRef<HTMLInputElement | null>(null);
  return (accept: string) => {
    input.current?.remove();
    const el = document.createElement("input");
    el.type = "file";
    el.multiple = true;
    if (accept) el.accept = accept;
    el.style.display = "none";
    el.onchange = () => {
      if (el.files?.length) sendFiles(Array.from(el.files));
      el.remove();
    };
    document.body.appendChild(el);
    input.current = el;
    el.click();
  };
}

async function pasteClipboard() {
  try {
    if (navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items) {
        const imgType = it.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await it.getType(imgType);
          files.push(new File([blob], `clipboard-${Date.now()}.${imgType.split("/")[1]}`, { type: imgType }));
        }
      }
      if (files.length) return sendFiles(files);
    }
    const text = await navigator.clipboard.readText();
    if (text.trim()) sendText(text);
    else toast("Clipboard is empty");
  } catch {
    toast("Clipboard access was blocked — long-press the message box and paste instead.", "error");
  }
}

function EmptyState() {
  const pick = useFilePicker();
  return (
    <div className="anim-rise m-auto flex w-full max-w-md flex-col items-center py-10 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-accent to-accent-2 text-white shadow-[0_16px_40px_-14px_var(--accent)]">
        <Icon name="check" size={30} />
      </span>
      <h2 className="mt-5 text-xl font-semibold">You’re connected</h2>
      <p className="mt-1 text-sm text-muted">Send anything — it goes straight to the other device, at full quality.</p>
      <div className="mt-6 grid w-full grid-cols-2 gap-3">
        {pickers.map((p) => (
          <QuickTile key={p.label} icon={p.icon} label={p.label} onClick={() => pick(p.accept)} />
        ))}
        <QuickTile icon="clipboard" label="Paste clipboard" onClick={() => void pasteClipboard()} />
      </div>
      <p className="mt-5 hidden text-xs text-faint sm:block">Tip: drag & drop files anywhere in this window.</p>
    </div>
  );
}

function QuickTile({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="glass flex flex-col items-center gap-2 rounded-2xl p-4 transition-transform active:scale-[0.97]">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon name={icon} />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const pick = useFilePicker();
  const area = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~5 lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim()) return;
    sendText(text);
    setText("");
    area.current?.focus();
  };

  return (
    <div className="glass safe-bottom relative z-20 border-x-0 border-b-0 pt-3">
      {menu && (
        <>
          <button className="fixed inset-0 z-0 cursor-default" aria-label="Close menu" onClick={() => setMenu(false)} />
          <div className="anim-pop glass absolute bottom-full left-3 z-10 mb-2 w-60 rounded-2xl p-1.5 sm:left-[max(0.75rem,calc(50%-24rem+0.75rem))]">
            {pickers.map((p) => (
              <MenuItem
                key={p.label}
                icon={p.icon}
                label={p.label}
                onClick={() => {
                  setMenu(false);
                  pick(p.accept);
                }}
              />
            ))}
            <MenuItem
              icon="clipboard"
              label="Paste clipboard"
              onClick={() => {
                setMenu(false);
                void pasteClipboard();
              }}
            />
          </div>
        </>
      )}
      <form
        className="mx-auto flex max-w-3xl items-end gap-2 px-3 sm:px-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          className={`icon-btn h-11 w-11 shrink-0 bg-surface-2 transition-transform ${menu ? "rotate-45" : ""}`}
          onClick={() => setMenu((m) => !m)}
          aria-label="Attach"
        >
          <Icon name="plus" size={22} />
        </button>
        <textarea
          ref={area}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              sendFiles(files);
            }
          }}
          placeholder="Message, link or note…"
          className="max-h-[132px] min-h-11 flex-1 resize-none rounded-[22px] border border-line bg-surface-2 px-4 py-2.5 text-[16px] leading-6 outline-none ring-accent/40 placeholder:text-faint focus:ring-2"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white shadow-[0_8px_20px_-8px_var(--accent)] transition-all active:scale-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Icon name="send" size={19} />
        </button>
      </form>
    </div>
  );
}

function MenuItem({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-surface-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon name={icon} size={17} />
      </span>
      {label}
    </button>
  );
}
