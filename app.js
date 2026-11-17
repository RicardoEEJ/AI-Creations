const STORAGE_KEY = "steady-habit-board-v1";
const BANK_STORAGE_KEY = "steady-task-bank-v1";
const STATE_VERSION = 6;
const HABIT_UNDO_DURATION_MS = 9000;
const TAB_STORAGE_KEY = "steady-active-tab-v1";
const APP_TABS = new Set(["today", "habits", "tasks", "bank"]);
const COLOR_MESSAGES = {
  green: [
    "You made time for what matters. That counts.",
    "A small step is still a real step.",
    "Look at you, showing up for yourself.",
  ],
  yellow: [
    "You still have time. One step at a time.",
    "No need to rush; just begin where you are.",
    "A little progress is plenty for now.",
  ],
  red: [
    "You’re here now. Do what you can with this moment.",
    "A gentle nudge, not a judgment.",
    "Starting small is still starting.",
  ],
  gray: [
    "No judgment. There’s always another chance.",
    "Rest and trying again are both part of progress.",
    "One unfinished day doesn’t define you.",
  ],
};
const QUOTES = window.STEADY_QUOTES;
const REPLACEMENTS = ["Drink some water", "Stretch for 30 seconds", "Step outside for a moment"];

const taskDialog = document.querySelector("#task-dialog");
const badDialog = document.querySelector("#bad-dialog");
const cancelTaskDialog = document.querySelector("#cancel-task-dialog");
const overtimeDialog = document.querySelector("#overtime-dialog");
const taskList = document.querySelector("#task-list");
const bankList = document.querySelector("#bank-list");
const bankDialog = document.querySelector("#bank-dialog");
const bankChooserDialog = document.querySelector("#bank-chooser-dialog");
const routineList = document.querySelector("#routine-list");
const badHabitList = document.querySelector("#bad-habit-list");
const notice = document.querySelector("#storage-notice");
const saveStatus = document.querySelector("#save-status");
const tabButtons = [...document.querySelectorAll(".tab-button")];
const appViews = [...document.querySelectorAll("[data-app-view]")];
const accountDialog = document.querySelector("#account-dialog");
const accountButton = document.querySelector("#account-button");
const accountForm = document.querySelector("#account-form");
const accountDetails = document.querySelector("#account-details");
const changePasswordForm = document.querySelector("#change-password-form");
const authMessage = document.querySelector("#auth-message");
const passwordChangeMessage = document.querySelector("#password-change-message");
const accountConfig = window.STEADY_SUPABASE_CONFIG || {};
const hasSupabaseConfig = Boolean(accountConfig.url || accountConfig.anonKey);
let supabaseClient = null;
let supabaseSetupError = null;
if (hasSupabaseConfig) {
  if (!accountConfig.url || !accountConfig.anonKey) {
    supabaseSetupError = "Add both the Supabase project URL and publishable key to supabase-config.js.";
  } else if (!window.supabase || typeof window.supabase.createClient !== "function") {
    supabaseSetupError = "The Supabase client could not be loaded. Check your internet connection and reload.";
  } else {
    try {
      supabaseClient = window.supabase.createClient(accountConfig.url, accountConfig.anonKey);
    } catch (error) {
      console.error("Could not initialize Supabase.", error);
      supabaseSetupError = "Supabase settings are invalid. Check supabase-config.js.";
    }
  }
}
let activePauseId = null;
let editingTaskId = null;
let editingHabitId = null;
let editingBankId = null;
let taskDialogEntryType = "task";
let taskTimeSelected = true;
let editingBadHabitId = null;
let audioContext = null;
let activeOscillators = [];
let audioUnavailableNotified = false;
let habitUndoTimer = null;
let pendingHabitUndo = null;
let completionMessageTimer = null;
let pendingCancelTaskId = null;
let pendingOvertimeTaskId = null;
let previousStreakCount = null;
let currentQuoteIndex = null;
let feedbackToastTimer = null;
let bank = loadBank();
let state = loadState();
let currentUser = null;
let accountReady = false;
let authMode = "login";
let isAccountSessionInitializing = true;
let pendingAuthUser = null;
let cloudWriteQueue = Promise.resolve();
let cloudWriteError = null;
let saveRevision = 0;

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `steady-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeDefaultState() {
  return {
    version: STATE_VERSION,
    dayKey: todayKey(),
    tasks: [],
    habits: [],
    badHabits: [],
    history: [],
    habitCompletionDays: [],
    lastHabitCelebrationDay: null,
    soundOn: true,
    habitTimeLog: [],
  };
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function loadActiveTab() {
  try {
    const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
    return APP_TABS.has(savedTab) ? savedTab : "today";
  } catch (error) {
    console.error("Could not read the last active tab.", error);
    showNotice("Your last tab couldn’t be restored. The Today tab is open.");
    return "today";
  }
}

function activateTab(tab, shouldSave = true) {
  if (!APP_TABS.has(tab)) {
    return;
  }

  appViews.forEach((view) => {
    view.hidden = view.dataset.appView !== tab;
  });
  tabButtons.forEach((button) => {
    if (button.dataset.tab === tab) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  if (shouldSave) {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch (error) {
      console.error("Could not save the last active tab.", error);
      showNotice("Your tab changed, but this browser couldn’t remember it for next time.");
    }
  }
}

function setSaveStatus(message) {
  saveStatus.textContent = message;
}

function isValidState(value) {
  return (
    value &&
    value.version === STATE_VERSION &&
    typeof value.dayKey === "string" &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.habits) &&
    Array.isArray(value.badHabits) &&
    Array.isArray(value.history) &&
    Array.isArray(value.habitCompletionDays) &&
    (value.lastHabitCelebrationDay === null || typeof value.lastHabitCelebrationDay === "string") &&
    typeof value.soundOn === "boolean" &&
    Array.isArray(value.habitTimeLog)
  );
}

function getCompletedHabitDays(value) {
  const days = new Set(Array.isArray(value.habitCompletionDays) ? value.habitCompletionDays : []);
  const addCompletedTasks = (dayKey, tasks) => {
    if (Array.isArray(tasks) && tasks.some((task) => task.status === "done" && task.habitId)) {
      days.add(dayKey);
    }
  };
  addCompletedTasks(value.dayKey, value.tasks);
  for (const day of value.history || []) {
    addCompletedTasks(day.dayKey, day.tasks);
  }
  return [...days].filter((dayKey) => /^\d{4}-\d{2}-\d{2}$/.test(dayKey)).sort();
}

function migrateState(value) {
  if (
    !value ||
    (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 5 && value.version !== STATE_VERSION) ||
    typeof value.dayKey !== "string" ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.habits) ||
    !Array.isArray(value.badHabits) ||
    !Array.isArray(value.history) ||
    typeof value.soundOn !== "boolean"
  ) {
    return null;
  }
  if (value.version === STATE_VERSION) {
    return value;
  }

  let migrated = value;
  if (value.version === 1) {
    migrated = {
      ...value,
      version: 2,
      tasks: value.tasks.map((task) => ({
        ...task,
        scheduledAt: Number.isFinite(task.scheduledAt) ? task.scheduledAt : null,
      })),
      badHabits: value.badHabits.map((habit) => ({
        ...habit,
        checkedIn: Boolean(habit.avoided),
      })),
      history: value.history.map((day) => ({
        ...day,
        badHabits: (Array.isArray(day.badHabits) ? day.badHabits : []).map((habit) => {
          const currentHabit = value.badHabits.find(
            (item) => item.name.toLocaleLowerCase() === String(habit.name).toLocaleLowerCase()
          );
          return {
            ...habit,
            id: habit.id || currentHabit?.id || null,
            checkedIn: Boolean(habit.avoided),
          };
        }),
      })),
    };
  }

  if (migrated.version === 1 || migrated.version === 2) {
    migrated = {
      ...migrated,
      version: 3,
      habitCompletionDays: getCompletedHabitDays(migrated),
      lastHabitCelebrationDay: null,
    };
  }

  const now = Date.now();
  const normalizeTask = (task, taskDayKey, currentDay) => {
    const startAt = Number.isFinite(task.scheduledAt) ? task.scheduledAt : task.createdAt;
    const elapsedMs = Number.isFinite(task.elapsedMs)
      ? Math.max(0, task.elapsedMs)
      : task.status === "active" && currentDay && Number.isFinite(startAt)
        ? Math.max(0, now - startAt)
        : 0;
    const lastResumedAt = task.status === "active"
      ? Number.isFinite(task.lastResumedAt) ? task.lastResumedAt : now
      : null;
    return {
      ...task,
      elapsedMs,
      recordedElapsedMs: Number.isFinite(task.recordedElapsedMs)
        ? Math.max(0, task.recordedElapsedMs)
        : 0,
      recordedOvertimeMs: Number.isFinite(task.recordedOvertimeMs)
        ? Math.max(0, task.recordedOvertimeMs)
        : 0,
      lastResumedAt,
      sessionDayKey: typeof task.sessionDayKey === "string"
        ? task.sessionDayKey
        : Number.isFinite(startAt) ? todayKey(new Date(startAt)) : taskDayKey,
      overtimeAccepted: Boolean(task.overtimeAccepted),
      overtimeDeclined: Boolean(task.overtimeDeclined),
    };
  };
  const legacyTimeLogs = [];
  if (value.version === 5) {
    for (const habit of migrated.habits) {
      if (!habit || !habit.id || !Array.isArray(habit.timeLog)) {
        continue;
      }
      habit.timeLog.forEach((entry, index) => {
        if (
          entry &&
          typeof entry.date === "string" &&
          Number.isFinite(entry.minutes) &&
          entry.minutes >= 0
        ) {
          legacyTimeLogs.push({
            sessionId: `legacy-${habit.id}-${entry.date}-${index}`,
            habitId: habit.id,
            dayKey: entry.date,
            elapsedMs: entry.minutes * 60 * 1000,
            overtimeMs: 0,
            legacy: true,
          });
        }
      });
    }
  }
  const existingTimeLogs = Array.isArray(migrated.habitTimeLog) ? migrated.habitTimeLog : [];
  return {
    ...migrated,
    version: STATE_VERSION,
    tasks: migrated.tasks.map((task) => normalizeTask(task, migrated.dayKey, true)),
    history: migrated.history.map((day) => ({
      ...day,
      tasks: Array.isArray(day.tasks)
        ? day.tasks.map((task) => normalizeTask(task, day.dayKey, false))
        : [],
    })),
    habitTimeLog: [...existingTimeLogs, ...legacyTimeLogs],
  };
}

function loadState() {
  let saved;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.error("Could not read the saved habit board.", error);
    showNotice("Your browser blocked saved data. You can use this page for now, but changes may not be saved.");
    return makeDefaultState();
  }

  if (!saved) {
    return makeDefaultState();
  }

  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    console.error("The saved habit board is not valid JSON.", error);
    showNotice("Saved data could not be read. A fresh board is open; your stored data has not been changed.");
    return makeDefaultState();
  }

  const migrated = migrateState(parsed);
  if (!migrated || !isValidState(migrated)) {
    showNotice("Saved data is from an unsupported version. A fresh board is open.");
    return makeDefaultState();
  }
  if (migrated !== parsed) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch (error) {
      console.error("Could not upgrade the saved habit board.", error);
      showNotice("Your board was upgraded for this session, but the updated format couldn’t be saved.");
    }
  }
  return migrated;
}

function normalizeBankTemplate(template) {
  if (
    !template ||
    typeof template.id !== "string" ||
    !template.id ||
    typeof template.title !== "string" ||
    !template.title.trim() ||
    (template.minutes !== null &&
      (!Number.isInteger(template.minutes) || template.minutes < 1 || template.minutes > 1440))
  ) {
    return null;
  }
  return {
    id: template.id,
    title: template.title.trim(),
    minutes: template.minutes,
    category: typeof template.category === "string" ? template.category.trim() : "",
    notes: typeof template.notes === "string" ? template.notes.trim() : "",
  };
}

function loadBank() {
  let saved;
  try {
    saved = localStorage.getItem(BANK_STORAGE_KEY);
  } catch (error) {
    console.error("Could not read the task bank.", error);
    showNotice("Your task bank couldn’t be read. You can use it for now, but changes may not be saved.");
    return [];
  }
  if (!saved) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    console.error("The saved task bank is not valid JSON.", error);
    showNotice("Saved task templates could not be read. The Bank is empty; your stored data has not been changed.");
    return [];
  }
  if (!Array.isArray(parsed)) {
    showNotice("The saved task bank has an unsupported format. The Bank is empty.");
    return [];
  }
  const templates = parsed.map(normalizeBankTemplate).filter(Boolean);
  if (templates.length !== parsed.length) {
    showNotice("Some saved task templates could not be read and were skipped.");
  }
  return templates;
}

function saveState() {
  if (currentUser) {
    if (!accountReady) {
      showNotice("Your account board is still loading. This change has not been saved.");
      return;
    }
    queueCloudSave(currentUser.id);
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    notice.hidden = true;
    setSaveStatus("Saved on this device");
  } catch (error) {
    console.error("Could not save the habit board.", error);
    showNotice("Your browser couldn’t save this change. The board will stay available until you close this page.");
  }
}

function queueCloudSave(userId) {
  const revision = ++saveRevision;
  const snapshot = JSON.parse(JSON.stringify(state));
  snapshot.bank = bank.map((template) => ({ ...template }));
  setSaveStatus("Saving to your account…");
  cloudWriteQueue = cloudWriteQueue.then(async () => {
    if (currentUser?.id !== userId) {
      return;
    }
    const { error } = await supabaseClient
      .from("steady_user_data")
      .upsert({ user_id: userId, board_state: snapshot });
    if (error) {
      throw error;
    }
    cloudWriteError = null;
    if (revision === saveRevision) {
      notice.hidden = true;
      setSaveStatus("Saved to your account");
    }
  }).catch((error) => {
    cloudWriteError = error;
    console.error("Could not save the account board.", error);
    showNotice("Your latest change couldn’t sync to your account. Check your connection and try again.");
    setSaveStatus("Not synced");
  });
}

function saveBank() {
  if (currentUser) {
    if (!accountReady) {
      showNotice("Your account board is still loading. This change has not been saved.");
      return false;
    }
    queueCloudSave(currentUser.id);
    return true;
  }
  try {
    localStorage.setItem(BANK_STORAGE_KEY, JSON.stringify(bank));
    setSaveStatus("Saved on this device");
    return true;
  } catch (error) {
    console.error("Could not save the task bank.", error);
    showNotice("Your browser couldn’t save this template. The Bank will stay available until you close this page.");
    return false;
  }
}

function escapeText(value) {
  return String(value);
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = escapeText(text);
  }
  return element;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatHabitTime(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h ${String(remainingMinutes).padStart(2, "0")}m` : `${minutes}m`;
}

