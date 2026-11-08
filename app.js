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
let activePauseId = null;
let state = loadState();

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
    version: 1,
    dayKey: todayKey(),
    tasks: [],
    habits: [],
    badHabits: [],
    history: [],
    soundOn: false,
  };
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
}

function isValidState(value) {
  return (
    value &&
    value.version === 1 &&
    typeof value.dayKey === "string" &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.habits) &&
    Array.isArray(value.badHabits) &&
    Array.isArray(value.history) &&
    typeof value.soundOn === "boolean"
  );
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

  if (!isValidState(parsed)) {
    showNotice("Saved data is from an unsupported version. A fresh board is open.");
    return makeDefaultState();
  }
  return parsed;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    notice.hidden = true;
  } catch (error) {
    console.error("Could not save the habit board.", error);
    showNotice("Your browser couldn’t save this change. The board will stay available until you close this page.");
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

function taskColor(task, now = Date.now()) {
  if (task.status === "done") {
    return task.outcome || "gray";
  }
  if (task.status === "missed") {
    return "gray";
  }
  const remaining = task.createdAt + task.durationMs - now;
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

function createTask({ name, minutes, habitId = null, saveAsHabit = false }) {
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
    status: "active",
    outcome: null,
    completedAt: null,
    habitId: linkedHabitId,
  });
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
  playChime();
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
  state.badHabits.push({ id: createId(), name, avoided: false });
  saveState();
  render();
}

function toggleAvoided(habitId) {
  const habit = state.badHabits.find((item) => item.id === habitId);
  if (!habit) {
    return;
  }
  habit.avoided = !habit.avoided;
  saveState();
  render();
  if (habit.avoided) {
    playChime();
  }
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
  const remaining = task.createdAt + task.durationMs - Date.now();
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
  if (active) {
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
  badge.textContent = active
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
  main.append(progress);
  card.append(main);

  const actions = makeElement("div", "task-actions");
  if (active) {
    const done = makeElement("button", "done-button", "Done");
    done.type = "button";
    done.setAttribute("aria-label", `Mark ${task.name} complete`);
    done.addEventListener("click", () => finishTask(task.id));
    actions.append(done);
  }
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
    button.textContent = todayTask.status === "done" ? "Done today" : "In progress";
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
  const status = makeElement(
    "span",
    `bad-habit-status${habit.avoided ? " is-resisted" : ""}`,
    habit.avoided ? "Avoided today · Green" : "Your check-in is open"
  );
  info.append(status);
  top.append(info);

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

  const urge = makeElement("button", "urge-button", activePauseId === habit.id ? "Close pause" : "I feel an urge");
  urge.type = "button";
  urge.setAttribute("aria-expanded", String(activePauseId === habit.id));
  urge.addEventListener("click", () => {
    activePauseId = activePauseId === habit.id ? null : habit.id;
    render();
  });
  buttons.append(urge);
  item.append(buttons);

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
    previousItems.push({
      name: habit.name,
      color: habit.avoided ? "green" : "gray",
      label: habit.avoided ? "Avoided · Green" : "No check-in · Gray",
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
    const remaining = task.createdAt + task.durationMs - Date.now();
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
  const previousTasks = state.tasks.map((task) =>
    Object.assign({}, task, {
      status: task.status === "active" ? "missed" : task.status,
      outcome: task.status === "active" ? "gray" : task.outcome,
    })
  );
  const previousBadHabits = state.badHabits.map((habit) => ({
    name: habit.name,
    avoided: habit.avoided,
  }));
  if (previousTasks.length > 0 || previousBadHabits.length > 0) {
    state.history.unshift({
      dayKey: state.dayKey,
      tasks: previousTasks,
      badHabits: previousBadHabits,
    });
    state.history = state.history.slice(0, 7);
  }
  state.dayKey = newDayKey;
  state.tasks = [];
  state.badHabits = state.badHabits.map((habit) => Object.assign({}, habit, { avoided: false }));
  activePauseId = null;
  saveState();
  render();
}

function checkDayBoundary() {
  const currentDay = todayKey();
  if (state.dayKey !== currentDay) {
    archiveCurrentDay(currentDay);
  }
}

function playChime() {
  if (!state.soundOn) {
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    showNotice("This browser does not support the optional success sound.");
    return;
  }
  try {
    const context = new AudioContextClass();
    const now = context.currentTime;
    [659.25, 783.99].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.11;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.045, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.21);
    });
    window.setTimeout(() => context.close(), 550);
  } catch (error) {
    console.error("The optional success sound could not be played.", error);
    showNotice("The optional success sound couldn’t be played in this browser.");
  }
}

function openDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    showNotice("This browser does not support the add-task dialog. Please try a current browser.");
  }
}

document.querySelector("#open-task-dialog").addEventListener("click", () => openDialog(taskDialog));
document.querySelector("#empty-add-task").addEventListener("click", () => openDialog(taskDialog));
document.querySelector("#open-bad-dialog").addEventListener("click", () => openDialog(badDialog));
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
  if (!name || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    showNotice("Add a task name and a duration between 1 and 1,440 minutes.");
    return;
  }
  createTask({ name, minutes, saveAsHabit: form.elements.saveAsHabit.checked });
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
  addBadHabit(name);
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
checkDayBoundary();
render();
window.setInterval(updateLiveTimers, 1000);
window.setInterval(checkDayBoundary, 15000);
