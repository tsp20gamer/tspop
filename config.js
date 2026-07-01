// config.js
// Central configuration file — loads environment variables from .env

require('dotenv').config();

module.exports = {
  // Your Telegram bot token (from @BotFather)
  BOT_TOKEN: process.env.BOT_TOKEN,

  // Telegram user ID of the admin (get yours by messaging @userinfobot)
  ADMIN_ID: process.env.ADMIN_ID,

  // Path to the JSON file where registered users are stored
  USERS_FILE: './users.json',

  // Path to the JSON file where tasks are stored
  TASKS_FILE: './tasks.json',
};
