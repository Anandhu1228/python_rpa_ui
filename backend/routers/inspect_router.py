"""
POST /api/inspect
Body: { url, credentials: [{name, value}] }
Returns: { inputs, selects, buttons }
"""
import json
import subprocess
import sys
import tempfile
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class Credential(BaseModel):
    name: str
    value: str


class InspectRequest(BaseModel):
    url: str
    login_steps: Optional[List[Dict[str, Any]]] = None
    credentials: Optional[List[Credential]] = None


INSPECTOR_SCRIPT = """
import json, sys
from playwright.sync_api import sync_playwright

url = __URL__
login_steps = __LOGIN_STEPS__
credentials = __CREDENTIALS__

def inspect_page(page):
    inputs = []
    for el in page.locator("input").all():
        try:
            inputs.append({
                "type":        el.get_attribute("type") or "text",
                "name":        el.get_attribute("name"),
                "id":          el.get_attribute("id"),
                "placeholder": el.get_attribute("placeholder"),
                "value":       el.get_attribute("value"),
                "class":       el.get_attribute("class"),
            })
        except Exception:
            pass

    selects = []
    for el in page.locator("select").all():
        try:
            opts = []
            for opt in el.locator("option").all():
                try:
                    opts.append({"value": opt.get_attribute("value"), "text": opt.inner_text().strip()})
                except Exception:
                    pass
            selects.append({
                "name":    el.get_attribute("name"),
                "id":      el.get_attribute("id"),
                "options": opts,
            })
        except Exception:
            pass

    textareas = []
    for el in page.locator("textarea").all():
        try:
            textareas.append({
                "name":        el.get_attribute("name"),
                "id":          el.get_attribute("id"),
                "placeholder": el.get_attribute("placeholder"),
            })
        except Exception:
            pass

    buttons = []
    for el in page.locator("button").all():
        try:
            buttons.append({
                "text":  el.inner_text().strip(),
                "type":  el.get_attribute("type"),
                "id":    el.get_attribute("id"),
                "class": el.get_attribute("class"),
            })
        except Exception:
            pass

    return {"inputs": inputs, "selects": selects, "textareas": textareas, "buttons": buttons}


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    for step in (login_steps or []):
        page.goto(step["url"])
        page.wait_for_load_state("networkidle")
        for f in step.get("fields", []):
            try:
                page.fill(f["selector"], f.get("literal_value", ""))
            except Exception:
                pass
        if step.get("submit_selector"):
            try:
                page.click(step["submit_selector"])
                page.wait_for_load_state("networkidle")
            except Exception:
                pass
        if step.get("wait_for_url"):
            try:
                page.wait_for_url(f'**{step["wait_for_url"]}**', timeout=15000)
            except Exception:
                pass

    page.goto(url)
    page.wait_for_load_state("networkidle")
    result = inspect_page(page)
    result["final_url"] = page.url
    browser.close()

print(json.dumps(result))
"""


@router.post("/inspect")
async def inspect(req: InspectRequest):
    credentials_list = [c.dict() for c in (req.credentials or [])]
    script = INSPECTOR_SCRIPT
    script = script.replace("__URL__", repr(req.url))
    script = script.replace("__LOGIN_STEPS__", repr(req.login_steps or []))
    script = script.replace("__CREDENTIALS__", repr(credentials_list))

    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(script)
        tmp = f.name

    try:
        result = subprocess.run(
            [sys.executable, tmp],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode != 0:
            raise HTTPException(500, f"Inspector error: {result.stderr[-2000:]}")
        data = json.loads(result.stdout.strip())
        return data
    except json.JSONDecodeError:
        raise HTTPException(500, f"Could not parse inspector output: {result.stdout[:500]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Inspector timed out (60s)")
    finally:
        os.unlink(tmp)