"""
Playwright automation worker.
Reads a recipe (flow + field mappings + delays) and a CSV/Excel file,
then executes the automation for each row.
"""
import csv
import json
import time
import random
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.workers.job_store import job_store

# ── Try to import openpyxl for Excel support ───────────────────
try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False


# ──────────────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────────────

def log(job_id: str, msg: str):
    job_store.append_log(job_id, msg)
    print(msg, flush=True)


def load_data_file(path: str) -> List[Dict[str, str]]:
    """Load CSV or Excel into list of dicts."""
    p = Path(path)
    if p.suffix.lower() in (".xlsx", ".xls"):
        if not HAS_OPENPYXL:
            raise RuntimeError("openpyxl not installed — cannot read Excel files")
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h) if h is not None else "" for h in rows[0]]
        result = []
        for row in rows[1:]:
            result.append({
                headers[i]: (str(row[i]) if row[i] is not None else "")
                for i in range(len(headers))
            })
        wb.close()
        return result
    else:
        with open(p, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))


def resolve_value(mapping: Dict, row: Dict[str, str]) -> str:
    """
    A mapping entry has:
      - source: "csv_column" | "literal"
      - csv_column: str  (header name from file)
      - literal_value: str
      - value_map: List[Dict] (from_val -> to_val)
    Returns the resolved string value for this row.
    """
    source = mapping.get("source", "csv_column")
    if source == "literal":
        val = mapping.get("literal_value", "")
    else:
        col = mapping.get("csv_column", "")
        val = row.get(col, "").strip()

    # Apply inline data transformations
    value_map = mapping.get("value_map", [])
    if value_map:
        for vmap in value_map:
            if val == vmap.get("from_val"):
                return vmap.get("to_val")

    return val


def human_delay(ms: int, jitter_pct: float = 0.2):
    """Sleep for ms ± jitter, minimum 10 ms."""
    if ms <= 0:
        return
    jitter = ms * jitter_pct * (random.random() * 2 - 1)
    actual = max(10, ms + jitter)
    time.sleep(actual / 1000.0)


# ──────────────────────────────────────────────────────────────
#  Field-filling logic
# ──────────────────────────────────────────────────────────────

def fill_field(page, field_cfg: Dict, row: Dict[str, str], delay: Dict):
    """Fill a single field according to its config."""
    selector   = field_cfg.get("selector", "")
    field_type = field_cfg.get("field_type", "text")   # text|password|email|radio|checkbox|select|textarea|click
    value      = resolve_value(field_cfg, row)
    char_delay = delay.get("char_delay_ms", 0)
    action_to  = delay.get("action_timeout_ms", 8000)

    if not value and field_type not in ("checkbox", "click"):
        return  # nothing to fill

    try:
        if field_type in ("text", "password", "email", "tel", "number", "textarea"):
            el = page.locator(selector).first
            el.wait_for(state="visible", timeout=action_to)
            el.click(timeout=action_to)
            el.fill("", timeout=action_to)   # clear first
            if char_delay > 0:
                for ch in value:
                    el.type(ch, delay=char_delay)
            else:
                el.fill(value, timeout=action_to)

        elif field_type == "select":
            # value can be option value OR option label text
            el = page.locator(selector).first
            el.wait_for(state="visible", timeout=action_to)
            try:
                el.select_option(value=value, timeout=action_to)
            except Exception:
                try:
                    el.select_option(label=value, timeout=action_to)
                except Exception:
                    pass   # value not found — skip silently

        elif field_type == "radio":
            # selector should target the specific radio input
            # value in config can override the [value="x"] part
            radio_sel = selector
            if value:
                # Build a specific selector with value attribute
                name_match = field_cfg.get("radio_name", "")
                if name_match:
                    radio_sel = f'input[type="radio"][name="{name_match}"][value="{value}"]'
            page.locator(radio_sel).first.click(timeout=action_to)

        elif field_type == "checkbox":
            el = page.locator(selector).first
            should_check = value.lower() in ("yes", "true", "1", "on", "checked")
            if should_check:
                if not el.is_checked():
                    el.check(timeout=action_to)
            else:
                if el.is_checked():
                    el.uncheck(timeout=action_to)

        elif field_type == "click":
            # Just click an element (button/link) — value not used
            page.locator(selector).first.click(timeout=action_to)

    except Exception as e:
        # Non-fatal: log and continue
        raise FieldError(f"Field '{selector}' ({field_type}): {e}")


class FieldError(Exception):
    pass


# ──────────────────────────────────────────────────────────────
#  Login steps (run once before the loop)
# ──────────────────────────────────────────────────────────────

