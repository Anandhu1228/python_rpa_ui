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
    ├── recordings/             {job_id}.webm (+ {job_id}_tab2.webm, _tab3.webm, …)
    └── temp_attachments/       transient files used by file_upload (local_disk / external_url); auto-deleted after upload
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

**`field_type` values** (from `fill_field()` in `playwright_worker.py` — the README only lists 8 of these; the actual list is 13):

| field_type | Behavior |
|---|---|
| `text`, `password`, `email`, `tel`, `number`, `textarea` | Clicks, clears, then `fill()`s instantly — or, if `char_delay_ms > 0` in the recipe's delay config, types character-by-character via `page.type()` |
| `select` | Tries `select_option(value=...)` first, falls back to `select_option(label=...)`, silently skips if neither matches |
| `radio` | If a value is resolved, builds `input[type="radio"][name="{radio_name}"][value="{value}"]` and clicks it; `radio_name` is a separate field on the mapping |
| `checkbox` | Checks if the resolved value is one of `yes/true/1/on/checked` (case-insensitive), unchecks otherwise |
| `click` | Just clicks the selector — no value used at all |
| `human_input` | **Pauses the run** (see §9) |
| `split_fill` | Splits one resolved value across multiple input boxes (see §10) |
| `file_upload` | Uploads a file to an `<input type="file">` element (see §21) |

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

For UIs that split one logical value across several boxes (e.g. an Aadhaar number across 3 four-digit inputs). Config lives on the mapping as `split_boxes: [{selector, length}]`. The worker resolves the value once (via the normal `source`/`csv_column`/`literal` rules, or via human-in-the-loop if `source` is `"human_input"`), then walks the boxes left to right, slicing out `length` characters for each box and filling it — independently of the row's normal field-fill error handling (a failure on one box just logs a warning and continues to the next box).

**`source` options for `split_fill`:**

| source | Behavior |
|---|---|
| `csv_column` (default) | Resolves from the named CSV column and splits across the boxes |
| `human_input` | Pauses the run and asks the operator (same mechanism as `field_type: "human_input"` — see §9); the operator's typed response is used as the value to split across the boxes. Use this for OTPs or any other split-box value that cannot be known in advance. Set `human_input_question` on the mapping to control the prompt shown to the operator. |

In the Flow Builder UI, when `split_fill` is selected as the field type, the value source selector offers "CSV col" and "Human Input". Choosing "Human Input" reveals a question field (same as for `field_type: "human_input"`) and hides the CSV column input.

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

Exactly four things were changed, only where necessary — no unrelated code was touched.

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

### D. Added `human_input` source support for `split_fill` fields
**Files:** `frontend/js/flow.js`, `backend/workers/playwright_worker.py`
Previously, `split_fill` mappings only accepted a CSV column as their value source. This is wrong for cases like an OTP entered across split boxes — the value cannot come from a CSV because it is unknown at run time.

**`frontend/js/flow.js`:** The `renderMappingValue()` function's `split_fill` branch was extended to show a source selector ("CSV col" / "Human Input") instead of a hardcoded CSV-only input. When "Human Input" is selected, the source column input is replaced by the same accent-coloured "Human Input" badge used by `field_type: "human_input"`, and the `splitFillHtml` block inside `renderMappingRow()` gains a conditional question-prompt input (identical in appearance to the one on `human_input` mappings) that only renders when `source === 'human_input'`.

**`backend/workers/playwright_worker.py`:** The `split_fill` branch in `fill_field()` was extended: instead of unconditionally calling `resolve_value()`, it first checks `field_cfg.get("source")`. If the source is `"human_input"`, it runs the same pause-poll-respond loop as `field_type: "human_input"` (5-minute timeout, `set_pending_action` / `get_action_response` / `clear_action`, raises `FieldError` on timeout), then uses the operator's response as the `source_value` to split across the boxes. For any other source it falls through to `resolve_value()` as before.

### E. Added `file_upload` field type for attaching files to web forms
**Files:** `frontend/js/flow.js`, `backend/workers/playwright_worker.py`
A new `file_upload` field type was added to handle `<input type="file">` elements on target web pages — covering image-only, PDF/document-only, any-file, and size-limited scenarios.

