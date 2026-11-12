const STORAGE_KEY = "steady-habit-board-v1";
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
const QUOTES = [
  "You don’t have to do it all. Just the next little thing.",
  "Progress can be quiet. It still counts.",
  "Begin where you are. One small step is enough.",
  "A kinder pace is still a pace forward.",
  "You’re allowed to make today easier for yourself.",
];
const REPLACEMENTS = ["Drink some water", "Stretch for 30 seconds", "Step outside for a moment"];

const taskDialog = document.querySelector("#task-dialog");
const badDialog = document.querySelector("#bad-dialog");
const taskList = document.querySelector("#task-list");
const routineList = document.querySelector("#routine-list");
const badHabitList = document.querySelector("#bad-habit-list");
const notice = document.querySelector("#storage-notice");
const saveStatus = document.querySelector("#save-status");
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
let editingBadHabitId = null;
let audioContext = null;
let activeOscillators = [];
let audioUnavailableNotified = false;
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
    version: 2,
    dayKey: todayKey(),
    tasks: [],
    habits: [],
    badHabits: [],
    history: [],
    soundOn: true,
  };
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function setSaveStatus(message) {
  saveStatus.textContent = message;
}

function isValidState(value) {
  return (
    value &&
    value.version === 2 &&
    typeof value.dayKey === "string" &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.habits) &&
    Array.isArray(value.badHabits) &&
    Array.isArray(value.history) &&
    typeof value.soundOn === "boolean"
  );
}

function migrateState(value) {
  if (
    !value ||
    (value.version !== 1 && value.version !== 2) ||
    typeof value.dayKey !== "string" ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.habits) ||
    !Array.isArray(value.badHabits) ||
    !Array.isArray(value.history) ||
    typeof value.soundOn !== "boolean"
  ) {
    return null;
  }
  if (value.version === 2) {
    return value;
  }

  return {
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

function taskColor(task, now = Date.now()) {
  if (task.status === "done") {
    return task.outcome || "gray";
  }
  if (task.status === "missed" || task.status === "scheduled") {
    return "gray";
  }
  const remaining = (task.scheduledAt ?? task.createdAt) + task.durationMs - now;
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
    status: scheduledAt > now ? "scheduled" : "active",
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
  task.name = name;
  task.minutes = minutes;
  task.durationMs = minutes * 60 * 1000;
  task.scheduledAt = scheduledAt;
  if (task.status === "scheduled" || task.status === "active") {
    task.status = scheduledAt > Date.now() ? "scheduled" : "active";
  }
  saveState();
  render();
}

function finishTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.status !== "active") {
    return;
  }
  task.outcome = taskColor(task);
  task.status = "done";
  task.completedAt = Date.now();
  saveState();
  render();
  void playSound("task-completed");
}

