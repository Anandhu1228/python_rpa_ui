import sqlite3
import time
import secrets
import hashlib
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

DB_PATH = Path(__file__).parent.parent / "storage" / "auth.db"

router = APIRouter()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT,
            security_pin TEXT,
            security_question TEXT,
            security_answer_hash TEXT
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            expires_at REAL
        )''')

init_db()

def hash_str(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def is_valid_session(token: str) -> bool:
    if not token: return False
    with get_db() as conn:
        row = conn.execute("SELECT expires_at FROM sessions WHERE token = ?", (token,)).fetchone()
        if row and row["expires_at"] > time.time():
            return True
        if row:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return False

class SignupReq(BaseModel):
    username: str
    password: str
    security_pin: str
    security_question: str
    security_answer: str

class LoginReq(BaseModel):
    username: str
    password: str

class ResetReq(BaseModel):
    username: str
    security_pin: str
    security_answer: str
    new_password: str

@router.get("/auth/status")
def auth_status():
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        return {"has_users": count > 0}

@router.post("/auth/signup")
def signup(req: SignupReq):
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        if count > 0:
            raise HTTPException(400, "A user already exists. Only one user is allowed.")
        
        conn.execute(
            "INSERT INTO users (username, password_hash, security_pin, security_question, security_answer_hash) VALUES (?, ?, ?, ?, ?)",
            (req.username, hash_str(req.password), req.security_pin, req.security_question, hash_str(req.security_answer.lower().strip()))
        )
        return {"success": True}

@router.post("/auth/login")
def login(req: LoginReq):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user or user["password_hash"] != hash_str(req.password):
            raise HTTPException(401, "Invalid username or password")
        
        token = secrets.token_hex(32)
        expires = time.time() + (7 * 24 * 3600) # 7 days
        conn.execute("INSERT INTO sessions (token, expires_at) VALUES (?, ?)", (token, expires))
        return {"token": token}

@router.post("/auth/logout")
def logout(token: str):
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    return {"success": True}

@router.get("/auth/question")
def get_question(username: str):
    with get_db() as conn:
        user = conn.execute("SELECT security_question FROM users WHERE username = ?", (username,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        return {"question": user["security_question"]}

@router.post("/auth/reset")
def reset_password(req: ResetReq):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user:
            raise HTTPException(404, "User not found")
        if user["security_pin"] != req.security_pin or user["security_answer_hash"] != hash_str(req.security_answer.lower().strip()):
            raise HTTPException(401, "Invalid security PIN or answer")
        
        conn.execute("UPDATE users SET password_hash = ? WHERE username = ?", (hash_str(req.new_password), req.username))
        conn.execute("DELETE FROM sessions") # Invalidate all sessions to enforce re-login
        return {"success": True}