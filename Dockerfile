# ── RPA Studio Dockerfile ─────────────────────────────────────
# Base: official Playwright Python image (includes Chromium + all deps)
FROM mcr.microsoft.com/playwright/python:v1.59.0-noble

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . /app/

# Ensure storage directories exist
RUN mkdir -p /app/storage/recipes /app/storage/uploads /app/storage/logs

# Set Python path so backend.* imports resolve correctly
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Expose the web server port
EXPOSE 10090

# Run FastAPI with uvicorn (production: no reload)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "10090"]
