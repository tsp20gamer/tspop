// bot.js
// Core bot logic using grammY (https://grammy.dev).
// Defines all command handlers and the inline button (callback query) handler.

const { Bot, InlineKeyboard } = require('grammy');
const config = require('./config');
const { registerUser, getAllUsers } = require('./users');
const {
  createTask,
  addBroadcastMessage,
  acceptTask,
  completeTask,
  getAllTasks,
  resetAllTasks,
} = require('./tasks');
const { recordCompletion, getUserStats, getAllStats, resetAllStats } = require('./stats');

// Initialize the bot — grammY uses long polling by default via bot.start()
const bot = new Bot(config.BOT_TOKEN);

// ─────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────

/**
 * Returns true if the user is the configured admin.
 * Supports two formats for ADMIN_ID in .env:
 *   - Numeric ID:  123456789      (most reliable)
 *   - Username:    Tsp20op  or  @Tsp20op  (case-insensitive)
 */
function isAdmin(chatId, username) {
  const adminId = (config.ADMIN_ID || '').trim();
  if (!adminId) return false;

  // If ADMIN_ID is all digits, compare against the numeric chat ID
  if (/^\d+$/.test(adminId)) {
    return String(chatId) === adminId;
  }

  // Otherwise treat it as a username (strip leading @ if present, ignore case)
  const adminUsername = adminId.replace(/^@/, '').toLowerCase();
  return (username || '').toLowerCase() === adminUsername;
}

/** Escapes special characters required by Telegram's MarkdownV2 format. */
function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/** Formats a single task entry for the /tasks list. */
function formatTask(task, index) {
  let statusLine;
  if (task.status === 'assigned') {
    statusLine = `✅ Assigned to: ${task.assignedTo.name} (@${task.assignedTo.username || 'N/A'})`;
  } else if (task.completedBy) {
    statusLine = `🔓 Open  _(last done by ${task.completedBy.name})_`;
  } else {
    statusLine = '🔓 Open';
  }
  return `${index + 1}. 📌 *${task.description}*\n   ID: \`${task.id}\`\n   ${statusLine}`;
}

/**
 * Builds the help text for a given user.
 * Admin users see the extra admin section.
 */
function buildHelpText(chatId, username) {
  const lines = [
    `📋 *All Commands:*\n`,
    `👤 *User Commands*`,
    `/start — Register yourself`,
    `/tasks — View all tasks and their status`,
    `/done <taskId> — Mark your assigned task as complete`,
    `/stats — View your task completion stats`,
    `/help — Show this help message`,
  ];

  if (isAdmin(chatId, username)) {
    lines.push(
      `\n👑 *Admin Commands*`,
      `/task <description> — Create & broadcast a new task`,
      `/users — List all registered users`,
      `/reset — Reset all task history (with confirmation)`,
      `/resetstats — Reset all completion stats (with confirmation)`
    );
  }

  lines.push(
    `\n💡 *Tips*`,
    `• Use /tasks to find your Task ID before running /done`,
    `• When you accept a task, tap the button in the task message`,
    `• Admins are notified when tasks are accepted or completed`
  );

  return lines.join('\n');
}

/**
 * Builds the quick-action inline keyboard shown with help messages.
 * Shows different buttons depending on whether the user is an admin.
 */
function buildHelpKeyboard(chatId) {
  const kb = new InlineKeyboard()
    .text('📋 View Tasks', 'quick_tasks')
    .text('🔄 Refresh Help', 'show_help');

  return kb;
}