function getTaskElapsedMs(task, now = Date.now()) {
  const accumulated = Number.isFinite(task.elapsedMs) ? Math.max(0, task.elapsedMs) : 0;
  if (task.status !== "active" || !Number.isFinite(task.lastResumedAt)) {
    return accumulated;
  }
  return accumulated + Math.max(0, now - task.lastResumedAt);
}

function getTaskRemainingMs(task, now = Date.now()) {
  return task.durationMs - getTaskElapsedMs(task, now);
}

function commitTaskTime(task, now = Date.now()) {
  const elapsedMs = task.overtimeAccepted
    ? getTaskElapsedMs(task, now)
    : Math.min(getTaskElapsedMs(task, now), task.durationMs);
  task.elapsedMs = elapsedMs;
  if (task.status === "active") {
    task.lastResumedAt = now;
  }

  if (!task.habitId) {
    return;
  }

  const previousElapsedMs = Number.isFinite(task.recordedElapsedMs)
    ? Math.max(0, task.recordedElapsedMs)
    : 0;
  const previousOvertimeMs = Number.isFinite(task.recordedOvertimeMs)
    ? Math.max(0, task.recordedOvertimeMs)
    : 0;
  const overtimeMs = task.overtimeAccepted
    ? Math.max(0, elapsedMs - task.durationMs)
    : 0;
  const elapsedDelta = Math.max(0, elapsedMs - previousElapsedMs);
  const overtimeDelta = Math.max(0, overtimeMs - previousOvertimeMs);

  if (elapsedDelta > 0 || overtimeDelta > 0) {
    let entry = state.habitTimeLog.find((item) => item.sessionId === task.id);
    if (!entry) {
      entry = {
        sessionId: task.id,
        habitId: task.habitId,
        dayKey: task.sessionDayKey || state.dayKey,
        elapsedMs: 0,
        overtimeMs: 0,
      };
      state.habitTimeLog.push(entry);
    }
    entry.elapsedMs += elapsedDelta;
    entry.overtimeMs += overtimeDelta;
  }

  task.recordedElapsedMs = Math.max(previousElapsedMs, elapsedMs);
  task.recordedOvertimeMs = Math.max(previousOvertimeMs, overtimeMs);
}

function getHabitTimeTotals(habitId, now = Date.now()) {
  const totals = state.habitTimeLog
    .filter((entry) => entry.habitId === habitId)
    .reduce((sum, entry) => ({
      elapsedMs: sum.elapsedMs + (Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : 0),
      overtimeMs: sum.overtimeMs + (Number.isFinite(entry.overtimeMs) ? entry.overtimeMs : 0),
    }), { elapsedMs: 0, overtimeMs: 0 });

  for (const task of state.tasks) {
    if (task.habitId !== habitId) {
      continue;
    }
    const elapsedMs = task.overtimeAccepted
      ? getTaskElapsedMs(task, now)
      : Math.min(getTaskElapsedMs(task, now), task.durationMs);
    const recordedElapsedMs = Number.isFinite(task.recordedElapsedMs) ? task.recordedElapsedMs : 0;
    const overtimeMs = task.overtimeAccepted ? Math.max(0, elapsedMs - task.durationMs) : 0;
    const recordedOvertimeMs = Number.isFinite(task.recordedOvertimeMs) ? task.recordedOvertimeMs : 0;
    totals.elapsedMs += Math.max(0, elapsedMs - recordedElapsedMs);
    totals.overtimeMs += Math.max(0, overtimeMs - recordedOvertimeMs);
  }
  return totals;
}

function taskColor(task, now = Date.now()) {
  if (task.status === "done") {
    return task.outcome || "gray";
  }
  if (task.status === "missed" || task.status === "scheduled") {
    return "gray";
  }
  const remaining = getTaskRemainingMs(task, now);
  const ratio = remaining / task.durationMs;
  if (ratio > 0.5) {
    return "green";
  }
  if (ratio >= 0.25 && remaining > 0) {
    return "yellow";
  }
  return "red";
}

function colorLabel(color) {
  return { green: "Green", yellow: "Yellow", red: "Red", gray: "Gray" }[color];
}

function taskMessage(color) {
  const messages = COLOR_MESSAGES[color] || COLOR_MESSAGES.gray;
  return messages[Math.floor(Math.random() * messages.length)];
}

function createTask({ name, minutes, habitId = null, saveAsHabit = false, scheduledAt = null }) {
  const now = Date.now();
  const startsLater = Number.isFinite(scheduledAt) && scheduledAt > now;
  let linkedHabitId = habitId;
  if (saveAsHabit) {
    const existing = state.habits.find(
      (habit) => habit.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    linkedHabitId = existing ? existing.id : createId();
    if (!existing) {
      state.habits.push({ id: linkedHabitId, name, minutes });
    } else {
      existing.minutes = minutes;
    }
  }

  state.tasks.unshift({
    id: createId(),
    name,
    minutes,
    durationMs: minutes * 60 * 1000,
    createdAt: now,
    scheduledAt,
    status: startsLater ? "scheduled" : "active",
    elapsedMs: 0,
    recordedElapsedMs: 0,
    recordedOvertimeMs: 0,
    lastResumedAt: startsLater ? null : now,
    sessionDayKey: startsLater ? todayKey(new Date(scheduledAt)) : state.dayKey,
    overtimeAccepted: false,
    overtimeDeclined: false,
    outcome: null,
    completedAt: null,
    habitId: linkedHabitId,
  });
  saveState();
  render();
  void playSound("task-added");
}

function updateTask(taskId, { name, minutes, scheduledAt }) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  const now = Date.now();
  task.name = name;
  task.minutes = minutes;
  task.durationMs = minutes * 60 * 1000;
  task.scheduledAt = scheduledAt;
  if (task.status === "scheduled") {
    if (Number.isFinite(scheduledAt) && scheduledAt > now) {
      task.lastResumedAt = null;
      task.sessionDayKey = todayKey(new Date(scheduledAt));
    } else {
      task.status = "active";
      task.lastResumedAt = now;
      task.sessionDayKey = state.dayKey;
    }
  }
  saveState();
  render();
}

function finishTask(taskId) {
  checkDayBoundary();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || (task.status !== "active" && task.status !== "paused")) {
    return;
  }
  const allTasksWereDone = areAllTasksDone();
  const now = Date.now();
  commitTaskTime(task, now);
  const isDailyHabit = Boolean(task.habitId);
  const isCurrentHabit = isDailyHabit &&
    state.habits.some((habit) => habit.id === task.habitId);
  task.outcome = taskColor(task, now);
  task.status = "done";
  task.lastResumedAt = null;
  task.completedAt = now;
  let celebrateAllHabits = false;
  if (isDailyHabit) {
    state.habitCompletionDays = getCompletedHabitDays(state);
    state.habitCompletionDays = [...new Set([...state.habitCompletionDays, state.dayKey])].sort();
    celebrateAllHabits = isCurrentHabit &&
      state.habits.length > 0 &&
      state.lastHabitCelebrationDay !== state.dayKey &&
      state.habits.every((habit) =>
        state.tasks.some((item) => item.habitId === habit.id && item.status === "done")
      );
    if (celebrateAllHabits) {
      state.lastHabitCelebrationDay = state.dayKey;
    }
  }
  commitTaskTime(task, now);
  const allTasksAreDone = areAllTasksDone();
  saveState();
  render();
  if (celebrateAllHabits || (!allTasksWereDone && allTasksAreDone)) {
    showCompletionMessage();
    void playSound("all-habits-completed");
  } else {
    void playSound("task-completed");
  }
}

