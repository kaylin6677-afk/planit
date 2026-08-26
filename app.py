import os
import sqlite3
from datetime import datetime, timezone, date
from functools import wraps

from flask import Flask, request, jsonify, render_template, session, redirect, url_for
import requests
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = "planit-prototype-secret-key-change-if-this-goes-public"

DB_PATH = os.path.join(os.path.dirname(__file__), "planner.db")

ENERGY_COST = {"low": 10, "medium": 20, "high": 35}
ENERGY_LEVELS = ("low", "medium", "high")
CLASS_COLORS = ["#3454d1", "#1a9e6b", "#d1743a", "#a13ac2", "#cc3b3b", "#0f9aa8", "#c2971a"]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        canvas_domain TEXT,
        canvas_token TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        visible INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'manual',
        UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        due_date TEXT,
        recurring INTEGER NOT NULL DEFAULT 0,
        energy TEXT NOT NULL DEFAULT 'medium',
        time_minutes INTEGER,
        source TEXT NOT NULL DEFAULT 'manual',
        external_id TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        done_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, source, external_id)
    );
    """)
    conn.commit()
    conn.close()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Please log in first."}), 401
        return fn(*args, **kwargs)
    return wrapper


def current_user_row(conn):
    return conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()


@app.route("/")
def home():
    if "user_id" not in session:
        return redirect(url_for("login_page"))
    return render_template("index.html")


@app.route("/login")
def login_page():
    if "user_id" in session:
        return redirect(url_for("home"))
    return render_template("login.html")


@app.route("/api/auth/signup", methods=["POST"])
def signup():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not name or not email or not password:
        return jsonify({"error": "Please fill in your name, email, and password."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password should be at least 6 characters."}), 400

    conn = get_db()
    existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "An account with that email already exists. Try logging in instead."}), 400

    conn.execute(
        "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (name, email, generate_password_hash(password), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    session["user_id"] = user["id"]
    return jsonify({"ok": True})


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Email or password is incorrect."}), 401

    session["user_id"] = user["id"]
    return jsonify({"ok": True})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/me")
@login_required
def me():
    conn = get_db()
    user = current_user_row(conn)
    conn.close()
    return jsonify({
        "name": user["name"],
        "email": user["email"],
        "canvasConnected": bool(user["canvas_domain"] and user["canvas_token"]),
        "canvasDomain": user["canvas_domain"] or "",
    })


def class_to_dict(row):
    return {
        "id": row["id"], "name": row["name"], "color": row["color"],
        "visible": bool(row["visible"]), "source": row["source"],
    }


def get_or_create_class(conn, user_id, name, source="manual", color=None):
    row = conn.execute(
        "SELECT * FROM classes WHERE user_id = ? AND name = ?", (user_id, name)
    ).fetchone()
    if row:
        return row["id"]
    if color is None:
        count = conn.execute("SELECT COUNT(*) c FROM classes WHERE user_id = ?", (user_id,)).fetchone()["c"]
        color = CLASS_COLORS[count % len(CLASS_COLORS)]
    cur = conn.execute(
        "INSERT INTO classes (user_id, name, color, visible, source) VALUES (?, ?, ?, 1, ?)",
        (user_id, name, color, source),
    )
    return cur.lastrowid


@app.route("/api/classes", methods=["GET"])
@login_required
def list_classes():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM classes WHERE user_id = ? ORDER BY name", (session["user_id"],)
    ).fetchall()
    conn.close()
    return jsonify({"classes": [class_to_dict(r) for r in rows]})


@app.route("/api/classes", methods=["POST"])
@login_required
def create_class():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    color = data.get("color") or CLASS_COLORS[0]
    if not name:
        return jsonify({"error": "Class name can't be empty."}), 400

    conn = get_db()
    try:
        class_id = get_or_create_class(conn, session["user_id"], name, source="manual", color=color)
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "You already have a class with that name."}), 400
    row = conn.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    conn.close()
    return jsonify({"class": class_to_dict(row)})


@app.route("/api/classes/<int:class_id>", methods=["PATCH"])
@login_required
def update_class(class_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM classes WHERE id = ? AND user_id = ?", (class_id, session["user_id"])
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Class not found."}), 404

    color = data.get("color", row["color"])
    visible = int(data["visible"]) if "visible" in data else row["visible"]
    conn.execute("UPDATE classes SET color = ?, visible = ? WHERE id = ?", (color, visible, class_id))
    conn.commit()
    row = conn.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
    conn.close()
    return jsonify({"class": class_to_dict(row)})


def task_to_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "dueDate": row["due_date"],
        "recurring": bool(row["recurring"]),
        "energy": row["energy"],
        "timeMinutes": row["time_minutes"],
        "source": row["source"],
        "done": bool(row["done"]),
        "doneAt": row["done_at"],
        "classId": row["class_id"],
        "className": row["class_name"] if "class_name" in row.keys() else None,
        "classColor": row["class_color"] if "class_color" in row.keys() else None,
    }


TASK_SELECT = """
    SELECT tasks.*, classes.name AS class_name, classes.color AS class_color,
           classes.visible AS class_visible
    FROM tasks
    LEFT JOIN classes ON classes.id = tasks.class_id
    WHERE tasks.user_id = ?
