# RPA Studio — Technical Reference Documentation

> This document was written by reading the actual source files in the repo (backend `.py` files, frontend `.js`/`.html`/`.css`, `Dockerfile`, `docker-compose.yml`, `startup.sh`). It does **not** reproduce the existing `README.md`, which is out of date — it describes things that have since been added (screen recording, new-tab navigation, split-box fields, human-in-the-loop input, CAPTCHA handoff) and is missing the auth system entirely. Use this as the authoritative reference; treat `README.md` as a short marketing-style summary that needs a rewrite.

---

## 1. What this project is

RPA Studio is a self-hosted, browser-based RPA (robotic process automation) tool. You point it at a web form, it discovers the fields automatically ("Inspector"), you map CSV/Excel columns onto those fields ("Flow Builder"), save that as a "Recipe", then run the recipe row-by-row against a real Chromium browser via Playwright. It has no frontend build step — the UI is plain HTML/CSS/JS served directly by FastAPI — and no external database; everything is JSON files, a `.log` file per run, and one SQLite file for auth.

---

## 2. Directory structure (as it exists on disk)

```
python_rpa_ui/
├── .gitignore
├── docker-compose.yml
├── Dockerfile
├── LICENSE
├── README.md                 ← outdated, see note above
├── requirements.txt           (not reviewed for this doc — check it directly for pinned versions)
├── startup.sh                 ← local dev runner (no Docker)
├── __init__.py
│
├── backend/
│   ├── __init__.py
│   ├── auth.py                 SQLite-backed auth (users + sessions)
│   ├── main.py                 FastAPI app, auth middleware, WebSocket, static mount
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── inspect_router.py   POST /api/inspect
│   │   ├── recipe_router.py    CRUD /api/recipes
│   │   └── run_router.py       /api/run*, /api/uploads*
│   └── workers/
│       ├── __init__.py
│       ├── job_store.py        Disk-backed job/log/action state
│       └── playwright_worker.py  The actual automation engine
│
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js          fetch/WebSocket wrapper, adds Bearer token to every call
│       ├── app.js          tab routing, modal system, auth screens (login/signup/forgot)
│       ├── inspector.js    Inspector tab
│       ├── flow.js         Flow Builder tab (recipe editing)
│       ├── recipes.js      Flows tab (saved recipe list)
│       └── runner.js       Run tab + Logs tab (incl. video playback)
│
└── storage/                  (created at runtime, persisted via Docker volume)
    ├── auth.db                SQLite: users + sessions
    ├── recipes/               one {recipe_id}.json per saved flow
    ├── uploads/                uploaded CSV/Excel, named {job_id}.csv|.xlsx
    ├── logs/                   {job_id}.log + {job_id}_meta.json per run
    └── recordings/             {job_id}.webm (+ {job_id}_tab2.webm, _tab3.webm, …)
```

