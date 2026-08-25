from flask import Flask, request, jsonify, render_template
import requests
from datetime import datetime, timezone

app = Flask(__name__)

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

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/canvas/assignments")
def canvas_assignments():
    domain = request.args.get("domain", "")
    token = request.args.get("token", "")
    if not domain or not token:
        return jsonify({"error": "Missing Canvas domain or access token."}), 400
    domain = clean_domain(domain)
    try:
        todo_items = canvas_get(domain, token, "/api/v1/users/self/todo")
        upcoming = canvas_get(domain, token, "/api/v1/users/self/upcoming_events")
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        if status == 401:
            msg = "That access token was rejected. Double check it was copied correctly."
        elif status == 404:
            msg = "Couldn't reach that Canvas domain. Double check the school web address."
        else:
            msg = f"Canvas returned an error ({status})."
        return jsonify({"error": msg}), 502
    except requests.exceptions.RequestException:
        return jsonify({"error": "Couldn't reach Canvas. Check the domain and try again."}), 502

    assignments = []
    for item in todo_items:
        a = item.get("assignment") or {}
        due = a.get("due_at")
        if not due:
            continue
        assignments.append({
            "id": f"todo-{a.get('id')}",
            "title": a.get("name", "Untitled assignment"),
            "course": item.get("context_name", "Canvas course"),
            "due": due, "type": "assignment", "source": "Canvas", "url": a.get("html_url"),
        })

    seen_ids = {x["id"] for x in assignments}
    for item in upcoming:
        item_id = f"event-{item.get('id')}"
        if item_id in seen_ids:
            continue
        due = item.get("assignment", {}).get("due_at") if item.get("assignment") else item.get("start_at")
        if not due:
            continue
        assignments.append({
            "id": item_id,
            "title": item.get("title", "Untitled item"),
            "course": item.get("context_name", "Canvas course"),
            "due": due,
            "type": "quiz" if "quiz" in item.get("title", "").lower() else "assignment",
            "source": "Canvas", "url": item.get("html_url"),
        })

    assignments.sort(key=lambda x: x["due"])
    return jsonify({"assignments": assignments})

@app.route("/api/mock/<platform>")
def mock_platform(platform):
    now = datetime.now(timezone.utc)
    samples = {
        "infinite-campus": [
            {"id": "ic-1", "title": "US History Unit 4 Test", "course": "US History",
             "due": now.replace(hour=23, minute=59).isoformat(), "type": "test", "source": "Infinite Campus (demo)"},
            {"id": "ic-2", "title": "Chemistry Lab Report", "course": "Chemistry",
             "due": now.replace(hour=23, minute=59).isoformat(), "type": "assignment", "source": "Infinite Campus (demo)"},
        ],
        "gavs": [{"id": "gavs-1", "title": "Module 6 Quiz", "course": "GAVS Economics",
                  "due": now.replace(hour=23, minute=59).isoformat(), "type": "quiz", "source": "GAVS (demo)"}],
        "fva": [{"id": "fva-1", "title": "Semester Project Check-in", "course": "FVA Art History",
                 "due": now.replace(hour=23, minute=59).isoformat(), "type": "assignment", "source": "FVA (demo)"}],
    }
    if platform not in samples:
        return jsonify({"error": "Unknown platform"}), 404
    return jsonify({"assignments": samples[platform]})

if __name__ == "__main__":
    app.run(debug=True, port=5000)