"""


@app.route("/api/tasks", methods=["GET"])
@login_required
def list_tasks():
    scope = request.args.get("scope", "all")
    conn = get_db()
    rows = conn.execute(TASK_SELECT, (session["user_id"],)).fetchall()
    conn.close()

    tasks = [dict(task_to_dict(r), classVisible=(r["class_visible"] is None or bool(r["class_visible"])))
             for r in rows]
    tasks = [t for t in tasks if t["classVisible"]]

    if scope == "day":
        target = request.args.get("date")
        tasks = [t for t in tasks if t["recurring"] or t["dueDate"] == target]
    elif scope == "month":
        target = request.args.get("month")
        tasks = [t for t in tasks if not t["recurring"] and t["dueDate"] and t["dueDate"].startswith(target)]

    return jsonify({"tasks": tasks})


@app.route("/api/tasks", methods=["POST"])
@login_required
def create_task():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "Task needs a title."}), 400

    energy = data.get("energy") if data.get("energy") in ENERGY_LEVELS else "medium"
    recurring = 1 if data.get("recurring") else 0
    due_date = data.get("dueDate") or None
    time_minutes = data.get("timeMinutes")
    class_name = (data.get("className") or "").strip()

    conn = get_db()
    class_id = None
    if class_name:
        class_id = get_or_create_class(conn, session["user_id"], class_name, source="manual")

    conn.execute(
        """INSERT INTO tasks (user_id, class_id, title, due_date, recurring, energy,
           time_minutes, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)""",
        (session["user_id"], class_id, title, due_date, recurring, energy,
         time_minutes, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
@login_required
def update_task(task_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, session["user_id"])
    ).fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Task not found."}), 404

    if "done" in data:
        done = 1 if data["done"] else 0
        done_at = datetime.now(timezone.utc).isoformat() if done else None
        conn.execute("UPDATE tasks SET done = ?, done_at = ? WHERE id = ?", (done, done_at, task_id))

    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    conn = get_db()
    conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, session["user_id"]))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/energy/today")
@login_required
def energy_today():
    today = date.today().isoformat()
    conn = get_db()
    rows = conn.execute(
        "SELECT energy FROM tasks WHERE user_id = ? AND done = 1 AND done_at LIKE ?",
        (session["user_id"], f"{today}%"),
    ).fetchall()
    conn.close()
    spent = sum(ENERGY_COST.get(r["energy"], 20) for r in rows)
    battery = max(0, 100 - spent)
    return jsonify({"battery": battery, "cap": 100, "spentToday": spent})


def clean_domain(domain: str) -> str:
    domain = domain.strip()
    domain = domain.replace("https://", "").replace("http://", "")
    return domain.rstrip("/")


def canvas_get(domain, token, path, params=None):
    url = f"https://{domain}{path}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(url, headers=headers, params=params or {}, timeout=10)
    resp.raise_for_status()
    return resp.json()


@app.route("/api/canvas/connect", methods=["POST"])
@login_required
def canvas_connect():
    data = request.get_json(silent=True) or {}
    domain = clean_domain(data.get("domain") or "")
    token = (data.get("token") or "").strip()
    if not domain or not token:
        return jsonify({"error": "Missing Canvas domain or access token."}), 400

    conn = get_db()
    conn.execute(
        "UPDATE users SET canvas_domain = ?, canvas_token = ? WHERE id = ?",
        (domain, token, session["user_id"]),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/canvas/sync", methods=["POST"])
@login_required
def canvas_sync():
    conn = get_db()
    user = current_user_row(conn)
    if not user["canvas_domain"] or not user["canvas_token"]:
        conn.close()
        return jsonify({"error": "Connect Canvas in Settings first."}), 400

    domain, token = user["canvas_domain"], user["canvas_token"]
    try:
        todo_items = canvas_get(domain, token, "/api/v1/users/self/todo")
        upcoming = canvas_get(domain, token, "/api/v1/users/self/upcoming_events")
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        msg = "That access token was rejected." if status == 401 else f"Canvas returned an error ({status})."
        conn.close()
        return jsonify({"error": msg}), 502
    except requests.exceptions.RequestException:
        conn.close()
        return jsonify({"error": "Couldn't reach Canvas. Check the domain and try again."}), 502

    items = []
    for item in todo_items:
        a = item.get("assignment") or {}
        if a.get("due_at"):
            items.append((str(a.get("id")), a.get("name", "Untitled"), item.get("context_name", "Canvas course"), a["due_at"]))
    seen = {i[0] for i in items}
    for item in upcoming:
        eid = str(item.get("id"))
        if eid in seen:
            continue
        due = item.get("assignment", {}).get("due_at") if item.get("assignment") else item.get("start_at")
        if due:
            items.append((eid, item.get("title", "Untitled"), item.get("context_name", "Canvas course"), due))

    for external_id, title, course, due_at in items:
        class_id = get_or_create_class(conn, session["user_id"], course, source="canvas")
        conn.execute(
            """INSERT INTO tasks (user_id, class_id, title, due_date, energy, source, external_id, created_at)
               VALUES (?, ?, ?, ?, 'medium', 'canvas', ?, ?)
               ON CONFLICT(user_id, source, external_id)
               DO UPDATE SET title = excluded.title, due_date = excluded.due_date, class_id = excluded.class_id""",
            (session["user_id"], class_id, title, due_at, external_id, datetime.now(timezone.utc).isoformat()),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "imported": len(items)})


MOCK_SAMPLES = {
    "infinite-campus": [
        ("ic-1", "US History Unit 4 Test", "US History"),
        ("ic-2", "Chemistry Lab Report", "Chemistry"),
    ],
    "gavs": [("gavs-1", "Module 6 Quiz", "GAVS Economics")],
    "fva": [("fva-1", "Semester Project Check-in", "FVA Art History")],
}


@app.route("/api/mock/<platform>/sync", methods=["POST"])
@login_required
def mock_sync(platform):
    if platform not in MOCK_SAMPLES:
        return jsonify({"error": "Unknown platform"}), 404

    today = date.today().isoformat()
    conn = get_db()
    for external_id, title, course in MOCK_SAMPLES[platform]:
        class_id = get_or_create_class(conn, session["user_id"], course, source="demo")
        conn.execute(
            """INSERT INTO tasks (user_id, class_id, title, due_date, energy, source, external_id, created_at)
               VALUES (?, ?, ?, ?, 'medium', ?, ?, ?)
               ON CONFLICT(user_id, source, external_id) DO NOTHING""",
            (session["user_id"], class_id, title, today, platform, external_id, datetime.now(timezone.utc).isoformat()),
        )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
