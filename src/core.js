// Pure, dependency-free logic for Horizon.
// No Electron / fs / DOM here, so it can be unit-tested directly with Node/Jest.
// The main process (src/main.js) imports these and supplies the I/O (settings,
// stats, the Win32 notification state, the system clock).

'use strict';

const DEFAULTS = {
  workMinutes: 20,
  breakSeconds: 20,
  soundEnabled: true,
  dndEnabled: true,
  dailyGoal: 14,
  autoStart: false,
  theme: 'daylight',
};

// Merge persisted settings over the defaults (ignores non-objects).
function mergeSettings(saved) {
  const ok = saved && typeof saved === 'object' && !Array.isArray(saved);
  return { ...DEFAULTS, ...(ok ? saved : {}) };
}

// Local YYYY-MM-DD (avoids the UTC shift that toISOString causes in non-UTC zones).
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayMap(stats) {
  return stats && stats.days && typeof stats.days === 'object' ? stats.days : {};
}

// Current consecutive-day streak (days with >=1 completed break), counting back
// from `now`. Today not yet having a break doesn't break the streak.
function getStreak(stats, now = new Date()) {
  const days = dayMap(stats);
  const hasAny = Object.keys(days).some(d => days[d] && days[d].completed > 0);
  if (!hasAny) return 0;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const check = new Date(today);
    check.setDate(check.getDate() - i);
    const key = dateKey(check);
    if (days[key] && days[key].completed > 0) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }
  return streak;
}

// Longest run of consecutive days with >=1 completed break, ever.
function getLongestStreak(stats) {
  const days = dayMap(stats);
  const keys = Object.keys(days).filter(d => days[d] && days[d].completed > 0).sort();
  if (keys.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < keys.length; i++) {
    const prev = new Date(keys[i - 1]);
    const cur = new Date(keys[i]);
    const diffDays = Math.round((cur - prev) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

// Last 7 days (oldest→newest) of completed counts, for the stats chart.
function getLast7Days(stats, now = new Date()) {
  const days = dayMap(stats);
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const day = days[key];
    result.push({
      label: labels[d.getDay()],
      completed: day ? day.completed : 0,
      isToday: i === 0,
    });
  }
  return result;
}

// Milliseconds -> "M:SS" (clamped at zero), for the tray tooltip.
function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

// Semver-ish compare. Returns 1 if a>b, -1 if a<b, 0 if equal. Tolerates a "v" prefix.
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// QUERY_USER_NOTIFICATION_STATE values that mean "don't interrupt":
// 2=busy, 3=D3D fullscreen, 4=presentation, 7=fullscreen Store app.
const FULLSCREEN_STATES = [2, 3, 4, 7];
function isFullscreenState(state) {
  return FULLSCREEN_STATES.includes(state);
}

module.exports = {
  DEFAULTS,
  mergeSettings,
  dateKey,
  getStreak,
  getLongestStreak,
  getLast7Days,
  formatTime,
  compareVersions,
  isFullscreenState,
};
