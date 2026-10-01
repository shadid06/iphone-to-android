import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Phones on the Wi-Fi load the dev server via this machine's LAN IP;
// Next.js blocks dev assets for unknown origins unless they are listed.
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n!.address);

const nextConfig: NextConfig = {
  // Pure frontend: `next build` emits a static site in `out/` that any HTTPS host can serve.
  output: "export",
  allowedDevOrigins: lanHosts,
};

export default nextConfig;
