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

TEMP_ATTACHMENTS_DIR = Path(__file__).parent.parent.parent / "storage" / "temp_attachments"
TEMP_ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False


# ──────────────────────────────────────────────────────────────
#  Structured log helpers
#  Every line is either a plain string (developer log) OR a
#  JSON-encoded envelope:  {"_t": "<type>", ...fields}
#  The frontend detects lines starting with {"_t": and routes
#  them into the "user" view; everything else goes to "dev" view.
# ──────────────────────────────────────────────────────────────

def log(job_id: str, msg: str):
    """Raw developer log line."""
    job_store.append_log(job_id, msg)
    print(msg, flush=True)


def ulog(job_id: str, event_type: str, **kwargs):
    """Structured user-friendly log event (JSON envelope)."""
    payload = json.dumps({"_t": event_type, **kwargs}, ensure_ascii=False)
    job_store.append_log(job_id, payload)
    print(payload, flush=True)


def load_data_file(path: str) -> List[Dict[str, str]]:
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
    source = mapping.get("source", "csv_column")
    if source == "literal":
        val = mapping.get("literal_value", "")
    elif source == "human_input":
        return ""
    else:
        col = mapping.get("csv_column", "")
        val = row.get(col, "").strip()

    value_map = mapping.get("value_map", [])
    if value_map:
        for vmap in value_map:
            if val == vmap.get("from_val"):
                return vmap.get("to_val")

    return val


def human_delay(ms: int, jitter_pct: float = 0.2):
    if ms <= 0:
        return
    jitter = ms * jitter_pct * (random.random() * 2 - 1)
    actual = max(10, ms + jitter)
    time.sleep(actual / 1000.0)


# ──────────────────────────────────────────────────────────────
#  iframe resolution helper
#  Returns the page/frame object that owns the given selector.
#  Checks the main page first, then all frames (iframes).
# ──────────────────────────────────────────────────────────────

def resolve_frame(page, selector: str, timeout_ms: int = 4000):
    """Return (frame_or_page, locator) for the first frame that has the selector."""
    try:
        loc = page.locator(selector).first
        loc.wait_for(state="attached", timeout=timeout_ms)
        return page, loc
    except Exception:
        pass
    for frame in page.frames:
        if frame == page.main_frame:
            continue
        try:
            loc = frame.locator(selector).first
            loc.wait_for(state="attached", timeout=timeout_ms)
            return frame, loc
        except Exception:
            continue
    return page, page.locator(selector).first


# ──────────────────────────────────────────────────────────────
#  Field-filling logic
# ──────────────────────────────────────────────────────────────

