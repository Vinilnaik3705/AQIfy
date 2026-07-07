# --- Build React Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Build Python Backend and Server ---
FROM python:3.11-slim
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy built frontend assets from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy backend files
COPY backend ./backend

# API keys (RESEND_API_KEY, BREVO_API_KEY, etc.) are injected at runtime
# via environment variables — do NOT COPY .env into the image.

# PORT is set by the hosting platform (Render, Railway, etc.)
# Default to 10000 (Render's default) if not set.
ENV PORT=10000
EXPOSE ${PORT}

WORKDIR /app/backend
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
