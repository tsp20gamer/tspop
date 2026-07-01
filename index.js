// index.js
// Entry point for the Telegram Task Management Bot.
// Validates configuration, registers bot commands with Telegram, then starts polling.

const config = require('./config');

// ── Startup Validation ──────────────────────────────────────────────────────

if (!config.BOT_TOKEN) {
  console.error('❌ Error: BOT_TOKEN is missing.');
  console.error('   Add it to your .env file: BOT_TOKEN=your_token_here');
  process.exit(1);
}

if (!config.ADMIN_ID) {
  console.warn('⚠️  Warning: ADMIN_ID is not set.');
  console.warn('   Admin commands (/task, /users) will not work.');
  console.warn('   Get your ID from @userinfobot on Telegram, then add ADMIN_ID to .env');
}

// ── Start the Bot ───────────────────────────────────────────────────────────

const bot = require('./bot');

// Global error handler — logs unhandled errors without crashing
bot.catch((err) => {
  console.error('❌ Unhandled bot error:', err.message);
});

/**
 * Registers commands with Telegram so they appear in the "/" menu for users.
 * We set two scopes:
 *   1. "default" — commands visible to all regular users
 *   2. "chat" scoped to the admin's chat ID — includes extra admin commands
 */
async function registerCommands() {
  // Commands shown to all users in the "/" menu
  const userCommands = [
    { command: 'start', description: 'Register yourself' },
    { command: 'tasks', description: 'View all tasks and their status' },
    { command: 'done', description: 'Mark your assigned task as complete' },
    { command: 'stats', description: 'View your task completion stats' },
    { command: 'help', description: 'Show all available commands' },
  ];

  // Admin also sees these extra commands in their "/" menu
  const adminCommands = [
    ...userCommands,
    { command: 'task', description: 'Create and broadcast a new task' },
    { command: 'users', description: 'List all registered users' },
    { command: 'reset', description: 'Reset all task history (admin only)' },
    { command: 'resetstats', description: 'Reset all completion stats (admin only)' },
  ];

  try {
    // Register commands for all users in private chats.
    // All commands are listed — admin commands are protected by isAdmin() in the handler,
    // so non-admins see them in the menu but cannot execute them.
    await bot.api.setMyCommands(adminCommands, {
      scope: { type: 'all_private_chats' },
    });

    console.log('✅ Bot commands registered in Telegram menu.');
  } catch (err) {
    // Non-fatal — bot still works, just without the "/" autocomplete menu
    console.warn('⚠️  Could not register bot commands:', err.message);
  }
}

console.log('🤖 Starting Telegram Task Management Bot...');

// Register commands first, then begin polling
registerCommands().then(() => {
  bot.start({
    onStart: () => console.log('✅ Bot is running! Press Ctrl+C to stop.'),
  });
});
