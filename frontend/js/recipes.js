/* recipes.js — Recipes tab */

async function loadRecipesList() {
  const container = document.getElementById('recipes-list');
  try {
    const recipes = await API.listRecipes();
    if (!recipes.length) {
      container.innerHTML = '<div class="empty-state">No recipes saved yet. Build one in the Flow Builder tab.</div>';
      return;
    }
    container.innerHTML = recipes.map(r => `
      <div class="recipe-card">
        <div class="recipe-card-name">${esc(r.name)}</div>
        <div class="recipe-card-url">${esc(r.base_url)}</div>
        ${r.description ? `<div class="recipe-card-desc">${esc(r.description)}</div>` : ''}
        <div class="row gap-sm" style="flex-wrap:wrap">
          <span class="badge badge-blue">${r.step_count} step${r.step_count !== 1 ? 's' : ''}</span>
          <span class="badge" style="font-family:var(--mono)">${r.recipe_id}</span>
        </div>
        <div class="recipe-card-actions">
          <button class="btn btn-sm btn-primary" onclick="editRecipe('${r.recipe_id}')">✏ Edit</button>
          <button class="btn btn-sm btn-green"   onclick="runRecipeQuick('${r.recipe_id}')">▶ Run</button>
          <button class="btn btn-sm btn-ghost"   onclick="downloadRecipe('${r.recipe_id}')">Download JSON</button>
          <button class="btn btn-sm btn-danger"  onclick="deleteRecipe('${r.recipe_id}')">🗑</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Error loading recipes: ${e.message}</div>`;
  }
}

async function editRecipe(id) {
  try {
    const recipe = await API.getRecipe(id);
    loadRecipeIntoFlow(recipe);
  } catch (e) {
    alert('Could not load recipe: ' + e.message);
  }
}

async function downloadRecipe(id) {
  try {
    const recipe = await API.getRecipe(id);
    const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${recipe.name || 'recipe'}.json`;
    a.click();
  } catch (e) {
     alert('Could not download recipe: ' + e.message);
  }
}

async function deleteRecipe(id) {
  if (!confirm('Delete this recipe?')) return;
  await API.deleteRecipe(id);
  loadRecipesList();
  populateRunRecipeSelect();
}

async function runRecipeQuick(id) {
  // Switch to Run tab and pre-select this recipe
  const select = document.getElementById('run-recipe-select');
  select.value = id;
  if (!select.value) {
    // option not yet populated — reload then set
    await populateRunRecipeSelect();
    select.value = id;
  }
  switchTab('run');
}

async function populateRunRecipeSelect() {
  const select = document.getElementById('run-recipe-select');
  const prev = select.value;
  try {
    const recipes = await API.listRecipes();
    select.innerHTML = '<option value="">— choose a recipe —</option>' +
      recipes.map(r => `<option value="${r.recipe_id}">${esc(r.name)} (${r.recipe_id})</option>`).join('');
    if (prev) select.value = prev;
  } catch (e) {
    console.warn('Could not load recipes for run select:', e);
  }
}