def execute_login_steps(page, login_steps: List[Dict], delay: Dict, job_id: str):
    if not login_steps:
        return
    log(job_id, "  → Executing login steps...")
    page_to  = delay.get("page_load_timeout_ms", 15000)
    action_to = delay.get("action_timeout_ms", 8000)

    for step in login_steps:
        url = step.get("url", "")
        if url:
            log(job_id, f"    → Navigating to {url}")
            page.goto(url)
            page.wait_for_load_state("networkidle", timeout=page_to)

        for field_cfg in step.get("fields", []):
            try:
                # login credentials are literal values
                fill_field(page, field_cfg, {}, delay)
                human_delay(delay.get("between_fields_ms", 100))
            except FieldError as e:
                log(job_id, f"    ⚠ {e}")

        submit_sel = step.get("submit_selector", "")
        if submit_sel:
            page.locator(submit_sel).first.click(timeout=action_to)
            page.wait_for_load_state("networkidle", timeout=page_to)

        wait_url = step.get("wait_for_url", "")
        if wait_url:
            try:
                page.wait_for_url(f"**{wait_url}**", timeout=page_to)
                log(job_id, f"    ✓ Reached {page.url}")
            except Exception:
                log(job_id, f"    ✗ Expected URL containing '{wait_url}', got {page.url}")


# ──────────────────────────────────────────────────────────────
#  Single flow step
# ──────────────────────────────────────────────────────────────

def execute_step(page, step: Dict, row: Dict[str, str], delay: Dict, job_id: str) -> bool:
    """Execute one flow step for one CSV row. Returns True on success."""
    label     = step.get("label", step.get("step_id", "?"))
    url       = step.get("url", "")
    page_to   = delay.get("page_load_timeout_ms", 15000)
    action_to = delay.get("action_timeout_ms", 8000)

    # Skip-if-no-data check
    if step.get("skip_if_no_data", False):
        has_data = any(
            resolve_value(fm, row)
            for fm in step.get("field_mappings", [])
            if fm.get("source") == "csv_column"
        )
        if not has_data:
            log(job_id, f"    → Skipping step '{label}' (no data)")
            return True

    # Navigate if URL given
    if url:
        log(job_id, f"    → [{label}] Navigating to {url}")
        page.goto(url)
        page.wait_for_load_state("networkidle", timeout=page_to)

    # Fill fields
    for fm in step.get("field_mappings", []):
        try:
            fill_field(page, fm, row, delay)
            human_delay(delay.get("between_fields_ms", 100))
        except FieldError as e:
            log(job_id, f"    ⚠ {e}")

    # Human Handoff / CAPTCHA processing
    cap_img_sel = step.get("captcha_image_selector", "")
    cap_inp_sel = step.get("captcha_input_selector", "")
    if cap_img_sel and cap_inp_sel:
        log(job_id, f"    → [Human Handoff] Waiting for image/canvas '{cap_img_sel}'...")
        try:
            import base64
            el = page.locator(cap_img_sel).first
            el.wait_for(state="visible", timeout=action_to)
            img_bytes = el.screenshot(timeout=action_to)
            b64 = base64.b64encode(img_bytes).decode('utf-8')

            log(job_id, "    → [Human Handoff] Action required: Waiting for user to solve CAPTCHA via Chat...")
            job_store.set_pending_action(job_id, {"type": "captcha", "image_b64": b64})

            # Wait up to 5 minutes for human input
            waited = 0
            resp = None
            while waited < 300:
                resp = job_store.get_action_response(job_id)
                if resp:
                    break
                time.sleep(1)
                waited += 1

            job_store.clear_action(job_id)

            if not resp:
                log(job_id, "    ✗ [Human Handoff] Timed out waiting for response (5 mins).")
                return False

            log(job_id, f"    ✓ [Human Handoff] Received response. Filling field...")
            inp = page.locator(cap_inp_sel).first
            inp.wait_for(state="visible", timeout=action_to)
            inp.fill(resp, timeout=action_to)
            human_delay(delay.get("between_fields_ms", 100))

        except Exception as e:
            log(job_id, f"    ✗ [Human Handoff] Failed: {e}")
            job_store.clear_action(job_id)
            return False

    # Submit
    submit_sel = step.get("submit_selector", "")
    if submit_sel:
        try:
            page.locator(submit_sel).first.click(timeout=action_to)
        except Exception as e:
            log(job_id, f"    ✗ Submit failed on step '{label}': {e}")
            return False

    # Wait for URL
    wait_url = step.get("wait_for_url", "")
    if wait_url:
        try:
            page.wait_for_url(f"**{wait_url}**", timeout=page_to)
            log(job_id, f"    ✓ Step '{label}' — reached {page.url}")
        except Exception:
            # Check for page errors
            errors = []
            try:
                errors = page.locator(
                    ".error, .errorlist, [class*='error'], .alert-danger, .alert"
                ).all_text_contents()
            except Exception:
                pass
            log(job_id, f"    ✗ Step '{label}' — expected URL '{wait_url}', got {page.url}")
            if errors:
                clean = [e.strip() for e in errors if e.strip()]
                log(job_id, f"    ✗ Page errors: {clean}")
            return False

    # Wait for selector
    wait_sel = step.get("wait_for_selector", "")
    if wait_sel:
        try:
            page.wait_for_selector(wait_sel, timeout=page_to)
        except Exception:
            log(job_id, f"    ⚠ Step '{label}' — selector '{wait_sel}' not found")

    return True


