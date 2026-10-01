// Serves Crossbeam to phones on the same Wi-Fi over HTTPS.
// Camera (QR scanning) and calls require a secure context, so plain http://<lan-ip> won't do.
//
//   node scripts/lan.mjs dev    → next dev with a self-signed certificate, bound to the LAN
//   node scripts/lan.mjs serve  → serves the static build in ./out over HTTPS
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:https";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import QRCode from "qrcode";

const mode = process.argv[2] ?? "dev";
const port = Number(process.env.PORT ?? 3000);
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => n.address);

async function banner() {
  if (!ips.length) {
    console.log("\n  ⚠  No Wi-Fi/LAN address found. Connect this computer to the same network as the phones.\n");
    return;
  }
  const url = `https://${ips[0]}:${port}`;
  console.log(`\n  Crossbeam is available on your network:\n`);
  for (const ip of ips) console.log(`    → https://${ip}:${port}`);
  console.log(`\n  Scan with each phone's camera to open it:\n`);
  console.log(await QRCode.toString(url, { type: "terminal", small: true }));
  console.log(`  The certificate is self-signed — accept the browser warning once per phone`);
  console.log(`  (iPhone: "Show Details" → "visit this website"; Android: "Advanced" → "Proceed").\n`);
}

if (mode === "dev") {
  setTimeout(banner, 2500);
  const child = spawn("npx", ["next", "dev", "--experimental-https", "-H", "0.0.0.0", "-p", String(port)], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
} else if (mode === "serve") {
  const root = resolve("out");
  const key = "certificates/localhost-key.pem";
  const cert = "certificates/localhost.pem";
  if (!existsSync(root)) {
    console.error("No ./out folder. Run `npm run build` first.");
    process.exit(1);
  }
  if (!existsSync(key) || !existsSync(cert)) {
    console.error("No certificate found. Run `npm run dev:lan` once to generate one in ./certificates.");
    process.exit(1);
  }
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain",
    ".webmanifest": "application/manifest+json",
  };
  createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "https://x").pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) file = join(root, "404.html");
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  }).listen(port, "0.0.0.0", banner);
} else {
  console.error(`Unknown mode "${mode}". Use "dev" or "serve".`);
  process.exit(1);
}