function areAllTasksDone() {
  return state.tasks.length > 0 && state.tasks.every((task) => task.status === "done");
}

function removeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  if (task.status === "active" || task.status === "paused") {
    pendingCancelTaskId = taskId;
    openDialog(cancelTaskDialog);
    document.querySelector("#keep-task-going").focus();
    return;
  }
  discardTask(taskId);
}

function pauseTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "active") {
    return;
  }
  commitTaskTime(task);
  task.status = "paused";
  task.lastResumedAt = null;
  saveState();
  render();
}

function resumeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "paused") {
    return;
  }
  task.status = "active";
  task.lastResumedAt = Date.now();
  saveState();
  render();
}

function confirmCancelTask() {
  const taskId = pendingCancelTaskId;
  pendingCancelTaskId = null;
  cancelTaskDialog.close();
  if (taskId) {
    discardTask(taskId);
  }
}

function discardTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  if (task.status === "active" || task.status === "paused") {
    commitTaskTime(task);
  }
  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  saveState();
  render();
}

function startRoutine(habit) {
  const alreadyStarted = state.tasks.some(
    (task) => task.habitId === habit.id && task.status !== "missed"
  );
  if (alreadyStarted) {
    return;
  }
  createTask({ name: habit.name, minutes: habit.minutes, habitId: habit.id });
}

function updateHabit(habitId, name, minutes) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  habit.name = name;
  habit.minutes = minutes;
  saveState();
  render();
}

function showHabitUndo(habit, index, taskSnapshot, taskIndex, wasRunning) {
  if (habitUndoTimer) {
    window.clearTimeout(habitUndoTimer);
  }
  pendingHabitUndo = { habit, index, taskSnapshot, taskIndex, wasRunning, userId: currentUser?.id || null };
  document.querySelector("#undo-toast-message").textContent = taskSnapshot
    ? "Habit and today’s session removed."
    : "Habit removed.";
  document.querySelector("#undo-toast").hidden = false;
  document.querySelector("#undo-delete-habit").focus();
  habitUndoTimer = window.setTimeout(() => {
    pendingHabitUndo = null;
    document.querySelector("#undo-toast").hidden = true;
    habitUndoTimer = null;
  }, HABIT_UNDO_DURATION_MS);
}

function clearHabitUndo() {
  if (habitUndoTimer) {
    window.clearTimeout(habitUndoTimer);
    habitUndoTimer = null;
  }
  pendingHabitUndo = null;
  document.querySelector("#undo-toast").hidden = true;
}

function removeHabit(habitId) {
  const index = state.habits.findIndex((habit) => habit.id === habitId);
  if (index < 0) {
    return;
  }
  const [habit] = state.habits.splice(index, 1);
  let taskSnapshot = null;
  let taskIndex = -1;
  let wasRunning = false;
  const linkedTaskIndex = state.tasks.findIndex((task) =>
    task.habitId === habitId &&
    (task.status === "active" || task.status === "paused" || task.status === "scheduled")
  );
  if (linkedTaskIndex >= 0) {
    const task = state.tasks[linkedTaskIndex];
    wasRunning = task.status === "active";
    commitTaskTime(task);
    if (task.status === "active") {
      task.status = "paused";
      task.lastResumedAt = null;
    }
    taskSnapshot = { ...task };
    taskIndex = linkedTaskIndex;
    state.tasks.splice(linkedTaskIndex, 1);
  }
  saveState();
  render();
  showHabitUndo(habit, index, taskSnapshot, taskIndex, wasRunning);
}

function undoRemoveHabit() {
  if (!pendingHabitUndo || pendingHabitUndo.userId !== (currentUser?.id || null)) {
    clearHabitUndo();
    return;
  }
  const { habit, index, taskSnapshot, taskIndex, wasRunning } = pendingHabitUndo;
  state.habits.splice(Math.min(index, state.habits.length), 0, habit);
  if (taskSnapshot) {
    const restoredTask = { ...taskSnapshot };
    if (wasRunning) {
      restoredTask.status = "active";
      restoredTask.lastResumedAt = Date.now();
    }
    state.tasks.splice(Math.min(taskIndex, state.tasks.length), 0, restoredTask);
  }
  clearHabitUndo();
  saveState();
  render();
}

function addBadHabit(name) {
  state.badHabits.push({ id: createId(), name, avoided: false, checkedIn: false });
  saveState();
  render();
  void playSound("habit-added");
}

function updateBadHabit(habitId, name) {
  const habit = state.badHabits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  habit.name = name;
  saveState();
  render();
}

function toggleAvoided(habitId) {
  const habit = state.badHabits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  habit.avoided = !habit.avoided;
  habit.checkedIn = habit.avoided;
  saveState();
  render();
  if (habit.avoided) {
    void playSound("habit-avoided");
  }
}

function toggleHardDay(habitId) {
  const habit = state.badHabits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  const isUndo = habit.checkedIn && !habit.avoided;
  habit.checkedIn = !isUndo;
  habit.avoided = false;
  saveState();
  render();
}

function getHabitHistory(habit) {
  const historyByDay = new Map(
    state.history.map((day) => [
      day.dayKey,
      (day.badHabits || []).find((item) => item.id === habit.id),
    ])
  );
  const days = [];
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - daysAgo);
    const dayKey = todayKey(date);
    const entry = dayKey === state.dayKey ? habit : historyByDay.get(dayKey);
    const status = !entry || !entry.checkedIn
      ? "open"
      : entry.avoided ? "avoided" : "hard";
    days.push({
      date,
      status,
    });
  }
  return days;
}

function removeBadHabit(habitId) {
  state.badHabits = state.badHabits.filter((habit) => habit.id !== habitId);
  if (activePauseId === habitId) {
    activePauseId = null;
  }
  saveState();
  render();
}

