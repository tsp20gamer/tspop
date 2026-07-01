// tasks.js
// Handles all task-related operations: creation, acceptance, and retrieval.
// Data is persisted in a local JSON file (tasks.json).

const fs = require('fs');
const { TASKS_FILE } = require('./config');

/**
 * Reads all tasks from the JSON file.
 * Returns an empty array if the file doesn't exist yet.
 */
function loadTasks() {
  if (!fs.existsSync(TASKS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(TASKS_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}

/**
 * Writes the tasks array back to the JSON file.
 * Uses pretty-printing (2-space indent) for readability.
 */
function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

/**
 * Creates a new task with a unique ID based on the current timestamp.
 * Status starts as 'open'.
 */
function createTask(description, createdBy) {
  const tasks = loadTasks();

  const task = {
    id: Date.now().toString(),         // Unique ID (millisecond timestamp)
    description,
    status: 'open',                    // 'open' or 'assigned'
    assignedTo: null,                  // Will hold user info once accepted
    broadcastMessages: [],             // Stores {chatId, messageId} for each broadcast message
    createdBy,
    createdAt: new Date().toISOString(),
  };

  tasks.push(task);
  saveTasks(tasks);

  return task;
}

/**
 * Records the message ID sent to each user during a broadcast.
 * This allows the bot to edit all those messages when a task is accepted.
 */
function addBroadcastMessage(taskId, chatId, messageId) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  task.broadcastMessages.push({ chatId, messageId });
  saveTasks(tasks);
}

/**
 * Marks a task as accepted by a specific user.
 * - Returns { success: false } if the task is already assigned.
 * - Returns { success: true, task } on successful acceptance.
 */
function acceptTask(taskId, userId, username, name) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    return { success: false, message: 'Task not found.' };
  }

  // Only the first user to accept gets the task
  if (task.status === 'assigned') {
    return { success: false, message: 'Task already assigned.' };
  }

  task.status = 'assigned';
  task.assignedTo = {
    userId,
    username: username || 'N/A',
    name: name || 'Unknown',
  };
  task.assignedAt = new Date().toISOString();

  saveTasks(tasks);

  return { success: true, task };
}

/**
 * Marks an assigned task as completed by its assigned user.
 * - Resets status to 'open' so the task can be accepted again.
 * - Only the currently assigned user can mark it done.
 * - Returns { success: false, message } on any failure.
 * - Returns { success: true, task, previousAssignee } on success.
 */
function completeTask(taskId, userId) {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);

  if (!task) {
    return { success: false, message: 'Task not found. Check the ID and try again.' };
  }

  if (task.status !== 'assigned') {
    return { success: false, message: 'This task is not currently assigned to anyone.' };
  }

  // Only the person who accepted the task can mark it done
  if (String(task.assignedTo.userId) !== String(userId)) {
    return { success: false, message: 'You can only mark tasks done that are assigned to you.' };
  }

  // Store who completed it before resetting
  const previousAssignee = { ...task.assignedTo };

  // Reset the task back to open so it can be reassigned
  task.status = 'open';
  task.assignedTo = null;
  task.completedBy = previousAssignee;
  task.completedAt = new Date().toISOString();

  saveTasks(tasks);

  return { success: true, task, previousAssignee };
}

/**
 * Returns the full list of all tasks.
 */
function getAllTasks() {
  return loadTasks();
}

/**
 * Returns a single task by its ID, or undefined if not found.
 */
function getTaskById(taskId) {
  return loadTasks().find((t) => t.id === taskId);
}

/**
 * Wipes all tasks and resets tasks.json to an empty array.
 * This is a destructive, irreversible operation — only the admin should call it.
 */
function resetAllTasks() {
  saveTasks([]);
}

module.exports = {
  createTask,
  addBroadcastMessage,
  acceptTask,
  completeTask,
  getAllTasks,
  getTaskById,
  resetAllTasks,
};
