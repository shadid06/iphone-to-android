"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Always dark-on-white: phone cameras read inverted codes poorly. */
export function QrCode({ value, size = 260 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#0e1124", light: "#ffffff" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(""));
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <div className="anim-pop rounded-3xl bg-white p-4 shadow-[0_20px_60px_-20px_rgba(109,77,255,0.45)]" style={{ width: size, maxWidth: "100%" }}>
      <div
        role="img"
        aria-label="Pairing QR code"
        className="aspect-square w-full [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