def fill_field(page, field_cfg: Dict, row: Dict[str, str], delay: Dict, job_id: str = None):
    selector   = field_cfg.get("selector", "")
    field_type = field_cfg.get("field_type", "text")
    value      = resolve_value(field_cfg, row)
    char_delay = delay.get("char_delay_ms", 0)
    action_to  = delay.get("action_timeout_ms", 8000)

    # ── human_input ──
    if field_type == "human_input":
        question = field_cfg.get("human_input_question", "Please provide the required input:")
        if job_id:
            log(job_id, f"    → [Human Input] Waiting for operator: {question}")
            ulog(job_id, "ask", question=question)
            job_store.set_pending_action(job_id, {"type": "human_input", "question": question})
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
                raise FieldError(f"Human input timed out for: {question}")
            log(job_id, f"    ✓ [Human Input] Received. Filling '{selector}'...")
            ulog(job_id, "answer", question=question, answer=resp)
            if selector:
                frame, el = resolve_frame(page, selector, action_to)
                el.wait_for(state="visible", timeout=action_to)
                el.click(timeout=action_to)
                el.fill("", timeout=action_to)
                el.fill(resp, timeout=action_to)
        return

    # ── split_fill ──
    if field_type == "split_fill":
        source = field_cfg.get("source", "csv_column")
        if source == "human_input":
            question = field_cfg.get("human_input_question", "Please provide the required input:")
            if job_id:
                log(job_id, f"    → [Human Input] Waiting for operator: {question}")
                ulog(job_id, "ask", question=question)
                job_store.set_pending_action(job_id, {"type": "human_input", "question": question})
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
                    raise FieldError(f"Human input timed out for: {question}")
                log(job_id, f"    ✓ [Human Input] Received. Splitting across boxes...")
                ulog(job_id, "answer", question=question, answer=resp)
                source_value = resp
            else:
                source_value = ""
        else:
            source_value = resolve_value(field_cfg, row)
        boxes = field_cfg.get("split_boxes", [])
        pos = 0
        for box in boxes:
            box_sel = box.get("selector", "")
            box_len = int(box.get("length", 1))
            chunk = source_value[pos:pos + box_len]
            pos += box_len
            if not box_sel:
                continue
            try:
                frame, el = resolve_frame(page, box_sel, action_to)
                el.wait_for(state="visible", timeout=action_to)
                el.click(timeout=action_to)
                el.fill("", timeout=action_to)
                el.fill(chunk, timeout=action_to)
                human_delay(delay.get("between_fields_ms", 100))
            except Exception as e:
                if job_id:
                    log(job_id, f"    ⚠ split_fill box '{box_sel}': {e}")
        return

    # ── file_upload ──
    # Uploads a file to an <input type="file"> element.
    # The CSV column (or literal value) must contain the absolute path of the
    # file on the server filesystem.
    # Three optional constraints are read from the mapping config:
    #   file_accept  : "image"  → only image/* MIME types
    #                  "pdf"    → only application/pdf and common doc types
    #                  "any"    → no MIME restriction (default)
    #   file_max_mb  : maximum allowed file size in MB (0 = no limit)
    # If a constraint is violated the field raises FieldError (row fails).
    if field_type == "file_upload":
        import mimetypes
        file_path = value.strip()
        if not file_path:
            if job_id:
                log(job_id, f"    ⚠ file_upload: no file path in CSV/literal for selector '{selector}' — skipping")
            return

        file_source = field_cfg.get("file_source", "server_path")
        _temp_file_to_cleanup = None  # track any temp file we create, so we can delete it after upload

        if file_source == "local_disk":
            # file_path is a path on the operator's local machine.
            # We cannot read the local disk from inside Docker — the user must have
            # placed the file under ./storage/temp_attachments/ (host) which maps to
            # /app/storage/temp_attachments/ (container).  We copy it into the same
            # temp folder under a job-scoped name so concurrent runs don't collide,
            # then delete the copy after set_input_files() completes.
            import shutil
            src = Path(file_path)
            if not src.exists():
                raise FieldError(
                    f"file_upload (local_disk): file not found in temp_attachments: {file_path}. "
                    f"Copy the file to ./storage/temp_attachments/ on the host first."
                )
            dest = TEMP_ATTACHMENTS_DIR / f"{job_id}_{src.name}"
            shutil.copy2(str(src), str(dest))
            _temp_file_to_cleanup = dest
            p_file = dest
            if job_id:
                log(job_id, f"    → [file_upload] local_disk: copied '{src.name}' to temp_attachments for upload")

        elif file_source == "external_url":
            # file_path is an HTTP/HTTPS URL (e.g. an S3 presigned URL or any public link).
            # Download it into temp_attachments/ under a job-scoped name, upload, then delete.
            import urllib.request
            import urllib.parse
            url_str = file_path
            parsed = urllib.parse.urlparse(url_str)
            url_filename = Path(parsed.path).name or "attachment"
            dest = TEMP_ATTACHMENTS_DIR / f"{job_id}_{url_filename}"
            if job_id:
                log(job_id, f"    → [file_upload] external_url: downloading '{url_filename}' to temp_attachments...")
            try:
                urllib.request.urlretrieve(url_str, str(dest))
            except Exception as dl_err:
                raise FieldError(f"file_upload (external_url): download failed for '{url_str}': {dl_err}")
            _temp_file_to_cleanup = dest
            p_file = dest
            if job_id:
                log(job_id, f"    ✓ [file_upload] external_url: downloaded '{url_filename}'")

        else:
            # "server_path" (default) — value is already an absolute path on the server filesystem
            p_file = Path(file_path)

        if not p_file.exists():
            raise FieldError(f"file_upload: file not found: {file_path}")

        # ── size check ──
        file_max_mb = float(field_cfg.get("file_max_mb", 0) or 0)
        if file_max_mb > 0:
            size_mb = p_file.stat().st_size / (1024 * 1024)
            if size_mb > file_max_mb:
                raise FieldError(
                    f"file_upload: file '{p_file.name}' is {size_mb:.2f} MB, "
                    f"exceeds limit of {file_max_mb} MB"
                )

        # ── MIME / accept check ──
        file_accept = field_cfg.get("file_accept", "any")
        mime_type, _ = mimetypes.guess_type(str(p_file))
        mime_type = mime_type or "application/octet-stream"

        if file_accept == "image":
            if not mime_type.startswith("image/"):
                raise FieldError(
                    f"file_upload: file '{p_file.name}' (MIME: {mime_type}) is not an image — "
                    f"only image/* files are accepted for this field"
                )
        elif file_accept == "pdf":
            # Accept PDF and common document types
            _PDF_DOC_MIMES = {
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-powerpoint",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "text/plain",
                "application/rtf",
            }
            if mime_type not in _PDF_DOC_MIMES:
                raise FieldError(
                    f"file_upload: file '{p_file.name}' (MIME: {mime_type}) is not an accepted "
                    f"PDF/document type for this field"
                )
        # "any" → no MIME restriction

        if job_id:
            log(job_id, f"    → [file_upload] Uploading '{p_file.name}' ({mime_type}) to '{selector}'...")
            ulog(job_id, "file_upload", selector=selector, filename=p_file.name, mime=mime_type)

        try:
            frame, el = resolve_frame(page, selector, action_to)
            el.wait_for(state="attached", timeout=action_to)
            el.set_input_files(str(p_file), timeout=action_to)
            if job_id:
                log(job_id, f"    ✓ [file_upload] '{p_file.name}' set successfully.")
        except Exception as e:
            raise FieldError(f"file_upload: could not set file on '{selector}': {e}")
        finally:
            # Clean up any temp file we created (local_disk copy or external_url download)
            if _temp_file_to_cleanup and _temp_file_to_cleanup.exists():
                try:
                    _temp_file_to_cleanup.unlink()
                    if job_id:
                        log(job_id, f"    → [file_upload] temp file '{_temp_file_to_cleanup.name}' removed.")
                except Exception:
                    pass
        return

    if not value and field_type not in ("checkbox", "click"):
        return

    try:
        if field_type in ("text", "password", "email", "tel", "number", "textarea"):
            frame, el = resolve_frame(page, selector, action_to)
            el.wait_for(state="visible", timeout=action_to)
            el.click(timeout=action_to)
            el.fill("", timeout=action_to)
            if char_delay > 0:
                for ch in value:
                    el.type(ch, delay=char_delay)
            else:
                el.fill(value, timeout=action_to)

        elif field_type == "select":
            frame, el = resolve_frame(page, selector, action_to)
            el.wait_for(state="visible", timeout=action_to)
            try:
                el.select_option(value=value, timeout=action_to)
            except Exception:
                try:
                    el.select_option(label=value, timeout=action_to)
                except Exception:
                    pass

        elif field_type == "radio":
            radio_sel = selector
            if value:
                name_match = field_cfg.get("radio_name", "")
                if name_match:
                    radio_sel = f'input[type="radio"][name="{name_match}"][value="{value}"]'
            frame, el = resolve_frame(page, radio_sel, action_to)
            el.first.click(timeout=action_to)

        elif field_type == "checkbox":
            frame, el = resolve_frame(page, selector, action_to)
            should_check = value.lower() in ("yes", "true", "1", "on", "checked")
            if should_check:
                if not el.is_checked():
                    el.check(timeout=action_to, force=True)
            else:
                if el.is_checked():
                    el.uncheck(timeout=action_to, force=True)

        elif field_type == "click":
            frame, el = resolve_frame(page, selector, action_to)
            el.click(timeout=action_to)

    except Exception as e:
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
    page_to   = delay.get("page_load_timeout_ms", 15000)
    action_to = delay.get("action_timeout_ms", 8000)

    for step in login_steps:
        url = step.get("url", "")
        if url:
            log(job_id, f"    → Navigating to {url}")
            page.goto(url)
            page.wait_for_load_state("networkidle", timeout=page_to)

        for field_cfg in step.get("fields", []):
            try:
                fill_field(page, field_cfg, {}, delay, job_id)
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

