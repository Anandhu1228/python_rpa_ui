"""
Recipes = saved automation configurations (flow + field mappings + delays)
"""
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

RECIPES_DIR = Path(__file__).parent.parent.parent / "storage" / "recipes"
RECIPES_DIR.mkdir(parents=True, exist_ok=True)


class FlowStep(BaseModel):
    step_id: str
    label: str
    url: str                          # page URL (can be relative)
    # Field mappings: { field_selector -> csv_column | literal_value }
    field_mappings: List[Dict[str, Any]] = []
    
    # NEW: Steps to execute just for the inspector to reach this page
    inspection_steps: Optional[List[Dict[str, Any]]] = None
    
    submit_selector: Optional[str] = None
    wait_for_url: Optional[str] = None      # URL substring to wait for after submit
    wait_for_selector: Optional[str] = None
    skip_if_no_data: bool = False           # skip step if all mapped columns are empty


class DelayConfig(BaseModel):
    between_records_ms: int = 800       # ms between each CSV row
    between_fields_ms: int = 100        # ms between filling each field
    between_steps_ms: int = 300         # ms between flow steps
    char_delay_ms: int = 0              # ms between each character typed (0 = instant fill)
    page_load_timeout_ms: int = 15000
    action_timeout_ms: int = 8000


class Recipe(BaseModel):
    name: str
    description: Optional[str] = ""
    base_url: str
    flow: List[FlowStep] = []
    delay: DelayConfig = DelayConfig()
    # Login steps (executed once before the flow loop)
    login_steps: Optional[List[Dict[str, Any]]] = None


def recipe_path(recipe_id: str) -> Path:
    return RECIPES_DIR / f"{recipe_id}.json"


@router.post("/recipes")
async def create_recipe(recipe: Recipe):
    recipe_id = str(uuid.uuid4())[:8]
    data = recipe.dict()
    data["recipe_id"] = recipe_id
    data["created_at"] = datetime.utcnow().isoformat()
    recipe_path(recipe_id).write_text(json.dumps(data, indent=2))
    return {"recipe_id": recipe_id, **data}


@router.get("/recipes")
async def list_recipes():
    recipes = []
    for f in sorted(RECIPES_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            recipes.append({
                "recipe_id":   data["recipe_id"],
                "name":        data["name"],
                "description": data.get("description", ""),
                "base_url":    data.get("base_url", ""),
                "created_at":  data.get("created_at", ""),
                "step_count":  len(data.get("flow", [])),
            })
        except Exception:
            pass
    return recipes


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str):
    p = recipe_path(recipe_id)
    if not p.exists():
        raise HTTPException(404, "Recipe not found")
    return json.loads(p.read_text())


@router.put("/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, recipe: Recipe):
    p = recipe_path(recipe_id)
    if not p.exists():
        raise HTTPException(404, "Recipe not found")
    existing = json.loads(p.read_text())
    data = recipe.dict()
    data["recipe_id"] = recipe_id
    data["created_at"] = existing.get("created_at", "")
    data["updated_at"] = datetime.utcnow().isoformat()
    p.write_text(json.dumps(data, indent=2))
    return data


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str):
    p = recipe_path(recipe_id)
    if not p.exists():
        raise HTTPException(404, "Recipe not found")
    p.unlink()
    return {"deleted": recipe_id}