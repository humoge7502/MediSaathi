# MediSaathi API - verification-first prescription intelligence.
#
# Hardened (audit MS-06): runs as a dedicated non-root user; curl is kept ONLY
# for the container healthcheck; the data volume is owned by the app user.
FROM python:3.12-slim

WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r medisaathi && useradd -r -g medisaathi -d /srv -s /usr/sbin/nologin medisaathi \
    && mkdir -p /data && chown medisaathi:medisaathi /data

COPY packages/contracts packages/contracts
RUN pip install --no-cache-dir packages/contracts

COPY apps/api apps/api
RUN pip install --no-cache-dir "apps/api[prod]"

ENV MEDISAATHI_DB_PATH=/data/medisaathi.db
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s CMD curl -sf http://localhost:8000/healthz || exit 1
USER medisaathi
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "apps/api"]
