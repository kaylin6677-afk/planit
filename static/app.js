// Georgia Student Planner - dashboard front-end

let classes = [];             // [{id, name, color, visible, source}]
let scope = "day";            // "day" | "month"
let selectedDay = new Date(); // used by both the Daily to-do list and the calendar's clicked day
let calCursor = new Date();   // which month the calendar is showing
let activeTimerTask = null;
let timerSecondsLeft = 0;
let timerInterval = null;
let timerRunning = false;

function isoDate(d) { return d.toISOString().slice(0, 10); }
function isoMonth(d) { return d.toISOString().slice(0, 7); }

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[s]);
}

document.querySelectorAll(".side-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".side-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.remove("hidden");
    if (btn.dataset.view === "calendar") renderCalendar();
    if (btn.dataset.view === "todo") renderTodo();
  });
});

async function loadMe() {
  const res = await fetch("/api/me");
  if (res.status === 401) { window.location.href = "/login"; return; }
  const data = await res.json();
  document.getElementById("account-info").textContent = `${data.name} · ${data.email}`;
  const badge = document.getElementById("canvas-badge");
  if (data.canvasConnected) {
    badge.textContent = "Live · " + data.canvasDomain;
    badge.className = "badge live";
    document.getElementById("canvas-domain").value = data.canvasDomain;
  } else {
    badge.textContent = "Not connected";
    badge.className = "badge demo";
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

document.getElementById("connect-canvas").addEventListener("click", async () => {
  const domain = document.getElementById("canvas-domain").value.trim();
  const token = document.getElementById("canvas-token").value.trim();
  const statusEl = document.getElementById("canvas-status");
  if (!domain || !token) {
    statusEl.textContent = "Please fill in both fields.";
    statusEl.className = "status err";
    return;
  }
  statusEl.textContent = "Connecting...";
  statusEl.className = "status";
  const connectRes = await fetch("/api/canvas/connect", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain, token }),
  });
  const connectData = await connectRes.json();
  if (!connectRes.ok) {
    statusEl.textContent = connectData.error || "Something went wrong.";
    statusEl.className = "status err";
    return;
  }
  const syncRes = await fetch("/api/canvas/sync", { method: "POST" });
  const syncData = await syncRes.json();
  if (!syncRes.ok) {
    statusEl.textContent = syncData.error || "Connected, but sync failed.";
    statusEl.className = "status err";
    return;
  }
  statusEl.textContent = `Connected! Imported ${syncData.imported} item(s) from Canvas.`;
  statusEl.className = "status ok";
  await loadMe();
  await loadClasses();
  await refreshCurrentView();
  await loadBattery();
});

document.getElementById("sync-demo").addEventListener("click", async () => {
  for (const platform of ["infinite-campus", "gavs", "fva"]) {
    await fetch(`/api/mock/${platform}/sync`, { method: "POST" });
  }
  await loadClasses();
  await refreshCurrentView();
});

async function loadClasses() {
  const res = await fetch("/api/classes");
  const data = await res.json();
  classes = data.classes;
  renderClassChips();
  renderSettingsClasses();
  renderClassDatalist();
}

function renderClassChips() {
  for (const rowId of ["class-chip-row", "class-chip-row-cal"]) {
    const row = document.getElementById(rowId);
    if (!row) continue;
    if (classes.length === 0) { row.innerHTML = ""; continue; }
    row.innerHTML = classes.map(c => `
      <div class="class-chip ${c.visible ? "" : "off"}" data-id="${c.id}">
        <span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)}
      </div>
    `).join("");
    row.querySelectorAll(".class-chip").forEach(chip => {
      chip.addEventListener("click", () => toggleClassVisible(parseInt(chip.dataset.id)));
    });
  }
}

