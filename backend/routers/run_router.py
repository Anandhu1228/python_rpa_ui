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
from pydantic import BaseModel

from backend.workers.job_store import job_store
from backend.workers.playwright_worker import run_job

router = APIRouter()

UPLOADS_DIR = Path(__file__).parent.parent.parent / "storage" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
RECIPES_DIR = Path(__file__).parent.parent.parent / "storage" / "recipes"


@router.post("/run")
async def start_run(
    background_tasks: BackgroundTasks,
    recipe_id: str = Form(...),
    file: UploadFile = File(...),
    start_row: int = Form(1),
    end_row: Optional[int] = Form(None),
):
    # Load recipe
    recipe_path = RECIPES_DIR / f"{recipe_id}.json"
    if not recipe_path.exists():
        raise HTTPException(404, "Recipe not found")
    recipe = json.loads(recipe_path.read_text())

    # Save uploaded file
    job_id = str(uuid.uuid4())[:8]
    suffix = ".xlsx" if file.filename.endswith(".xlsx") else ".csv"
    upload_path = UPLOADS_DIR / f"{job_id}{suffix}"
    content = await file.read()
    upload_path.write_bytes(content)

    # Create job
    job_store.create(job_id)

    # Run in background thread (Playwright is sync)
    def _run():
        run_job(job_id, recipe, str(upload_path), start_row, end_row)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    return {"job_id": job_id, "status": "running"}


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
        "log_count": len(job.logs),
    }


@router.get("/run/{job_id}/logs")
async def get_logs(job_id: str, since: int = 0):
    """Polling fallback — returns logs from line `since`."""
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
