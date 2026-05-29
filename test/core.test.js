'use strict';

const core = require('../src/core');

// Build a stats.days key N days before `now` (local), using the same logic as core.
function keyBefore(now, n) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return core.dateKey(d);
}

describe('compareVersions', () => {
  test('equal versions', () => {
    expect(core.compareVersions('1.2.3', '1.2.3')).toBe(0);
  });
  test('greater / lesser', () => {
    expect(core.compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(core.compareVersions('1.2.0', '1.10.0')).toBe(-1);
  });
  test('tolerates a leading v', () => {
    expect(core.compareVersions('v2.0.0', '1.9.9')).toBe(1);
    expect(core.compareVersions('v1.0.0', 'v1.0.0')).toBe(0);
  });
  test('different segment counts (1.2 == 1.2.0)', () => {
    expect(core.compareVersions('1.2', '1.2.0')).toBe(0);
    expect(core.compareVersions('1.2.1', '1.2')).toBe(1);
  });
});

describe('mergeSettings', () => {
  test('returns defaults when given nothing', () => {
    expect(core.mergeSettings()).toEqual(core.DEFAULTS);
  });
  test('overrides defaults with saved values', () => {
    const merged = core.mergeSettings({ workMinutes: 30, theme: 'midnight' });
    expect(merged.workMinutes).toBe(30);
    expect(merged.theme).toBe('midnight');
    expect(merged.breakSeconds).toBe(core.DEFAULTS.breakSeconds); // untouched default
  });
  test('ignores non-object input', () => {
    expect(core.mergeSettings(null)).toEqual(core.DEFAULTS);
    expect(core.mergeSettings('nope')).toEqual(core.DEFAULTS);
    expect(core.mergeSettings([1, 2])).toEqual(core.DEFAULTS);
  });
  test('does not mutate DEFAULTS', () => {
    core.mergeSettings({ workMinutes: 99 });
    expect(core.DEFAULTS.workMinutes).toBe(20);
  });
});

describe('dateKey', () => {
  test('formats local YYYY-MM-DD with zero padding', () => {
    expect(core.dateKey(new Date(2026, 0, 5))).toBe('2026-01-05'); // Jan 5
    expect(core.dateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('formatTime', () => {
  test('formats minutes and seconds', () => {
    expect(core.formatTime(20 * 60 * 1000)).toBe('20:00');
    expect(core.formatTime(90 * 1000)).toBe('1:30');
  });
  test('rounds up partial seconds (ceil)', () => {
    expect(core.formatTime(1500)).toBe('0:02');
  });
  test('clamps negatives to 0:00', () => {
    expect(core.formatTime(-5000)).toBe('0:00');
  });
});

describe('isFullscreenState', () => {
  test('true for busy/fullscreen/presentation/app states', () => {
    [2, 3, 4, 7].forEach(s => expect(core.isFullscreenState(s)).toBe(true));
  });
  test('false for normal / quiet / null', () => {
    [1, 5, 6, 0, null, undefined].forEach(s => expect(core.isFullscreenState(s)).toBe(false));
  });
});

describe('getStreak', () => {
  const now = new Date(2026, 4, 29); // local May 29 2026

  test('zero when no completed breaks', () => {
    expect(core.getStreak({ days: {} }, now)).toBe(0);
    expect(core.getStreak({}, now)).toBe(0);
    expect(core.getStreak({ days: { [keyBefore(now, 0)]: { completed: 0 } } }, now)).toBe(0);
  });
  test('counts today', () => {
    const stats = { days: { [keyBefore(now, 0)]: { completed: 3 } } };
    expect(core.getStreak(stats, now)).toBe(1);
  });
  test('counts consecutive days back from today', () => {
    const stats = { days: {
      [keyBefore(now, 0)]: { completed: 1 },
      [keyBefore(now, 1)]: { completed: 2 },
      [keyBefore(now, 2)]: { completed: 1 },
    } };
    expect(core.getStreak(stats, now)).toBe(3);
  });
  test('today empty but yesterday present still continues the streak', () => {
    const stats = { days: {
      [keyBefore(now, 1)]: { completed: 1 },
      [keyBefore(now, 2)]: { completed: 1 },
    } };
    expect(core.getStreak(stats, now)).toBe(2);
  });
  test('a gap breaks the streak', () => {
    const stats = { days: {
      [keyBefore(now, 0)]: { completed: 1 },
      [keyBefore(now, 1)]: { completed: 1 },
      [keyBefore(now, 3)]: { completed: 1 }, // gap at day 2
    } };
    expect(core.getStreak(stats, now)).toBe(2);
  });
});

describe('getLongestStreak', () => {
  const now = new Date(2026, 4, 29);
  test('zero when empty', () => {
    expect(core.getLongestStreak({ days: {} })).toBe(0);
  });
  test('single day is 1', () => {
    expect(core.getLongestStreak({ days: { '2026-05-01': { completed: 2 } } })).toBe(1);
  });
  test('picks the longest of multiple runs', () => {
    const stats = { days: {
      '2026-05-01': { completed: 1 },
      '2026-05-02': { completed: 1 }, // run of 2
      '2026-05-05': { completed: 1 },
      '2026-05-06': { completed: 1 },
      '2026-05-07': { completed: 1 }, // run of 3
    } };
    expect(core.getLongestStreak(stats)).toBe(3);
  });
});

describe('getLast7Days', () => {
  const now = new Date(2026, 4, 29);
  test('returns 7 entries, newest flagged today', () => {
    const series = core.getLast7Days({ days: {} }, now);
    expect(series).toHaveLength(7);
    expect(series[6].isToday).toBe(true);
    expect(series.slice(0, 6).every(d => d.isToday === false)).toBe(true);
    expect(series.every(d => d.completed === 0)).toBe(true);
  });
  test('maps completed counts to the right days', () => {
    const stats = { days: {
      [keyBefore(now, 0)]: { completed: 5 },
      [keyBefore(now, 3)]: { completed: 2 },
    } };
    const series = core.getLast7Days(stats, now);
    expect(series[6].completed).toBe(5); // today
    expect(series[3].completed).toBe(2); // 3 days ago
    expect(series[0].completed).toBe(0); // 6 days ago
  });
});
