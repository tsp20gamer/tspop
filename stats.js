// stats.js
// Tracks daily task completion counts per user.
// Persists data in stats.json as { userId: { name, username, total, daily: { "YYYY-MM-DD": count } } }

const fs = require('fs');

const STATS_FILE = './stats.json';

// ─────────────────────────────────────────────
// File I/O
// ─────────────────────────────────────────────

function loadStats() {
  if (!fs.existsSync(STATS_FILE)) return {};
  const raw = fs.readFileSync(STATS_FILE, 'utf8');
  return JSON.parse(raw || '{}');
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Returns today's date string in YYYY-MM-DD format (UTC). */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns the date strings for the last N days including today.
 * Used to compute "this week" (last 7 days) totals.
 */
function lastNDays(n) {
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Sums completions for the given date strings from a daily map. */
function sumDays(daily, dates) {
  return dates.reduce((acc, date) => acc + (daily[date] || 0), 0);
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Records one task completion for a user.
 * Creates the user's entry if it doesn't exist yet.
 */
function recordCompletion(userId, username, name) {
  const stats = loadStats();
  const key = String(userId);
  const date = today();

  if (!stats[key]) {
    stats[key] = { name, username: username || 'N/A', total: 0, daily: {} };
  }

  // Keep name/username in sync in case the user changed them
  stats[key].name = name;
  stats[key].username = username || 'N/A';

  // Increment today's count and the all-time total
  stats[key].daily[date] = (stats[key].daily[date] || 0) + 1;
  stats[key].total = (stats[key].total || 0) + 1;

  saveStats(stats);
}

/**
 * Returns stats for a single user.
 * Returns null if the user has no recorded completions yet.
 */
function getUserStats(userId) {
  const stats = loadStats();
  const entry = stats[String(userId)];
  if (!entry) return null;

  const week = lastNDays(7);
  return {
    name: entry.name,
    username: entry.username,
    today: entry.daily[today()] || 0,
    thisWeek: sumDays(entry.daily, week),
    total: entry.total || 0,
    daily: entry.daily,
  };
}

/**
 * Returns stats for every user, sorted by today's completions (descending).
 * Each entry includes: userId, name, username, today, thisWeek, total.
 */
function getAllStats() {
  const stats = loadStats();
  const week = lastNDays(7);
  const todayStr = today();

  return Object.entries(stats)
    .map(([userId, entry]) => ({
      userId,
      name: entry.name,
      username: entry.username,
      today: entry.daily[todayStr] || 0,
      thisWeek: sumDays(entry.daily, week),
      total: entry.total || 0,
    }))
    .sort((a, b) => b.today - a.today || b.total - a.total);
}

/**
 * Wipes all stats and resets stats.json to an empty object.
 * Destructive and irreversible — only the admin should call it.
 */
function resetAllStats() {
  saveStats({});
}

module.exports = { recordCompletion, getUserStats, getAllStats, resetAllStats };