def execute_step(page, step: Dict, row: Dict[str, str], delay: Dict, job_id: str):
    """Execute one flow step for one CSV row. Returns (success: bool, active_page)."""
    label     = step.get("label", step.get("step_id", "?"))
    url       = step.get("url", "")
    page_to   = delay.get("page_load_timeout_ms", 15000)
    action_to = delay.get("action_timeout_ms", 8000)

    if step.get("skip_if_no_data", False):
        has_data = any(
            resolve_value(fm, row)
            for fm in step.get("field_mappings", [])
            if fm.get("source") == "csv_column"
        )
        if not has_data:
            log(job_id, f"    → Skipping step '{label}' (no data)")
            return True, page

    if url:
        log(job_id, f"    → [{label}] Navigating to {url}")
        ulog(job_id, "navigate", label=label, url=url)
        page.goto(url)
        page.wait_for_load_state("networkidle", timeout=page_to)

    for fm in step.get("field_mappings", []):
        try:
            fill_field(page, fm, row, delay, job_id)
            human_delay(delay.get("between_fields_ms", 100))
        except FieldError as e:
            log(job_id, f"    ⚠ {e}")

    # CAPTCHA / Human Handoff
    cap_img_sel = step.get("captcha_image_selector", "")
    cap_inp_sel = step.get("captcha_input_selector", "")
    if cap_img_sel and cap_inp_sel:
        log(job_id, f"    → [Human Handoff] Waiting for image/canvas '{cap_img_sel}'...")
        try:
            import base64
            # Try main page then iframes
            frame_obj = page
            try:
                el_check = page.locator(cap_img_sel).first
                el_check.wait_for(state="visible", timeout=action_to)
            except Exception:
                for fr in page.frames:
                    if fr == page.main_frame:
                        continue
                    try:
                        el_check = fr.locator(cap_img_sel).first
                        el_check.wait_for(state="visible", timeout=2000)
                        frame_obj = fr
                        break
                    except Exception:
                        continue

            el = frame_obj.locator(cap_img_sel).first
            el.wait_for(state="visible", timeout=action_to)
            img_bytes = el.screenshot(timeout=action_to)
            b64 = base64.b64encode(img_bytes).decode('utf-8')

            log(job_id, "    → [Human Handoff] Action required: Waiting for user to solve CAPTCHA via Chat...")
            ulog(job_id, "captcha", image_b64=b64)
            job_store.set_pending_action(job_id, {"type": "captcha", "image_b64": b64})

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
                ulog(job_id, "captcha_timeout")
                return False, page

            log(job_id, f"    ✓ [Human Handoff] Received response. Filling field...")
            ulog(job_id, "captcha_answer", answer=resp)

            inp_frame, inp_el = resolve_frame(page, cap_inp_sel, action_to)
            inp_el.wait_for(state="visible", timeout=action_to)
            inp_el.fill(resp, timeout=action_to)
            human_delay(delay.get("between_fields_ms", 100))

        except Exception as e:
            log(job_id, f"    ✗ [Human Handoff] Failed: {e}")
            job_store.clear_action(job_id)

    # Submit
    submit_sel  = step.get("submit_selector", "")
    opens_new_tab = step.get("opens_new_tab", False)

    if submit_sel:
        try:
            if opens_new_tab:
                log(job_id, f"    → [{label}] Clicking (expects new tab)...")
                ulog(job_id, "click", label=label, selector=submit_sel, context="new tab")
                with page.context.expect_page() as new_page_info:
                    page.locator(submit_sel).first.click(timeout=action_to)
                new_page = new_page_info.value
                new_page.wait_for_load_state("networkidle", timeout=page_to)
                log(job_id, f"    ✓ New tab opened: {new_page.url}")
                ulog(job_id, "new_tab", url=new_page.url)
                return True, new_page
            else:
                # Try main page first, then iframes
                clicked = False
                try:
                    page.locator(submit_sel).first.click(timeout=action_to)
                    clicked = True
                except Exception:
                    pass
                if not clicked:
                    for fr in page.frames:
                        if fr == page.main_frame:
                            continue
                        try:
                            fr.locator(submit_sel).first.click(timeout=2000)
                            clicked = True
                            log(job_id, f"    → [{label}] Clicked inside iframe")
                            break
                        except Exception:
                            continue
                if not clicked:
                    raise Exception(f"Could not find submit selector '{submit_sel}' on page or any iframe")
                log(job_id, f"    → [{label}] Clicked '{submit_sel}'")
                ulog(job_id, "click", label=label, selector=submit_sel, context="same tab")
        except Exception as e:
            log(job_id, f"    ✗ Submit failed on step '{label}': {e}")
            return False, page

    # Wait for URL
    wait_url = step.get("wait_for_url", "")
    if wait_url:
        try:
            page.wait_for_url(f"**{wait_url}**", timeout=page_to)
            log(job_id, f"    ✓ Step '{label}' — reached {page.url}")
            ulog(job_id, "reached", label=label, url=page.url)
        except Exception:
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
            return False, page

    # Wait for selector (try page + iframes)
    wait_sel = step.get("wait_for_selector", "")
    if wait_sel:
        found = False
        try:
            page.wait_for_selector(wait_sel, timeout=page_to)
            found = True
        except Exception:
            pass
        if not found:
            for fr in page.frames:
                if fr == page.main_frame:
                    continue
                try:
                    fr.wait_for_selector(wait_sel, timeout=2000)
                    found = True
                    break
                except Exception:
                    continue
        if not found:
            log(job_id, f"    ⚠ Step '{label}' — selector '{wait_sel}' not found")

    return True, page