**`backend/workers/playwright_worker.py`:** A new `# ── file_upload ──` branch was added inside `fill_field()`, immediately after the `split_fill` block. The branch:
1. Resolves the file path from the CSV column or literal value (same `resolve_value()` as every other type).
2. Checks the file exists on disk — raises `FieldError` if not.
3. Checks file size against `file_max_mb` if set to a value greater than `0` — raises `FieldError` if exceeded.
4. Checks MIME type against `file_accept`: `"image"` requires `image/*`; `"pdf"` requires a set of PDF/Office/text MIME types; `"any"` (default) skips the check entirely — raises `FieldError` on mismatch.
5. Calls `el.set_input_files(path)` via Playwright's `resolve_frame` helper (so it works inside iframes too).
Violations raise `FieldError`, which marks the row as failed with a descriptive log message and continues to the next row — same behaviour as any other field failure.

**`frontend/js/flow.js`:** Four additions only, no existing code altered:
- `file_upload` appended to the `ftypes` dropdown array in `renderMappingRow()`.
- A **"File Upload Constraints"** config panel rendered when `field_type === 'file_upload'`: an Accept type dropdown (`Any document` / `Image only (image/*)` / `PDF / Document only`) and a Max size (MB) number input (0 = no limit).
- `file_accept: 'any'` and `file_max_mb: 0` added to the default object created by `addMapping()`.
- Both fields included in `buildRecipePayload()` and `loadRecipeIntoFlow()` so they round-trip correctly through save / load / JSON export / JSON import.

See §21 for full usage reference.

### F. Added `file_source` to `file_upload` fields — local disk and external URL support
**Files:** `frontend/js/flow.js`, `backend/workers/playwright_worker.py`, `RPA_STUDIO_DOCUMENTATION.md`
A new `file_source` field was added to `file_upload` mappings, with three options: `server_path` (existing behaviour, default), `local_disk`, and `external_url`.

**`backend/workers/playwright_worker.py`:**
- A module-level `TEMP_ATTACHMENTS_DIR` constant (`storage/temp_attachments/`) is created on import with `mkdir(parents=True, exist_ok=True)`.
- Inside the `# ── file_upload ──` branch of `fill_field()`, before the file-exists check, a `file_source` dispatch block was added:
  - `local_disk` — expects the file has been placed under `./storage/temp_attachments/` on the host (which maps to `/app/storage/temp_attachments/` inside Docker). Copies it to a job-scoped name in that same directory (to prevent concurrent-run collisions), then cleans up the copy in a `finally` block after `set_input_files()` completes.
  - `external_url` — treats the CSV value as an HTTP/HTTPS URL. Downloads it with `urllib.request.urlretrieve` into `temp_attachments/` under a job-scoped name, then cleans up in the same `finally` block.
  - `server_path` (default) — existing behaviour; no copy/download, no cleanup.
- A `_temp_file_to_cleanup` variable tracks the temp path (if any) and the `finally` block deletes it unconditionally whether the upload succeeded or raised.

**`frontend/js/flow.js`:** Four additions only, no existing code altered:
- `file_source: 'server_path'` added to the default object created by `addMapping()`.
- A **"File source"** dropdown added at the top of the "File Upload Constraints" panel (rendered when `field_type === 'file_upload'`): options are `Server path (absolute)` / `Local disk (via temp folder)` / `External URL (S3 / HTTP link)`. A contextual hint line below the dropdown changes based on the selected source to guide the user.
- `file_source` included in `buildRecipePayload()` so it is saved into the recipe JSON.
- `file_source` included in `loadRecipeIntoFlow()` so it round-trips correctly through save / load / JSON export / JSON import.

See §21 for full usage reference.

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
        },
        {
          "selector": "input[name=\"photo\"]",
          "field_type": "file_upload",
          "source": "csv_column",
          "csv_column": "PhotoPath",
          "literal_value": "",
          "file_accept": "image",
          "file_max_mb": 2,
          "value_map": []
        }
      ]
    }
  ]
}
```

---

## 21. File upload fields (`field_type: "file_upload"`)

Added in the same pass as this documentation update. Handles `<input type="file">` elements on target web pages — the three attachment scenarios and the strict size limit are all controlled per mapping, not per recipe.

### How it works at run time (`playwright_worker.py` → `fill_field()`)

1. The CSV column (or literal value) is resolved to a file path string via the normal `resolve_value()` call.
2. If the path is empty the field is silently skipped (logs a warning, does not fail the row).
3. If the file does not exist on disk → `FieldError` → row fails.
4. **Size check** (`file_max_mb`): if greater than `0`, the file's size in MB is compared. Exceeding the limit → `FieldError` → row fails.
5. **MIME check** (`file_accept`):
   - `"image"` — MIME must start with `image/` (covers `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`, `.bmp`, `.tiff`, etc.). Anything else → `FieldError`.
   - `"pdf"` — MIME must be one of: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`), `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`), `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` (`.pptx`), `text/plain`, `application/rtf`. Anything else → `FieldError`.
   - `"any"` (default) — no MIME check, any file is accepted.
