# Horizon

A minimal Windows desktop app that follows the **20-20-20 rule**: every 20 minutes, look at something 20 feet away for 20 seconds.

Horizon runs quietly in your system tray and gently reminds you to rest your eyes with a fullscreen overlay and optional chime sounds.

## Features

- **Break reminders** — Fullscreen overlay with a calm countdown timer
- **Skip button** — Dismiss a break early when you need to
- **Custom intervals** — Adjust work and break durations in Settings
- **Sound notifications** — Gentle chimes when breaks start and end (toggleable)
- **Stats tracking** — Day streak, daily and all-time break counts
- **System tray** — Runs in the background with pause/resume, settings, stats, and quit

## Install

Download the latest installer from [Releases](https://github.com/akash-devanarayana/horizon-eye-care/releases) and run it.

## Development

Requires [Node.js](https://nodejs.org) (v18+).

```bash
# Install dependencies
npm install

# Run the app
npm start

# Build the Windows installer
npm run dist
```

## Tech Stack

- [Electron](https://www.electronjs.org/) — Desktop framework
- [electron-builder](https://www.electron.build/) — Windows NSIS installer packaging

## License

MIT
