"use client";

import { useEffect } from "react";
import { disconnect, getState, joinWith, useStore } from "@/lib/store";
import { CallLayer } from "./CallLayer";
import { CoffeeButton } from "./CoffeeButton";
import { Home } from "./Home";
import { Pairing } from "./Pairing";
import { Session } from "./Session";
import { Toasts } from "./Toasts";

export default function App() {
  const phase = useStore((s) => s.phase);

  useEffect(() => {
    // Opened from the other phone's QR via the native Camera app.
    if (location.hash.startsWith("#join=")) {
      const code = location.hash;
      history.replaceState(null, "", location.pathname + location.search);
      void joinWith(code);
    }
    // Tell the other side right away when this tab closes.
    const onHide = (e: PageTransitionEvent) => {
      if (!e.persisted && getState().phase === "connected") disconnect();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    if (phase !== "connected") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  return (
    <>
      {phase === "home" && <Home />}
      {(phase === "hosting" || phase === "joining") && <Pairing />}
      {(phase === "connected" || phase === "lost") && <Session />}
      {/* Hidden in a session: the composer and call controls own the bottom edge there. */}
      {phase !== "connected" && phase !== "lost" && <CoffeeButton />}
      <CallLayer />
      <Toasts />
    </>
  );
}