# ──────────────────────────────────────────────────────────────
#  Main entry point
# ──────────────────────────────────────────────────────────────

def run_job(job_id: str, recipe: Dict, data_path: str, start_row: int = 1, end_row: Optional[int] = None):
    """Called in a background thread."""
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    
    RECORDINGS_DIR = Path(__file__).parent.parent.parent / "storage" / "recordings"
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

    job_store.set_status(job_id, "running")
    delay = recipe.get("delay", {})

    try:
        log(job_id, "📂 Loading data file...")
        rows = load_data_file(data_path)
        total = len(rows)
        log(job_id, f"   Found {total} rows.")

        start_idx = max(0, start_row - 1)
        end_idx   = min(total, end_row) if end_row else total
        batch     = rows[start_idx:end_idx]

        if not batch:
            log(job_id, "❌ No rows to process.")
            job_store.set_status(job_id, "done")
            job_store.set_summary(job_id, {"success": 0, "failed": 0, "failed_ids": []})
            return

        log(job_id, f"   Processing rows {start_idx + 1}–{end_idx} ({len(batch)} records).")

        stats = {"success": 0, "failed": 0, "failed_ids": []}

        log(job_id, "🚀 Launching browser...")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                record_video_dir=str(RECORDINGS_DIR)
            )
            page = context.new_page()

            # Execute login steps once
            login_steps = recipe.get("login_steps") or []
            if login_steps:
                try:
                    execute_login_steps(page, login_steps, delay, job_id)
                except Exception as e:
                    log(job_id, f"  💥 Login failed: {e}")
                    browser.close()
                    job_store.set_status(job_id, "error")
                    return

            flow = recipe.get("flow", [])

            for i, row in enumerate(batch, start=start_idx + 1):
                # Use first column value as row ID, fallback to row number
                row_id = next(iter(row.values()), str(i)) if row else str(i)
                log(job_id, "")
                log(job_id, f"{'='*56}")
                log(job_id, f"[{i}/{end_idx}] Row: {row_id}")
                log(job_id, f"{'='*56}")

                row_ok = True
                for step in flow:
                    try:
                        ok = execute_step(page, step, row, delay, job_id)
                        if not ok:
                            row_ok = False
                            break
                        human_delay(delay.get("between_steps_ms", 300))
                    except Exception as e:
                        log(job_id, f"  💥 Unexpected error in step: {e}")
                        row_ok = False
                        break

                if row_ok:
                    stats["success"] += 1
                    log(job_id, f"  ✅ Row {row_id} — done")
                else:
                    stats["failed"] += 1
                    stats["failed_ids"].append(row_id)
                    log(job_id, f"  ❌ Row {row_id} — failed")
                    # Try to recover: navigate to a known safe URL
                    try:
                        base_url = recipe.get("base_url", "")
                        if base_url:
                            page.goto(base_url)
                            page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass

                # Delay between records
                human_delay(delay.get("between_records_ms", 800))

            # Save and rename the video recording safely before closing
            try:
                page.close()
                if page.video:
                    page.video.save_as(str(RECORDINGS_DIR / f"{job_id}.webm"))
                    page.video.delete()
            except Exception as e:
                log(job_id, f"  ⚠ Could not process video file: {e}")

            context.close()
            browser.close()

        log(job_id, "")
        log(job_id, "=" * 56)
        log(job_id, "📊 RUN SUMMARY")
        log(job_id, "=" * 56)
        log(job_id, f"  ✅ Success : {stats['success']}")
        log(job_id, f"  ❌ Failed  : {stats['failed']}")
        if stats["failed_ids"]:
            log(job_id, f"  Failed IDs: {', '.join(str(x) for x in stats['failed_ids'])}")
        log(job_id, "=" * 56)

        job_store.set_summary(job_id, stats)
        job_store.set_status(job_id, "done")

    except Exception as e:
        log(job_id, f"\n💥 Fatal error: {e}")
        import traceback
        log(job_id, traceback.format_exc())
        job_store.set_status(job_id, "error")
        job_store.set_summary(job_id, {"error": str(e)})