The `docker-compose.yml` mounts `./storage:/app/storage` (so all of the above persists across container restarts) and `./frontend:/app/frontend:ro` (so editing frontend files doesn't require a rebuild). It exposes port **10090**.

---

## 3. Running it

**Docker (production-style):**
```bash
docker compose up --build
```
Built from `mcr.microsoft.com/playwright/python:v1.59.0-noble` (Playwright + Chromium + system deps preinstalled). `PYTHONPATH=/app` is set so `backend.*` imports resolve. Container runs `uvicorn backend.main:app --host 0.0.0.0 --port 10090` (no `--reload` in the image).

**Local dev (no Docker):**
```bash
pip install -r requirements.txt
playwright install chromium
bash startup.sh
```
`startup.sh` runs `uvicorn backend.main:app --host 0.0.0.0 --port 10090 --reload --reload-dir backend` (reloads backend on change; frontend is always served live from disk regardless, since there's no build step).

Open `http://localhost:10090`.

---

## 4. Authentication system (`backend/auth.py`)

This is a **single-admin-account** system, not multi-user:

- SQLite file at `storage/auth.db`, with two tables: `users` (one row, enforced) and `sessions` (`token`, `expires_at`).
- `GET /api/auth/status` → `{has_users: bool}`. The frontend uses this on load to decide whether to show **Signup** (first run) or **Login**.
- `POST /api/auth/signup` — **rejected with HTTP 400 if a user already exists** (`count > 0` check). Takes `username`, `password`, `security_pin`, `security_question`, `security_answer`.
- `POST /api/auth/login` → `{token}`. Token is `secrets.token_hex(32)`, stored in `sessions` with a **7-day expiry**.
- `POST /api/auth/logout?token=...` deletes that one session row.
- `GET /api/auth/question?username=...` → returns the stored security question (for "Forgot Password").
- `POST /api/auth/reset` — validates `security_pin` (compared in plaintext — see note below) and `security_answer` (hashed), then updates the password hash **and deletes every row in `sessions`**, i.e. a password reset force-logs-out all devices, not just the requester's.

**Password/answer hashing:** `hashlib.sha256(text.encode()).hexdigest()` with **no per-user salt**. The `security_pin` itself is stored **unhashed** in the `users` table. This is functional but not how you'd want production-grade credential storage; worth knowing if this is exposed beyond a trusted network.

**Middleware (`backend/main.py`):** every request to a path starting with `/api/` except `/api/auth/*` is checked for a valid session token, taken from either:
1. `Authorization: Bearer <token>` header (used by all `fetch()` calls in `api.js`), or
2. a `?token=` query parameter (used **specifically** because an HTML `<video>` tag can't set custom headers — see §10).

No token, or an expired/unknown token → `401 {"detail": "Unauthorized"}`. The WebSocket endpoint (`/ws/run/{job_id}/logs`) is **not** under `/api/`, so it isn't covered by this middleware — it validates the `?token=` query param itself, inside the handler, before accepting the connection.

Frontend session storage: the bearer token lives in `localStorage['rpa_token']`. A `401` from any API call clears it and re-shows the auth overlay (`api.js` → `_fetch()`).

---

## 5. The three different "Login Steps" concepts — don't conflate them

The codebase has three distinct mechanisms that all involve navigating + filling + submitting a login form, and they are **not interchangeable**:

| Concept | Where it's built | What it's for | Does it run during an actual automation Run? |
|---|---|---|---|
| **Inspector "Login Steps"** | Inspector tab (`inspector.js`, `inspectorLoginSteps`) | One-off: get past a login wall just so the **Inspector** can see the next page's fields | **No** — only sent as part of the `POST /api/inspect` request body |
| **Recipe "Login Steps"** | Flow Builder → Recipe Info card (`flow.js`, `recipeLoginSteps`) | Runs **once**, before the per-row loop, on every real Run | **Yes** — `execute_login_steps()` in `playwright_worker.py` |
| **Per-step "Inspection Setup"** (`inspection_steps`) | Inside each Flow Step's editor, labeled "Inspection Setup (Optional)" | Pre-navigation steps needed just to reach *that one step's* page for **field auto-discovery** ("Auto-Extract Fields" button) | **No** — `execute_step()` never reads `inspection_steps`; it's only sent to `/api/inspect` when you click "Auto-Extract Fields" |

This matters operationally: if a flow step's target page requires a fresh login every time (not just once per run), the only one of these three that actually gets executed per-row during a Run is... none of them — there's no "run before every step" login mechanism. Recipe Login Steps run exactly once per Run, before row 1.

---

## 6. Recipe JSON schema

This is the Pydantic model in `recipe_router.py` — the exact shape saved to `storage/recipes/{recipe_id}.json` and produced by "Download JSON" / consumed by the new "Upload JSON" import:

```jsonc
{
  "name": "string",
  "description": "string (optional)",
  "base_url": "string",
  "flow": [ /* array of FlowStep, see below */ ],
  "delay": {
    "between_records_ms": 800,
    "between_fields_ms": 100,
    "between_steps_ms": 300,
    "char_delay_ms": 0,
    "page_load_timeout_ms": 15000,
    "action_timeout_ms": 8000
  },
  "login_steps": [ /* optional, see §7 */ ]
}
```

**FlowStep:**
```jsonc
{
  "step_id": "string",
  "label": "string",
  "url": "string (page to navigate to; can be left blank to stay on current page)",
  "field_mappings": [ /* array, see §8 */ ],
  "inspection_steps": [ /* optional, see §5 — only used by Inspector calls, never at run time */ ],
  "captcha_image_selector": "string (optional — see §11)",
  "captcha_input_selector": "string (optional — see §11)",
  "submit_selector": "string (optional)",
  "wait_for_url": "string (optional — substring match against the post-submit URL)",
  "wait_for_selector": "string (optional — waited for, but a miss only logs a warning, not a failure)",
  "skip_if_no_data": false,
  "opens_new_tab": false
}
```

`recipe_id` and `created_at`/`updated_at` are added by the backend on save/update — they don't need to be (and aren't required to be) present in an uploaded/imported JSON; FastAPI/Pydantic ignores unrecognized extra keys, so re-uploading a previously-downloaded recipe JSON works without modification.

---

## 7. Login Steps format (used by both Inspector and Recipe login steps)

```jsonc
{
  "url": "string",
  "fields": [
    { "selector": "[name=\"username\"]", "field_type": "text", "source": "literal", "literal_value": "..." }
  ],
  "submit_selector": "button[type=\"submit\"]",
  "wait_for_url": "/dashboard/"
}
```
Executed by `execute_login_steps()`: navigate → fill each field via `fill_field()` (literal values only) → click submit → wait for network idle → optionally wait for a URL substring.

---

## 8. Field mapping reference

A field mapping object (used in `field_mappings`) has a `field_type` and a `source`.

**`field_type` values** (from `fill_field()` in `playwright_worker.py` — the README only lists 8 of these; the actual list is 12):

| field_type | Behavior |
|---|---|
| `text`, `password`, `email`, `tel`, `number`, `textarea` | Clicks, clears, then `fill()`s instantly — or, if `char_delay_ms > 0` in the recipe's delay config, types character-by-character via `page.type()` |
| `select` | Tries `select_option(value=...)` first, falls back to `select_option(label=...)`, silently skips if neither matches |
| `radio` | If a value is resolved, builds `input[type="radio"][name="{radio_name}"][value="{value}"]` and clicks it; `radio_name` is a separate field on the mapping |
| `checkbox` | Checks if the resolved value is one of `yes/true/1/on/checked` (case-insensitive), unchecks otherwise |
| `click` | Just clicks the selector — no value used at all |
| `human_input` | **Pauses the run** (see §9) |
| `split_fill` | Splits one resolved value across multiple input boxes (see §10) |

**`source` values** (`resolve_value()` in `playwright_worker.py`):

| source | Behavior |
|---|---|
| `csv_column` (default) | Looks up `mapping.csv_column` in the current data row, `.strip()`'d |
| `literal` | Uses `mapping.literal_value` for every row |
| `human_input` | Returns `""` here — actually handled by the `field_type == "human_input"` branch in `fill_field()`, not by `resolve_value()` |

**`value_map`** — optional array of `{from_val, to_val}` applied *after* resolving the raw value, exact-match only: e.g. map CSV's `Male` → `male` for a site that expects lowercase. First match wins; if nothing matches, the original resolved value passes through unchanged.

---

## 9. Human-in-the-loop input (`field_type: "human_input"`)

For values that can't be known ahead of time (an OTP, for example):
1. The mapping needs a `human_input_question` string.
2. At run time, `job_store.set_pending_action(job_id, {"type": "human_input", "question": ...})` is called, and the worker thread **blocks for up to 5 minutes**, polling `job_store.get_action_response()` once per second.
3. The WebSocket pushes an `action` message to the Logs tab; the frontend (`runner.js` → `handleRunAction`) shows the "⚠️ Human Input Required" card with the question and a text box.
4. Submitting that box calls `POST /api/run/{job_id}/action` with `{response}`, which `job_store.set_action_response()` stores.
5. The worker picks it up, clears the pending action, and fills the mapping's `selector` with the response.
6. If nothing arrives within 5 minutes, the field raises `FieldError` and the row is marked failed.

---

## 10. Split-box fields (`field_type: "split_fill"`)

For UIs that split one logical value across several boxes (e.g. an Aadhaar number across 3 four-digit inputs). Config lives on the mapping as `split_boxes: [{selector, length}]`. The worker resolves the value once (via the normal `source`/`csv_column`/`literal` rules), then walks the boxes left to right, slicing out `length` characters for each box and filling it — independently of the row's normal field-fill error handling (a failure on one box just logs a warning and continues to the next box).

---

## 11. CAPTCHA / Human Handoff (step-level, distinct from `human_input`)

This is a **step property**, not a field mapping — toggled via "Requires Human Handoff (e.g. CAPTCHA)" in the Flow Builder UI, which sets `captcha_image_selector` and `captcha_input_selector` on the step itself.

At run time (`execute_step()`):
1. Screenshots the element matching `captcha_image_selector`, base64-encodes it.
2. Pushes a pending action of `{"type": "captcha", "image_b64": ...}`.
3. Frontend shows the image inline in the "Human Input Required" card and waits for a typed answer.
4. Same 5-minute timeout / polling mechanism as `human_input`.
5. On response, fills `captcha_input_selector` with the typed answer.

---

## 12. New-tab handling (`opens_new_tab`)

When a step's `submit_selector` click is expected to open a new browser tab (common for ID-verification widgets like SurePass), set `opens_new_tab: true` on that step. At run time:

```python
with page.context.expect_page() as new_page_info:
    page.locator(submit_sel).first.click(timeout=action_to)
new_page = new_page_info.value
```

The new page becomes the **active page for the rest of that row's remaining flow steps**. Important nuance: at the **start of the next CSV row**, `active_page` is reset back to the *original* first tab (`run_job()`'s loop does `active_page = page` at the top of every row). So if every row in your data opens its own new tab (e.g. one verification popup per applicant), you'll accumulate one extra tab per row over the course of a multi-row run — they're all cleaned up (closed + video-saved) at the very end, not after each row.

---

## 13. Screen recording / videos — what was wrong and what changed

**Original behavior:** the browser context is created with `record_video_dir`, which means Playwright auto-records a video for every page in that context, including popups. At the very end of `run_job()`, the code looped over `context.pages` (i.e. whatever pages are *still open right now*) and saved each one's video as `{job_id}.webm` (first) or `{job_id}_tab{N}.webm` (rest).

**The bug:** `context.pages` only reflects pages that are **currently open**. If a popup tab (e.g. a SurePass verification widget) gets **closed before the run finishes** — either by the external site itself or as a side effect of the automation — it disappears from `context.pages` immediately, and the final save loop never sees it, so its video is silently never written. This matches exactly the symptom described: the main tab's recording exists, the new tab's doesn't.

**The fix (`playwright_worker.py`):** track every page from the moment it's created, independent of whether it's later closed, using a context-level event listener:
```python
recorded_pages = []
def _track_page(new_p):
    if new_p not in recorded_pages:
        recorded_pages.append(new_p)
context.on("page", _track_page)
page = context.new_page()
_track_page(page)
```
The end-of-run save loop now iterates `recorded_pages` instead of `context.pages`, and only calls `.close()` if the page isn't already closed (`if not p.is_closed(): p.close()`) before accessing `.video.save_as(...)`. This means a tab that closed itself mid-run still gets its video saved.

**A second, related bug (`runner.js`):** in the video-playback modal, once you have more than one tab recorded, the per-tab switch buttons were generated as `playVideo('', tab)` — an **empty job ID**. This meant clicking "Tab 2" (or any tab after the first) could never actually load that recording, which independently would have looked exactly like "I only get the first tab" even once the backend was saving the file correctly. Fixed to pass the actual `jobId` through:
```js
`<button ... onclick="playVideo('${jobId}',${v.tab})" ...>${v.label}</button>`
```

**Video API (`run_router.py`):**
- `GET /api/run/{job_id}/videos` → lists which tabs have a recording (`[{tab, label, url}]`), checking for `{job_id}.webm` (tab 1) and `{job_id}_tab2.webm` through `_tab9.webm`.
- `GET /api/run/{job_id}/video?tab=N` → streams that specific `.webm` file. `tab<=1` serves the main file; otherwise `_tab{N}.webm`.
- Frontend `playVideo(jobId, tab)` (`runner.js`) calls `/videos` first if no tab is specified, builds the tab-switch buttons if more than one exists, then sets the `<video>` element's `src` to the per-tab URL (with `?token=` since `<video>` can't send headers).