function buildTaskCard(task) {
  const now = Date.now();
  const color = taskColor(task, now);
  const active = task.status === "active";
  const paused = task.status === "paused";
  const scheduled = task.status === "scheduled";
  const remaining = getTaskRemainingMs(task, now);
  const elapsedMs = getTaskElapsedMs(task, now);
  const overtimeMs = task.overtimeAccepted ? Math.max(0, elapsedMs - task.durationMs) : 0;
  const remainingRatio = active || paused ? Math.min(1, Math.max(0, remaining / task.durationMs)) : 0;
  const card = makeElement(
    "article",
    `task-card tone-${color}${task.status === "done" ? " is-finished" : ""}${task.status === "missed" ? " is-missed" : ""}${paused ? " is-paused" : ""}`
  );
  card.id = `task-${task.id}`;
  card.dataset.taskId = task.id;

  const main = makeElement("div", "task-main");
  const titleRow = makeElement("div", "task-title-row");
  titleRow.append(makeElement("h3", "task-title", task.name));
  const kind = makeElement("span", `task-kind${task.habitId ? "" : " one-time"}`, task.habitId ? "Daily habit" : "Task");
  titleRow.append(kind);
  main.append(titleRow);

  const meta = makeElement("div", "task-meta");
  const timer = makeElement("span", "task-timer");
  timer.dataset.timerFor = task.id;
  if (scheduled) {
    timer.textContent = `Starts ${new Date(task.scheduledAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;
  } else if (task.overtimeAccepted && overtimeMs > 0) {
    timer.classList.add("is-overtime");
    timer.textContent = `${formatDuration(task.durationMs)} scheduled + ${formatDuration(overtimeMs)} overtime`;
  } else if (paused) {
    timer.classList.add("is-paused");
    timer.textContent = remaining > 0
      ? `Paused · ${formatDuration(remaining)} left`
      : `Paused · ${formatDuration(-remaining)} over`;
  } else if (active) {
    timer.textContent = remaining > 0
      ? `${formatDuration(remaining)} left`
      : task.habitId && !task.overtimeDeclined
        ? "Scheduled time reached"
        : `${formatDuration(-remaining)} overdue`;
  } else if (task.status === "done") {
    timer.textContent = overtimeMs > 0
      ? `${formatDuration(task.durationMs)} scheduled + ${formatDuration(overtimeMs)} overtime`
      : `Finished in ${colorLabel(color).toLowerCase()} time`;
  } else {
    timer.textContent = "Not finished today";
  }
  meta.append(timer);

  const badge = makeElement("span", `status-badge status-${color}`);
  badge.dataset.statusFor = task.id;
  badge.dataset.tooltip = taskMessage(color);
  badge.tabIndex = 0;
  badge.textContent = scheduled
    ? "Scheduled"
    : paused
      ? "Paused"
      : active
        ? remaining <= 0 ? "Overdue" : `${colorLabel(color)} zone`
      : task.status === "done" ? `Done · ${colorLabel(color)}` : "Missed · Gray";
  badge.setAttribute("aria-label", `${badge.textContent}. ${badge.dataset.tooltip}`);
  meta.append(badge);
  main.append(meta);

  const progress = makeElement("div", "task-progress");
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", `Time remaining for ${task.name}`);
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  progress.setAttribute("aria-valuenow", String(Math.round(remainingRatio * 100)));
  const fill = makeElement("div", "task-progress-fill");
  fill.dataset.progressFor = task.id;
  fill.style.width = `${remainingRatio * 100}%`;
  progress.append(fill);
  if (!scheduled) {
    main.append(progress);
  }
  card.append(main);

  const actions = makeElement("div", "task-actions");
  if (active || paused) {
    const done = makeElement("button", "done-button", "Done");
    done.type = "button";
    done.setAttribute("aria-label", `Mark ${task.name} complete`);
    done.addEventListener("click", () => finishTask(task.id));
    actions.append(done);
    const timerControl = makeElement(
      "button",
      "task-control-button",
      paused ? "Resume" : "Pause"
    );
    timerControl.type = "button";
    timerControl.setAttribute("aria-label", `${paused ? "Resume" : "Pause"} ${task.name}`);
    timerControl.addEventListener("click", () => {
      if (paused) {
        resumeTask(task.id);
      } else {
        pauseTask(task.id);
      }
    });
    actions.append(timerControl);
  }
  const edit = makeElement("button", "icon-button", "✎");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${task.name}`);
  edit.addEventListener("click", () => openTaskEditor(task.id));
  actions.append(edit);

  const remove = makeElement("button", "icon-button", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", `${active || paused ? "Cancel" : "Remove"} ${task.name}`);
  remove.addEventListener("click", () => removeTask(task.id));
  actions.append(remove);
  card.append(actions);
  return card;
}

function buildRoutineItem(habit) {
  const item = makeElement("article", "routine-item");
  const info = makeElement("div", "routine-info");
  info.append(makeElement("p", "routine-name", habit.name));
  info.append(makeElement("span", "routine-time", `${habit.minutes} min · daily`));
  const totals = getHabitTimeTotals(habit.id);
  const total = makeElement("span", "routine-state", `${formatHabitTime(totals.elapsedMs)} total`);
  total.dataset.habitRoutineTotal = habit.id;
  info.append(total);
  item.append(info);

  const todayTask = state.tasks.find((task) => task.habitId === habit.id && task.status !== "missed");
  const button = makeElement("button", todayTask ? "button button-secondary" : "button button-primary");
  button.type = "button";
  if (todayTask) {
    button.textContent = todayTask.status === "done"
      ? "Done today"
      : todayTask.status === "scheduled"
        ? "Scheduled"
        : todayTask.status === "paused" ? "Paused" : "In progress";
    button.disabled = true;
  } else {
    button.textContent = "Start today";
    button.setAttribute("aria-label", `Start ${habit.name} today`);
    button.addEventListener("click", () => startRoutine(habit));
  }
  const actions = makeElement("div", "routine-actions");
  actions.append(button);

  const edit = makeElement("button", "routine-management-button", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${habit.name}`);
  edit.addEventListener("click", () => openHabitEditor(habit.id));
  actions.append(edit);

  const remove = makeElement("button", "routine-management-button", "Delete");
  remove.type = "button";
  remove.setAttribute("aria-label", `Delete ${habit.name}`);
  remove.addEventListener("click", () => removeHabit(habit.id));
  actions.append(remove);
  item.append(actions);
  return item;
}

function buildBadHabitItem(habit) {
  const item = makeElement("article", "bad-habit-item");
  const top = makeElement("div", "bad-habit-top");
  const info = makeElement("div");
  info.append(makeElement("p", "bad-habit-name", habit.name));
  const statusLabel = habit.avoided
    ? "Avoided today · Green"
    : habit.checkedIn
      ? "Thanks for checking in · Tomorrow is another chance"
      : "Your check-in is open";
  const status = makeElement("span", `bad-habit-status${habit.avoided ? " is-resisted" : ""}`, statusLabel);
  info.append(status);
  top.append(info);

  const edit = makeElement("button", "icon-button", "✎");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${habit.name}`);
  edit.addEventListener("click", () => openBadHabitEditor(habit.id));
  top.append(edit);

  const remove = makeElement("button", "icon-button", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${habit.name}`);
  remove.addEventListener("click", () => removeBadHabit(habit.id));
  top.append(remove);
  item.append(top);

  const buttons = makeElement("div", "bad-habit-buttons");
  const checkIn = makeElement(
    "button",
    "resist-button",
    habit.avoided ? "Undo check-in" : "I avoided it today"
  );
  checkIn.type = "button";
  checkIn.setAttribute("aria-pressed", String(habit.avoided));
  checkIn.addEventListener("click", () => toggleAvoided(habit.id));
  buttons.append(checkIn);

  const hardDay = makeElement(
    "button",
    "urge-button",
    habit.checkedIn && !habit.avoided ? "Undo check-in" : "Today was hard"
  );
  hardDay.type = "button";
  hardDay.setAttribute("aria-pressed", String(habit.checkedIn && !habit.avoided));
  hardDay.addEventListener("click", () => toggleHardDay(habit.id));
  buttons.append(hardDay);

  const urge = makeElement("button", "urge-button", activePauseId === habit.id ? "Close pause" : "I feel an urge");
  urge.type = "button";
  urge.setAttribute("aria-expanded", String(activePauseId === habit.id));
  urge.addEventListener("click", () => {
    activePauseId = activePauseId === habit.id ? null : habit.id;
    render();
  });
  buttons.append(urge);
  item.append(buttons);

  const history = getHabitHistory(habit);
  const avoidedDays = history.filter((day) => day.status === "avoided").length;
  const checkedDays = history.filter((day) => day.status !== "open").length;
  const progress = makeElement("div", "habit-progress");
  progress.append(makeElement(
    "p",
    "habit-progress-summary",
    `${avoidedDays} steady ${avoidedDays === 1 ? "day" : "days"} · ${checkedDays} ${checkedDays === 1 ? "check-in" : "check-ins"} in 30 days`
  ));
  const dayStrip = makeElement("div", "habit-day-strip");
  dayStrip.setAttribute("role", "img");
  dayStrip.setAttribute("aria-label", `${avoidedDays} avoided days out of ${checkedDays} check-ins in the last 30 days`);
  for (const day of history) {
    const dot = makeElement("span", `habit-day is-${day.status}`);
    const dayLabel = day.date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const dayStatus = day.status === "avoided"
      ? "avoided"
      : day.status === "hard" ? "checked in, ready to try again" : "no check-in";
    dot.title = `${dayLabel}: ${dayStatus}`;
    dayStrip.append(dot);
  }
  progress.append(dayStrip);
  item.append(progress);

  if (activePauseId === habit.id) {
    const pause = makeElement("div", "pause-card");
    pause.setAttribute("aria-live", "polite");
    pause.append(makeElement("p", "", "Pause for one breath. What’s one kind thing you could do for yourself right now?"));
    const replacementActions = makeElement("div", "replacement-actions");
    for (const replacement of REPLACEMENTS) {
      const option = makeElement("button", "replacement-button", replacement);
      option.type = "button";
      option.addEventListener("click", () => {
        const result = pause.querySelector(".replacement-result");
        if (result) {
          result.textContent = `That’s a lovely next step: ${replacement.toLocaleLowerCase()}.`;
        } else {
          pause.append(makeElement("p", "replacement-result", `That’s a lovely next step: ${replacement.toLocaleLowerCase()}.`));
        }
      });
      replacementActions.append(option);
    }
    pause.append(replacementActions);
    item.append(pause);
  }
  return item;
}

function renderHabitTimeList() {
  const list = document.querySelector("#habit-time-list");
  const empty = document.querySelector("#habit-time-empty");
  list.replaceChildren();
  empty.hidden = state.habits.length > 0;
  for (const habit of state.habits) {
    const totals = getHabitTimeTotals(habit.id);
    const row = makeElement("div", "habit-time-item");
    row.append(makeElement("span", "habit-time-name", habit.name));
    const total = makeElement("span", "habit-time-total", `${formatHabitTime(totals.elapsedMs)} total`);
    total.dataset.habitTotalFor = habit.id;
    const details = makeElement("span", "habit-time-overtime");
    if (totals.overtimeMs > 0) {
      details.textContent = `${formatDuration(totals.overtimeMs)} overtime`;
    }
    details.dataset.habitOvertimeFor = habit.id;
    const values = makeElement("div");
    values.append(total);
    values.append(details);
    row.append(values);
    list.append(row);
  }
}

function updateSummary() {
  const doneTasks = state.tasks.filter((task) => task.status === "done").length;
  const activeTasks = state.tasks.filter((task) => task.status === "active" || task.status === "paused").length;
  document.querySelector("#done-count").textContent = String(doneTasks);
  document.querySelector("#active-count").textContent = String(activeTasks);
  document.querySelector("#habit-count").textContent = String(state.habits.length);
}

function showFeedbackToast(message) {
  const toast = document.querySelector("#feedback-toast");
  toast.textContent = message;
  toast.hidden = false;
  if (feedbackToastTimer) {
    window.clearTimeout(feedbackToastTimer);
  }
  feedbackToastTimer = window.setTimeout(() => {
    toast.hidden = true;
    feedbackToastTimer = null;
  }, 2400);
}

function saveTaskToBank(title, minutes) {
  const existing = bank.find(
    (template) => template.title.toLocaleLowerCase() === title.toLocaleLowerCase()
  );
  if (existing) {
    existing.title = title;
    existing.minutes = minutes;
  } else {
    bank.unshift({
      id: createId(),
      title,
      minutes,
      category: "",
      notes: "",
    });
  }
  const saved = saveBank();
  renderBank();
  if (saved) {
    showFeedbackToast(existing ? "Bank template updated" : "Saved to Bank");
  }
}

function buildBankTemplate(template) {
  const card = makeElement("article", "bank-template");
  const info = makeElement("div", "bank-template-info");
  const titleRow = makeElement("div", "bank-template-title-row");
  titleRow.append(makeElement("h3", "bank-template-title", template.title));
  if (template.category) {
    titleRow.append(makeElement("span", "bank-template-category", template.category));
  }
  info.append(titleRow);
  info.append(makeElement(
    "p",
    "bank-template-duration",
    template.minutes ? `${template.minutes} min` : "No duration set"
  ));
  if (template.notes) {
    info.append(makeElement("p", "bank-template-notes", template.notes));
  }
  card.append(info);

  const actions = makeElement("div", "bank-template-actions");
  const use = makeElement("button", "button button-primary", "Use");
  use.type = "button";
  use.setAttribute("aria-label", `Add ${template.title} to Today`);
  use.addEventListener("click", () => {
    createTask({ name: template.title, minutes: template.minutes || 30 });
    showFeedbackToast("Added to Today");
  });
  actions.append(use);

  const edit = makeElement("button", "button button-secondary", "Edit");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${template.title}`);
  edit.addEventListener("click", () => openBankEditor(template.id));
  actions.append(edit);

  const remove = makeElement("button", "button button-secondary", "Delete");
  remove.type = "button";
  remove.setAttribute("aria-label", `Delete ${template.title}`);
  remove.addEventListener("click", () => {
    if (!window.confirm(`Delete “${template.title}” from your Bank?`)) {
      return;
    }
    bank = bank.filter((item) => item.id !== template.id);
    const saved = saveBank();
    render();
    if (saved) {
      showFeedbackToast("Template deleted");
    }
  });
  actions.append(remove);
  card.append(actions);
  return card;
}

function renderBank() {
  bankList.replaceChildren(...bank.map(buildBankTemplate));
  document.querySelector("#bank-empty").hidden = bank.length > 0;
}

function renderBankChooser() {
  const list = document.querySelector("#bank-chooser-list");
  const empty = document.querySelector("#bank-chooser-empty");
  list.replaceChildren();
  empty.hidden = bank.length > 0;
  for (const template of bank) {
    const option = makeElement("button", "bank-chooser-option");
    option.type = "button";
    option.append(makeElement("span", "bank-chooser-option-title", template.title));
    option.append(makeElement(
      "span",
      "bank-chooser-option-detail",
      template.minutes ? `${template.minutes} min` : "30 min default"
    ));
    option.addEventListener("click", () => {
      bankChooserDialog.close();
      openNewTaskDialog();
      const form = document.querySelector("#task-form");
      form.elements.name.value = template.title;
      taskDurationPicker.setValue(template.minutes || 30);
      requestAnimationFrame(() => taskDurationPicker.refresh());
    });
    list.append(option);
  }
}

function getStreakSummary() {
  const days = getCompletedHabitDays(state).filter((dayKey) => dayKey <= todayKey());
  if (!days.length) {
    return null;
  }
  const completed = new Set(days);
  let best = 0;
  let run = 0;
  let previousDate = null;
  for (const dayKey of days) {
    const date = new Date(`${dayKey}T12:00:00`);
    const gap = previousDate ? Math.round((date - previousDate) / 86400000) : 0;
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previousDate = date;
  }

  const today = todayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const latestActiveDay = completed.has(today) ? today : todayKey(yesterday);
  if (!completed.has(latestActiveDay)) {
    return { current: 0, best };
  }
  let current = 1;
  let day = new Date(`${latestActiveDay}T12:00:00`);
  while (true) {
    day.setDate(day.getDate() - 1);
    if (!completed.has(todayKey(day))) {
      break;
    }
    current += 1;
  }
  return { current, best, completedToday: completed.has(today) };
}

function renderStreak() {
  const card = document.querySelector("#streak-card");
  const bar = document.querySelector("#summary-bar");
  const streak = state.habits.length > 0 ? getStreakSummary() : null;
  bar.classList.toggle("has-streak", Boolean(streak));
  if (!streak) {
    card.hidden = true;
    previousStreakCount = 0;
    return;
  }
  card.hidden = false;
  document.querySelector("#streak-value").textContent = String(streak.current);
  document.querySelector("#streak-best").textContent =
    `Best: ${streak.best} ${streak.best === 1 ? "day" : "days"}`;
  if (previousStreakCount !== null && streak.current > previousStreakCount) {
    card.classList.remove("is-increasing");
    void card.offsetWidth;
    card.classList.add("is-increasing");
  }
  previousStreakCount = streak.current;
}

function showCompletionMessage() {
  const message = document.querySelector("#completion-message");
  message.textContent = "All done for today. Nice work.";
  message.hidden = false;
  if (completionMessageTimer) {
    window.clearTimeout(completionMessageTimer);
  }
  completionMessageTimer = window.setTimeout(() => {
    message.hidden = true;
    completionMessageTimer = null;
  }, 6000);
}

function render() {
  document.querySelector("#today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  taskList.replaceChildren(...state.tasks.map(buildTaskCard));
  document.querySelector("#task-empty").hidden = state.tasks.length > 0;
  renderBank();

  routineList.replaceChildren(...state.habits.map(buildRoutineItem));
  document.querySelector("#routine-count").textContent = `${state.habits.length} saved`;
  document.querySelector("#routine-empty").hidden = state.habits.length > 0;
  renderStreak();

  badHabitList.replaceChildren(...state.badHabits.map(buildBadHabitItem));
  document.querySelector("#bad-habit-empty").hidden = state.badHabits.length > 0;
  updateSummary();
  renderHabitTimeList();

  const soundToggle = document.querySelector("#sound-toggle");
  soundToggle.setAttribute("aria-pressed", String(state.soundOn));
  document.querySelector("#sound-label").textContent = state.soundOn ? "Sound on" : "Sound off";
  document.querySelector("#sound-icon").textContent = state.soundOn ? "♫" : "♪";
}

function updateLiveTimers() {
  if (currentUser && !accountReady) {
    return;
  }
  const now = Date.now();
  for (const task of state.tasks) {
    if (task.status !== "active" && task.status !== "paused") {
      continue;
    }
    const remaining = getTaskRemainingMs(task, now);
    const elapsedMs = getTaskElapsedMs(task, now);
    const overtimeMs = task.overtimeAccepted ? Math.max(0, elapsedMs - task.durationMs) : 0;
    const color = taskColor(task, now);
    const card = document.querySelector(`#task-${CSS.escape(task.id)}`);
    if (!card) {
      continue;
    }
    card.classList.remove("tone-green", "tone-yellow", "tone-red", "is-paused");
    card.classList.add(`tone-${color}`);
    if (task.status === "paused") {
      card.classList.add("is-paused");
    }

    const timer = card.querySelector(`[data-timer-for="${CSS.escape(task.id)}"]`);
    timer.classList.toggle("is-paused", task.status === "paused");
    timer.classList.toggle("is-overtime", task.overtimeAccepted && overtimeMs > 0);
    if (task.overtimeAccepted && overtimeMs > 0) {
      timer.textContent = `${formatDuration(task.durationMs)} scheduled + ${formatDuration(overtimeMs)} overtime`;
    } else if (task.status === "paused") {
      timer.textContent = remaining > 0
        ? `Paused · ${formatDuration(remaining)} left`
        : `Paused · ${formatDuration(-remaining)} over`;
    } else {
      timer.textContent = remaining > 0
        ? `${formatDuration(remaining)} left`
        : task.habitId && !task.overtimeDeclined
          ? "Scheduled time reached"
          : `${formatDuration(-remaining)} overdue`;
    }

    const badge = card.querySelector(`[data-status-for="${CSS.escape(task.id)}"]`);
    badge.className = `status-badge status-${color}`;
    badge.textContent = task.status === "paused"
      ? "Paused"
      : remaining <= 0 ? "Overdue" : `${colorLabel(color)} zone`;
    badge.dataset.tooltip = taskMessage(color);
    badge.setAttribute("aria-label", `${badge.textContent}. ${badge.dataset.tooltip}`);

    const fill = card.querySelector(`[data-progress-for="${CSS.escape(task.id)}"]`);
    const ratio = Math.min(1, Math.max(0, remaining / task.durationMs));
    fill.style.width = `${ratio * 100}%`;
    card.querySelector('[role="progressbar"]').setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
  updateHabitTimeDisplays(now);
  showPendingOvertimePrompt(now);
}

function updateHabitTimeDisplays(now) {
  for (const habit of state.habits) {
    const totals = getHabitTimeTotals(habit.id, now);
    const formattedTotal = `${formatHabitTime(totals.elapsedMs)} total`;
    const routineTotal = document.querySelector(`[data-habit-routine-total="${CSS.escape(habit.id)}"]`);
    if (routineTotal) {
      routineTotal.textContent = formattedTotal;
    }
    const total = document.querySelector(`[data-habit-total-for="${CSS.escape(habit.id)}"]`);
    if (total) {
      total.textContent = formattedTotal;
    }
    const overtime = document.querySelector(`[data-habit-overtime-for="${CSS.escape(habit.id)}"]`);
    if (overtime) {
      overtime.textContent = totals.overtimeMs > 0
        ? `${formatDuration(totals.overtimeMs)} overtime`
        : "";
    }
  }
}

function showPendingOvertimePrompt(now = Date.now()) {
  if (pendingOvertimeTaskId || overtimeDialog.open || (currentUser && !accountReady)) {
    return;
  }
  const task = state.tasks.find((item) =>
    item.status === "active" &&
    item.habitId &&
    !item.overtimeAccepted &&
    !item.overtimeDeclined &&
    getTaskRemainingMs(item, now) <= 0
  );
  if (!task) {
    return;
  }
  pendingOvertimeTaskId = task.id;
  openDialog(overtimeDialog);
  document.querySelector("#continue-overtime").focus();
}

function resolveOvertime(continueTracking) {
  const task = state.tasks.find((item) => item.id === pendingOvertimeTaskId);
  pendingOvertimeTaskId = null;
  overtimeDialog.close();
  if (!task || task.status !== "active") {
    return;
  }
  if (continueTracking) {
    task.overtimeAccepted = true;
    commitTaskTime(task);
    saveState();
    render();
    return;
  }

  task.elapsedMs = Math.min(getTaskElapsedMs(task), task.durationMs);
  task.lastResumedAt = null;
  task.status = "paused";
  task.overtimeDeclined = true;
  finishTask(task.id);
}

function archiveCurrentDay(newDayKey) {
  const now = Date.now();
  const carriedTasks = state.tasks.filter((task) =>
    (task.status === "scheduled" &&
      (task.scheduledAt > now || todayKey(new Date(task.scheduledAt)) === newDayKey)) ||
    (task.habitId && (task.status === "active" || task.status === "paused"))
  ).map((task) => Object.assign({}, task, {
    status: task.status === "scheduled" && task.scheduledAt <= now ? "active" : task.status,
    lastResumedAt: task.status === "scheduled" && task.scheduledAt <= now ? task.scheduledAt : task.lastResumedAt,
  }));
  const carriedTaskIds = new Set(carriedTasks.map((task) => task.id));
  for (const task of state.tasks) {
    if (!carriedTaskIds.has(task.id) && (task.status === "active" || task.status === "paused")) {
      commitTaskTime(task, now);
      task.lastResumedAt = null;
    }
  }
  const previousTasks = state.tasks.filter((task) => !carriedTasks.some((carried) => carried.id === task.id)).map((task) =>
    Object.assign({}, task, {
      status: task.status === "active" || task.status === "paused" || task.status === "scheduled" ? "missed" : task.status,
      outcome: task.status === "active" || task.status === "paused" || task.status === "scheduled" ? "gray" : task.outcome,
    })
  );
  const previousBadHabits = state.badHabits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    avoided: habit.avoided,
    checkedIn: habit.checkedIn,
  }));
  if (previousTasks.length > 0 || previousBadHabits.length > 0) {
    state.history.unshift({
      dayKey: state.dayKey,
      tasks: previousTasks,
      badHabits: previousBadHabits,
    });
    state.history = state.history.slice(0, 30);
  }
  state.dayKey = newDayKey;
  state.tasks = carriedTasks;
  state.badHabits = state.badHabits.map((habit) => Object.assign({}, habit, {
    avoided: false,
    checkedIn: false,
  }));
  activePauseId = null;
  saveState();
  render();
}

