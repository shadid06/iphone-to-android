"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/**
 * Camera QR scanner. Uses the native BarcodeDetector where available
 * (Android Chrome) and falls back to jsQR (iOS Safari has no BarcodeDetector).
 */
export function Scanner({ onResult, paused = false }: { onResult: (text: string) => void; paused?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(onResult);
  useEffect(() => {
    cb.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (paused) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    let detector: Detector | null = null;
    try {
      detector = BD ? new BD({ formats: ["qr_code"] }) : null;
    } catch {
      detector = null;
    }

    const found = (text: string) => {
      if (stopped || !text) return;
      stopped = true;
      navigator.vibrate?.(30);
      cb.current(text);
    };

    const tick = async (t: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || v.readyState < 2 || t - last < 140) return;
      last = t;
      try {
        if (detector) {
          const codes = await detector.detect(v);
          if (codes[0]) found(codes[0].rawValue);
          return;
        }
        if (!ctx) return;
        // Downscale for speed; QR codes on a phone screen are large in frame.
        const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (code) found(code.data);
      } catch {
        /* frame not ready */
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setReady(true);
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(
          !window.isSecureContext
            ? "Camera needs a secure (https://) page. Open the app over HTTPS."
            : name === "NotAllowedError"
              ? "Camera access was blocked. Allow it in your browser settings, or paste the code below."
              : "No camera available. Paste the code below instead.",
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      setReady(false);
    };
  }, [paused]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black">
      <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/85">
          <div className="flex flex-col items-center gap-3">
            <Icon name="alert" size={28} />
            <p>{error}</p>
          </div>
        </div>
      ) : (
        <>
          {/* viewfinder */}
          <div className="pointer-events-none absolute inset-[12%]">
            {(["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl"] as const).map((c) => (
              <span key={c} className={`absolute h-10 w-10 border-white ${c}`} />
            ))}
            {ready && <span className="scanline absolute left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-transparent via-[var(--accent-2)] to-transparent shadow-[0_0_16px_var(--accent-2)]" />}
          </div>
          {!ready && <div className="absolute inset-0 grid place-items-center text-sm text-white/70">Starting camera…</div>}
        </>
      )}
    </div>
  );
}
