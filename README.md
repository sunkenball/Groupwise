# Groupwise

A desktop dashboard for Roblox developers: your groups, games, analytics, funds and group payouts in one place.

Built with Tauri, React and TypeScript. Your Roblox login and Open Cloud API key are stored in the Windows Credential Manager and never leave your machine.

Not affiliated with or endorsed by Roblox Corporation.

## Development

Requires Node.js and the Rust toolchain.

```sh
npm install
npm run tauri dev
```

Build an installer with `npm run tauri build`.

## Releasing

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.
3. GitHub Actions builds the Windows installers and publishes them as a release automatically.
