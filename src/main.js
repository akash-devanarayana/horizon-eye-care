const { app, BrowserWindow, Tray, Menu, screen, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const core = require('./core');

const REPO = 'akash-devanarayana/horizon-eye-care';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

let overlay = null;
let settingsWin = null;
let statsWin = null;
let updateWin = null;
let updateToastTimer = null;
let pendingUpdate = null;
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
const DEFAULTS = core.DEFAULTS;

function applyAutoStart(enabled) {
  // Writes/removes the Windows "Run at login" registry entry for the packaged app.
  // No-op in dev (points at electron.exe), but harmless.
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
  } catch {
    // ignore (e.g. unsupported platform)
  }
}

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
  return core.isFullscreenState(queryNotificationState());
}

function readJson(file) {
  // Strip a leading UTF-8 BOM, which JSON.parse cannot handle.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function loadSettings() {
  try {
    return core.mergeSettings(readJson(SETTINGS_PATH));
  } catch {
    return core.mergeSettings();
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

function todayKey() {
  return core.dateKey(new Date());
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
  return core.getStreak(loadStats());
}

function getLongestStreak() {
  return core.getLongestStreak(loadStats());
}

function getLast7Days() {
  return core.getLast7Days(loadStats());
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
  return core.formatTime(ms);
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

// --- Update check (lightweight: query GitHub Releases, notify if newer) ---
function compareVersions(a, b) {
  return core.compareVersions(a, b);
}

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'User-Agent': 'Horizon-App', Accept: 'application/vnd.github+json' } },
      res => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ tag: json.tag_name, url: json.html_url });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
}

async function checkForUpdates(manual) {
  try {
    const { tag, url } = await fetchLatestRelease();
    if (!tag) throw new Error('no tag');
    const current = app.getVersion();
    const latest = tag.replace(/^v/, '');
    const releaseUrl = url || RELEASES_PAGE;

    if (compareVersions(tag, current) > 0) {
      if (manual) {
        const { response } = await dialog.showMessageBox({
          type: 'info',
          title: 'Update available',
          message: `Horizon ${latest} is available.`,
          detail: `You have ${current}. Download the new version?`,
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1,
        });
        if (response === 0) shell.openExternal(releaseUrl);
      } else {
        showUpdateToast(latest, releaseUrl);
      }
    } else if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Horizon',
        message: 'You’re up to date.',
        detail: `Horizon ${current} is the latest version.`,
        buttons: ['OK'],
      });
    }
  } catch (e) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Horizon',
        message: 'Couldn’t check for updates.',
        detail: 'Please check your connection and try again later.',
        buttons: ['OK'],
      });
    }
  }
}

function showUpdateToast(version, url) {
  pendingUpdate = { version, url };
  if (updateWin) {
    updateWin.show();
    return;
  }
  const W = 340;
  const H = 168;
  const { workArea } = screen.getPrimaryDisplay();
  updateWin = new BrowserWindow({
    width: W,
    height: H,
    x: workArea.x + workArea.width - W - 16,
    y: workArea.y + workArea.height - H - 16,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  updateWin.setMenu(null);
  updateWin.loadFile(path.join(__dirname, 'update-toast.html'));
  updateWin.once('ready-to-show', () => updateWin.showInactive());
  updateWin.on('closed', () => {
    updateWin = null;
    clearTimeout(updateToastTimer);
  });
  // Auto-dismiss after a while if untouched.
  clearTimeout(updateToastTimer);
  updateToastTimer = setTimeout(() => {
    if (updateWin) updateWin.close();
  }, 20000);
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
    {
      label: 'Check for Updates…',
      click: () => checkForUpdates(true),
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
    height: 1060,
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
  applyAutoStart(settings.autoStart);
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

ipcMain.handle('get-update-info', () => pendingUpdate);

ipcMain.on('update-download', () => {
  if (pendingUpdate) shell.openExternal(pendingUpdate.url);
  if (updateWin) updateWin.close();
});

ipcMain.on('update-dismiss', () => {
  if (updateWin) updateWin.close();
});

app.whenReady().then(() => {
  // Required for Windows toast notifications to attribute correctly.
  app.setAppUserModelId('com.horizon.eyecare');
  // Keep the OS login-item in sync with the saved preference.
  applyAutoStart(loadSettings().autoStart);
  createTray();
  startWorkTimer();
  startTooltipUpdates();
  startDndMonitor();
  // Check for updates shortly after launch (silent unless one is found).
  setTimeout(() => checkForUpdates(false), 5000);
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
