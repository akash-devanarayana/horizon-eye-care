const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let overlay = null;
let settingsWin = null;
let statsWin = null;
let tray = null;
let workTimer = null;
let breakTimer = null;
let tooltipInterval = null;
let paused = false;
let workStartedAt = null;
let onBreak = false;

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { workMinutes: 20, breakSeconds: 20, soundEnabled: true };

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

const STATS_PATH = path.join(app.getPath('userData'), 'stats.json');

function loadStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return { days: {}, totalCompleted: 0, totalSkipped: 0 };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function recordBreak(type) {
  const stats = loadStats();
  const key = todayKey();
  if (!stats.days[key]) stats.days[key] = { completed: 0, skipped: 0 };
  if (type === 'completed') {
    stats.days[key].completed++;
    stats.totalCompleted = (stats.totalCompleted || 0) + 1;
  } else {
    stats.days[key].skipped++;
    stats.totalSkipped = (stats.totalSkipped || 0) + 1;
  }
  saveStats(stats);
}

function getStreak() {
  const stats = loadStats();
  const dates = Object.keys(stats.days).filter(d => stats.days[d].completed > 0).sort().reverse();
  if (dates.length === 0) return 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const check = new Date(today);
    check.setDate(check.getDate() - i);
    const key = check.toISOString().slice(0, 10);
    if (stats.days[key] && stats.days[key].completed > 0) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
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

function playSound(file) {
  const settings = loadSettings();
  if (!settings.soundEnabled) return;
  const soundPath = path.join(__dirname, '..', 'assets', 'sounds', file).replace(/\\/g, '/');
  const win = overlay || settingsWin;
  if (win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(`new Audio('file:///${soundPath}').play().catch(()=>{})`);
  }
}

function endBreak(skipped) {
  clearTimeout(breakTimer);
  breakTimer = null;
  recordBreak(skipped ? 'skipped' : 'completed');
  playSound('break-end.wav');
  setTimeout(() => {
    if (overlay) overlay.close();
    onBreak = false;
    startWorkTimer();
  }, 600);
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
    {
      label: 'Stats',
      click: openStats,
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
    height: 720,
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

ipcMain.on('skip-break', () => endBreak(true));

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

function openStats() {
  if (statsWin) {
    statsWin.focus();
    return;
  }
  statsWin = new BrowserWindow({
    width: 480,
    height: 520,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  statsWin.setMenu(null);
  statsWin.loadFile(path.join(__dirname, 'stats.html'));
  statsWin.on('closed', () => { statsWin = null; });
}

ipcMain.handle('get-stats', () => {
  const stats = loadStats();
  const key = todayKey();
  const today = stats.days[key] || { completed: 0, skipped: 0 };
  return {
    todayCompleted: today.completed,
    todaySkipped: today.skipped,
    totalCompleted: stats.totalCompleted || 0,
    streak: getStreak(),
  };
});

ipcMain.on('close-stats', () => {
  if (statsWin) statsWin.close();
});

app.whenReady().then(() => {
  createTray();
  startWorkTimer();
  startTooltipUpdates();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
