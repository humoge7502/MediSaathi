# MediSaathi API - verification-first prescription intelligence.
FROM python:3.12-slim

WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY packages/contracts packages/contracts
RUN pip install --no-cache-dir packages/contracts

COPY apps/api apps/api
RUN pip install --no-cache-dir "apps/api[prod]"

ENV MEDISAATHI_DB_PATH=/data/medisaathi.db
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s CMD curl -sf http://localhost:8000/healthz || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "apps/api"]