# ──────────────────────────────────────────────────────────────
#  Main entry point
# ──────────────────────────────────────────────────────────────

def run_job(job_id: str, recipe: Dict, data_path: str, start_row: int = 1, end_row: Optional[int] = None):
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
        ulog(job_id, "start", total=len(batch), start=start_idx+1, end=end_idx)

        stats = {"success": 0, "failed": 0, "failed_ids": []}

        log(job_id, "🚀 Launching browser...")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                record_video_dir=str(RECORDINGS_DIR)
            )
            recorded_pages = []
            def _track_page(new_p):
                if new_p not in recorded_pages:
                    recorded_pages.append(new_p)
            context.on("page", _track_page)
            page = context.new_page()
            _track_page(page)

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
                row_id = next(iter(row.values()), str(i)) if row else str(i)
                log(job_id, "")
                log(job_id, f"{'='*56}")
                log(job_id, f"[{i}/{end_idx}] Row: {row_id}")
                log(job_id, f"{'='*56}")
                ulog(job_id, "row_start", row_num=i, row_total=end_idx, row_id=row_id)

                row_ok = True
                active_page = page
                for step in flow:
                    try:
                        ok, active_page = execute_step(active_page, step, row, delay, job_id)
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
                    ulog(job_id, "row_done", row_id=row_id, success=True)
                else:
                    stats["failed"] += 1
                    stats["failed_ids"].append(row_id)
                    log(job_id, f"  ❌ Row {row_id} — failed")
                    ulog(job_id, "row_done", row_id=row_id, success=False)
                    try:
                        base_url = recipe.get("base_url", "")
                        if base_url:
                            page.goto(base_url)
                            page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass

                human_delay(delay.get("between_records_ms", 800))

            all_pages = recorded_pages
            for tab_idx, p in enumerate(all_pages):
                try:
                    suffix = f"{job_id}.webm" if tab_idx == 0 else f"{job_id}_tab{tab_idx + 1}.webm"
                    if not p.is_closed():
                        p.close()
                    if p.video:
                        p.video.save_as(str(RECORDINGS_DIR / suffix))
                        p.video.delete()
                except Exception as e:
                    log(job_id, f"  ⚠ Could not process video for tab {tab_idx + 1}: {e}")

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
        ulog(job_id, "summary", success=stats["success"], failed=stats["failed"], failed_ids=stats.get("failed_ids", []))

        job_store.set_summary(job_id, stats)
        job_store.set_status(job_id, "done")

    except Exception as e:
        log(job_id, f"\n💥 Fatal error: {e}")
        import traceback
        log(job_id, traceback.format_exc())
        job_store.set_status(job_id, "error")
        job_store.set_summary(job_id, {"error": str(e)})