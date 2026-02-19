# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY futbol-mvp-web/package*.json ./
RUN npm ci
COPY futbol-mvp-web/ ./

# Set API base to empty string so frontend uses same origin in production
ENV VITE_API_BASE_URL=""
RUN npm run build

# Stage 2: Python backend
FROM python:3.13-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY app/ ./app/

# Copy built frontend to /app/static (served by FastAPI)
COPY --from=frontend-build /app/frontend/dist ./static/

# Railway provides PORT env var
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
