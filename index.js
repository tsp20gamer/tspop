// ============================================================
// Telegram Task Management Bot — Single File Version
// All modules combined: config, users, tasks, stats, bot
// ============================================================
// Setup:
//   1. npm install
//   2. Create .env with BOT_TOKEN and ADMIN_ID
//   3. node index.js
// ============================================================
// Task format: /task Name | Description
//   - Name        → shown publicly in broadcast
//   - Description → hidden, revealed ONLY to whoever accepts
//   - Timer       → 4 minutes to complete after accepting;
//                   auto-released if time runs out
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const { Bot, InlineKeyboard } = require('grammy');

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────
const config = {
  BOT_TOKEN:   process.env.BOT_TOKEN,
  ADMIN_ID:    process.env.ADMIN_ID,
  USERS_FILE:  './users.json',
  TASKS_FILE:  './tasks.json',
  STATS_FILE:  './stats.json',
};

const TASK_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes

// In-memory timer map: taskId → { timeout, deadlineMs, assignedUserId }
const taskTimers = new Map();

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────
function loadUsers() {
  if (!fs.existsSync(config.USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(config.USERS_FILE, 'utf8') || '[]');
}
function saveUsers(users) {
  fs.writeFileSync(config.USERS_FILE, JSON.stringify(users, null, 2));
}
function registerUser(chatId, username, firstName, lastName) {
  const users = loadUsers();
  if (users.find(u => u.chatId === chatId))
    return { success: false, message: 'You are already registered!' };
  const user = {
    chatId,
    username: username || 'N/A',
    name: `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown',
    registeredAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return { success: true, user };
}
function getAllUsers() { return loadUsers(); }

// ─────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────
function loadTasks() {
  if (!fs.existsSync(config.TASKS_FILE)) return [];
  return JSON.parse(fs.readFileSync(config.TASKS_FILE, 'utf8') || '[]');
}
function saveTasks(tasks) {
  fs.writeFileSync(config.TASKS_FILE, JSON.stringify(tasks, null, 2));
}
function createTask(name, description, createdBy) {
  const tasks = loadTasks();
  const task = {
    id: Date.now().toString(),
    name,
    description,
    status: 'open',
    assignedTo: null,
    broadcastMessages: [],
    createdBy,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  saveTasks(tasks);
  return task;
}
function addBroadcastMessage(taskId, chatId, messageId) {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.broadcastMessages.push({ chatId, messageId });
  saveTasks(tasks);
}
function acceptTask(taskId, userId, username, name) {
  const tasks = loadTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task)                      return { success: false, message: 'Task not found.' };
  if (task.status === 'assigned') return { success: false, message: 'Task already assigned.' };
  task.status     = 'assigned';
  task.assignedTo = { userId, username: username || 'N/A', name: name || 'Unknown' };
  task.assignedAt = new Date().toISOString();
  saveTasks(tasks);
  return { success: true, task };
}
function releaseTask(taskId) {
  const tasks = loadTasks();
  const task  = tasks.find(t => t.id === taskId);
  if (!task || task.status !== 'assigned') return null;
  const wasAssignedTo = { ...task.assignedTo };
  task.status     = 'open';
  task.assignedTo = null;
  task.timedOutAt = new Date().toISOString();
  saveTasks(tasks);
  return { task, wasAssignedTo };
}
function completeTask(taskId, userId) {
  const tasks = loadTasks();
  const task  = tasks.find(t => t.id === taskId);
  if (!task)                      return { success: false, message: 'Task not found. Check the ID and try again.' };
  if (task.status !== 'assigned') return { success: false, message: 'This task is not currently assigned to anyone.' };
  if (String(task.assignedTo.userId) !== String(userId))
    return { success: false, message: 'You can only mark tasks done that are assigned to you.' };
  const previousAssignee = { ...task.assignedTo };
  task.status      = 'open';
  task.assignedTo  = null;
  task.completedBy = previousAssignee;
  task.completedAt = new Date().toISOString();
  saveTasks(tasks);
  return { success: true, task, previousAssignee };
}
function getAllTasks()    { return loadTasks(); }
function resetAllTasks() { saveTasks([]); }

// ─────────────────────────────────────────────
// TIMER HELPERS
// ─────────────────────────────────────────────
function deadlineText(deadlineMs) {
  const d = new Date(deadlineMs);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
}

function timeLeftText(deadlineMs) {
  const secsLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
  const m = Math.floor(secsLeft / 60);
  const s = secsLeft % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function startTaskTimer(taskId, assignedUserId, taskName) {
  // Clear any existing timer for this task
  clearTaskTimer(taskId);

  const deadlineMs = Date.now() + TASK_TIMEOUT_MS;

  const timeout = setTimeout(async () => {
    taskTimers.delete(taskId);
    const released = releaseTask(taskId);
    if (!released) return; // already completed

    const { task, wasAssignedTo } = released;

    // Notify the user whose time ran out
    await bot.api.sendMessage(wasAssignedTo.userId,
      `⏰ *Time's up!*\n\n📌 *${task.name}*\n\nYou didn't complete the task within 4 minutes.\nIt has been released back to the pool.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    // Notify admin
    if (config.ADMIN_ID) {
      await bot.api.sendMessage(config.ADMIN_ID,
        `⏰ *Task Timed Out*\n\n📌 *${task.name}*\nAssigned to: *${wasAssignedTo.name}* (@${wasAssignedTo.username || 'N/A'})\n\n🔓 Auto-released and re-broadcast.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    // Re-broadcast: available again with Accept button
    const keyboard = new InlineKeyboard().text('✅ Accept Task', `accept_${task.id}`);
    const msg =
      `📌 *Task Available Again\\!*\n\n` +
      `*${escapeMarkdown(task.name)}*\n\n` +
      `_Previous holder ran out of time\\._\n` +
      `_Tap the button to accept and receive full details\\._`;

    for (const bm of task.broadcastMessages) {
      await bot.api.editMessageText(bm.chatId, bm.messageId, msg, {
        parse_mode: 'MarkdownV2', reply_markup: keyboard,
      }).catch(() => {});
    }
  }, TASK_TIMEOUT_MS);

  taskTimers.set(taskId, { timeout, deadlineMs, assignedUserId });
  return deadlineMs;
}

function clearTaskTimer(taskId) {
  const entry = taskTimers.get(taskId);
  if (entry) {
    clearTimeout(entry.timeout);
    taskTimers.delete(taskId);
  }
}

function getTimerInfo(taskId) {
  return taskTimers.get(taskId) || null;
}

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────
function loadStats() {
  if (!fs.existsSync(config.STATS_FILE)) return {};
  return JSON.parse(fs.readFileSync(config.STATS_FILE, 'utf8') || '{}');
}
function saveStats(stats) {
  fs.writeFileSync(config.STATS_FILE, JSON.stringify(stats, null, 2));
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function lastNDays(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });
}
function sumDays(daily, dates) {
  return dates.reduce((acc, d) => acc + (daily[d] || 0), 0);
}
function recordCompletion(userId, username, name) {
  const stats = loadStats();
  const key   = String(userId);
  const date  = todayStr();
  if (!stats[key]) stats[key] = { name, username: username || 'N/A', total: 0, daily: {} };
  stats[key].name            = name;
  stats[key].username        = username || 'N/A';
  stats[key].daily[date]     = (stats[key].daily[date] || 0) + 1;
  stats[key].total           = (stats[key].total || 0) + 1;
  saveStats(stats);
}
function getUserStats(userId) {
  const stats = loadStats();
  const entry = stats[String(userId)];
  if (!entry) return null;
  const week = lastNDays(7);
  return {
    name:     entry.name,
    username: entry.username,
    today:    entry.daily[todayStr()] || 0,
    thisWeek: sumDays(entry.daily, week),
    total:    entry.total || 0,
    daily:    entry.daily,
  };
}
function getAllStats() {
  const stats = loadStats();
  const week  = lastNDays(7);
  const today = todayStr();
  return Object.entries(stats)
    .map(([userId, e]) => ({
      userId,
      name:     e.name,
      username: e.username,
      today:    e.daily[today] || 0,
      thisWeek: sumDays(e.daily, week),
      total:    e.total || 0,
    }))
    .sort((a, b) => b.today - a.today || b.total - a.total);
}
function resetAllStats() { saveStats({}); }

// ─────────────────────────────────────────────
// BOT HELPERS
// ─────────────────────────────────────────────
function isAdmin(chatId, username) {
  const adminId = (config.ADMIN_ID || '').trim();
  if (!adminId) return false;
  if (/^\d+$/.test(adminId)) return String(chatId) === adminId;
  return (username || '').toLowerCase() === adminId.replace(/^@/, '').toLowerCase();
}

function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function formatTask(task, index, showDescription = false) {
  let statusLine;
  if (task.status === 'assigned') {
    const timer = getTimerInfo(task.id);
    const timerStr = timer ? ` ⏰ ${timeLeftText(timer.deadlineMs)} left` : '';
    statusLine = `✅ Taken by: ${task.assignedTo.name} (@${task.assignedTo.username || 'N/A'})${timerStr}`;
  } else if (task.completedBy) {
    statusLine = `🔓 Available  _(last done by ${task.completedBy.name})_`;
  } else {
    statusLine = '🔓 Available';
  }

  const descLine = showDescription ? `\n   📝 _${task.description}_` : '';
  return `${index + 1}. 📌 *${task.name}*${descLine}\n   ID: \`${task.id}\`\n   ${statusLine}`;
}

function buildHelpText(chatId, username) {
  const lines = [
    `📋 *All Commands:*\n`,
    `👤 *User Commands*`,
    `/start — Register yourself`,
    `/tasks — View all tasks and their status`,
    `/mytask — Re-read the details of your current task`,
    `/done <taskId> — Mark your assigned task as complete`,
    `/stats — View your task completion stats`,
    `/help — Show this help message`,
  ];
  if (isAdmin(chatId, username)) {
    lines.push(
      `\n👑 *Admin Commands*`,
      `/task Name | Description — Create & broadcast a new task`,
      `   _Name is shown publicly. Description revealed only to whoever accepts._`,
      `/users — List all registered users`,
      `/reset — Reset all task history (with confirmation)`,
      `/resetstats — Reset all completion stats (with confirmation)`
    );
  }
  lines.push(
    `\n⏰ *Timer*`,
    `• Each task has a 4-minute timer once accepted`,
    `• If time runs out, the task is auto-released to the pool`,
    `• Complete with /done <taskId> before the timer expires`,
    `\n💡 *Tips*`,
    `• Tap "Accept Task" in a task message to claim it`,
    `• Once you accept, you'll receive the full task details privately`,
    `• Use /mytask to re-read your task details at any time`,
    `• Admins are notified when tasks are accepted, completed, or timed out`
  );
  return lines.join('\n');
}

function buildHelpKeyboard() {
  return new InlineKeyboard()
    .text('📋 View Tasks', 'quick_tasks')
    .text('🔄 Refresh Help', 'show_help');
}

// ─────────────────────────────────────────────
// BOT INIT
// ─────────────────────────────────────────────
const bot = new Bot(config.BOT_TOKEN);

// ── /start ───────────────────────────────────
bot.command('start', async ctx => {
  const { id: chatId, username, first_name, last_name } = ctx.from;
  const result  = registerUser(chatId, username, first_name, last_name);
  const keyboard = new InlineKeyboard()
    .text('❓ Help & Commands', 'show_help')
    .text('📋 View Tasks', 'quick_tasks');
  if (result.success) {
    await ctx.reply(
      `👋 Welcome, *${escapeMarkdown(result.user.name)}*\\!\n\nYou are now registered\\.\nTap a button below or type /help to get started\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
  } else {
    await ctx.reply(
      `👋 Welcome back\\!\n\nYou are already registered\\. Use the buttons below or type /help\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
  }
});

// ── /help ────────────────────────────────────
bot.command('help', async ctx => {
  const { id: chatId, username } = ctx.from;
  await ctx.reply(buildHelpText(chatId, username), {
    parse_mode: 'Markdown',
    reply_markup: buildHelpKeyboard(),
  });
});

// ── /task Name | Description  (admin) ────────
bot.command('task', async ctx => {
  const { id: chatId, username } = ctx.from;
  if (!isAdmin(chatId, username)) return ctx.reply('❌ You are not authorized to create tasks.');

  const input = ctx.match?.trim();
  if (!input) return ctx.reply(
    '⚠️ *Usage:* `/task Name | Description`\n\n' +
    '• *Name* — shown publicly to all users\n' +
    '• *Description* — hidden; revealed only to whoever accepts the task\n\n' +
    '_Example:_ `/task Deliver Package | Go to 5th Ave, apartment 3B. Call on arrival.`',
    { parse_mode: 'Markdown' }
  );

  const pipeIndex = input.indexOf('|');
  if (pipeIndex === -1) return ctx.reply(
    '⚠️ Missing separator\\. Use a `|` between the name and description\\.\n\n' +
    '_Example:_ `/task Deliver Package | Go to 5th Ave, apartment 3B`',
    { parse_mode: 'MarkdownV2' }
  );

  const name        = input.slice(0, pipeIndex).trim();
  const description = input.slice(pipeIndex + 1).trim();
  if (!name)        return ctx.reply('⚠️ Task name cannot be empty.');
  if (!description) return ctx.reply('⚠️ Task description cannot be empty.');

  const task     = createTask(name, description, chatId);
  const keyboard = new InlineKeyboard().text('✅ Accept Task', `accept_${task.id}`);

  // Broadcast: name visible, description HIDDEN, timer note shown
  const msg =
    `📌 *New Task Available\\!*\n\n` +
    `*${escapeMarkdown(task.name)}*\n\n` +
    `⏰ _4 minutes to complete after accepting_\n` +
    `_Tap the button below to accept and receive full details\\._`;

  const users = getAllUsers();
  let sentCount = 0;
  for (const user of users) {
    try {
      const sent = await bot.api.sendMessage(user.chatId, msg, {
        parse_mode: 'MarkdownV2', reply_markup: keyboard,
      });
      addBroadcastMessage(task.id, user.chatId, sent.message_id);
      sentCount++;
    } catch (e) {
      console.error(`Failed to send to ${user.chatId}:`, e.message);
    }
  }

  await ctx.reply(
    `✅ Task created and sent to *${sentCount}* user(s).\n\n` +
    `📌 *Name:* ${task.name}\n` +
    `🔒 *Hidden description:* ${task.description}\n` +
    `⏰ *Timer:* 4 minutes (starts when accepted)\n` +
    `🆔 *Task ID:* \`${task.id}\``,
    { parse_mode: 'Markdown' }
  );
});

// ── /users  (admin) ──────────────────────────
bot.command('users', async ctx => {
  const { id: chatId, username } = ctx.from;
  if (!isAdmin(chatId, username)) return ctx.reply('❌ Not authorized.');
  const users = getAllUsers();
  if (!users.length) return ctx.reply('No users registered yet.');
  const list = users.map((u, i) =>
    `${i + 1}. *${u.name}* (@${u.username || 'N/A'})\n   Chat ID: \`${u.chatId}\`\n   Registered: ${u.registeredAt.slice(0, 10)}`
  ).join('\n\n');
  await ctx.reply(`👥 *Registered Users (${users.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
});

// ── /tasks ───────────────────────────────────
bot.command('tasks', async ctx => {
  const { id: chatId, username } = ctx.from;
  const admin = isAdmin(chatId, username);
  const tasks = getAllTasks();
  if (!tasks.length)
    return ctx.reply('No tasks yet.\n\n_Admins can create one with /task Name | Description_', { parse_mode: 'Markdown' });

  const lines  = tasks.map((t, i) => formatTask(t, i, admin)).join('\n\n');
  const header = admin
    ? `📋 *All Tasks (${tasks.length}) — Admin View:*\n_Descriptions shown only here_\n\n`
    : `📋 *All Tasks (${tasks.length}):*\n_Accept a task to see its full details_\n\n`;
  await ctx.reply(header + lines, { parse_mode: 'Markdown' });
});

// ── /mytask ───────────────────────────────────
bot.command('mytask', async ctx => {
  const userId = ctx.from.id;
  const tasks  = getAllTasks();
  const task   = tasks.find(t => t.status === 'assigned' && String(t.assignedTo.userId) === String(userId));

  if (!task) return ctx.reply(
    '📋 You have no active task right now.\n\n_Check /tasks to see what is available._',
    { parse_mode: 'Markdown' }
  );

  const timer = getTimerInfo(task.id);
  const timerLine = timer
    ? `⏰ *Time remaining:* ${timeLeftText(timer.deadlineMs)} (deadline: ${deadlineText(timer.deadlineMs)})`
    : '⏰ _Timer info not available (bot may have restarted)_';

  await ctx.reply(
    `📌 *Your Current Task*\n\n` +
    `*${task.name}*\n\n` +
    `📝 *Details:*\n${task.description}\n\n` +
    `${timerLine}\n\n` +
    `Run /done \`${task.id}\` when finished.`,
    { parse_mode: 'Markdown' }
  );
});

// ── /stats ───────────────────────────────────
bot.command('stats', async ctx => {
  const { id: chatId, username } = ctx.from;
  if (isAdmin(chatId, username)) {
    const all = getAllStats();
    if (!all.length) return ctx.reply('No completions recorded yet.');
    const rows = all.map((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} *${u.name}* (@${u.username})\n   Today: *${u.today}*  │  This week: ${u.thisWeek}  │  Total: ${u.total}`;
    });
    await ctx.reply(
      `📊 *Task Completion Stats — All Users*\n_Sorted by today's completions_\n\n${rows.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  } else {
    const s = getUserStats(chatId);
    if (!s) return ctx.reply(
      '📊 You have no completions yet.\n\n_Accept a task and run /done <taskId> when finished._',
      { parse_mode: 'Markdown' }
    );
    const days = Object.entries(s.daily)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 7)
      .map(([date, count]) => `   ${date}  →  ${count} task${count !== 1 ? 's' : ''}`)
      .join('\n');
    await ctx.reply(
      `📊 *Your Stats, ${s.name}*\n\n🗓 Today: *${s.today}* task${s.today !== 1 ? 's' : ''}\n📅 This week: *${s.thisWeek}* tasks\n🏆 All time: *${s.total}* tasks\n\n*Recent daily breakdown:*\n${days || '   No data yet'}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /done <taskId> ───────────────────────────
bot.command('done', async ctx => {
  const userId = ctx.from.id;
  const taskId = ctx.match?.trim();
  if (!taskId) return ctx.reply('⚠️ Usage: /done <taskId>\n\nFind your Task ID with /tasks or /mytask');

  // Cancel the timer first
  clearTaskTimer(taskId);

  const result = completeTask(taskId, userId);
  if (!result.success) return ctx.reply(`❌ ${result.message}`);

  const { task, previousAssignee } = result;
  await ctx.reply(
    `🎉 *Task Completed!*\n\n📌 *${task.name}*\n\nGreat work! The task is now open for reassignment.`,
    { parse_mode: 'Markdown' }
  );

  if (config.ADMIN_ID) {
    await bot.api.sendMessage(config.ADMIN_ID,
      `✅ *Task Completed!*\n\n📌 *${task.name}*\nCompleted by: *${previousAssignee.name}* (@${previousAssignee.username || 'N/A'})\nTask ID: \`${taskId}\`\n\n🔓 Now open for reassignment.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  recordCompletion(previousAssignee.userId, previousAssignee.username, previousAssignee.name);

  // Re-broadcast: available again with Accept button
  const keyboard = new InlineKeyboard().text('✅ Accept Task', `accept_${task.id}`);
  const taskMsg =
    `📌 *Task Available Again\\!*\n\n` +
    `*${escapeMarkdown(task.name)}*\n\n` +
    `_Previously completed by ${escapeMarkdown(previousAssignee.name)}_\n` +
    `⏰ _4 minutes to complete after accepting_\n` +
    `_Tap the button to accept and receive full details\\._`;

  for (const bm of task.broadcastMessages) {
    await bot.api.editMessageText(bm.chatId, bm.messageId, taskMsg, {
      parse_mode: 'MarkdownV2', reply_markup: keyboard,
    }).catch(() => {});
  }
});

// ── /reset  (admin) ──────────────────────────
bot.command('reset', async ctx => {
  const { id: chatId, username } = ctx.from;
  if (!isAdmin(chatId, username)) return ctx.reply('❌ Not authorized.');
  const count = getAllTasks().length;
  if (count === 0) return ctx.reply('ℹ️ Task history is already empty.');
  const keyboard = new InlineKeyboard()
    .text('🗑 Yes, delete all tasks', 'confirm_reset')
    .text('❌ Cancel', 'cancel_reset');
  await ctx.reply(
    `⚠️ *Are you sure?*\n\nThis will permanently delete *${count} task${count !== 1 ? 's' : ''}* and cancel all active timers\\.\nUser stats will *not* be affected\\.\n\nThis action *cannot be undone*\\.`,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
});

// ── /resetstats  (admin) ─────────────────────
bot.command('resetstats', async ctx => {
  const { id: chatId, username } = ctx.from;
  if (!isAdmin(chatId, username)) return ctx.reply('❌ Not authorized.');
  const all = getAllStats();
  if (!all.length) return ctx.reply('ℹ️ All counters are already empty.');
  const total = all.reduce((s, u) => s + u.total, 0);
  const keyboard = new InlineKeyboard()
    .text('🗑 Yes, reset all stats', 'confirm_reset_stats')
    .text('❌ Cancel', 'cancel_reset_stats');
  await ctx.reply(
    `⚠️ *Are you sure?*\n\nThis will wipe stats for *${all.length} user${all.length !== 1 ? 's' : ''}* \\(${total} completions\\)\\.\nTask history and registrations will *not* be affected\\.\n\nThis action *cannot be undone*\\.`,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
});

// ─────────────────────────────────────────────
// CALLBACK QUERIES
// ─────────────────────────────────────────────
bot.on('callback_query:data', async ctx => {
  const data   = ctx.callbackQuery.data;
  const from   = ctx.from;
  const chatId = from.id;

  // Help button
  if (data === 'show_help') {
    await ctx.answerCallbackQuery();
    await ctx.reply(buildHelpText(chatId, from.username), {
      parse_mode: 'Markdown', reply_markup: buildHelpKeyboard(),
    });
    return;
  }

  // Quick tasks button
  if (data === 'quick_tasks') {
    await ctx.answerCallbackQuery();
    const admin = isAdmin(chatId, from.username);
    const tasks = getAllTasks();
    if (!tasks.length)
      await ctx.reply('No tasks yet.\n\n_Admins can create one with /task Name | Description_', { parse_mode: 'Markdown' });
    else {
      const lines  = tasks.map((t, i) => formatTask(t, i, admin)).join('\n\n');
      const header = admin
        ? `📋 *All Tasks (${tasks.length}) — Admin View:*\n_Descriptions shown only here_\n\n`
        : `📋 *All Tasks (${tasks.length}):*\n_Accept a task to see its full details_\n\n`;
      await ctx.reply(header + lines, { parse_mode: 'Markdown' });
    }
    return;
  }

  // Accept Task button
  if (data.startsWith('accept_')) {
    const taskId = data.replace('accept_', '');
    const name   = `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'Unknown';
    const result = acceptTask(taskId, from.id, from.username, name);

    if (result.success) {
      // Start the 4-minute countdown
      const deadlineMs = startTaskTimer(taskId, from.id, result.task.name);

      await ctx.answerCallbackQuery({ text: '🎉 Task accepted! Check your messages for details.' });

      // Send description + timer info PRIVATELY to the acceptor
      await ctx.reply(
        `✅ *Task Accepted!*\n\n📌 *${result.task.name}*\n\n` +
        `📝 *Full details:*\n${result.task.description}\n\n` +
        `⏰ *You have 4 minutes!*\n` +
        `Deadline: *${deadlineText(deadlineMs)}*\n\n` +
        `Run /done \`${taskId}\` when finished\\.\n` +
        `Use /mytask to re\\-read this task at any time\\.`,
        { parse_mode: 'MarkdownV2' }
      );

      // Notify admin
      if (config.ADMIN_ID) {
        await bot.api.sendMessage(config.ADMIN_ID,
          `📣 *Task Accepted!*\n\n📌 *${result.task.name}*\nAccepted by: *${name}* (@${from.username || 'N/A'})\n⏰ Deadline: ${deadlineText(deadlineMs)}\nTask ID: \`${taskId}\``,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }

      // Update broadcast messages — name + who took it, NO description, timer shown
      const updatedText =
        `📌 *Task Taken*\n\n*${result.task.name}*\n\n` +
        `✅ Accepted by: *${name}*\n` +
        `⏰ Deadline: ${deadlineText(deadlineMs)}\n` +
        `_This task is no longer available_`;
      for (const bm of result.task.broadcastMessages) {
        await bot.api.editMessageText(bm.chatId, bm.messageId, updatedText, {
          parse_mode: 'Markdown',
        }).catch(() => {});
      }
    } else {
      await ctx.answerCallbackQuery({ text: '⚠️ Task already taken by someone else.', show_alert: true });
    }
    return;
  }

  // Confirm reset tasks
  if (data === 'confirm_reset') {
    if (!isAdmin(chatId, from.username)) {
      await ctx.answerCallbackQuery({ text: '❌ Not authorized.', show_alert: true });
      return;
    }
    const tasks = getAllTasks();
    // Cancel all active timers
    tasks.forEach(t => clearTaskTimer(t.id));
    const count = tasks.length;
    resetAllTasks();
    await ctx.answerCallbackQuery({ text: '🗑 Task history cleared.' });
    await ctx.editMessageText(
      `✅ *Task history has been reset.*\n\n_${count} task${count !== 1 ? 's' : ''} deleted. All active timers cancelled. Stats and registrations were not affected._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    return;
  }

  // Cancel reset tasks
  if (data === 'cancel_reset') {
    await ctx.answerCallbackQuery({ text: 'Reset cancelled.' });
    await ctx.editMessageText('↩️ Reset cancelled. No tasks were deleted.').catch(() => {});
    return;
  }

  // Confirm reset stats
  if (data === 'confirm_reset_stats') {
    if (!isAdmin(chatId, from.username)) {
      await ctx.answerCallbackQuery({ text: '❌ Not authorized.', show_alert: true });
      return;
    }
    const all   = getAllStats();
    const total = all.reduce((s, u) => s + u.total, 0);
    resetAllStats();
    await ctx.answerCallbackQuery({ text: '🗑 Stats cleared.' });
    await ctx.editMessageText(
      `✅ *All stats have been reset.*\n\n_${total} completion${total !== 1 ? 's' : ''} across ${all.length} user${all.length !== 1 ? 's' : ''} cleared._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    return;
  }

  // Cancel reset stats
  if (data === 'cancel_reset_stats') {
    await ctx.answerCallbackQuery({ text: 'Reset cancelled.' });
    await ctx.editMessageText('↩️ Reset cancelled. No stats were changed.').catch(() => {});
    return;
  }

  await ctx.answerCallbackQuery();
});

// ─────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────
if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing. Set it in Railway environment variables.');
  process.exit(1);
}
if (!config.ADMIN_ID) {
  console.warn('⚠️  ADMIN_ID not set. Admin commands will not work.');
}

['users.json', 'tasks.json', 'stats.json'].forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, f === 'stats.json' ? '{}' : '[]');
});

bot.catch(err => console.error('Bot error:', err.message));

bot.api.setMyCommands([
  { command: 'start',      description: 'Register yourself' },
  { command: 'tasks',      description: 'View all tasks and their status' },
  { command: 'mytask',     description: 'Re-read your current task details and time left' },
  { command: 'done',       description: 'Mark your assigned task as complete' },
  { command: 'stats',      description: 'View your task completion stats' },
  { command: 'help',       description: 'Show all available commands' },
  { command: 'task',       description: 'Create & broadcast a task: Name | Description (admin)' },
  { command: 'users',      description: 'List all registered users (admin)' },
  { command: 'reset',      description: 'Reset all task history (admin)' },
  { command: 'resetstats', description: 'Reset all completion stats (admin)' },
], { scope: { type: 'all_private_chats' } }).catch(() => {});

console.log('🤖 Starting Telegram Task Management Bot...');
bot.start({ onStart: () => console.log('✅ Bot is running!') });