async function toggleClassVisible(classId) {
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;
  cls.visible = !cls.visible;
  renderClassChips();
  await fetch(`/api/classes/${classId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visible: cls.visible }),
  });
  await refreshCurrentView();
}

function renderSettingsClasses() {
  const el = document.getElementById("settings-class-list");
  if (classes.length === 0) {
    el.innerHTML = `<p class="muted">No classes yet — add a to-do with a class name, or connect Canvas / load demo data.</p>`;
    return;
  }
  el.innerHTML = classes.map(c => `
    <div class="class-row">
      <input type="color" value="${c.color}" data-id="${c.id}" class="class-color-input">
      <span class="class-name">${escapeHtml(c.name)} <span class="source-tag">(${c.source})</span></span>
      <label class="checkbox-label" style="margin:0;">
        <input type="checkbox" class="class-visible-input" data-id="${c.id}" ${c.visible ? "checked" : ""}> Show
      </label>
    </div>
  `).join("");

  el.querySelectorAll(".class-color-input").forEach(input => {
    input.addEventListener("change", async () => {
      const id = parseInt(input.dataset.id);
      await fetch(`/api/classes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: input.value }),
      });
      await loadClasses();
      await refreshCurrentView();
    });
  });
  el.querySelectorAll(".class-visible-input").forEach(input => {
    input.addEventListener("change", async () => {
      const id = parseInt(input.dataset.id);
      await fetch(`/api/classes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: input.checked }),
      });
      await loadClasses();
      await refreshCurrentView();
    });
  });
}

function renderClassDatalist() {
  const dl = document.getElementById("class-options");
  dl.innerHTML = classes.map(c => `<option value="${escapeHtml(c.name)}">`).join("");
}

function classColor(classId) {
  const c = classes.find(cl => cl.id === classId);
  return c ? c.color : "#9aa1ad";
}

async function loadBattery() {
  const res = await fetch("/api/energy/today");
  const data = await res.json();
  document.getElementById("battery-fill").style.width = data.battery + "%";
  document.getElementById("battery-text").textContent = data.battery + "%";
  const fill = document.getElementById("battery-fill");
  fill.style.background = data.battery > 50 ? "var(--good)" : data.battery > 20 ? "var(--warn)" : "var(--danger)";
}

document.querySelectorAll(".seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    scope = btn.dataset.scope;
    renderTodo();
  });
});

function taskItemHtml(t, opts = {}) {
  const cls = classes.find(c => c.id === t.classId);
  const classChip = cls ? `<span class="chip"><span class="dot" style="background:${cls.color}"></span>${escapeHtml(cls.name)}</span>` : "";
  const energyChip = `<span class="energy-chip energy-${t.energy}">${t.energy}</span>`;
  const timeChip = t.timeMinutes ? `<span class="muted">${t.timeMinutes} min</span>` : "";
  const dueChip = (!opts.hideDue && t.dueDate) ? `<span class="muted">due ${t.dueDate}</span>` : "";
  return `
    <div class="todo-item ${t.done ? "done" : ""}" data-id="${t.id}">
      <input type="checkbox" data-id="${t.id}" ${t.done ? "checked" : ""}>
      <div class="todo-main">
        <div class="todo-title">${escapeHtml(t.title)}</div>
        <div class="todo-meta">${classChip}${energyChip}${timeChip}${dueChip}</div>
      </div>
      <button class="timer-btn" data-timer-id="${t.id}">▶ Focus</button>
    </div>
  `;
}

function bindTaskEvents(container, allTasks) {
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", async () => {
      const id = parseInt(cb.dataset.id);
      await fetch(`/api/tasks/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: cb.checked }),
      });
      await loadBattery();
      await refreshCurrentView();
    });
  });
  container.querySelectorAll(".timer-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.timerId);
      const task = allTasks.find(t => t.id === id);
      if (task) openTimer(task);
    });
  });
}

async function renderTodo() {
  document.getElementById("todo-list-label").textContent = scope === "day"
    ? (isoDate(selectedDay) === isoDate(new Date()) ? "Today" : selectedDay.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))
    : selectedDay.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const recurringSection = document.getElementById("recurring-section");
  recurringSection.style.display = scope === "day" ? "" : "none";

  let tasks = [];
  if (scope === "day") {
    const res = await fetch(`/api/tasks?scope=day&date=${isoDate(selectedDay)}`);
    tasks = (await res.json()).tasks;
  } else {
    const res = await fetch(`/api/tasks?scope=month&month=${isoMonth(selectedDay)}`);
    tasks = (await res.json()).tasks;
  }

  const recurring = tasks.filter(t => t.recurring);
  const oneOff = tasks.filter(t => !t.recurring);

  const recurringList = document.getElementById("recurring-list");
  recurringList.innerHTML = recurring.length
    ? recurring.map(t => taskItemHtml(t, { hideDue: true })).join("")
    : `<p class="empty-state">No daily habits yet.</p>`;
  bindTaskEvents(recurringList, tasks);

  const list = document.getElementById("todo-list");
  const sorted = [...oneOff].sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  list.innerHTML = sorted.length
    ? sorted.map(t => taskItemHtml(t, { hideDue: scope === "day" })).join("")
    : `<p class="empty-state">Nothing here yet. Tap "+ Add to-do" or connect Canvas in Settings.</p>`;
  bindTaskEvents(list, tasks);
}

document.getElementById("open-add-task").addEventListener("click", () => openAddTask());

const addModal = document.getElementById("add-task-modal");

function openAddTask() {
  document.getElementById("task-title").value = "";
  document.getElementById("task-class").value = "";
  document.getElementById("task-energy").value = "medium";
  document.getElementById("task-time").value = "";
  document.getElementById("task-recurring").checked = false;
  document.getElementById("task-due").value = isoDate(selectedDay);
  document.getElementById("due-date-row").style.display = "";
  document.getElementById("add-task-error").textContent = "";
  addModal.classList.remove("hidden");
}
document.getElementById("cancel-add-task").addEventListener("click", () => addModal.classList.add("hidden"));

