# MediSaathi API - verification-first prescription intelligence.
#
# Hardened (audit MS-06): runs as a dedicated non-root user; curl is kept ONLY
# for the container healthcheck; the data volume is owned by the app user.
#
# 3.13 because that is the interpreter every API number in this repository was
# measured with (`.venv` is 3.13.6, `make test` runs through it). The image used
# to pin 3.12-slim, which made the artifact a *different runtime* than the 466
# passing tests describe — a version gap no test can see, because no test runs in
# the image.
FROM python:3.13-slim

WORKDIR /srv

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r medisaathi && useradd -r -g medisaathi -d /srv -s /usr/sbin/nologin medisaathi \
    && mkdir -p /data && chown medisaathi:medisaathi /data

# The image installs through the same pin file CI and the gates use. Without
# `-c constraints.txt` the prod extra resolves to whatever is newest on PyPI at
# build time, so two builds of the same commit can ship different FastAPI /
# Starlette / pydantic versions than the 466 passing tests measured.
COPY constraints.txt .
COPY packages/contracts packages/contracts
RUN pip install --no-cache-dir -c constraints.txt packages/contracts

COPY apps/api apps/api
# Corpus (brands/interactions/contraindications CSVs): the engine loads it
# from <root>/data by default (app/routers/api.py DATA_DIR -> /srv/data here).
# Verified live: without this line the container exits FileNotFoundError
# /srv/data/brands.csv at import time.
COPY data data/
RUN pip install --no-cache-dir -c constraints.txt "apps/api[prod]"

ENV MEDISAATHI_DB_PATH=/data/medisaathi.db
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s CMD curl -sf http://localhost:8000/healthz || exit 1
USER medisaathi
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "apps/api"]