6. `resolve_frame(page, selector)` is called (same helper used by every other field type) so the upload works even if the `<input type="file">` sits inside an iframe.
7. `el.set_input_files(path)` sets the file on the element. Playwright handles the OS file-picker bypass internally — no dialog appears in headless mode.

### Field mapping JSON shape

```jsonc
{
  "selector": "input[name=\"photo\"]",   // CSS selector for the <input type="file">
  "field_type": "file_upload",
  "source": "csv_column",               // or "literal"
  "csv_column": "PhotoPath",            // header name in the CSV/Excel file
  "literal_value": "",                  // used instead of csv_column when source = "literal"
  "file_source": "server_path",         // "server_path" | "local_disk" | "external_url"
  "file_accept": "image",              // "image" | "pdf" | "any"
  "file_max_mb": 2,                    // 0 = no limit; 2 = strict < 2 MB
  "value_map": []                       // not useful for file paths, keep empty
}
```

### What goes in the CSV column (depends on `file_source`)

`file_source` controls how the worker interprets the CSV value:

| `file_source` | What the CSV column must contain | When to use |
|---|---|---|
| `server_path` (default) | Absolute path on the server/container filesystem, e.g. `/app/storage/uploads/john.jpg` | File is already on the server (e.g. uploaded via the Uploads tab) |
| `local_disk` | Absolute container path inside `temp_attachments/`, e.g. `/app/storage/temp_attachments/john.jpg` | File lives on the operator's machine; they copy it to `./storage/temp_attachments/` on the host first |
| `external_url` | Full HTTP/HTTPS URL, e.g. `https://s3.amazonaws.com/bucket/john.jpg` or an S3 presigned URL | File is on S3 or any public/presigned HTTP endpoint |

### `local_disk` workflow (Docker)

Because the Docker container cannot see the operator's local filesystem, the file must be copied into the shared volume first:

1. Copy the file into `./storage/temp_attachments/` on the host machine (this folder maps to `/app/storage/temp_attachments/` inside the container). The folder is created automatically on first run.
2. In the CSV, put the container path: `/app/storage/temp_attachments/john.jpg`
3. Set `file_source` to `local_disk` in the Flow Builder.
4. Run the job — the worker copies the file to a job-scoped temp name, calls `set_input_files()`, then **auto-deletes the copy** after the upload completes (success or failure).

> The original file in `temp_attachments/` is **not** deleted — only the job-scoped copy is removed. If you want to clean up the originals, delete them from the Uploads tab or manually from the host folder.

### `external_url` workflow (S3 / remote links)

1. In the CSV, put the full URL of the file: `https://s3.amazonaws.com/your-bucket/john.jpg` (or an S3 presigned URL, or any direct HTTP link).
2. Set `file_source` to `external_url` in the Flow Builder.
3. Run the job — for each row the worker downloads the file to `storage/temp_attachments/` under a job-scoped name, calls `set_input_files()`, then **auto-deletes the downloaded file** immediately after.

> Private S3 files must use presigned URLs (which are time-limited). Public S3 URLs or CloudFront URLs work directly.

### `server_path` workflow (existing behaviour)

| Deployment | Example CSV value |
|---|---|
| Local machine (no Docker) | `/home/user/files/john_photo.jpg` or `C:\Users\user\files\john_photo.jpg` |
| Docker container | `/app/storage/uploads/john_photo.jpg` |
| Network share mounted into container | `/mnt/nas/docs/john_id.pdf` |

Use the RPA Studio **Uploads tab** to drag-and-drop files — they land at `/app/storage/uploads/{filename}` inside the container, which is the path to put in the CSV.

### Flow Builder UI

When `file_upload` is selected as the field type in a mapping row, a **"File Upload Constraints"** panel appears below the row showing:
- **File source** dropdown: `Server path (absolute)` / `Local disk (via temp folder)` / `External URL (S3 / HTTP link)` — a contextual hint line below the dropdown explains what the CSV column must contain for the selected source.
- **Accept type** dropdown: `Any document` / `Image only (image/*)` / `PDF / Document only`
- **Max size (MB)** number input: `0` = no limit; set `2` to enforce strictly less than 2 MB

These values are saved into the recipe JSON as `file_source`, `file_accept` and `file_max_mb` on the mapping object and round-trip correctly through Download JSON / Upload JSON.