function checkDayBoundary() {
  if (currentUser && !accountReady) {
    return;
  }
  const currentDay = todayKey();
  if (state.dayKey !== currentDay) {
    archiveCurrentDay(currentDay);
  }
}

function activateDueTasks() {
  const now = Date.now();
  let changed = false;
  for (const task of state.tasks) {
    if (task.status === "scheduled" && task.scheduledAt <= now) {
      task.status = "active";
      task.lastResumedAt = task.scheduledAt;
      task.sessionDayKey = task.sessionDayKey || state.dayKey;
      changed = true;
    }
  }
  if (changed) {
    saveState();
    render();
  }
}

async function playSound(kind) {
  if (!state.soundOn) {
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    if (!audioUnavailableNotified) {
      showNotice("This browser does not support the optional sounds.");
      audioUnavailableNotified = true;
    }
    return;
  }

  const sequences = {
    "task-added": [{ frequency: 587.33, offset: 0, duration: 0.13, volume: 0.018 }],
    "habit-added": [
      { frequency: 523.25, offset: 0, duration: 0.14, volume: 0.018 },
      { frequency: 659.25, offset: 0.08, duration: 0.16, volume: 0.018 },
    ],
    "task-completed": [
      { frequency: 523.25, offset: 0, duration: 0.2, volume: 0.034 },
      { frequency: 659.25, offset: 0.1, duration: 0.22, volume: 0.034 },
      { frequency: 783.99, offset: 0.2, duration: 0.25, volume: 0.034 },
      { frequency: 1046.5, offset: 0.3, duration: 0.34, volume: 0.034 },
    ],
    "all-habits-completed": [
      { frequency: 523.25, offset: 0, duration: 0.52, volume: 0.014 },
      { frequency: 659.25, offset: 0, duration: 0.52, volume: 0.014 },
      { frequency: 783.99, offset: 0, duration: 0.52, volume: 0.014 },
      { frequency: 523.25, offset: 0.08, duration: 0.3, volume: 0.019 },
      { frequency: 659.25, offset: 0.2, duration: 0.34, volume: 0.019 },
      { frequency: 783.99, offset: 0.32, duration: 0.38, volume: 0.019 },
      { frequency: 1046.5, offset: 0.44, duration: 0.48, volume: 0.019 },
      { frequency: 1318.51, offset: 0.56, duration: 0.6, volume: 0.017 },
    ],
    "habit-avoided": [
      { frequency: 659.25, offset: 0, duration: 0.2, volume: 0.03 },
      { frequency: 783.99, offset: 0.11, duration: 0.24, volume: 0.03 },
      { frequency: 987.77, offset: 0.22, duration: 0.28, volume: 0.03 },
    ],
  };
  const sequence = sequences[kind];
  if (!sequence) {
    return;
  }

  try {
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    if (!state.soundOn) {
      return;
    }
    for (const oscillator of activeOscillators) {
      oscillator.stop();
    }
    activeOscillators = [];
    const now = audioContext.currentTime;
    for (const note of sequence) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = now + note.offset;
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.volume, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      activeOscillators.push(oscillator);
      oscillator.addEventListener("ended", () => {
        activeOscillators = activeOscillators.filter((item) => item !== oscillator);
      }, { once: true });
      oscillator.start(start);
      oscillator.stop(start + note.duration + 0.01);
    }
  } catch (error) {
    console.error("The optional interaction sound could not be played.", error);
    if (!audioUnavailableNotified) {
      showNotice("The optional sound couldn’t be played in this browser.");
      audioUnavailableNotified = true;
    }
  }
}

