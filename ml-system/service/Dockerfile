# M5 render service (m5-cutover.md C3 / G3 — pinned runtime, reproducible builds).
# Build context is ALWAYS the ml-system/ root (it must contain fitted_core/ AND service/);
# ml-system/fly.toml pins this (`dockerfile = "service/Dockerfile"`, deploy = `cd ml-system
# && fly deploy`) and ml-system/.dockerignore keeps experiments//test assets out. Manually:
#   cd ml-system && docker build -f service/Dockerfile -t fitted-render-service .
FROM python:3.12-slim

WORKDIR /app

# Deps first (layer-cache friendly); exact pins only — see service/requirements.txt.
COPY service/requirements.txt /app/service/requirements.txt
RUN pip install --no-cache-dir -r /app/service/requirements.txt

# The substrate + the service (fitted_core gains no HTTP dependency; the service wraps it).
COPY fitted_core/ /app/fitted_core/
COPY service/ /app/service/

# Secrets/config come from Fly secrets at runtime (OPENAI_API_KEY, SERVICE_KEY_CURRENT,
# SERVICE_KEY_NEXT, M5_MAX_COMPLETION_TOKENS) — never baked into the image.
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "service.app:app", "--host", "0.0.0.0", "--port", "8080"]