---

## 14. Job store (`backend/workers/job_store.py`)

Disk-backed, in-memory-cached. Per job:
- `storage/logs/{job_id}.log` — append-only plain text, one line per log call.
- `storage/logs/{job_id}_meta.json` — `{job_id, recipe_name, status, summary, created_at}`.
- On process start, `_load_all_meta()` rehydrates every job (including its full log file into memory) from these files — so run history survives a restart.
- `status` lifecycle: `pending → running → done | error`.
- `pending_action` / `action_response` — the mechanism behind `human_input` and `captcha` (see §9, §11); `clear_action()` resets both after a response is consumed.

---

## 15. Run execution flow (`backend/workers/playwright_worker.py` → `run_job()`)

1. Load the data file (`load_data_file()` — CSV via stdlib `csv.DictReader`, `.xlsx`/`.xls` via `openpyxl` if installed — raises if `.xlsx` is given but `openpyxl` isn't available).
2. Slice to `[start_row-1 : end_row]`.
3. Launch headless Chromium, create a context with `record_video_dir` and a `1280x800` viewport.
4. Run recipe-level `login_steps` once (if any) — a failure here aborts the whole job (`status = "error"`) before any rows run.
5. For each row: run every flow step in order via `execute_step()`. On any step failure, the row is marked failed and the worker tries to recover by navigating back to `base_url` before continuing to the next row (best-effort, swallows its own exceptions).
6. `between_records_ms`, `between_fields_ms`, `between_steps_ms` delays all apply `human_delay()` — sleep for the configured ms ±20% random jitter (minimum 10ms), meant to look less robotic.
7. At the end: save every tracked page's video (§13), close context/browser, write the final summary (`{success, failed, failed_ids}`) and set status to `done`.
8. Any uncaught exception anywhere sets `status = "error"` and logs a full traceback into the run's log.

The run itself executes in a plain background `threading.Thread` (`run_router.py`'s `start_run()`), not `asyncio` — because Playwright's **sync** API is used throughout the worker, which is blocking by design and can't run inside FastAPI's event loop.

---

## 16. Inspector (`backend/routers/inspect_router.py`)

`POST /api/inspect` doesn't run Playwright in-process — it writes a complete, self-contained Playwright script to a temp file (string-templated with `repr()`-escaped URL/login-steps/credentials) and runs it as a **separate subprocess** (`subprocess.run([sys.executable, tmp], ..., timeout=60)`), capturing its stdout as JSON. This isolates inspection from the main process and gives it a hard 60-second timeout. It returns `{inputs, selects, textareas, buttons, final_url}` — note `final_url` reflects wherever login redirects ended up, which may differ from the requested `url`.

---

## 17. API endpoint reference

All paths below are mounted with the `/api` prefix from `main.py`; everything except `/api/auth/*` requires a valid bearer/query token (§4).

| Method | Path | Source file | Purpose |
|---|---|---|---|
| GET | `/api/auth/status` | auth.py | `{has_users}` — drives login vs signup screen |
| POST | `/api/auth/signup` | auth.py | Create the one admin account (fails if one exists) |
| POST | `/api/auth/login` | auth.py | `{username, password}` → `{token}` |
| POST | `/api/auth/logout?token=` | auth.py | Invalidate one session |
| GET | `/api/auth/question?username=` | auth.py | Get security question for reset |
| POST | `/api/auth/reset` | auth.py | Reset password via PIN + security answer; kills all sessions |
| POST | `/api/inspect` | inspect_router.py | `{url, login_steps?}` → discovered fields |
| POST | `/api/recipes` | recipe_router.py | Create a recipe; returns it with a new `recipe_id` |
| GET | `/api/recipes` | recipe_router.py | List recipes (summary fields only) |
| GET | `/api/recipes/{id}` | recipe_router.py | Full recipe JSON |
| PUT | `/api/recipes/{id}` | recipe_router.py | Replace a recipe |
| DELETE | `/api/recipes/{id}` | recipe_router.py | Delete a recipe |
| POST | `/api/run` | run_router.py | multipart form: `recipe_id, file, start_row, end_row?` → starts a background run, returns `{job_id}` |
| POST | `/api/run/{job_id}/action` | run_router.py | `{response}` — answers a pending human_input/captcha request |
| GET | `/api/run` | run_router.py | List all jobs (newest first) |
| GET | `/api/run/{job_id}` | run_router.py | Status + summary + log count for one job |
| GET | `/api/run/{job_id}/logs?since=` | run_router.py | Polling fallback for logs (use the WebSocket for live tailing) |
| GET | `/api/run/{job_id}/video?tab=1` | run_router.py | Stream one tab's `.webm` |
| GET | `/api/run/{job_id}/videos` | run_router.py | List which tabs have a recording |
| DELETE | `/api/run/{job_id}` | run_router.py | Delete job logs/meta + its main video |
| GET | `/api/uploads` | run_router.py | List uploaded data files with linked job/recipe info |
| GET | `/api/uploads/{filename}` | run_router.py | Download an uploaded data file |
| DELETE | `/api/uploads/{filename}` | run_router.py | Delete an uploaded data file |
| WS | `/ws/run/{job_id}/logs?start=&token=` | main.py | Live log/done/error/action stream (see below) |

**WebSocket message shapes** (server → client):
```jsonc
{"type": "log",    "line": "string"}
{"type": "done",   "status": "done|error", "summary": {...}}
{"type": "error",  "msg": "string"}
{"type": "action", "action": {"type": "human_input"|"captcha", ...} | null}
```
The handler polls job state every 150ms and uses guarded send/close helpers (`_safe_send`/`_safe_close`) so a client that already disconnected (e.g. tab refresh) doesn't cause a crash on the next send attempt.

---

## 18. Frontend tabs

| Tab | File(s) | What it does |
|---|---|---|
| **Inspector** | `inspector.js` | Enter a URL (+ optional one-off login steps), discover all inputs/selects/textareas/buttons, optionally push them straight into a new Flow Builder step |
| **Flow Builder** | `flow.js` | Build/edit a recipe: name/base URL/description, timing config, recipe-level login steps, and an ordered list of flow steps with field mappings. Has Save / Download JSON / **Upload JSON** (new) / Clear |
| **Flows** | `recipes.js` | List saved recipes; Edit / Run / Download JSON / Delete each |
| **Run** | `runner.js` | Pick a recipe, drop a CSV/XLSX (client-side preview via SheetJS for `.xlsx`), optional row range, start the run |
| **Logs** | `runner.js` | Run history grouped by recipe name → list of past runs → live or historical log terminal, progress bar, human-input/captcha action card, video playback (multi-tab), download/delete log |
| **Uploads** | `runner.js` | Manage previously-uploaded data files; shows linked job status/recipe name |

Theme toggle (dark/light) is stored in `localStorage['theme']` and applied via `document.documentElement.dataset.theme`. The active tab is also persisted, in `sessionStorage['activeTab']`, so a refresh returns you to where you were.

---

## 19. Changes made in this pass

Exactly three things were changed, only where necessary — no unrelated code was touched.

### A. Moved the "+ Add Step" button to the bottom of the Flow Steps card
**File:** `frontend/index.html`
The button previously sat in the card header (top), forcing a scroll back up after adding each step. It's now rendered after `#flow-steps-list`, so it's right where you're already looking once you've finished editing the last step.

### B. Added "Upload JSON" to import a flow
**Files:** `frontend/index.html`, `frontend/js/flow.js`
A new "Upload JSON" button (next to "Download JSON") opens a file picker. The selected file is parsed and loaded into the Flow Builder via the existing `loadRecipeIntoFlow()` — but `editingRecipeId` is then explicitly cleared, so clicking "Save Recipe" afterward always creates a **new** recipe (`POST /api/recipes`) rather than overwriting whatever recipe the uploaded JSON's `recipe_id` (if any) used to belong to. No backend change was needed: `POST /api/recipes` already ignores unrecognized extra fields like `recipe_id`/`created_at`, so a previously-downloaded recipe JSON round-trips cleanly.

### C. Fixed multi-tab screen recording
**Files:** `backend/workers/playwright_worker.py`, `frontend/js/runner.js`
Two independent bugs were contributing to "only the first tab's recording is there":
1. **Backend:** the end-of-run save loop only iterated `context.pages` (pages still open *right now*), so a popup tab that had already been closed during the run (e.g. by the SurePass widget itself) was invisible to it and never got its video saved. Fixed by tracking every page from creation via a `context.on("page", ...)` listener into a persistent list, and saving from that list instead.
2. **Frontend:** in the video modal, switching to any tab other than the first called `playVideo('', tab)` with an empty job ID, which could never have worked. Fixed to pass the real job ID through.

---

## 20. Appendix — minimal complete recipe example

```json
{
  "name": "Sample Signup Flow",
  "description": "Single-step demo",
  "base_url": "https://example.com",
  "delay": {
    "between_records_ms": 800,
    "between_fields_ms": 100,
    "between_steps_ms": 300,
    "char_delay_ms": 0,
    "page_load_timeout_ms": 15000,
    "action_timeout_ms": 8000
  },
  "login_steps": [],
  "flow": [
    {
      "step_id": "step_1",
      "label": "Registration Form",
      "url": "https://example.com/signup/",
      "submit_selector": "button[type=\"submit\"]",
      "wait_for_url": "/dashboard/",
      "wait_for_selector": "",
      "skip_if_no_data": false,
      "opens_new_tab": false,
      "captcha_image_selector": "",
      "captcha_input_selector": "",
      "field_mappings": [
        {
          "selector": "input[name=\"full_name\"]",
          "field_type": "text",
          "source": "csv_column",
          "csv_column": "Name",
          "literal_value": "",
          "value_map": []
        },
        {
          "selector": "input[name=\"newsletter\"]",
          "field_type": "checkbox",
          "source": "literal",
          "literal_value": "yes",
          "value_map": []
        }
      ]
    }
  ]
}
```
