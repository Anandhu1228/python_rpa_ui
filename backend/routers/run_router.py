"""
POST /api/run        → start a job
GET  /api/run        → list all jobs
GET  /api/run/{id}   → job status + summary
"""
import json
import uuid
import threading
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.workers.job_store import job_store
from backend.workers.playwright_worker import run_job

router = APIRouter()

UPLOADS_DIR = Path(__file__).parent.parent.parent / "storage" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
RECIPES_DIR = Path(__file__).parent.parent.parent / "storage" / "recipes"
RECORDINGS_DIR = Path(__file__).parent.parent.parent / "storage" / "recordings"
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
CAPTCHA_DIR = Path(__file__).parent.parent.parent / "storage" / "captcha"
CAPTCHA_DIR.mkdir(parents=True, exist_ok=True)

class ActionReq(BaseModel):
    response: str


@router.post("/run")
async def start_run(
    background_tasks: BackgroundTasks,
    recipe_id: str = Form(...),
    file: UploadFile = File(...),
    start_row: int = Form(1),
    end_row: Optional[int] = Form(None),
):
    recipe_path = RECIPES_DIR / f"{recipe_id}.json"
    if not recipe_path.exists():
        raise HTTPException(404, "Recipe not found")
    recipe = json.loads(recipe_path.read_text())

    job_id = str(uuid.uuid4())[:8]
    suffix = ".xlsx" if file.filename.endswith(".xlsx") else ".csv"
    upload_path = UPLOADS_DIR / f"{job_id}{suffix}"
    content = await file.read()
    upload_path.write_bytes(content)

    job_store.create(job_id, recipe.get("name", "Unknown Recipe"))

    def _run():
        run_job(job_id, recipe, str(upload_path), start_row, end_row)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return {"job_id": job_id, "status": "running"}


@router.post("/run/{job_id}/action")
async def submit_action(job_id: str, req: ActionReq):
    job_store.set_action_response(job_id, req.response)
    return {"success": True}


@router.get("/run")
async def list_runs():
    return job_store.all_jobs()


@router.get("/run/{job_id}")
async def get_run(job_id: str):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {
        "job_id": job_id,
        "status": job.status,
        "summary": job.summary,
        "log_count": len(job_store.get_logs(job_id)),
        "recipe_name": job.recipe_name
    }


@router.get("/run/{job_id}/logs")
async def get_logs(job_id: str, since: int = 0):
    job = job_store.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    logs = job_store.get_logs(job_id)
    return {
        "logs": logs[since:],
        "total": len(logs),
        "status": job.status,
        "summary": job.summary,
    }


@router.get("/run/{job_id}/video")
async def get_video(job_id: str, tab: int = 1):
    if tab <= 1:
        vid_path = RECORDINGS_DIR / f"{job_id}.webm"
    else:
        vid_path = RECORDINGS_DIR / f"{job_id}_tab{tab}.webm"
    if not vid_path.exists():
        raise HTTPException(404, "Recording not found")
    return FileResponse(path=str(vid_path), media_type="video/webm")

@router.get("/run/{job_id}/videos")
async def list_videos(job_id: str):
    available = []
    main = RECORDINGS_DIR / f"{job_id}.webm"
    if main.exists():
        available.append({"tab": 1, "label": "Main Tab", "url": f"/api/run/{job_id}/video?tab=1"})
    for tab_num in range(2, 10):
        p = RECORDINGS_DIR / f"{job_id}_tab{tab_num}.webm"
        if p.exists():
            available.append({"tab": tab_num, "label": f"Tab {tab_num}", "url": f"/api/run/{job_id}/video?tab={tab_num}"})
    return available


@router.delete("/run/{job_id}")
async def delete_run(job_id: str):
    job_store.delete(job_id)
    for pattern in [f"{job_id}.webm"] + [f"{job_id}_tab{t}.webm" for t in range(2, 10)]:
        vid_path = RECORDINGS_DIR / pattern
        if vid_path.exists():
            vid_path.unlink()
    for cap_file in CAPTCHA_DIR.glob(f"{job_id}_*.png"):
        cap_file.unlink()
    return {"deleted": job_id}


@router.get("/uploads")
async def list_uploads():
    files = []
    for f in UPLOADS_DIR.iterdir():
        if f.is_file() and not f.name.startswith("."):
            stat = f.stat()
            job_id = f.stem
            job = job_store.get(job_id)
            job_status = job.status if job else "Unknown (archived)"
            recipe_name = job.recipe_name if job else "Unknown Flow"
            files.append({
                "filename": f.name,
                "size": stat.st_size,
                "job_id": job_id,
                "job_status": job_status,
                "recipe_name": recipe_name
            })
    files.sort(key=lambda x: (UPLOADS_DIR / x["filename"]).stat().st_mtime, reverse=True)
    return files


@router.delete("/uploads/{filename}")
async def delete_upload(filename: str):
    p = UPLOADS_DIR / filename
    if p.exists():
        p.unlink()
    return {"deleted": filename}


@router.get("/uploads/{filename}")
async def download_upload(filename: str):
    p = UPLOADS_DIR / filename
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path=str(p), filename=filename)