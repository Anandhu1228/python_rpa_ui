"""
RPA Studio — FastAPI backend
"""
import uuid
import asyncio
import json
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect, BackgroundTasks, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState

from backend.routers import inspect_router, recipe_router, run_router
from backend.workers.job_store import job_store
from backend.auth import router as auth_router, is_valid_session

BASE = Path(__file__).parent.parent

app = FastAPI(title="RPA Studio", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/auth"):
        auth_header = request.headers.get("Authorization")
        token = None
        
        # 1. Try to get token from secure Authorization header (used by JS fetch)
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
        # 2. Fallback to URL query parameter (used by <video src="...">)
        elif "token" in request.query_params:
            token = request.query_params.get("token")
            
        if not token or not is_valid_session(token):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
            
    return await call_next(request)

# Mount routers
app.include_router(auth_router, prefix="/api")
app.include_router(inspect_router.router, prefix="/api")
app.include_router(recipe_router.router,  prefix="/api")
app.include_router(run_router.router,     prefix="/api")

# Serve frontend static files
app.mount("/static", StaticFiles(directory=str(BASE / "frontend")), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    return FileResponse(str(BASE / "frontend" / "index.html"))


async def _safe_send(websocket: WebSocket, payload: dict) -> bool:
    """Send JSON only if the socket is still connected. Returns False if the
    client is already gone (e.g. the tab was refreshed/closed), so the caller
    can stop instead of trying to keep using a dead connection."""
    if websocket.client_state != WebSocketState.CONNECTED:
        return False
    try:
        await websocket.send_json(payload)
        return True
    except Exception:
        return False


async def _safe_close(websocket: WebSocket):
    """Close the socket only if it's still open. Avoids
    'Cannot call "send" once a close message has been sent' when the
    client already disconnected on its own (e.g. page refresh)."""
    if websocket.client_state == WebSocketState.CONNECTED:
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/ws/run/{job_id}/logs")
async def run_logs_ws(websocket: WebSocket, job_id: str, start: int = 0, token: str = ""):
    if not is_valid_session(token):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    job = job_store.get(job_id)
    if not job:
        await _safe_send(websocket, {"type": "error", "msg": "Job not found"})
        await _safe_close(websocket)
        return

    sent = start
    last_action = None
    try:
        while True:
            logs = job_store.get_logs(job_id)
            if len(logs) > sent:
                for line in logs[sent:]:
                    if not await _safe_send(websocket, {"type": "log", "line": line}):
                        return  # client is gone — stop this orphaned loop
                sent = len(logs)

            status = job_store.get_status(job_id)
            if status in ("done", "error"):
                summary = job_store.get_summary(job_id)
                await _safe_send(websocket, {"type": "done", "status": status, "summary": summary})
                break

            action = job_store.get_pending_action(job_id)
            if action != last_action:
                if not await _safe_send(websocket, {"type": "action", "action": action}):
                    return  # client is gone — stop this orphaned loop
                last_action = action

            await asyncio.sleep(0.15)
    except WebSocketDisconnect:
        pass
    finally:
        await _safe_close(websocket)