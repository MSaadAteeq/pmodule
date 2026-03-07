# Parakeet AI - Interview Assistant

An AI-powered interview practice assistant (Parakeet AI clone). Get real-time AI suggestions during Zoom, Google Meet, Teams, HackerRank, and coding interviews.

## Features

- **Listen to interviewer questions** – Captures audio (mic or Stereo Mix for meeting audio), transcribes with Whisper, generates answers with GPT
- **Never shows when screen sharing** – Window is excluded from screen capture (Zoom, Meet, Teams)
- **Desktop app** for Windows, macOS, and Linux
- **Website** with download links for all platforms
- Cross-platform support

## Setup

1. **OpenAI API key** – Required. Sign in as **superadmin**, open **Admin**, and set the OpenAI API key once. It is stored locally and used for all users. Get a key at [platform.openai.com](https://platform.openai.com).
2. **Capture meeting audio (optional)** – For Zoom/Meet, set **Stereo Mix** or **What U Hear** as your default recording device in Windows Sound settings to capture interviewer audio. Otherwise the mic captures room audio.
3. **Auth** – No Supabase or external auth. Sign up or sign in inside the app; users and usage are stored locally (SQLite in the app data directory).
4. **Superadmin** – First run creates a superadmin account: **Email:** `superadmin@parakeet.local` **Password:** `SuperAdmin123!`  
   Use it to open **Admin**: add/remove coupons (with expiry in days), and forcefully remove any user’s subscription.

## Project Structure

```
Parakeet/
├── src/                 # React frontend (Vite)
├── src-tauri/           # Tauri desktop app (Rust)
├── website/             # Landing page with downloads
│   ├── index.html
│   └── downloads/       # Place built installers here
└── package.json
```

## Prerequisites

- **Node.js** 18+
- **Rust** (install from [rustup.rs](https://rustup.rs))
- **Windows**: Visual Studio Build Tools with C++ workload
- **macOS**: Xcode Command Line Tools
- **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`

## Setup

```bash
npm install
```

## Generate Icons (Required for Build)

Before building, generate app icons:

1. Create or add a 1024x1024 PNG icon (e.g., `app-icon.png`)
2. Run: `npm run tauri icon app-icon.png`

This generates all platform icons in `src-tauri/icons/`.

## Development

```bash
npm run tauri dev
```

## Build for Distribution

### Build for current platform
```bash
npm run tauri build
```

Outputs:
- **Windows**: `src-tauri/target/release/bundle/nsis/Parakeet AI_1.0.0_x64-setup.exe`
- **macOS**: `src-tauri/target/release/bundle/dmg/Parakeet AI_1.0.0_aarch64.dmg` (Apple Silicon) or `_x64.dmg` (Intel)
- **Linux**: `src-tauri/target/release/bundle/appimage/Parakeet AI_1.0.0_amd64.AppImage`

### Deploy website with downloads

1. Copy built installers to `website/downloads/`:
   - `Parakeet-AI_1.0.0_x64-setup.exe` (Windows)
   - `Parakeet-AI_1.0.0_aarch64.dmg` (Mac Apple Silicon)
   - `Parakeet-AI_1.0.0_x64.dmg` (Mac Intel)
   - `Parakeet-AI_1.0.0_amd64.AppImage` (Linux)

2. Serve the website:
   ```bash
   cd website && npx serve .
   ```

3. Or deploy `website/` to Vercel, Netlify, GitHub Pages, etc.

## Cross-Platform Builds

To build for all platforms, use CI:

- **GitHub Actions**: Use [tauri-action](https://github.com/tauri-apps/tauri-action) to build on each platform and create releases
- **Local**: Build on each OS (Windows exe on Windows, dmg on Mac, AppImage on Linux)

## License

MIT