// ─────────────────────────────────────────────
// /start — Register a new user
// ─────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const { id: chatId, username, first_name, last_name } = ctx.from;
  const result = registerUser(chatId, username, first_name, last_name);

  // Inline buttons shown right below the welcome message
  const keyboard = new InlineKeyboard()
    .text('❓ Help & Commands', 'show_help')
    .text('📋 View Tasks', 'quick_tasks');

  if (result.success) {
    await ctx.reply(
      `👋 Welcome, *${escapeMarkdown(result.user.name)}*\\!\n\n` +
        `You are now registered\\.\n` +
        `Tap a button below or type /help to get started\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
  } else {
    // Already registered — show welcome back message with buttons
    await ctx.reply(
      `👋 Welcome back\\!\n\nYou are already registered\\. ` +
        `Use the buttons below or type /help to see all commands\\.`,
      { parse_mode: 'MarkdownV2', reply_markup: keyboard }
    );
  }
});

// ─────────────────────────────────────────────
// /help — Show all available commands
// ─────────────────────────────────────────────
bot.command('help', async (ctx) => {
  const { id: chatId, username } = ctx.from;
  await ctx.reply(buildHelpText(chatId, username), {
    parse_mode: 'Markdown',
    reply_markup: buildHelpKeyboard(chatId),
  });
});

// ─────────────────────────────────────────────
// /task <description> — Admin: Create and broadcast a task
// ─────────────────────────────────────────────
bot.command('task', async (ctx) => {
  const { id: chatId, username } = ctx.from;

  if (!isAdmin(chatId, username)) {
    return ctx.reply('❌ You are not authorized to create tasks.');
  }

  const description = ctx.match?.trim();
  if (!description) {
    return ctx.reply('⚠️ Please provide a task description.\n\nUsage: /task <description>');
  }

  // Save the new task to tasks.json
  const task = createTask(description, chatId);

  // The Accept button users tap to claim the task
  const keyboard = new InlineKeyboard().text('✅ Accept Task', `accept_${task.id}`);

  const taskMessage =
    `📌 *New Task Available\\!*\n\n` +
    `${escapeMarkdown(task.description)}\n\n` +
    `_Task ID: ${escapeMarkdown(task.id)}_`;

  // Broadcast to all registered users
  const users = getAllUsers();
  let sentCount = 0;

  for (const user of users) {
    try {
      const sent = await bot.api.sendMessage(user.chatId, taskMessage, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      });
      // Store message ID so we can edit it later when accepted or re-opened
      addBroadcastMessage(task.id, user.chatId, sent.message_id);
      sentCount++;
    } catch (err) {
      // User may have blocked the bot — log quietly and continue
      console.error(`⚠️  Failed to send to user ${user.chatId}:`, err.message);
    }
  }

  await ctx.reply(
    `✅ Task created and sent to *${sentCount}* user(s).\n📌 Task ID: \`${task.id}\``,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /users — Admin: List all registered users
// ─────────────────────────────────────────────
bot.command('users', async (ctx) => {
  const { id: chatId, username } = ctx.from;

  if (!isAdmin(chatId, username)) {
    return ctx.reply('❌ You are not authorized to view users.');
  }

  const users = getAllUsers();

  if (users.length === 0) {
    return ctx.reply('No users have registered yet.');
  }

  const list = users
    .map(
      (u, i) =>
        `${i + 1}. *${u.name}* (@${u.username || 'N/A'})\n   Chat ID: \`${u.chatId}\`\n   Registered: ${u.registeredAt.slice(0, 10)}`
    )
    .join('\n\n');

  await ctx.reply(`👥 *Registered Users (${users.length}):*\n\n${list}`, {
    parse_mode: 'Markdown',
  });
});

// ─────────────────────────────────────────────
// /tasks — List all tasks and their statuses
// ─────────────────────────────────────────────
bot.command('tasks', async (ctx) => {
  const tasks = getAllTasks();

  if (tasks.length === 0) {
    return ctx.reply(
      'No tasks have been created yet.\n\n_Admins can create one with /task <description>_',
      { parse_mode: 'Markdown' }
    );
  }

  const list = tasks.map(formatTask).join('\n\n');

  await ctx.reply(`📋 *All Tasks (${tasks.length}):*\n\n${list}`, {
    parse_mode: 'Markdown',
  });
});

// ─────────────────────────────────────────────
// /stats — Task completion statistics
// Users see only their own stats; admin sees all users ranked
// ─────────────────────────────────────────────
bot.command('stats', async (ctx) => {
  const { id: chatId, username } = ctx.from;

  if (isAdmin(chatId, username)) {
    // ── Admin view: leaderboard of all users ──
    const all = getAllStats();

    if (all.length === 0) {
      return ctx.reply('No completions recorded yet. Stats appear once users start completing tasks.');
    }

    const rows = all.map((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return (
        `${medal} *${u.name}* (@${u.username})\n` +
        `   Today: *${u.today}*  │  This week: ${u.thisWeek}  │  Total: ${u.total}`
      );
    });

    await ctx.reply(
      `📊 *Task Completion Stats — All Users*\n` +
        `_Sorted by today's completions_\n\n` +
        rows.join('\n\n'),
      { parse_mode: 'Markdown' }
    );
  } else {
    // ── Regular user view: their own stats only ──
    const s = getUserStats(chatId);

    if (!s) {
      return ctx.reply(
        '📊 You have no completions recorded yet.\n\n' +
          '_Accept a task and run /done <taskId> when finished to start tracking your stats._',
        { parse_mode: 'Markdown' }
      );
    }

    // Show last 7 days as a mini daily breakdown
    const days = Object.entries(s.daily)
      .sort(([a], [b]) => b.localeCompare(a)) // newest first
      .slice(0, 7)
      .map(([date, count]) => `   ${date}  →  ${count} task${count !== 1 ? 's' : ''}`)
      .join('\n');

    await ctx.reply(
      `📊 *Your Stats, ${s.name}*\n\n` +
        `🗓 Today: *${s.today}* task${s.today !== 1 ? 's' : ''}\n` +
        `📅 This week: *${s.thisWeek}* tasks\n` +
        `🏆 All time: *${s.total}* tasks\n\n` +
        `*Recent daily breakdown:*\n${days || '   No data yet'}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ─────────────────────────────────────────────
// /done <taskId> — Mark your assigned task as complete
// ─────────────────────────────────────────────
bot.command('done', async (ctx) => {
  const userId = ctx.from.id;
  const taskId = ctx.match?.trim();

  if (!taskId) {
    return ctx.reply(
      '⚠️ Please provide the Task ID.\n\nUsage: /done <taskId>\n\nFind your Task ID with /tasks'
    );
  }

  const result = completeTask(taskId, userId);

  if (!result.success) {
    return ctx.reply(`❌ ${result.message}`);
  }

  const { task, previousAssignee } = result;

  // Confirm to the user who completed it
  await ctx.reply(
    `🎉 *Task Marked as Done!*\n\n_${task.description}_\n\nThe task is now open for reassignment.`,
    { parse_mode: 'Markdown' }
  );

  // Notify the admin
  if (config.ADMIN_ID) {
    await bot.api
      .sendMessage(
        config.ADMIN_ID,
        `✅ *Task Completed!*\n\n` +
          `Task: _${task.description}_\n` +
          `Completed by: *${previousAssignee.name}* (@${previousAssignee.username || 'N/A'})\n` +
          `Task ID: \`${taskId}\`\n\n` +
          `🔓 The task is now open for reassignment.`,
        { parse_mode: 'Markdown' }
      )
      .catch(() => {});
  }

  // Record this completion in the stats counter
  recordCompletion(previousAssignee.userId, previousAssignee.username, previousAssignee.name);

  // Restore the Accept button on all original broadcast messages
  const keyboard = new InlineKeyboard().text('✅ Accept Task', `accept_${task.id}`);
  const taskMessage =
    `📌 *Task Available Again\\!*\n\n` +
    `${escapeMarkdown(task.description)}\n\n` +
    `_Previously completed by ${escapeMarkdown(previousAssignee.name)}_\n` +
    `_Task ID: ${escapeMarkdown(task.id)}_`;

  for (const bm of task.broadcastMessages) {
    await bot.api
      .editMessageText(bm.chatId, bm.messageId, taskMessage, {
        parse_mode: 'MarkdownV2',
        reply_markup: keyboard,
      })
      .catch(() => {});
  }
});

// ─────────────────────────────────────────────
// /reset — Admin: Reset all task history (with confirmation)
// ─────────────────────────────────────────────
bot.command('reset', async (ctx) => {
  const { id: chatId, username } = ctx.from;

  if (!isAdmin(chatId, username)) {
    return ctx.reply('❌ You are not authorized to reset task history.');
  }

  const taskCount = getAllTasks().length;

  if (taskCount === 0) {
    return ctx.reply('ℹ️ There are no tasks to reset. Task history is already empty.');
  }

  // Ask the admin to confirm before wiping anything
  const keyboard = new InlineKeyboard()
    .text('🗑 Yes, delete all tasks', 'confirm_reset')
    .text('❌ Cancel', 'cancel_reset');

  await ctx.reply(
    `⚠️ *Are you sure?*\n\n` +
      `This will permanently delete *${taskCount} task${taskCount !== 1 ? 's' : ''}* from history\\.\n` +
      `User stats \\(completion counts\\) will *not* be affected\\.\n\n` +
      `This action *cannot be undone*\\.`,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
});

// ─────────────────────────────────────────────
// /resetstats — Admin: Reset all completion counters (with confirmation)
// ─────────────────────────────────────────────
bot.command('resetstats', async (ctx) => {
  const { id: chatId, username } = ctx.from;

  if (!isAdmin(chatId, username)) {
    return ctx.reply('❌ You are not authorized to reset stats.');
  }

  const allStats = getAllStats();

  if (allStats.length === 0) {
    return ctx.reply('ℹ️ There are no stats to reset. All counters are already empty.');
  }

  const totalCompletions = allStats.reduce((sum, u) => sum + u.total, 0);

  const keyboard = new InlineKeyboard()
    .text('🗑 Yes, reset all stats', 'confirm_reset_stats')
    .text('❌ Cancel', 'cancel_reset_stats');

  await ctx.reply(
    `⚠️ *Are you sure?*\n\n` +
      `This will permanently wipe stats for *${allStats.length} user${allStats.length !== 1 ? 's' : ''}* ` +
      `\\(${totalCompletions} total completion${totalCompletions !== 1 ? 's' : ''} recorded\\)\\.\n` +
      `Task history and user registrations will *not* be affected\\.\n\n` +
      `This action *cannot be undone*\\.`,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
});

// ─────────────────────────────────────────────
// Callback Queries — All inline button handlers
// ─────────────────────────────────────────────
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const from = ctx.from;
  const chatId = from.id;

  // ── "❓ Help & Commands" button ──────────────────────────────────────────
  if (data === 'show_help') {
    await ctx.answerCallbackQuery();
    await ctx.reply(buildHelpText(chatId, from.username), {
      parse_mode: 'Markdown',
      reply_markup: buildHelpKeyboard(chatId),
    });
    return;
  }

  // ── "📋 View Tasks" quick button ─────────────────────────────────────────
  if (data === 'quick_tasks') {
    await ctx.answerCallbackQuery();
    const tasks = getAllTasks();
    if (tasks.length === 0) {
      await ctx.reply(
        'No tasks have been created yet.\n\n_Admins can create one with /task <description>_',
        { parse_mode: 'Markdown' }
      );
    } else {
      const list = tasks.map(formatTask).join('\n\n');
      await ctx.reply(`📋 *All Tasks (${tasks.length}):*\n\n${list}`, {
        parse_mode: 'Markdown',
      });
    }
    return;
  }

  // ── "✅ Accept Task" button ───────────────────────────────────────────────
  if (data.startsWith('accept_')) {
    const taskId = data.replace('accept_', '');
    const name = `${from.first_name || ''} ${from.last_name || ''}`.trim() || 'Unknown';

    // Attempt to claim the task — only the first user wins
    const result = acceptTask(taskId, from.id, from.username, name);

    if (result.success) {
      await ctx.answerCallbackQuery({ text: '🎉 You accepted the task!' });

      // Confirm to the accepting user
      await ctx.reply(
        `✅ *Task Accepted!*\n\nYou have been assigned:\n_${result.task.description}_\n\nRun /done \`${taskId}\` when you're finished.`,
        { parse_mode: 'Markdown' }
      );

      // Notify the admin
      if (config.ADMIN_ID) {
        await bot.api
          .sendMessage(
            config.ADMIN_ID,
            `📣 *Task Accepted!*\n\n` +
              `Task: _${result.task.description}_\n` +
              `Accepted by: *${name}* (@${from.username || 'N/A'})\n` +
              `Task ID: \`${taskId}\``,
            { parse_mode: 'Markdown' }
          )
          .catch(() => {});
      }

      // Edit ALL broadcast messages — remove the button, show who accepted
      const updatedText =
        `📌 *Task Assigned*\n\n${result.task.description}\n\n` +
        `✅ Accepted by: *${name}*\n_Task ID: ${taskId}_`;

      for (const bm of result.task.broadcastMessages) {
        await bot.api
          .editMessageText(bm.chatId, bm.messageId, updatedText, {
            parse_mode: 'Markdown',
          })
          .catch(() => {});
      }
    } else {
      // Task already taken — show modal alert
      await ctx.answerCallbackQuery({
        text: '⚠️ Task already assigned to someone else.',
        show_alert: true,
      });
    }
    return;
  }

  // ── "🗑 Yes, delete all tasks" confirmation button ───────────────────────
  if (data === 'confirm_reset') {
    // Re-check admin rights on the callback too (security: button could be forwarded)
    if (!isAdmin(chatId, from.username)) {
      await ctx.answerCallbackQuery({ text: '❌ Not authorized.', show_alert: true });
      return;
    }

    const taskCount = getAllTasks().length;
    resetAllTasks();

    await ctx.answerCallbackQuery({ text: '🗑 Task history cleared.' });

    // Edit the confirmation prompt to show the result
    await ctx.editMessageText(
      `✅ *Task history has been reset.*\n\n_${taskCount} task${taskCount !== 1 ? 's' : ''} deleted. Stats and user registrations were not affected._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    return;
  }

  // ── "❌ Cancel" button ────────────────────────────────────────────────────
  if (data === 'cancel_reset') {
    await ctx.answerCallbackQuery({ text: 'Reset cancelled.' });
    await ctx.editMessageText('↩️ Reset cancelled. No tasks were deleted.').catch(() => {});
    return;
  }

  // ── "🗑 Yes, reset all stats" confirmation button ────────────────────────
  if (data === 'confirm_reset_stats') {
    if (!isAdmin(chatId, from.username)) {
      await ctx.answerCallbackQuery({ text: '❌ Not authorized.', show_alert: true });
      return;
    }

    const allStats = getAllStats();
    const userCount = allStats.length;
    const totalCompletions = allStats.reduce((sum, u) => sum + u.total, 0);

    resetAllStats();

    await ctx.answerCallbackQuery({ text: '🗑 Stats cleared.' });
    await ctx.editMessageText(
      `✅ *All stats have been reset.*\n\n` +
        `_${totalCompletions} completion${totalCompletions !== 1 ? 's' : ''} across ${userCount} user${userCount !== 1 ? 's' : ''} cleared. Task history and registrations were not affected._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    return;
  }

  // ── "❌ Cancel" stats reset button ────────────────────────────────────────
  if (data === 'cancel_reset_stats') {
    await ctx.answerCallbackQuery({ text: 'Reset cancelled.' });
    await ctx.editMessageText('↩️ Reset cancelled. No stats were changed.').catch(() => {});
    return;
  }

  // Fallback — unknown button, silently acknowledge
  await ctx.answerCallbackQuery();
});

module.exports = bot;