function renderNextQuote() {
  if (
    !Array.isArray(QUOTES) ||
    QUOTES.length !== 100 ||
    QUOTES.some((quote) => !quote || typeof quote.text !== "string" || typeof quote.source !== "string")
  ) {
    console.error("The motivational quote catalog must contain exactly 100 attributed entries.");
    showNotice("The encouragement quotes couldn’t be loaded. Your board is still available.");
    return;
  }

  let previousIndex = currentQuoteIndex;
  if (previousIndex === null) {
    try {
      const savedIndex = localStorage.getItem("steady-last-quote-index-v1");
      const storedIndex = savedIndex === null ? NaN : Number(savedIndex);
      previousIndex = Number.isInteger(storedIndex) ? storedIndex : null;
    } catch (error) {
      console.error("Could not read the previous quote choice.", error);
    }
  }
  const options = QUOTES.map((_quote, index) => index)
    .filter((index) => index !== previousIndex);
  currentQuoteIndex = options[Math.floor(Math.random() * options.length)];
  const quote = QUOTES[currentQuoteIndex];
  document.querySelector("#quote-text").textContent = quote.text;
  document.querySelector("#quote-source").textContent = quote.source;
  try {
    localStorage.setItem("steady-last-quote-index-v1", String(currentQuoteIndex));
  } catch (error) {
    console.error("Could not remember the previous quote choice.", error);
    showNotice("Your quote changed, but this browser couldn’t remember it for next time.");
  }
}

function initializeSummaryBar() {
  const sentinel = document.querySelector("#summary-sentinel");
  const summaryBar = document.querySelector("#summary-bar");
  const updateCompactState = () => {
    summaryBar.classList.toggle("is-compact", sentinel.getBoundingClientRect().top < 0);
  };
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(updateCompactState, { threshold: 0 });
    observer.observe(sentinel);
  } else {
    window.addEventListener("scroll", updateCompactState, { passive: true });
    updateCompactState();
  }
}

function createDurationPicker(container, initialMinutes, onChange) {
  const choices = [5, 15, 30, 45, 60];
  const hours = Array.from({ length: 25 }, (_, index) => index);
  let minuteValues = [];
  let minuteStep = 5;
  let selectedHours = 0;
  let selectedMinutes = 30;
  const scrollTimers = new WeakMap();

  container.innerHTML = `
    <div class="duration-quick-picks" aria-label="Quick durations">
      ${choices.map((minutes) => `<button class="duration-chip" type="button" data-minutes="${minutes}">${minutes} min</button>`).join("")}
    </div>
    <div class="duration-wheels">
      <div class="duration-wheel-column">
        <span class="duration-wheel-label">Hours</span>
        <div class="duration-wheel" data-unit="hours" role="group" aria-label="Hours">
          <div class="duration-wheel-list"></div>
        </div>
      </div>
      <div class="duration-wheel-column">
        <div class="duration-wheel-heading">
          <span class="duration-wheel-label">Minutes</span>
          <button class="duration-step-toggle" type="button" aria-pressed="false">Use 1 min steps</button>
        </div>
        <div class="duration-wheel" data-unit="minutes" role="group" aria-label="Minutes">
          <div class="duration-wheel-list"></div>
        </div>
      </div>
      <p class="duration-summary" aria-live="polite"></p>
    </div>
  `;

  const hourWheel = container.querySelector('[data-unit="hours"]');
  const minuteWheel = container.querySelector('[data-unit="minutes"]');
  const stepToggle = container.querySelector(".duration-step-toggle");
  const summary = container.querySelector(".duration-summary");
  const chips = Array.from(container.querySelectorAll(".duration-chip"));

  function valuesForMinutes() {
    return selectedHours === 24
      ? [0]
      : Array.from({ length: 60 / minuteStep }, (_, index) => index * minuteStep);
  }

  function itemHeight(wheel) {
    const item = wheel.querySelector(".duration-wheel-item");
    return item ? parseFloat(getComputedStyle(item).height) || 44 : 44;
  }

  function wheelIndex(wheel) {
    const items = wheel.querySelectorAll(".duration-wheel-item");
    return Math.max(0, Math.min(items.length - 1, Math.round(wheel.scrollTop / itemHeight(wheel))));
  }

  function centerWheel(wheel, value, behavior) {
    const items = Array.from(wheel.querySelectorAll(".duration-wheel-item"));
    const index = items.findIndex((item) => Number(item.dataset.value) === value);
    if (index >= 0) {
      wheel.scrollTo({ top: index * itemHeight(wheel), behavior });
    }
  }

  function updateWheelState(wheel, selectedValue) {
    wheel.querySelectorAll(".duration-wheel-item").forEach((item) => {
      item.setAttribute("aria-pressed", String(Number(item.dataset.value) === selectedValue));
    });
  }

  function renderWheel(wheel, values, unit) {
    const list = wheel.querySelector(".duration-wheel-list");
    const fragment = document.createDocumentFragment();
    values.forEach((value) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "duration-wheel-item";
      item.dataset.value = String(value);
      item.textContent = String(value);
      item.setAttribute("aria-pressed", "false");
      item.setAttribute(
        "aria-label",
        unit === "hours"
          ? `${value} ${value === 1 ? "hour" : "hours"}`
          : `${value} ${value === 1 ? "minute" : "minutes"}`,
      );
      item.addEventListener("click", () => chooseValue(unit, value, "smooth"));
      fragment.append(item);
    });
    list.replaceChildren(fragment);
  }

  function formatSummary() {
    if (selectedHours && selectedMinutes) {
      return `${selectedHours} h ${selectedMinutes} min`;
    }
    if (selectedHours) {
      return `${selectedHours} h`;
    }
    return `${selectedMinutes} min`;
  }

  function updateReadout() {
    const total = selectedHours * 60 + selectedMinutes;
    summary.textContent = formatSummary();
    chips.forEach((chip) => {
      chip.setAttribute("aria-pressed", String(Number(chip.dataset.minutes) === total));
    });
    updateWheelState(hourWheel, selectedHours);
    updateWheelState(minuteWheel, selectedMinutes);
    onChange(total);
  }

  function chooseValue(unit, value, behavior) {
    if (unit === "hours") {
      const previousHours = selectedHours;
      selectedHours = value;
      if (selectedHours === 24 || previousHours === 24) {
        if (selectedHours === 24) {
          selectedMinutes = 0;
        }
        minuteValues = valuesForMinutes();
        renderWheel(minuteWheel, minuteValues, "minutes");
        centerWheel(minuteWheel, selectedMinutes, behavior);
      }
      centerWheel(hourWheel, selectedHours, behavior);
    } else {
      selectedMinutes = value;
      centerWheel(minuteWheel, selectedMinutes, behavior);
    }
    updateReadout();
  }

  function commitWheel(wheel) {
    clearTimeout(scrollTimers.get(wheel));
    const unit = wheel.dataset.unit;
    const values = unit === "hours" ? hours : minuteValues;
    const value = values[wheelIndex(wheel)];
    if (Number.isFinite(value)) {
      chooseValue(unit, value, "auto");
    }
  }

  function scheduleWheelCommit(wheel) {
    clearTimeout(scrollTimers.get(wheel));
    scrollTimers.set(wheel, setTimeout(() => commitWheel(wheel), 120));
  }

  function attachWheelEvents(wheel) {
    wheel.addEventListener("scroll", () => scheduleWheelCommit(wheel), { passive: true });
    wheel.addEventListener("scrollend", () => commitWheel(wheel));
    wheel.addEventListener("wheel", (event) => {
      if (!event.deltaY) {
        return;
      }
      event.preventDefault();
      const unit = wheel.dataset.unit;
      const values = unit === "hours" ? hours : minuteValues;
      const currentValue = unit === "hours" ? selectedHours : selectedMinutes;
      const index = values.indexOf(currentValue);
      const nextIndex = Math.max(0, Math.min(values.length - 1, index + (event.deltaY > 0 ? 1 : -1)));
      chooseValue(unit, values[nextIndex], "auto");
    }, { passive: false });
  }

  function renderMinutesWheel() {
    minuteValues = valuesForMinutes();
    renderWheel(minuteWheel, minuteValues, "minutes");
  }

  function setValue(minutes, options = {}) {
    const total = Number.isFinite(minutes) ? Math.min(1440, Math.max(0, Math.round(minutes))) : 30;
    selectedHours = Math.floor(total / 60);
    selectedMinutes = total % 60;
    minuteStep = selectedMinutes % 5 === 0 ? 5 : 1;
    stepToggle.setAttribute("aria-pressed", String(minuteStep === 1));
    stepToggle.textContent = minuteStep === 1 ? "Use 5 min steps" : "Use 1 min steps";
    renderMinutesWheel();
    centerWheel(hourWheel, selectedHours, options.smooth ? "smooth" : "auto");
    centerWheel(minuteWheel, selectedMinutes, options.smooth ? "smooth" : "auto");
    updateReadout();
  }

  renderWheel(hourWheel, hours, "hours");
  renderMinutesWheel();
  attachWheelEvents(hourWheel);
  attachWheelEvents(minuteWheel);

  chips.forEach((chip) => {
    chip.addEventListener("click", () => setValue(Number(chip.dataset.minutes), { smooth: true }));
  });

  stepToggle.addEventListener("click", () => {
    if (minuteStep === 5) {
      minuteStep = 1;
    } else {
      const roundedMinutes = Math.round(selectedMinutes / 5) * 5;
      if (roundedMinutes === 60) {
        selectedHours = Math.min(24, selectedHours + 1);
        selectedMinutes = 0;
      } else {
        selectedMinutes = roundedMinutes;
      }
      minuteStep = 5;
    }
    stepToggle.setAttribute("aria-pressed", String(minuteStep === 1));
    stepToggle.textContent = minuteStep === 1 ? "Use 5 min steps" : "Use 1 min steps";
    renderMinutesWheel();
    centerWheel(hourWheel, selectedHours, "smooth");
    centerWheel(minuteWheel, selectedMinutes, "smooth");
    updateReadout();
  });

  const picker = {
    setValue,
    refresh() {
      centerWheel(hourWheel, selectedHours, "auto");
      centerWheel(minuteWheel, selectedMinutes, "auto");
    },
  };
  picker.setValue(initialMinutes);
  return picker;
}

