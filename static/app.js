let allAssignments = [];
let doneIds = new Set(JSON.parse(localStorage.getItem("doneIds") || "[]"));
let calCursor = new Date();
let selectedDateKey = null;

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.remove("hidden");
    if (btn.dataset.view === "calendar") renderCalendar();
  });
});

const savedDomain = localStorage.getItem("canvasDomain");
const savedToken = localStorage.getItem("canvasToken");
if (savedDomain) document.getElementById("canvas-domain").value = savedDomain;
if (savedToken) document.getElementById("canvas-token").value = savedToken;

document.getElementById("connect-canvas").addEventListener("click", connectCanvas);

async function connectCanvas() {
  const domain = document.getElementById("canvas-domain").value.trim();
  const token = document.getElementById("canvas-token").value.trim();
  const statusEl = document.getElementById("canvas-status");
  if (!domain || !token) {
    statusEl.textContent = "Please fill in both fields.";
    statusEl.className = "status err";
    return;
  }
  localStorage.setItem("canvasDomain", domain);
  localStorage.setItem("canvasToken", token);
  statusEl.textContent = "Connecting...";
  statusEl.className = "status";
  try {
    const res = await fetch(`/api/canvas/assignments?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || "Something went wrong connecting to Canvas.";
      statusEl.className = "status err";
      return;
    }
    statusEl.textContent = `Connected! Found ${data.assignments.length} upcoming item(s) from Canvas.`;
    statusEl.className = "status ok";
    allAssignments = allAssignments.filter(a => a.source !== "Canvas").concat(data.assignments);
    renderTodo();
    renderCalendar();
  } catch (err) {
    statusEl.textContent = "Couldn't reach the server. Is the app running?";
    statusEl.className = "status err";
  }
}

async function loadMockPlatforms() {
  const platforms = ["infinite-campus", "gavs", "fva"];
  for (const p of platforms) {
    try {
      const res = await fetch(`/api/mock/${p}`);
      const data = await res.json();
      allAssignments = allAssignments.concat(data.assignments);
    } catch (e) {}
  }
  renderTodo();
  renderCalendar();
}

function renderTodo() {
  const container = document.getElementById("todo-list");
  if (allAssignments.length === 0) {
    container.innerHTML = `<p class="empty-state">Nothing here yet. Go to <strong>Connect Accounts</strong> to get started.</p>`;
    return;
  }
  const sorted = [...allAssignments].sort((a, b) => new Date(a.due) - new Date(b.due));
  container.innerHTML = sorted.map(item => {
    const isDone = doneIds.has(item.id);
    const due = new Date(item.due);
    const dueStr = due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    return `
      <div class="todo-item ${isDone ? "done" : ""}">
        <input type="checkbox" data-id="${item.id}" ${isDone ? "checked" : ""}>
        <div class="todo-main">
          <div class="todo-title">${escapeHtml(item.title)}</div>
          <div class="todo-meta">
            <span class="chip">${escapeHtml(item.source)}</span>
            ${escapeHtml(item.course)} &middot; due ${dueStr}
          </div>
        </div>
      </div>
    `;
  }).join("");
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) doneIds.add(cb.dataset.id);
      else doneIds.delete(cb.dataset.id);
      localStorage.setItem("doneIds", JSON.stringify([...doneIds]));
      renderTodo();
    });
  });
}

document.getElementById("cal-prev").addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() - 1);
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  calCursor.setMonth(calCursor.getMonth() + 1);
  renderCalendar();
});

function dateKey(d) { return d.toISOString().slice(0, 10); }

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  const label = document.getElementById("cal-month-label");
  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  label.textContent = calCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const byDate = {};
  for (const item of allAssignments) {
    const k = dateKey(new Date(item.due));
    (byDate[k] = byDate[k] || []).push(item);
  }
  const firstOfMonth = new Date(year, month, 1);
  const startDow = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKey(new Date());
  let html = "";
  ["S", "M", "T", "W", "T", "F", "S"].forEach(d => html += `<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    const k = dateKey(d);
    const items = byDate[k] || [];
    const classes = ["cal-day"];
    if (k === todayKey) classes.push("today");
    if (k === selectedDateKey) classes.push("selected");
    const dots = items.slice(0, 4).map(() => `<span class="dot"></span>`).join("");
    html += `
      <div class="${classes.join(" ")}" data-date="${k}">
        <div class="day-num">${day}</div>
        <div class="dot-row">${dots}</div>
      </div>
    `;
  }
  grid.innerHTML = html;
  grid.querySelectorAll(".cal-day[data-date]").forEach(el => {
    el.addEventListener("click", () => {
      selectedDateKey = el.dataset.date;
      renderCalendar();
      showDayDetail(selectedDateKey, byDate[selectedDateKey] || []);
    });
  });
}

function showDayDetail(dateKeyStr, items) {
  const el = document.getElementById("day-detail");
  if (items.length === 0) {
    el.innerHTML = `<h3>${dateKeyStr}</h3><p class="muted">Nothing due this day.</p>`;
  } else {
    el.innerHTML = `<h3>${dateKeyStr}</h3>` + items.map(item => `
      <div class="todo-item">
        <div class="todo-main">
          <div class="todo-title">${escapeHtml(item.title)}</div>
          <div class="todo-meta"><span class="chip">${escapeHtml(item.source)}</span>${escapeHtml(item.course)}</div>
        </div>
      </div>
    `).join("");
  }
  el.classList.remove("hidden");
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[s]);
}

loadMockPlatforms();
