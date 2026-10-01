# Contributing to Crossbeam

Thanks for your interest in improving Crossbeam!

## Reporting bugs

Open an issue and include:

- Both devices' models, OS versions and browsers (e.g. iPhone 15, iOS 18, Safari / Pixel 8, Android 15, Chrome)
- What you were doing (pairing, sending a file, calling) and what happened
- Router/network notes if pairing fails (guest network, client isolation, VPN)

## Development setup

```bash
npm install
npm run dev:lan
```

Open the printed HTTPS URL on two phones on the same Wi-Fi. See the [README](README.md#getting-started) for details.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep changes focused; one feature or fix per PR.
3. Run checks before pushing:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```
4. Test on a real iPhone and Android phone when your change touches pairing, transfers or calls.
5. Describe what changed and how you tested it.

## Guidelines

- The app is frontend only. Changes should not add a backend, accounts or cloud relays.
- Keep traffic on the local network; `iceServers` stays empty.
- Match the existing code style (TypeScript, Tailwind, small components).

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