const taskDurationPicker = createDurationPicker(
  document.querySelector("#task-duration-picker"),
  30,
  (minutes) => {
    document.querySelector("#task-minutes").value = String(minutes);
  },
);
const bankDurationPicker = createDurationPicker(
  document.querySelector("#bank-duration-picker"),
  30,
  (minutes) => {
    document.querySelector("#bank-minutes").value = String(minutes);
  },
);

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    showNotice("This browser does not support dialogs. Please try a current browser.");
  }
}

function openNewTaskDialog() {
  openNewEntryDialog("task");
}

function openNewHabitDialog() {
  openNewEntryDialog("habit");
}

function openNewEntryDialog(entryType) {
  editingTaskId = null;
  editingHabitId = null;
  taskDialogEntryType = entryType;
  taskTimeSelected = entryType === "task";
  const form = document.querySelector("#task-form");
  form.reset();
  taskDurationPicker.setValue(30);
  document.querySelector("#task-bank-actions").hidden = entryType !== "task";
  document.querySelector("#save-task-to-bank").checked = false;
  document.querySelector("#task-time-control").hidden = entryType === "habit";
  document.querySelector("#task-time-picker").hidden = true;
  document.querySelector("#task-dialog-title").textContent = `Add ${entryType}`;
  form.querySelector('[type="submit"]').textContent = `Add ${entryType}`;
  document.querySelector("#task-form-hint").hidden = entryType === "habit";
  if (entryType === "task") {
    setTaskTime(suggestedTaskTime());
  }
  openDialog(taskDialog);
  requestAnimationFrame(() => taskDurationPicker.refresh());
}

function openTaskEditor(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  editingTaskId = taskId;
  editingHabitId = null;
  taskDialogEntryType = "task";
  taskTimeSelected = task.scheduledAt !== null;
  const form = document.querySelector("#task-form");
  document.querySelector("#task-bank-actions").hidden = true;
  document.querySelector("#save-task-to-bank").checked = false;
  form.elements.name.value = task.name;
  taskDurationPicker.setValue(task.minutes);
  document.querySelector("#task-time-control").hidden = false;
  document.querySelector("#task-time-picker").hidden = true;
  document.querySelector("#task-form-hint").hidden = false;
  setTaskTime(task.scheduledAt || suggestedTaskTime());
  document.querySelector("#task-dialog-title").textContent = "Edit task";
  form.querySelector('[type="submit"]').textContent = "Save changes";
  openDialog(taskDialog);
  requestAnimationFrame(() => taskDurationPicker.refresh());
}

function openBankEditor(templateId = null) {
  const template = templateId ? bank.find((item) => item.id === templateId) : null;
  if (templateId && !template) {
    return;
  }
  editingBankId = template ? template.id : null;
  const form = document.querySelector("#bank-form");
  form.reset();
  form.elements.title.value = template ? template.title : "";
  form.elements.category.value = template ? template.category : "";
  form.elements.notes.value = template ? template.notes : "";
  form.elements.durationEnabled.checked = Boolean(template && template.minutes);
  document.querySelector("#bank-duration-fields").hidden = !form.elements.durationEnabled.checked;
  bankDurationPicker.setValue(template?.minutes || 30);
  document.querySelector("#bank-dialog-title").textContent = template ? "Edit template" : "Add a template";
  form.querySelector('[type="submit"]').textContent = template ? "Save changes" : "Save template";
  openDialog(bankDialog);
  if (form.elements.durationEnabled.checked) {
    requestAnimationFrame(() => bankDurationPicker.refresh());
  }
}

function openBankChooser() {
  document.querySelector("#task-dialog").close();
  renderBankChooser();
  openDialog(bankChooserDialog);
}

function suggestedTaskTime() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.round(date.getMinutes() / 5) * 5);
  return date.getTime();
}

function setTaskTime(timestamp) {
  const input = document.querySelector("#task-start-at");
  input.value = toLocalDateTimeInput(timestamp);
  updateTaskTimeLabel(timestamp);
}

function updateTaskTimeLabel(timestamp) {
  const suggestion = document.querySelector("#suggested-task-time");
  if (!Number.isFinite(timestamp)) {
    suggestion.textContent = "Choose a start time";
    suggestion.setAttribute("aria-pressed", "false");
    return;
  }
  const date = new Date(timestamp);
  const dateLabel = todayKey(date) === todayKey()
    ? "Today"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  suggestion.textContent = `${dateLabel} at ${timeLabel}`;
  suggestion.setAttribute("aria-pressed", "true");
}

function openHabitEditor(habitId) {
  const habit = state.habits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  editingTaskId = null;
  editingHabitId = habitId;
  taskDialogEntryType = "habit";
  taskTimeSelected = false;
  const form = document.querySelector("#task-form");
  document.querySelector("#task-bank-actions").hidden = true;
  document.querySelector("#save-task-to-bank").checked = false;
  form.elements.name.value = habit.name;
  taskDurationPicker.setValue(habit.minutes);
  document.querySelector("#task-time-control").hidden = true;
  document.querySelector("#task-time-picker").hidden = true;
  document.querySelector("#task-dialog-title").textContent = "Edit daily habit";
  form.querySelector('[type="submit"]').textContent = "Save changes";
  document.querySelector("#task-form-hint").hidden = true;
  openDialog(taskDialog);
  requestAnimationFrame(() => taskDurationPicker.refresh());
}

function toLocalDateTimeInput(timestamp) {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 19);
}

function parseLocalDateTime(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function openNewBadHabitDialog() {
  editingBadHabitId = null;
  const form = document.querySelector("#bad-form");
  form.reset();
  document.querySelector("#bad-dialog-title").textContent = "Add a habit to change";
  form.querySelector('[type="submit"]').textContent = "Add habit";
  openDialog(badDialog);
}

function openBadHabitEditor(habitId) {
  const habit = state.badHabits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  editingBadHabitId = habitId;
  const form = document.querySelector("#bad-form");
  form.elements.name.value = habit.name;
  document.querySelector("#bad-dialog-title").textContent = "Edit habit";
  form.querySelector('[type="submit"]').textContent = "Save changes";
  openDialog(badDialog);
}

function renderAccountControls() {
  const signedIn = Boolean(currentUser);
  accountButton.textContent = signedIn ? "Account" : "Log in";
  accountForm.hidden = signedIn;
  accountDetails.hidden = !signedIn;
  document.querySelector("#account-email-label").textContent = currentUser?.email || "";
  document.querySelector("#auth-submit").textContent = authMode === "login" ? "Log in" : "Create account";
  document.querySelector("#auth-mode-toggle").textContent =
    authMode === "login" ? "Create an account" : "I already have an account";
  document.querySelector("#account-password").autocomplete =
    authMode === "login" ? "current-password" : "new-password";
}

function showAuthMessage(message) {
  authMessage.textContent = message;
  authMessage.hidden = false;
}

function showPasswordChangeMessage(message) {
  passwordChangeMessage.textContent = message;
  passwordChangeMessage.hidden = false;
}

function resetPasswordVisibility() {
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.getElementById(button.dataset.passwordToggle);
    input.type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-label", `Show ${input.labels[0].textContent.trim().toLowerCase()}`);
    button.setAttribute("aria-pressed", "false");
  });
}

function hasBoardData(boardState) {
  return boardState.tasks.length > 0 ||
    boardState.habits.length > 0 ||
    boardState.badHabits.length > 0 ||
    boardState.history.length > 0 ||
    bank.length > 0;
}

async function activateAccount(user) {
  if (!user) {
    if (!currentUser) {
      return;
    }
    clearHabitUndo();
    currentUser = null;
    accountReady = true;
    cloudWriteError = null;
    state = loadState();
    bank = loadBank();
    document.querySelector("main").inert = false;
    setSaveStatus("Saved on this device");
    renderAccountControls();
    render();
    return;
  }
  if (currentUser?.id === user.id && accountReady) {
    return;
  }

  clearHabitUndo();
  currentUser = user;
  accountReady = false;
  document.querySelector("main").inert = true;
  renderAccountControls();
  setSaveStatus("Loading your account…");
  showNotice("Loading your saved board…");
  try {
    const { data, error } = await supabaseClient
      .from("steady_user_data")
      .select("board_state")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      throw error;
    }

    let cloudStateNeedsUpgrade = false;
    if (data) {
      const accountBoard = migrateState(data.board_state);
      if (!accountBoard || !isValidState(accountBoard)) {
        throw new Error("The account board has an unsupported data format.");
      }
      if (accountBoard.bank !== undefined && !Array.isArray(accountBoard.bank)) {
        throw new Error("The account task bank has an unsupported data format.");
      }
      const accountBank = Array.isArray(accountBoard.bank)
        ? accountBoard.bank.map(normalizeBankTemplate)
        : [];
      if (accountBank.some((template) => !template)) {
        throw new Error("The account task bank contains an invalid template.");
      }
      bank = accountBank;
      state = { ...accountBoard };
      delete state.bank;
      cloudStateNeedsUpgrade = accountBoard !== data.board_state;
    } else {
      const localState = loadState();
      const localBank = loadBank();
      const copyLocalBoard = (hasBoardData(localState) || localBank.length > 0) && window.confirm(
        "This account has no saved board yet. Copy this device’s tasks, habits, and templates to the account? Choose Cancel to keep them only on this device."
      );
      state = copyLocalBoard ? localState : makeDefaultState();
      bank = copyLocalBoard ? localBank : [];
    }

    accountReady = true;
    document.querySelector("main").inert = false;
    render();
    if (data) {
      if (cloudStateNeedsUpgrade) {
        saveState();
        await cloudWriteQueue;
      } else {
        notice.hidden = true;
        setSaveStatus("Saved to your account");
      }
    } else if (hasBoardData(state)) {
      saveState();
      await cloudWriteQueue;
    } else {
      notice.hidden = true;
      setSaveStatus("Saved to your account");
    }
  } catch (error) {
    console.error("Could not load the account board.", error);
    showNotice("Your account board couldn’t be loaded. The board is locked to prevent overwriting your saved data. Check your connection, then reload.");
    setSaveStatus("Account unavailable");
  }
  renderAccountControls();
}

async function initializeAccount() {
  if (!supabaseClient) {
    return;
  }
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    const user = session?.user || null;
    if (isAccountSessionInitializing) {
      pendingAuthUser = user;
      return;
    }
    if (user?.id === currentUser?.id) {
      return;
    }
    window.setTimeout(() => {
      void activateAccount(user);
    }, 0);
  });
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      throw error;
    }
    const user = data.session?.user || pendingAuthUser;
    if (user) {
      await activateAccount(user);
    }
  } catch (error) {
    console.error("Could not check the account session.", error);
    showNotice("Your account session couldn’t be checked. Your saved board has not been changed.");
    if (pendingAuthUser) {
      await activateAccount(pendingAuthUser);
    }
  } finally {
    isAccountSessionInitializing = false;
  }
}

