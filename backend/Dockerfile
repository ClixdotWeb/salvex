# Salvex API for Coolify (or any Docker host).
# Build:  docker build -t salvex-api ./backend
# Run migrations once per release (Coolify "pre-deployment command" or a one-off container):
#   alembic upgrade head
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app

# Uploaded KYC documents and photos. Mount a PERSISTENT volume here in Coolify.
RUN useradd --create-home --uid 10001 salvex && mkdir -p /data/private && chown -R salvex /data /app
ENV KYC_STORAGE_DIR=/data/private
USER salvex

EXPOSE 8000
# Keep ONE worker: the built-in rate limiter counts per process (the auction closer is safe either way).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
