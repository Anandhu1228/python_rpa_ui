"""
Simple in-memory job store.
Maps job_id → { status, logs, summary }
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import threading


@dataclass
class Job:
    job_id: str
    status: str = "pending"          # pending | running | done | error
    logs: List[str] = field(default_factory=list)
    summary: Optional[dict] = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)


class JobStore:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, job_id: str) -> Job:
        with self._lock:
            job = Job(job_id=job_id)
            self._jobs[job_id] = job
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

    def set_status(self, job_id: str, status: str):
        job = self.get(job_id)
        if job:
            job.status = status

    def set_summary(self, job_id: str, summary: dict):
        job = self.get(job_id)
        if job:
            job.summary = summary

    def all_jobs(self):
        with self._lock:
            return [
                {"job_id": j.job_id, "status": j.status, "summary": j.summary}
                for j in self._jobs.values()
            ]


job_store = JobStore()