document.getElementById("task-recurring").addEventListener("change", (e) => {
  document.getElementById("due-date-row").style.display = e.target.checked ? "none" : "";
});

document.getElementById("save-task").addEventListener("click", async () => {
  const title = document.getElementById("task-title").value.trim();
  const errEl = document.getElementById("add-task-error");
  if (!title) { errEl.textContent = "Please enter a title."; return; }

  const recurring = document.getElementById("task-recurring").checked;
  const payload = {
    title,
    className: document.getElementById("task-class").value.trim(),
    energy: document.getElementById("task-energy").value,
    timeMinutes: document.getElementById("task-time").value ? parseInt(document.getElementById("task-time").value) : null,
    recurring,
    dueDate: recurring ? null : (document.getElementById("task-due").value || null),
  };

  const res = await fetch("/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) { errEl.textContent = data.error || "Something went wrong."; return; }

  addModal.classList.add("hidden");
  await loadClasses();
  await refreshCurrentView();
});

const timerModal = document.getElementById("timer-modal");

function openTimer(task) {
  activeTimerTask = task;
  timerSecondsLeft = (task.timeMinutes || 25) * 60;
  timerRunning = false;
  clearInterval(timerInterval);
  document.getElementById("timer-task-title").textContent = "Focus: " + task.title;
  document.getElementById("timer-start").classList.remove("hidden");
  document.getElementById("timer-pause").classList.add("hidden");
  updateTimerDisplay();
  timerModal.classList.remove("hidden");
}

function updateTimerDisplay() {
  const m = Math.floor(timerSecondsLeft / 60).toString().padStart(2, "0");
  const s = (timerSecondsLeft % 60).toString().padStart(2, "0");
  document.getElementById("timer-display").textContent = `${m}:${s}`;
}

document.getElementById("timer-start").addEventListener("click", () => {
  timerRunning = true;
  document.getElementById("timer-start").classList.add("hidden");
  document.getElementById("timer-pause").classList.remove("hidden");
  timerInterval = setInterval(() => {
    if (timerSecondsLeft <= 0) {
      clearInterval(timerInterval);
      document.getElementById("timer-display").textContent = "Time's up!";
      return;
    }
    timerSecondsLeft--;
    updateTimerDisplay();
  }, 1000);
});
document.getElementById("timer-pause").addEventListener("click", () => {
  timerRunning = false;
  clearInterval(timerInterval);
  document.getElementById("timer-pause").classList.add("hidden");
  document.getElementById("timer-start").classList.remove("hidden");
});
document.getElementById("timer-close").addEventListener("click", () => {
  clearInterval(timerInterval);
  timerModal.classList.add("hidden");
});

document.getElementById("cal-prev").addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
});

async function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  const label = document.getElementById("cal-month-label");
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  label.textContent = calCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const res = await fetch(`/api/tasks?scope=month&month=${isoMonth(calCursor)}`);
  const tasks = (await res.json()).tasks;

  const byDate = {};
  for (const t of tasks) {
    if (!t.dueDate) continue;
    (byDate[t.dueDate] = byDate[t.dueDate] || []).push(t);
  }

  const firstOfMonth = new Date(year, month, 1);
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = isoDate(new Date());
  const selectedKey = isoDate(selectedDay);

  let html = "";
  ["S", "M", "T", "W", "T", "F", "S"].forEach(d => html += `<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const k = isoDate(d);
    const items = byDate[k] || [];
    const classesEl = ["cal-day"];
    if (k === todayKey) classesEl.push("today");
    if (k === selectedKey) classesEl.push("selected");
    const dots = items.slice(0, 5).map(t => `<span class="dot" style="background:${classColor(t.classId)}"></span>`).join("");
    html += `
      <div class="${classesEl.join(" ")}" data-date="${k}">
        <div class="day-num">${day}</div>
        <div class="dot-row">${dots}</div>
      </div>
    `;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".cal-day[data-date]").forEach(el => {
    el.addEventListener("click", () => {
      selectedDay = new Date(el.dataset.date + "T00:00:00");
      renderCalendar();
      showDayDetail(byDate[el.dataset.date] || [], el.dataset.date);
    });
  });
}

function showDayDetail(items, dateKey) {
  const el = document.getElementById("day-detail");
  const label = new Date(dateKey + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  if (items.length === 0) {
    el.innerHTML = `<h3>${label}</h3><p class="muted">Nothing due this day.</p>`;
  } else {
    el.innerHTML = `<h3>${label}</h3>` + items.map(t => taskItemHtml(t, { hideDue: true })).join("");
    bindTaskEvents(el, items);
  }
  el.classList.remove("hidden");
}

async function refreshCurrentView() {
  await loadBattery();
  const activeView = document.querySelector(".side-btn.active")?.dataset.view;
  if (activeView === "calendar") await renderCalendar();
  else if (activeView === "todo" || !activeView) await renderTodo();
}

(async function init() {
  await loadMe();
  await loadClasses();
  await loadBattery();
  await renderTodo();
})();
