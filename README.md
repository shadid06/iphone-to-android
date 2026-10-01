<div align="center">

<img src="public/icon.svg" alt="Crossbeam logo" width="96" height="96" />

# Crossbeam

**iPhone ⇄ Android transfer over your Wi-Fi. No app, no account, no cloud.**

Send photos, videos, audio, files, text and links between an iPhone and an Android phone, and make audio or video calls between them, straight from the browser.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![WebRTC](https://img.shields.io/badge/WebRTC-peer--to--peer-333?logo=webrtc)](https://webrtc.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<a href="https://buymeacoffee.com/hasnain.dev" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50" /></a>

</div>

---

## Features

- **Any file type**: photos, videos, audio, documents. Queue several at once, see speed and ETA, cancel from either side.
- **Text and links**: chat-style bubbles, tap to copy or open.
- **Audio and video calls**: mute, camera on/off, front/back flip, minimize to chat.
- **Pair by QR code**: scan with the phone's normal Camera app. A copy/paste code is available as a fallback.
- **Private by design**: WebRTC peer-to-peer with DTLS encryption. No servers, no STUN/TURN, traffic never leaves your LAN.
- **Nothing to install**: works in Safari on iPhone and Chrome on Android. Installable as a PWA.
- **Saves where you expect**: iPhone uses the Share sheet (Save to Photos or Files); Android uses Downloads/Gallery.

## How it works

| Concern | Approach |
| --- | --- |
| Transport | WebRTC peer-to-peer (`RTCDataChannel` + media tracks), DTLS-encrypted. `iceServers: []`, so traffic never leaves the LAN. |
| Signaling | **QR codes instead of a server.** The SDP is reduced to its essential fields (ICE ufrag/pwd, DTLS fingerprint, setup role, LAN candidates) and packed into ~100 bytes ([lib/codec.ts](lib/codec.ts)). The full SDP is rebuilt on the other side. |
| Pairing | Phone A shows QR ① (a link, so the native Camera app can open it). Phone B scans it and shows reply QR ②. Phone A scans ②, and the two phones are connected. |
| Files | A dedicated ordered channel carries a JSON header followed by 64 KB chunks, with 1 MB read-ahead and `bufferedAmount` backpressure. |
| Calls | After pairing, renegotiation runs over the data channel ("perfect negotiation"). A single audio and video transceiver pair is reused across calls via `replaceTrack`. |
| Saving | iPhone: the Share sheet. Android/desktop: download, plus Share. |

### Project structure

```
app/            Next.js app router entry, global styles, PWA manifest
components/     UI (Home, Pairing, Scanner, Session, CallLayer, ...)
lib/peer.ts     WebRTC session engine (data channels, file transfer, calls)
lib/codec.ts    SDP <-> compact QR payload codec
lib/store.ts    App state and actions
scripts/lan.mjs HTTPS dev/serve helper for testing on phones over the LAN
```

## Getting started

### Prerequisites

- Node.js 20+
- A computer and two phones on the **same Wi-Fi** (guest networks with client isolation will not work)

Phones need **HTTPS** to use the camera (QR scanning and calls), so use the LAN script below rather than plain `npm run dev`.

```bash
git clone https://github.com/shadid06/crossbeam.git
cd crossbeam
npm install
npm run dev:lan        # HTTPS dev server on your LAN; prints the URL and a terminal QR
```

1. Open the printed `https://<lan-ip>:3000` on both phones and accept the self-signed certificate warning once.
2. On one phone, tap **Show pairing code**. On the other, tap **Scan pairing code**, then follow the two steps.

### Production build

```bash
npm run build          # static export to ./out
npm run serve:lan      # serve ./out over HTTPS on the LAN (reuses the dev certificate)
```

### Deploy

**Vercel:** import the repo and keep the defaults. `output: "export"` makes it a static site and Vercel supplies HTTPS, so no certificate warnings on the phones.

Any static HTTPS host works too (Netlify, GitHub Pages, Cloudflare Pages): upload `out/`. The page loads from the internet, but transfers and calls still go device to device over the local Wi-Fi.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server (localhost only) |
| `npm run dev:lan` | HTTPS dev server reachable from phones on the LAN |
| `npm run build` | Static export to `out/` |
| `npm run serve:lan` | Serve `out/` over HTTPS on the LAN |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |

## Known limits

- Keep the screen on and the browser in the foreground. iOS suspends the connection when the phone locks or you switch apps. The app requests a wake lock to help.
- Received files are held in memory until saved, so very large files (multiple GB) depend on the phone's RAM.
- Some routers block mDNS or isolate clients. The app requests microphone permission while pairing, which exposes real LAN addresses and makes pairing much more reliable on those networks.
- Both devices must be on the same local network. There is no relay for connecting across the internet.

## Contributing

Contributions are welcome! Bug reports, feature ideas and pull requests all help. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get set up.

If you find a security issue, please open a private report via GitHub's **Security → Report a vulnerability** instead of a public issue.

## Support

If Crossbeam saved you a cable or an awkward cloud upload, consider buying me a coffee. It keeps the project going. ☕

<a href="https://buymeacoffee.com/hasnain.dev" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50" /></a>

Starring the repo ⭐ also helps others find it.

## License

[MIT](LICENSE)