function removeTask(taskId) {
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
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
  const color = taskColor(task);
  const active = task.status === "active";
  const scheduled = task.status === "scheduled";
  const remaining = (task.scheduledAt ?? task.createdAt) + task.durationMs - Date.now();
  const remainingRatio = active ? Math.min(1, Math.max(0, remaining / task.durationMs)) : 0;
  const card = makeElement(
    "article",
    `task-card tone-${color}${task.status === "done" ? " is-finished" : ""}${task.status === "missed" ? " is-missed" : ""}`
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
  } else if (active) {
    timer.textContent = remaining > 0 ? `${formatDuration(remaining)} left` : `${formatDuration(-remaining)} overdue`;
  } else if (task.status === "done") {
    timer.textContent = `Finished in ${colorLabel(color).toLowerCase()} time`;
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
  if (active) {
    const done = makeElement("button", "done-button", "Done");
    done.type = "button";
    done.setAttribute("aria-label", `Mark ${task.name} complete`);
    done.addEventListener("click", () => finishTask(task.id));
    actions.append(done);
  }
  const edit = makeElement("button", "icon-button", "✎");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${task.name}`);
  edit.addEventListener("click", () => openTaskEditor(task.id));
  actions.append(edit);

  const remove = makeElement("button", "icon-button", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", `Remove ${task.name}`);
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
  item.append(info);

  const todayTask = state.tasks.find((task) => task.habitId === habit.id && task.status !== "missed");
  const button = makeElement("button", todayTask ? "button button-secondary" : "button button-primary");
  button.type = "button";
  if (todayTask) {
    button.textContent = todayTask.status === "done"
      ? "Done today"
      : todayTask.status === "scheduled" ? "Scheduled" : "In progress";
    button.disabled = true;
  } else {
    button.textContent = "Start today";
    button.setAttribute("aria-label", `Start ${habit.name} today`);
    button.addEventListener("click", () => startRoutine(habit));
  }
  item.append(button);
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

function renderYesterday() {
  const panel = document.querySelector("#yesterday-panel");
  const list = document.querySelector("#yesterday-list");
  list.replaceChildren();
  const previousDay = state.history[0];
  if (!previousDay || (previousDay.tasks.length === 0 && !(previousDay.badHabits || []).length)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const date = new Date(`${previousDay.dayKey}T12:00:00`);
  document.querySelector("#yesterday-title").textContent = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const previousItems = previousDay.tasks.map((task) => {
    const color = task.status === "done" ? task.outcome || "gray" : "gray";
    return {
      name: task.name,
      color,
      label: task.status === "done" ? `Done · ${colorLabel(color)}` : "Missed · Gray",
    };
  });
  for (const habit of previousDay.badHabits || []) {
    const color = habit.avoided ? "green" : "gray";
    previousItems.push({
      name: habit.name,
      color,
      label: habit.avoided
        ? "Avoided · Green"
        : habit.checkedIn ? "Checked in · A new chance tomorrow" : "No check-in · Gray",
    });
  }
  for (const item of previousItems.slice(0, 5)) {
    const row = makeElement("div", "yesterday-item");
    row.append(makeElement("span", "", item.name));
    const badge = makeElement("span", `status-badge status-${item.color}`, item.label);
    badge.tabIndex = 0;
    badge.dataset.tooltip = taskMessage(item.color);
    badge.setAttribute("aria-label", `${badge.textContent}. ${badge.dataset.tooltip}`);
    row.append(badge);
    list.append(row);
  }
  if (previousItems.length > 5) {
    list.append(makeElement("p", "form-hint", `And ${previousItems.length - 5} more from that day.`));
  }
}

function updateSummary() {
  const doneTasks = state.tasks.filter((task) => task.status === "done").length;
  const activeTasks = state.tasks.filter((task) => task.status === "active").length;
  const resisted = state.badHabits.filter((habit) => habit.avoided).length;
  document.querySelector("#done-count").textContent = String(doneTasks);
  document.querySelector("#active-count").textContent = String(activeTasks);
  document.querySelector("#resisted-count").textContent = String(resisted);
}

function render() {
  document.querySelector("#today-label").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  taskList.replaceChildren(...state.tasks.map(buildTaskCard));
  document.querySelector("#task-empty").hidden = state.tasks.length > 0;

  routineList.replaceChildren(...state.habits.map(buildRoutineItem));
  document.querySelector("#routine-count").textContent = `${state.habits.length} saved`;
  document.querySelector("#routine-empty").hidden = state.habits.length > 0;

  badHabitList.replaceChildren(...state.badHabits.map(buildBadHabitItem));
  document.querySelector("#bad-habit-empty").hidden = state.badHabits.length > 0;
  updateSummary();
  renderYesterday();

  const soundToggle = document.querySelector("#sound-toggle");
  soundToggle.setAttribute("aria-pressed", String(state.soundOn));
  document.querySelector("#sound-label").textContent = state.soundOn ? "Sound on" : "Sound off";
  document.querySelector("#sound-icon").textContent = state.soundOn ? "♫" : "♪";
}

function updateLiveTimers() {
  for (const task of state.tasks) {
    if (task.status !== "active") {
      continue;
    }
    const remaining = (task.scheduledAt ?? task.createdAt) + task.durationMs - Date.now();
    const color = taskColor(task);
    const card = document.querySelector(`#task-${CSS.escape(task.id)}`);
    if (!card) {
      continue;
    }
    card.classList.remove("tone-green", "tone-yellow", "tone-red");
    card.classList.add(`tone-${color}`);

    const timer = card.querySelector(`[data-timer-for="${CSS.escape(task.id)}"]`);
    timer.textContent = remaining > 0 ? `${formatDuration(remaining)} left` : `${formatDuration(-remaining)} overdue`;

    const badge = card.querySelector(`[data-status-for="${CSS.escape(task.id)}"]`);
    badge.className = `status-badge status-${color}`;
    badge.textContent = remaining <= 0 ? "Overdue" : `${colorLabel(color)} zone`;
    badge.dataset.tooltip = taskMessage(color);
    badge.setAttribute("aria-label", `${badge.textContent}. ${badge.dataset.tooltip}`);

    const fill = card.querySelector(`[data-progress-for="${CSS.escape(task.id)}"]`);
    const ratio = Math.min(1, Math.max(0, remaining / task.durationMs));
    fill.style.width = `${ratio * 100}%`;
    card.querySelector('[role="progressbar"]').setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
}

function archiveCurrentDay(newDayKey) {
  const now = Date.now();
  const carriedTasks = state.tasks.filter((task) =>
    task.status === "scheduled" &&
    (task.scheduledAt > now || todayKey(new Date(task.scheduledAt)) === newDayKey)
  ).map((task) => Object.assign({}, task, {
    status: task.scheduledAt <= now ? "active" : task.status,
  }));
  const previousTasks = state.tasks.filter((task) => !carriedTasks.some((carried) => carried.id === task.id)).map((task) =>
    Object.assign({}, task, {
      status: task.status === "active" || task.status === "scheduled" ? "missed" : task.status,
      outcome: task.status === "active" || task.status === "scheduled" ? "gray" : task.outcome,
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

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    showNotice("This browser does not support the add-task dialog. Please try a current browser.");
  }
}

function openNewTaskDialog() {
  editingTaskId = null;
  const form = document.querySelector("#task-form");
  form.reset();
  document.querySelector("#task-dialog-title").textContent = "Add a task";
  form.querySelector('[type="submit"]').textContent = "Add to today";
  document.querySelector("#save-as-habit-row").hidden = false;
  openDialog(taskDialog);
}

function openTaskEditor(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  editingTaskId = taskId;
  const form = document.querySelector("#task-form");
  form.elements.name.value = task.name;
  form.elements.minutes.value = String(task.minutes);
  form.elements.startAt.value = task.scheduledAt ? toLocalDateTimeInput(task.scheduledAt) : "";
  document.querySelector("#task-dialog-title").textContent = "Edit task";
  form.querySelector('[type="submit"]').textContent = "Save changes";
  document.querySelector("#save-as-habit-row").hidden = true;
  openDialog(taskDialog);
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
    boardState.history.length > 0;
}

async function activateAccount(user) {
  if (!user) {
    if (!currentUser) {
      return;
    }
    currentUser = null;
    accountReady = true;
    cloudWriteError = null;
    state = loadState();
    document.querySelector("main").inert = false;
    setSaveStatus("Saved on this device");
    renderAccountControls();
    render();
    return;
  }
  if (currentUser?.id === user.id && accountReady) {
    return;
  }

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
      state = accountBoard;
      cloudStateNeedsUpgrade = accountBoard !== data.board_state;
    } else {
      const localState = loadState();
      const copyLocalBoard = hasBoardData(localState) && window.confirm(
        "This account has no saved board yet. Copy this device’s current tasks and habits to the account? Choose Cancel to keep them only on this device."
      );
      state = copyLocalBoard ? localState : makeDefaultState();
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
document.querySelector("#open-bad-dialog").addEventListener("click", openNewBadHabitDialog);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`).close());
});

document.querySelector("#task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) {
    return;
  }
  const name = form.elements.name.value.trim();
  const minutes = Number(form.elements.minutes.value);
  const scheduledAt = parseLocalDateTime(form.elements.startAt.value);
  if (!name || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    showNotice("Add a task name and a duration between 1 and 1,440 minutes.");
    return;
  }
  if (form.elements.startAt.value && scheduledAt === null) {
    showNotice("Choose a valid local date and time for this task.");
    return;
  }
  if (editingTaskId) {
    updateTask(editingTaskId, { name, minutes, scheduledAt });
  } else {
    createTask({ name, minutes, scheduledAt, saveAsHabit: form.elements.saveAsHabit.checked });
  }
  editingTaskId = null;
  form.reset();
  taskDialog.close();
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

document.querySelector("#new-quote").addEventListener("click", () => {
  const current = document.querySelector("#quote-text").textContent;
  const options = QUOTES.filter((quote) => quote !== current);
  document.querySelector("#quote-text").textContent = options[Math.floor(Math.random() * options.length)];
});

document.addEventListener("pointerover", (event) => {
  const badge = event.target.closest(".status-badge[data-tooltip]");
  if (badge && !badge.contains(event.relatedTarget)) {
    badge.dataset.tooltip = taskMessage(badge.className.includes("status-green") ? "green" : badge.className.includes("status-yellow") ? "yellow" : badge.className.includes("status-red") ? "red" : "gray");
    badge.setAttribute("aria-label", `${badge.textContent}. ${badge.dataset.tooltip}`);
  }
});

document.querySelector("#quote-text").textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
renderAccountControls();
void initializeAccount().then(() => {
  if (currentUser && !accountReady) {
    return;
  }
  checkDayBoundary();
  activateDueTasks();
  render();
});
window.setInterval(() => {
  activateDueTasks();
  updateLiveTimers();
}, 1000);
window.setInterval(checkDayBoundary, 15000);