accountButton.addEventListener("click", () => {
  if (!supabaseClient) {
    showNotice(supabaseSetupError ||
      "Account saving is not configured yet. Follow the Supabase setup instructions to enable sign-in.");
    return;
  }
  renderAccountControls();
  if (typeof accountDialog.showModal === "function") {
    accountDialog.showModal();
  } else {
    showNotice("This browser does not support the account dialog. Please try a current browser.");
  }
});

document.querySelector("#auth-mode-toggle").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  authMessage.hidden = true;
  renderAccountControls();
});

document.querySelector("#open-password-change").addEventListener("click", () => {
  changePasswordForm.reset();
  passwordChangeMessage.hidden = true;
  changePasswordForm.hidden = false;
  document.querySelector("#open-password-change").hidden = true;
  resetPasswordVisibility();
  document.querySelector("#current-password").focus();
});

document.querySelector("#cancel-password-change").addEventListener("click", () => {
  changePasswordForm.reset();
  changePasswordForm.hidden = true;
  passwordChangeMessage.hidden = true;
  document.querySelector("#open-password-change").hidden = false;
  resetPasswordVisibility();
});

document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Hide" : "Show";
    const label = input.labels[0].textContent.trim().toLowerCase();
    button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${label}`);
    button.setAttribute("aria-pressed", String(visible));
  });
});

changePasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!changePasswordForm.reportValidity()) {
    return;
  }
  const currentPassword = changePasswordForm.elements.currentPassword.value;
  const newPassword = changePasswordForm.elements.newPassword.value;
  const confirmPassword = changePasswordForm.elements.confirmPassword.value;
  if (newPassword.length < 12) {
    showPasswordChangeMessage("Use a new password with at least 12 characters.");
    return;
  }
  if (newPassword !== confirmPassword) {
    showPasswordChangeMessage("The new password and confirmation don’t match.");
    return;
  }
  if (newPassword === currentPassword) {
    showPasswordChangeMessage("Choose a new password that differs from your current one.");
    return;
  }
  if (!currentUser?.email || !supabaseClient) {
    showPasswordChangeMessage("Sign in with an email and password account before changing your password.");
    return;
  }

  const submitButton = changePasswordForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  passwordChangeMessage.hidden = true;
  try {
    const { error: verificationError } = await supabaseClient.auth.signInWithPassword({
      email: currentUser.email,
      password: currentPassword,
    });
    if (verificationError) {
      showPasswordChangeMessage("Your current password couldn’t be verified. Check it and try again.");
      return;
    }

    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) {
      showPasswordChangeMessage("The password couldn’t be updated. Check the account password policy and try again.");
      return;
    }
    changePasswordForm.reset();
    resetPasswordVisibility();
    showPasswordChangeMessage("Your password has been updated.");
  } catch (error) {
    console.error("Could not change the account password.");
    showPasswordChangeMessage("We couldn’t complete the password change. Please try again.");
  } finally {
    submitButton.disabled = false;
  }
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    showAuthMessage(supabaseSetupError || "Account saving is not configured yet.");
    return;
  }
  const email = accountForm.elements.email.value.trim();
  const password = accountForm.elements.password.value;
  const submitButton = document.querySelector("#auth-submit");
  submitButton.disabled = true;
  authMessage.hidden = true;
  try {
    const result = authMode === "login"
      ? await supabaseClient.auth.signInWithPassword({ email, password })
      : await supabaseClient.auth.signUp({ email, password });
    if (result.error) {
      throw result.error;
    }
    if (authMode === "signup" && !result.data.session) {
      showAuthMessage("Check your email for a confirmation link, then return here to log in.");
      return;
    }
    accountDialog.close();
  } catch (error) {
    console.error("Account authentication failed.", error);
    showAuthMessage(error.message || "We couldn’t complete that account request. Please try again.");
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  await cloudWriteQueue;
  if (cloudWriteError && !window.confirm(
    "Your latest board changes may not have synced. Log out anyway?"
  )) {
    return;
  }
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      throw error;
    }
    accountDialog.close();
  } catch (error) {
    console.error("Could not sign out.", error);
    showNotice("You couldn’t be signed out. Please try again.");
  }
});

document.querySelector("#open-task-dialog").addEventListener("click", openNewTaskDialog);
document.querySelector("#empty-add-task").addEventListener("click", openNewTaskDialog);
document.querySelector("#open-habit-dialog").addEventListener("click", openNewHabitDialog);
document.querySelector("#open-bad-dialog").addEventListener("click", openNewBadHabitDialog);
document.querySelector("#open-bank-dialog").addEventListener("click", () => openBankEditor());
document.querySelector("#empty-add-template").addEventListener("click", () => openBankEditor());
document.querySelector("#choose-from-bank").addEventListener("click", openBankChooser);
document.querySelector("#bank-duration-enabled").addEventListener("change", (event) => {
  const fields = document.querySelector("#bank-duration-fields");
  fields.hidden = !event.currentTarget.checked;
  if (!fields.hidden) {
    requestAnimationFrame(() => bankDurationPicker.refresh());
  }
});
document.querySelector("#suggested-task-time").addEventListener("click", () => {
  taskTimeSelected = true;
  document.querySelector("#task-time-picker").hidden = true;
});
document.querySelector("#change-task-time").addEventListener("click", () => {
  const picker = document.querySelector("#task-time-picker");
  picker.hidden = false;
  document.querySelector("#task-start-at").focus();
});
document.querySelector("#confirm-task-time").addEventListener("click", () => {
  const timestamp = parseLocalDateTime(document.querySelector("#task-start-at").value);
  taskTimeSelected = timestamp !== null;
  updateTaskTimeLabel(timestamp);
  document.querySelector("#task-time-picker").hidden = true;
  document.querySelector("#suggested-task-time").focus();
});
document.querySelector("#task-start-at").addEventListener("input", (event) => {
  const timestamp = parseLocalDateTime(event.currentTarget.value);
  taskTimeSelected = timestamp !== null;
  updateTaskTimeLabel(timestamp);
});
document.querySelector("#undo-delete-habit").addEventListener("click", undoRemoveHabit);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close());
});
taskDialog.addEventListener("click", (event) => {
  if (event.target === taskDialog) {
    taskDialog.close();
  }
});
taskDialog.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    taskDialog.close();
  }
});
document.querySelector("#keep-task-going").addEventListener("click", () => cancelTaskDialog.close());
document.querySelector("#confirm-cancel-task").addEventListener("click", confirmCancelTask);
cancelTaskDialog.addEventListener("close", () => {
  pendingCancelTaskId = null;
});
cancelTaskDialog.addEventListener("click", (event) => {
  if (event.target === cancelTaskDialog) {
    cancelTaskDialog.close();
  }
});
document.querySelector("#continue-overtime").addEventListener("click", () => resolveOvertime(true));
document.querySelector("#finish-overtime").addEventListener("click", () => resolveOvertime(false));
overtimeDialog.addEventListener("cancel", (event) => event.preventDefault());

document.querySelector("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const name = form.elements.name.value.trim();
  const minutes = Number(form.elements.minutes.value);
  const scheduledAt = taskTimeSelected ? parseLocalDateTime(form.elements.startAt.value) : null;
  if (!name || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    showNotice("Add a task name and a duration between 1 and 1,440 minutes.");
    return;
  }
  if (!editingHabitId && taskTimeSelected && form.elements.startAt.value && scheduledAt === null) {
    showNotice("Choose a valid local date and time for this task.");
    return;
  }
  if (editingHabitId) {
    updateHabit(editingHabitId, name, minutes);
  } else if (editingTaskId) {
    updateTask(editingTaskId, { name, minutes, scheduledAt });
  } else {
    createTask({ name, minutes, scheduledAt, saveAsHabit: taskDialogEntryType === "habit" });
    if (taskDialogEntryType === "task" && document.querySelector("#save-task-to-bank").checked) {
      saveTaskToBank(name, minutes);
    }
  }
  editingTaskId = null;
  editingHabitId = null;
  taskDialogEntryType = "task";
  form.reset();
  taskDialog.close();
});

document.querySelector("#bank-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const title = form.elements.title.value.trim();
  const durationEnabled = form.elements.durationEnabled.checked;
  const minutes = durationEnabled ? Number(form.elements.minutes.value) : null;
  if (!title || (durationEnabled && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440))) {
    showNotice("Add a template title and choose a duration between 1 and 1,440 minutes.");
    return;
  }
  const duplicate = bank.find(
    (template) =>
      template.id !== editingBankId &&
      template.title.toLocaleLowerCase() === title.toLocaleLowerCase()
  );
  if (duplicate) {
    showNotice("A template with that title already exists. Choose a different title.");
    return;
  }
  const template = {
    id: editingBankId || createId(),
    title,
    minutes,
    category: form.elements.category.value.trim(),
    notes: form.elements.notes.value.trim(),
  };
  const existingIndex = bank.findIndex((item) => item.id === template.id);
  if (existingIndex === -1) {
    bank.unshift(template);
  } else {
    bank[existingIndex] = template;
  }
  const saved = saveBank();
  render();
  bankDialog.close();
  editingBankId = null;
  if (saved) {
    showFeedbackToast(existingIndex === -1 ? "Template saved" : "Template updated");
  }
});

document.querySelector("#bad-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const name = form.elements.name.value.trim();
  if (!name) {
    showNotice("Add a name for the habit you’d like to change.");
    return;
  }
  if (editingBadHabitId) {
    updateBadHabit(editingBadHabitId, name);
  } else {
    addBadHabit(name);
  }
  editingBadHabitId = null;
  form.reset();
  badDialog.close();
});

document.querySelector("#sound-toggle").addEventListener("click", () => {
  state.soundOn = !state.soundOn;
  saveState();
  render();
});

document.querySelector("#new-quote").addEventListener("click", renderNextQuote);

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});
activateTab(loadActiveTab(), false);

document.addEventListener("pointerover", (event) => {
  const badge = event.target.closest(".status-badge[data-tooltip]");
  if (badge && !badge.contains(event.relatedTarget)) {
    badge.dataset.tooltip = taskMessage(badge.className.includes("status-green") ? "green" : badge.className.includes("status-yellow") ? "yellow" : badge.className.includes("status-red") ? "red" : "gray");
    badge.setAttribute("aria-label", `${badge.textContent}. ${badge.dataset.tooltip}`);
  }
});

renderNextQuote();
renderAccountControls();
initializeSummaryBar();
void initializeAccount().then(() => {
  if (currentUser && !accountReady) {
    return;
  }
  checkDayBoundary();
  activateDueTasks();
  render();
  updateLiveTimers();
});
window.setInterval(() => {
  activateDueTasks();
  updateLiveTimers();
}, 1000);
window.setInterval(checkDayBoundary, 15000);
