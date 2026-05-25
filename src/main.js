const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let overlay = null;
let settingsWin = null;
let tray = null;
let workTimer = null;
let breakTimer = null;
let tooltipInterval = null;
let paused = false;
let workStartedAt = null;
let onBreak = false;

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { workMinutes: 20, breakSeconds: 20 };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function getWorkDuration() {
  return loadSettings().workMinutes * 60 * 1000;
}

function getBreakDuration() {
  return loadSettings().breakSeconds * 1000;
}

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
      preload: path.join(__dirname, 'preload.js'),
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
    const remaining = getWorkDuration() - elapsed;
    tray.setToolTip(`Horizon — Next break in ${formatTime(remaining)}`);
  }
}

function startTooltipUpdates() {
  clearInterval(tooltipInterval);
  tooltipInterval = setInterval(updateTooltip, 1000);
  updateTooltip();
}

function endBreak() {
  clearTimeout(breakTimer);
  breakTimer = null;
  if (overlay) {
    overlay.close();
  }
  onBreak = false;
  startWorkTimer();
}

function startBreak() {
  onBreak = true;
  workStartedAt = null;
  updateTooltip();
  createOverlay();

  breakTimer = setTimeout(endBreak, getBreakDuration());
}

function startWorkTimer() {
  if (paused) return;
  workStartedAt = Date.now();
  updateTooltip();
  workTimer = setTimeout(() => {
    startBreak();
  }, getWorkDuration());
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
    {
      label: 'Settings',
      click: openSettings,
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

function openSettings() {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 540,
    height: 660,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

ipcMain.on('skip-break', endBreak);

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.on('save-settings', (_e, settings) => {
  saveSettings(settings);
  if (settingsWin) settingsWin.close();
  if (!paused && !onBreak) {
    clearTimeout(workTimer);
    startWorkTimer();
  }
});

ipcMain.on('close-settings', () => {
  if (settingsWin) settingsWin.close();
});

app.whenReady().then(() => {
  createTray();
  startWorkTimer();
  startTooltipUpdates();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
