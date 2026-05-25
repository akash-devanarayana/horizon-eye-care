const { app, BrowserWindow, Tray, Menu, screen } = require('electron');
const path = require('path');

let overlay = null;
let tray = null;
let workTimer = null;
let breakTimer = null;
let paused = false;

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

function startBreak() {
  createOverlay();

  breakTimer = setTimeout(() => {
    if (overlay) {
      overlay.close();
    }
    startWorkTimer();
  }, BREAK_DURATION);
}

function startWorkTimer() {
  if (paused) return;
  workTimer = setTimeout(() => {
    startBreak();
  }, WORK_DURATION);
}

function togglePause() {
  paused = !paused;
  if (paused) {
    clearTimeout(workTimer);
    workTimer = null;
  } else {
    startWorkTimer();
  }
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
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
