// users.js
// Handles all user-related operations: registration and retrieval.
// Data is persisted in a local JSON file (users.json).

const fs = require('fs');
const { USERS_FILE } = require('./config');

/**
 * Reads all users from the JSON file.
 * Returns an empty array if the file doesn't exist yet.
 */
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(USERS_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}

/**
 * Writes the users array back to the JSON file.
 * Uses pretty-printing (2-space indent) for readability.
 */
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/**
 * Registers a new user.
 * - Returns { success: false } if the user is already registered.
 * - Returns { success: true, user } on successful registration.
 */
function registerUser(chatId, username, firstName, lastName) {
  const users = loadUsers();

  // Prevent duplicate registrations by checking for existing chat ID
  const alreadyExists = users.find((u) => u.chatId === chatId);
  if (alreadyExists) {
    return { success: false, message: 'You are already registered!' };
  }

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

/**
 * Returns the full list of registered users.
 */
function getAllUsers() {
  return loadUsers();
}

module.exports = { registerUser, getAllUsers };
