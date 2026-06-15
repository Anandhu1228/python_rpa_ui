# ⚡ RPA Studio

A visual, browser-based automation platform built on Playwright + FastAPI.  
No React, no Node build step — just HTML/CSS/JS served by Python.

---

## Project Structure

```
rpa_studio/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── startup.sh               ← local dev (no Docker)
│
├── backend/
│   ├── main.py              ← FastAPI app + WebSocket
│   ├── routers/
│   │   ├── inspect_router.py   POST /api/inspect
│   │   ├── recipe_router.py    CRUD /api/recipes
│   │   └── run_router.py       POST /api/run + status
│   └── workers/
│       ├── job_store.py        in-memory job state
│       └── playwright_worker.py  core automation engine
│
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js           ← fetch/WebSocket wrappers
│       ├── app.js           ← tab routing + modal
│       ├── inspector.js     ← page inspection UI
│       ├── flow.js          ← flow + field mapping builder
│       ├── recipes.js       ← saved recipes list
│       └── runner.js        ← run + live log streaming
│
└── storage/
    ├── recipes/             ← JSON recipe files
    ├── uploads/             ← uploaded CSV/Excel files
    └── logs/                ← (future) persistent logs
```

---

## Quick Start — Docker (recommended)

```bash
cd rpa_studio
docker compose up --build
```

Open **http://localhost:10090** in your browser.

---

## Quick Start — Local (dev)

```bash
pip install -r requirements.txt
playwright install chromium
bash startup.sh
```

---

## Workflow

### 1 · Inspector Tab
- Enter the URL of any page you want to automate
- If the page requires login first, add **Login Steps** (URL → credentials → submit selector)
- Click **Inspect** — all form fields, selects, radios, checkboxes, and buttons appear in a table
- Click **→ Use These Fields in Flow Builder** to seed a flow step automatically

### 2 · Flow Builder Tab
Set up the automation recipe:

- **Recipe Info** — name, base URL, description
- **⏱ Timing & Delays** — configure all delays:
  - *Between Records* — pause between each CSV row
  - *Between Fields* — pause between filling each field on a page
  - *Between Steps* — pause between form submission steps
  - *Char Typing Delay* — type character-by-character (0 = instant fill)
  - *Page Load Timeout / Action Timeout*
- **🔐 Login Steps** — credentials filled once before the row loop starts
- **Flow Steps** — each step is one page:
  - URL to navigate to
  - Field mappings: selector → CSV column or literal value
  - Submit selector
  - URL to wait for after submission
  - Option: skip step if all CSV columns are empty

Field mapping types: `text`, `password`, `email`, `tel`, `number`, `textarea`, `select`, `radio`, `checkbox`, `click`

Click **💾 Save Recipe** when done.

### 3 · Recipes Tab
Browse, edit, or delete saved recipes. Click **▶ Run** to jump straight to the Run tab.

### 4 · Run Tab
- Select a recipe
- Drop a **CSV** or **Excel (.xlsx)** file — see a live preview with column chips
- Set optional row range (start/end)
- Click **▶ Start Run**

### 5 · Logs Tab
- Live streaming log output via WebSocket
- Progress bar showing rows processed
- Success/failure counters
- Download log file

---

## Field Mapping Reference

| Field Type  | How it fills                                      |
|-------------|---------------------------------------------------|
| `text`      | `fill()` — instant or char-by-char               |
| `password`  | same as text but masked in UI                     |
| `email`     | same as text                                      |
| `select`    | tries `value=` first, then `label=`              |
| `radio`     | clicks `input[type="radio"][name="X"][value="Y"]` |
| `checkbox`  | checks if value is yes/true/1, unchecks otherwise |
| `textarea`  | same as text                                      |
| `click`     | clicks the element (no value needed)             |

**Source types:**
- `csv_column` — reads value from the named column in each CSV row
- `literal` — fixed value used for every row (great for constant flags)

---

## Notes

- The **Inspector** login steps are one-off — only used to reach the target URL for field discovery.  
  Recipe login steps are used in the actual automation run.
- Character-by-character typing (`char_delay_ms > 0`) looks more human but is much slower.
- If a row fails, the worker navigates to `base_url` to recover before the next row.
- All delays have ±20% random jitter to appear more natural.
