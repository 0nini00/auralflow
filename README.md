<div align="center">

<img src="desktop/src/assets/logo.png" alt="AuralFlow Logo" width="96" height="96" />

<h1 align="center">AuralFlow</h1>

<p align="center">A cross-platform modern music player for Desktop and Android, sharing domain logic via <code>@lx/core</code>.</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue.svg" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D22.11.0-brightgreen.svg" alt="Node" />
  <img src="https://img.shields.io/badge/tauri-v2-orange.svg" alt="Tauri" />
  <img src="https://img.shields.io/badge/react--native-0.86-61dafb.svg" alt="React Native" />
  <img src="https://img.shields.io/badge/package-pnpm%20monorepo-yellow.svg" alt="pnpm" />
</p>

</div>

## Overview

AuralFlow is a full-featured, cross-platform music streaming and local audio player. Built with a monorepo architecture, it powers both a desktop application (Tauri v2 + React 18) and a mobile application (React Native 0.86 + React 19) through a shared domain core package (`@lx/core`).

Inspired by LX Music, AuralFlow delivers a seamless audio playback experience with real-time synchronized karaoke lyrics, unified multi-source search, automatic cross-source copyright fallback, bi-directional WebDAV library synchronization, and deep Android background playback resilience.

## Highlights

- **Shared Domain Core (`@lx/core`)**: Domain models, playback resolution race logic, stream probe validation, and lyric clock interpolation algorithms are centralized and verified by unit tests.
- **Cross-Source Fallback**: When NetEase tracks cannot resolve playback streams due to regional restrictions or copyright unavailability, AuralFlow automatically queries QQ Music with strict metadata validation (normalized title + artist overlap + duration delta <= 5s) to take over playback seamlessly.
- **Dynamic Synchronized Lyrics**: Supports LRC, YRC, QRC, and KRC lyric formats with dynamic character-by-character karaoke rendering, translation merging, and desktop transparent floating overlay / Android WindowManager overlay.
- **Reliable WebDAV Sync**: Synchronizes playlists, favorite tracks, and listening history with automated startup convergence, conflict detection, and local pre-download snapshots.
- **Android Background Resilience**: Integrates battery optimization exemption prompts and audio focus management to prevent background freeze on modern Android ROMs.
- **Local Music Management**: High-performance local directory scanning, ID3 metadata inspection and editing, embedded album artwork extraction, and lossless audio downloading.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        AuralFlow Client                         │
├───────────────────────────────┬─────────────────────────────────┤
│        Desktop Client         │         Android Client          │
│       Tauri v2 + React        │   React Native 0.86 + React 19  │
│  - HTMLAudio + rAF Engine     │  - react-native-track-player    │
│  - Transparent Desktop Lyric  │  - WindowManager Float Lyric    │
│  - Rust Media Cache & FS      │  - Battery Exemption Keeper     │
└───────────────┬───────────────┴─────────────────┬───────────────┘
                │                                 │
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              Shared Domain Core (@lx/core)                      │
│  - Playback Quality Tiers (128k / 192k / 320k / FLAC / Hi-Res)  │
│  - Cross-Source Strict Matcher (NetEase ──▶ QQ Music Fallback)  │
│  - Lyric Clock Engine & Parsers (LRC / YRC / QRC / KRC)         │
│  - WebDAV Playlist & History Merge Logic                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Audio Providers                          │
│  - NetEase (wy): eapi/weapi   - QQ Music (tx): musicu/custom    │
│  - Bilibili (bili): WBI/DASH  - Custom User API Scripts (LX)    │
└─────────────────────────────────────────────────────────────────┘
```

## Feature Matrix

| Category | Capability | Desktop | Android |
|---|---|---|---|
| Search | Multi-source aggregated search with suggestion and deduplication | Supported | Supported |
| Playlists | NetEase / QQ playlists, local playlists, Bilibili collections, favorites | Supported | Supported |
| Discovery | Daily recommendation, Private FM mode with prefetch, leaderboards | Supported | Supported |
| Playback | Queue management, Play Next, 4 loop modes, playback rate, quality switch | Supported | Supported |
| Fallback | Automatic NetEase to QQ Music fallback for tracks without rights | Supported | Supported |
| Lyrics | Synchronized scrolling, karaoke word-by-word timing, translation merge | Supported | Supported |
| Floating Lyric | Transparent click-through desktop overlay / WindowManager overlay | Desktop window | Android overlay |
| Local Music | File scanning, ID3 tag editing, embedded album art, lossless download | Rust Lofty/Tags | MediaStore/FS |
| WebDAV | Cloud sync for playlists, history, and custom sources; startup auto-sync | Supported | Supported |
| Background Play | Keeps audio uninterrupted during sleep or lockscreen | System tray | Foreground service |

## Repository Structure

```text
auralflow/
├── apps/mobile/                Mobile app (React Native 0.86 + Android native modules)
├── desktop/                    Desktop app (Tauri v2 + React 18 + Rust native core)
│   └── packages/tauri-bridge/  IPC bridge for desktop web views
├── packages/core/              Shared core domain package (@lx/core, Vitest suite)
├── dist/                       Release package output directory
└── package.json                Monorepo workspace root configuration
```

## Quick Start

### Prerequisites

- **Node.js**: >= 22.11.0 (strict requirement for Metro compiler)
- **pnpm**: >= 9.0.0
- **Rust toolchain**: Required for desktop compilation (`cargo`, `rustc`)
- **Android SDK & JDK 17**: Required for mobile compilation (minSdk 24, compileSdk 36)

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/0nini00/auralflow.git
cd auralflow
pnpm install
```

### Development

Run the desktop application:

```bash
pnpm desktop:tauri:dev
# Or run web view dev server alone:
pnpm desktop:dev
```

Run the Android application:

```bash
# Terminal 1: Start Metro bundler
pnpm mobile:start

# Terminal 2: Launch Android application on emulator or connected device
pnpm mobile:android
```

### Verification & Testing

Run type checks and tests across the monorepo:

```bash
# Run core shared package unit tests
pnpm core:test

# Run desktop TypeScript type checking
pnpm desktop:typecheck

# Run mobile TypeScript type checking
pnpm mobile:typecheck
```

### Build Release Artifacts

Build desktop Windows installers (MSI and portable executable):

```bash
pnpm desktop:tauri:build
```

Build mobile Android APKs:

```bash
# Build Debug APK
pnpm mobile:build:debug

# Build Release APK
pnpm mobile:build:release
```
