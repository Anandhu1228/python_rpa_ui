"""
Disk-backed job store.
Maps job_id → { status, logs, summary, recipe_name, created_at }
Saves logs to storage/logs/<job_id>.log
Saves meta to storage/logs/<job_id>_meta.json
"""
import json
import threading
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, List, Optional

LOGS_DIR = Path(__file__).parent.parent.parent / "storage" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

@dataclass
class Job:
    job_id: str
    recipe_name: str = "Unknown Recipe"
    status: str = "pending"          # pending | running | done | error
    summary: Optional[dict] = None
    created_at: float = field(default_factory=time.time)
    logs: List[str] = field(default_factory=list)  # Keep in memory for fast websocket reads
    pending_action: Optional[dict] = None
    action_response: Optional[str] = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

class JobStore:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self._load_all_meta()

    def _meta_path(self, job_id: str) -> Path:
        return LOGS_DIR / f"{job_id}_meta.json"

    def _log_path(self, job_id: str) -> Path:
        return LOGS_DIR / f"{job_id}.log"

    def _load_all_meta(self):
        for p in LOGS_DIR.glob("*_meta.json"):
            try:
                job_id = p.name.replace("_meta.json", "")
                data = json.loads(p.read_text())
                job = Job(
                    job_id=job_id,
                    recipe_name=data.get("recipe_name", "Unknown Recipe"),
                    status=data.get("status", "unknown"),
                    summary=data.get("summary"),
                    created_at=data.get("created_at", time.time())
                )
                
                log_p = self._log_path(job_id)
                if log_p.exists():
                    job.logs = log_p.read_text(encoding="utf-8").splitlines()
                
                self._jobs[job_id] = job
            except Exception:
                pass

    def _save_meta(self, job: Job):
        data = {
            "job_id": job.job_id,
            "recipe_name": job.recipe_name,
            "status": job.status,
            "summary": job.summary,
            "created_at": job.created_at
        }
        self._meta_path(job.job_id).write_text(json.dumps(data, indent=2))

    def create(self, job_id: str, recipe_name: str = "Unknown Recipe") -> Job:
        with self._lock:
            job = Job(job_id=job_id, recipe_name=recipe_name)
            self._jobs[job_id] = job
            self._save_meta(job)
            self._log_path(job_id).write_text("")
            return job

    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def get_logs(self, job_id: str) -> List[str]:
        job = self.get(job_id)
        return job.logs[:] if job else []

    def get_status(self, job_id: str) -> str:
        job = self.get(job_id)
        return job.status if job else "unknown"

    def get_summary(self, job_id: str) -> Optional[dict]:
        job = self.get(job_id)
        return job.summary if job else None

    def append_log(self, job_id: str, line: str):
        job = self.get(job_id)
        if job:
            with job._lock:
                job.logs.append(line)
                with self._log_path(job_id).open("a", encoding="utf-8") as f:
                    f.write(line + "\n")

    def set_status(self, job_id: str, status: str):
        job = self.get(job_id)
        if job:
            with job._lock:
                job.status = status
                self._save_meta(job)

    def set_summary(self, job_id: str, summary: dict):
        job = self.get(job_id)
        if job:
            with job._lock:
                job.summary = summary
                self._save_meta(job)

    def delete(self, job_id: str):
        with self._lock:
            if job_id in self._jobs:
                del self._jobs[job_id]
            meta_path = self._meta_path(job_id)
            if meta_path.exists():
                meta_path.unlink()
            log_path = self._log_path(job_id)
            if log_path.exists():
                log_path.unlink()

    def all_jobs(self):
        with self._lock:
            jobs_list = [
                {
                    "job_id": j.job_id, 
                    "status": j.status, 
                    "summary": j.summary, 
                    "recipe_name": j.recipe_name,
                    "created_at": j.created_at
                }
                for j in self._jobs.values()
            ]
            jobs_list.sort(key=lambda x: x["created_at"], reverse=True)
            return jobs_list

    def set_pending_action(self, job_id: str, action: dict):
        job = self.get(job_id)
        if job:
            with job._lock:
                job.pending_action = action
                job.action_response = None

    def get_pending_action(self, job_id: str) -> Optional[dict]:
        job = self.get(job_id)
        return job.pending_action if job else None

    def set_action_response(self, job_id: str, response: str):
        job = self.get(job_id)
        if job:
            with job._lock:
                job.action_response = response

    def get_action_response(self, job_id: str) -> Optional[str]:
        job = self.get(job_id)
        return job.action_response if job else None

    def clear_action(self, job_id: str):
        job = self.get(job_id)
        if job:
            with job._lock:
                job.pending_action = None
                job.action_response = None

job_store = JobStore()