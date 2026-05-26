const { app, BrowserWindow, Tray, Menu, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let overlay = null;
let settingsWin = null;
let statsWin = null;
let tray = null;
let workTimer = null;
let breakTimer = null;
let breakEndSoundTimer = null;
let tooltipInterval = null;
let dndInterval = null;
let paused = false;
let dndActive = false;
let workStartedAt = null;
let onBreak = false;

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { workMinutes: 20, breakSeconds: 20, soundEnabled: true, dndEnabled: true, dailyGoal: 14 };

// --- Do Not Disturb: detect fullscreen apps via the Windows notification-state API ---
let queryNotificationState = null;
try {
  const koffi = require('koffi');
  const shell32 = koffi.load('shell32.dll');
  const fn = shell32.func('int __stdcall SHQueryUserNotificationState(_Out_ int *pquns)');
  queryNotificationState = () => {
    const ptr = [0];
    const hr = fn(ptr);
    return hr === 0 ? ptr[0] : null;
  };
} catch {
  queryNotificationState = null;
}

function isFullscreenAppRunning() {
  if (!queryNotificationState) return false;
  const state = queryNotificationState();
  // 2=BUSY, 3=D3D fullscreen, 4=presentation mode, 7=fullscreen Store app
  return state === 2 || state === 3 || state === 4 || state === 7;
}

function readJson(file) {
  // Strip a leading UTF-8 BOM, which JSON.parse cannot handle.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...readJson(SETTINGS_PATH) };
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
    return readJson(STATS_PATH);
  } catch {
    return { days: {}, totalCompleted: 0, totalSkipped: 0 };
  }
}

function saveStats(stats) {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
}

function dateKey(d) {
  // Local YYYY-MM-DD (avoids the UTC shift from toISOString in non-UTC zones)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return dateKey(new Date());
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
    const key = dateKey(check);
    if (stats.days[key] && stats.days[key].completed > 0) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

function getLongestStreak() {
  const stats = loadStats();
  const days = Object.keys(stats.days).filter(d => stats.days[d].completed > 0).sort();
  if (days.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const cur = new Date(days[i]);
    const diffDays = Math.round((cur - prev) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

function getLast7Days() {
  const stats = loadStats();
  const result = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const day = stats.days[key];
    result.push({
      label: labels[d.getDay()],
      completed: day ? day.completed : 0,
      isToday: i === 0,
    });
  }
  return result;
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
  } else if (dndActive) {
    tray.setToolTip('Horizon — Paused (fullscreen app)');
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

function checkDnd() {
  const enabled = loadSettings().dndEnabled;

  // If the feature is off, make sure any auto-pause is lifted.
  if (!enabled) {
    if (dndActive) {
      dndActive = false;
      if (!paused && !onBreak) startWorkTimer();
      updateTooltip();
    }
    return;
  }

  // Don't interfere while a break overlay is showing.
  if (onBreak) return;

  const fullscreen = isFullscreenAppRunning();

  if (fullscreen && !dndActive) {
    // Entered a fullscreen app — pause the countdown.
    dndActive = true;
    clearTimeout(workTimer);
    workTimer = null;
    workStartedAt = null;
    updateTooltip();
  } else if (!fullscreen && dndActive) {
    // Left the fullscreen app — resume (unless manually paused).
    dndActive = false;
    if (!paused) startWorkTimer();
    updateTooltip();
  }
}

function startDndMonitor() {
  clearInterval(dndInterval);
  dndInterval = setInterval(checkDnd, 3000);
}

function playSound(file) {
  const settings = loadSettings();
  if (!settings.soundEnabled) return;
  const win = overlay || settingsWin || statsWin;
  if (!win || win.isDestroyed()) return;
  try {
    // Read via fs (asar-aware) and play as a data URL. A file:// URL into
    // an asar archive can't be played by the renderer's media loader.
    const filePath = path.join(__dirname, '..', 'assets', 'sounds', file);
    const base64 = fs.readFileSync(filePath).toString('base64');
    win.webContents.executeJavaScript(
      `new Audio('data:audio/wav;base64,${base64}').play().catch(()=>{})`
    );
  } catch {
    // Ignore playback errors (missing file, no audio device, etc.)
  }
}

function endBreak(skipped) {
  clearTimeout(breakTimer);
  clearTimeout(breakEndSoundTimer);
  breakTimer = null;
  breakEndSoundTimer = null;
  recordBreak(skipped ? 'skipped' : 'completed');
  if (skipped) {
    // User bailed early — play the chime, then close after it plays.
    playSound('break-end.wav');
    setTimeout(() => {
      if (overlay) overlay.close();
      onBreak = false;
      startWorkTimer();
    }, 500);
  } else {
    // Natural end — the chime already played during the final second,
    // so close immediately as the countdown hits zero.
    if (overlay) overlay.close();
    onBreak = false;
    startWorkTimer();
  }
}

function startBreak() {
  onBreak = true;
  workStartedAt = null;
  updateTooltip();
  createOverlay();

  const breakMs = getBreakDuration();

  overlay.webContents.once('did-finish-load', () => {
    playSound('break-start.wav');
  });

  // Play the end chime so it finishes right as the break ends, so the
  // overlay can close instantly at zero instead of lingering.
  const lead = 700;
  if (breakMs > lead + 800) {
    breakEndSoundTimer = setTimeout(() => playSound('break-end.wav'), breakMs - lead);
  }

  breakTimer = setTimeout(() => endBreak(false), breakMs);
}

function startWorkTimer() {
  if (paused || dndActive) return;
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
    width: 560,
    height: 880,
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
    width: 600,
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
    longestStreak: getLongestStreak(),
    last7: getLast7Days(),
    dailyGoal: loadSettings().dailyGoal || 14,
  };
});

ipcMain.on('close-stats', () => {
  if (statsWin) statsWin.close();
});

app.whenReady().then(() => {
  createTray();
  startWorkTimer();
  startTooltipUpdates();
  startDndMonitor();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
