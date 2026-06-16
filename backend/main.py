"""
RPA Studio — FastAPI backend
"""
import uuid
import asyncio
import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import inspect_router, recipe_router, run_router
from backend.workers.job_store import job_store

BASE = Path(__file__).parent.parent

app = FastAPI(title="RPA Studio", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(inspect_router.router, prefix="/api")
app.include_router(recipe_router.router,  prefix="/api")
app.include_router(run_router.router,     prefix="/api")

# Serve frontend static files
app.mount("/static", StaticFiles(directory=str(BASE / "frontend")), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    return FileResponse(str(BASE / "frontend" / "index.html"))


@app.websocket("/ws/run/{job_id}/logs")
async def run_logs_ws(websocket: WebSocket, job_id: str, start: int = 0):
    await websocket.accept()
    job = job_store.get(job_id)
    if not job:
        await websocket.send_json({"type": "error", "msg": "Job not found"})
        await websocket.close()
        return

    sent = start
    try:
        while True:
            logs = job_store.get_logs(job_id)
            if len(logs) > sent:
                for line in logs[sent:]:
                    await websocket.send_json({"type": "log", "line": line})
                sent = len(logs)

            status = job_store.get_status(job_id)
            if status in ("done", "error"):
                summary = job_store.get_summary(job_id)
                await websocket.send_json({"type": "done", "status": status, "summary": summary})
                break

            await asyncio.sleep(0.15)
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()