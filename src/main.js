const { app, BrowserWindow, Tray, Menu, screen } = require('electron');
const path = require('path');

let overlay = null;
let tray = null;
let workTimer = null;
let breakTimer = null;
let tooltipInterval = null;
let paused = false;
let workStartedAt = null;
let onBreak = false;

const WORK_DURATION = 20 * 60 * 1000;
const BREAK_DURATION = 20 * 1000;

function createOverlay() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  overlay = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreen: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlay.loadFile(path.join(__dirname, 'overlay.html'));
  overlay.on('closed', () => { overlay = null; });
}

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function updateTooltip() {
  if (!tray) return;
  if (paused) {
    tray.setToolTip('Horizon — Paused');
  } else if (onBreak) {
    tray.setToolTip('Horizon — On break');
  } else if (workStartedAt) {
    const elapsed = Date.now() - workStartedAt;
    const remaining = WORK_DURATION - elapsed;
    tray.setToolTip(`Horizon — Next break in ${formatTime(remaining)}`);
  }
}

function startTooltipUpdates() {
  clearInterval(tooltipInterval);
  tooltipInterval = setInterval(updateTooltip, 1000);
  updateTooltip();
}

function startBreak() {
  onBreak = true;
  workStartedAt = null;
  updateTooltip();
  createOverlay();

  breakTimer = setTimeout(() => {
    if (overlay) {
      overlay.close();
    }
    onBreak = false;
    startWorkTimer();
  }, BREAK_DURATION);
}

function startWorkTimer() {
  if (paused) return;
  workStartedAt = Date.now();
  updateTooltip();
  workTimer = setTimeout(() => {
    startBreak();
  }, WORK_DURATION);
}

function togglePause() {
  paused = !paused;
  if (paused) {
    clearTimeout(workTimer);
    workTimer = null;
    workStartedAt = null;
  } else {
    startWorkTimer();
  }
  updateTooltip();
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: paused ? 'Resume' : 'Pause',
      click: togglePause,
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
  tray.setToolTip('Horizon — 20-20-20 reminder');
  updateTrayMenu();
}

app.whenReady().then(() => {
  createTray();
  startWorkTimer();
  startTooltipUpdates();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
