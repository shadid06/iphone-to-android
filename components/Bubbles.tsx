"use client";

import { useEffect, useState } from "react";
import { cancelTransfer, type Item } from "@/lib/store";
import { canShareFiles, formatBytes, isIOS, mediaKind, saveBlob, splitLinks } from "@/lib/util";
import { Icon, type IconName } from "./icons";

type TextItem = Extract<Item, { kind: "text" }>;
type FileItem = Extract<Item, { kind: "file" }>;

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Row({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return <div className={`anim-rise flex w-full ${mine ? "justify-end" : "justify-start"}`}>{children}</div>;
}

export function TextBubble({ item }: { item: TextItem }) {
  const mine = item.from === "me";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  };
  const host = item.link ? safeHost(item.link) : null;

  return (
    <Row mine={mine}>
      <div className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[70%] ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${
            mine ? "rounded-br-lg text-white" : "rounded-bl-lg border border-line text-ink"
          }`}
          style={{ background: mine ? "var(--bubble-me)" : "var(--bubble-peer)" }}
        >
          {splitLinks(item.text).map((p, i) =>
            p.href ? (
              <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${mine ? "decoration-white/60" : "text-accent"}`}>
                {p.text}
              </a>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
        {item.link && host && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="glass flex w-64 max-w-full items-center gap-3 rounded-2xl p-2.5 transition-transform active:scale-[0.98]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name="link" size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{host}</span>
              <span className="block truncate text-xs text-muted">{item.link}</span>
            </span>
            <Icon name="external" size={16} className="shrink-0 text-muted" />
          </a>
        )}
        <div className="flex items-center gap-2 px-1 text-[11px] text-faint">
          <span>{time(item.ts)}</span>
          <button onClick={copy} className="flex items-center gap-1 hover:text-ink" aria-label="Copy text">
            <Icon name={copied ? "check" : "copy"} size={12} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </Row>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const kindIcon: Record<string, IconName> = { image: "image", video: "film", audio: "music", pdf: "file", text: "file", archive: "archive", file: "file" };

export function FileBubble({ item, onOpen }: { item: FileItem; onOpen: () => void }) {
  const mine = item.from === "me";
  const kind = mediaKind(item.mime, item.name);
  const pct = item.size ? Math.min(100, Math.round((item.bytes / item.size) * 100)) : 100;
  const active = item.status === "active" || item.status === "queued";
  const done = item.status === "done";
  const eta = item.speed > 0 ? (item.size - item.bytes) / item.speed : 0;
  const showMedia = item.url && (kind === "image" || kind === "video" || kind === "audio");

  return (
    <Row mine={mine}>
      <div className="glass w-[min(85%,340px)] overflow-hidden rounded-3xl">
        {showMedia && kind === "image" && (
          <button onClick={onOpen} className="block w-full bg-black/5" aria-label={`Open ${item.name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={item.name} className="max-h-80 w-full object-cover" />
          </button>
        )}
        {showMedia && kind === "video" && <video src={item.url} controls playsInline preload="metadata" className="max-h-80 w-full bg-black" />}
        {showMedia && kind === "audio" && (
          <div className="px-3 pt-3">
            <audio src={item.url} controls preload="metadata" className="w-full" />
          </div>
        )}

        <div className="flex items-center gap-3 p-3">
          {!showMedia && (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Icon name={kindIcon[kind]} size={20} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{item.name}</p>
            <p className="mt-0.5 truncate text-xs text-muted">
              {active
                ? item.status === "queued"
                  ? `Queued · ${formatBytes(item.size)}`
                  : `${formatBytes(item.bytes)} of ${formatBytes(item.size)}${item.speed ? ` · ${formatBytes(item.speed)}/s` : ""}${eta > 1 ? ` · ${Math.ceil(eta)}s left` : ""}`
                : item.status === "canceled"
                  ? "Canceled"
                  : `${formatBytes(item.size)} · ${mine ? "Sent" : "Received"} ${time(item.ts)}`}
            </p>
          </div>
          {active && (
            <button className="icon-btn h-9 w-9 shrink-0 text-muted" onClick={() => cancelTransfer(item.id)} aria-label="Cancel transfer">
              <Icon name="x" size={18} />
            </button>
          )}
          {done && mine && (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ok/15 text-ok" title="Delivered">
              <Icon name="check" size={15} />
            </span>
          )}
        </div>

        {active && (
          <div className="mx-3 mb-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="progress-active h-full rounded-full transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        )}

        {done && !mine && item.blob && <SaveActions blob={item.blob} name={item.name} />}
      </div>
    </Row>
  );
}

function SaveActions({ blob, name }: { blob: Blob; name: string }) {
  // Only rendered client-side (after pairing), so feature detection in render is safe.
  const shareable = canShareFiles();
  const ios = isIOS();
  const media = /^(image|video)\//.test(blob.type);

  return (
    <div className="flex border-t border-line">
      <button className="flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-semibold text-accent hover:bg-surface-2" onClick={() => void saveBlob(blob, name)}>
        <Icon name={ios ? "share" : "download"} size={16} />
        {ios ? (media ? "Save to Photos" : "Save to Files") : "Download"}
      </button>
      {!ios && shareable && (
        <button
          className="flex flex-1 items-center justify-center gap-2 border-l border-line py-2.5 text-sm font-semibold text-accent hover:bg-surface-2"
          onClick={() => void saveBlob(blob, name, true)}
        >
          <Icon name="share" size={16} /> Share
        </button>
      )}
    </div>
  );
}

export function Lightbox({ item, onClose }: { item: FileItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="anim-pop fixed inset-0 z-50 flex flex-col bg-black/92 backdrop-blur" onClick={onClose}>
      <div className="safe-top flex items-center justify-between gap-3 p-3 text-white">
        <p className="truncate px-2 text-sm font-medium">{item.name}</p>
        <button className="icon-btn text-white hover:bg-white/10" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="grid flex-1 place-items-center p-3" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.name} className="max-h-[80dvh] max-w-full rounded-xl object-contain" />
      </div>
      {item.blob && item.from === "peer" && (
        <div className="safe-bottom flex justify-center p-3" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-primary" onClick={() => void saveBlob(item.blob!, item.name)}>
            <Icon name={isIOS() ? "share" : "download"} size={18} /> {isIOS() ? "Save to Photos" : "Download"}
          </button>
        </div>
      )}
    </div>
  );
}
