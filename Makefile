# MediSaathi monorepo - the verbs your muscle memory needs.
#
# Two tiers:
#   apps/api  - FastAPI verification service (Python; the deep-verification tier)
#   apps/web  - self-contained Next.js fullstack app (bun; the demo product tier)
#
# make setup | test | lint | eval | demo-check | run | web | web-build | selftest | docker | container-pins

PY ?= python3
API_DIR := apps/api
WEB_DIR := apps/web

.PHONY: setup test lint eval ablation audit data-check claims-check demo-check bake-judge run parity parity-py experiments experiments-quick evidence binder web web-build web-typecheck web-selftest web-test web-check web-e2e db-push docker container-pins prove-atomicity bench clean

setup:            ## install contracts + api (editable) and dev deps
	cd packages/contracts && $(PY) -m pip install -e . -q
	cd $(API_DIR) && $(PY) -m pip install -e ".[dev]" -q
	@echo "setup complete"

test:             ## API tier: safety-plane properties + API golden paths + red-team + parity gate
	cd $(API_DIR) && $(PY) -m pytest -q

lint:             ## Python lint — the same command and paths CI runs (.github/workflows/ci.yml)
	$(PY) -m ruff check apps/api packages/contracts eval tools

eval:             ## fixture benchmark (A4 full pipeline)
	$(PY) eval/eval.py

ablation:         ## A1 (raw read, no gate) vs A4 (full) counterfactual table
	$(PY) eval/eval.py --ablation A1
	$(PY) eval/eval.py --ablation A4

audit:            ## static sanity: data gates, contracts importable, eval harness runs
	$(MAKE) -s data-check
	$(PY) -c "import medisaathi_contracts as m; print('contracts', m.__version__)"
	$(PY) eval/eval.py --json > /dev/null && echo "eval harness OK"

data-check:       ## derived-data gates: one identity per drug, no brand keyed to another drug, generated tables match their source, evidence manifest matches the bytes
	$(PY) tools/normalize_molecules.py --check
	$(PY) tools/repair_pmbjp_molecules.py --check
	$(PY) tools/build_dose_caps.py --check
	$(PY) tools/build_web_dataset.py --check
	$(PY) tools/build_corpus.py --verify

claims-check:     ## re-derive every documented suite count from a real run (TD-16's remainder): bun test + pytest, then each doc site that quotes them
	$(PY) tools/check_claims.py --tier all

parity:           ## cross-engine parity gate (ADR-0012/MED-015): both planes must agree on every case in the shared golden corpus (needs bun)
	$(MAKE) -s parity-py
	cd $(WEB_DIR) && bun run parity

parity-py:        ## Python-side parity gate — the API tier's engine-only check
	$(PY) eval/parity/parity.py

demo-check:       ## FULL offline demo gate - API tier (sealed cases + tests + eval + python parity)
	@echo "== demo-check: offline pipeline through sealed cases =="
	$(MAKE) -s data-check
	$(PY) tools/demo_check.py
	$(MAKE) -s test
	$(MAKE) -s eval
	$(MAKE) -s parity-py

bake-judge:       ## re-bake the zero-network judge cache from the live pipeline
	$(PY) tools/bake_judge_cache.py

prove-atomicity:  ## multi-process proof that the verdict tally cannot drift (RES-31)
# --baseline is on the make target and deliberately absent from the CI invocation:
# it is the only part of this command that quotes a latency number, and CI should
# fail on tally drift, not on a noisy machine. TD-30's write-rate band comes from
# here, which is why the number is reproducible with one verb.
	$(PY) tools/prove_tally_atomicity.py --workers 3 --rounds 1500 --baseline 3000

prove-boot-order: ## multi-process proof that the store opens WAL safely (RES-32)
	$(PY) tools/prove_wal_boot_order.py --trials 30 --workers 4

bench:            ## API latency battery, three transports (docs/PERFORMANCE.md)
	$(PY) tools/bench.py --requests 400 --transport asgi

run:              ## local API on :8000
	cd $(API_DIR) && $(PY) -m uvicorn app.main:app --reload --port 8000

# ------------------------------------------------------------------ evidence
# The evidence spine (MED-007..MED-020). Every reported number must come from a
# run manifest under eval/runs/; these targets produce and compile them.
experiments:      ## run E-A..E-H and archive a run manifest for each
	$(PY) tools/run_experiments.py --all

# same, with reduced case counts (fast smoke; does NOT overwrite eval/results)
experiments-quick: ## quick E-A..E-H smoke (small case counts)
	$(PY) tools/run_experiments.py --all --quick --json > /dev/null && echo "experiments quick: OK"

regimen-corpus:   ## rebuild the cross-prescription regimen corpus (mechanism A+B evidence)
	$(PY) tools/build_regimen_corpus.py

evidence:         ## compile archived runs into the web app evidence artifact
	$(PY) tools/export_evidence.py

binder:           ## build the patent evidence binder from the run archive
	$(PY) tools/build_binder.py

# ------------------------------------------------------------------ web tier
web:              ## web app dev server on :3000 (demo product)
	cd $(WEB_DIR) && bun install && bun run dev

web-build:        ## production standalone build
	cd $(WEB_DIR) && bun install && bun run db:generate && bun run build

web-typecheck:    ## web TypeScript check
	cd $(WEB_DIR) && bun run typecheck

web-selftest:     ## deterministic engine self-test (18 cases) + copilot gates
	cd $(WEB_DIR) && bun run selftest

web-test:         ## route-handler integration tests (isolated SQLite)
	cd $(WEB_DIR) && bun run test

web-check:        ## full web gate: lint + typecheck + selftest + parity + integration tests + build
	cd $(WEB_DIR) && bun run lint && bun run typecheck && bun run selftest && bun run parity && bun run test && bun run build

# On a Linux host with no window server this runs 42 of the 47 gates: the headed
# delivery file skips itself out loud, because headless Chromium has no notification
# platform to deliver to (docs/TESTING.md). CI gives it a display with `xvfb-run`.
web-e2e:          ## browser E2E: build + boot standalone + Playwright suite
	cd $(WEB_DIR) && bun run e2e

db-push:          ## create/update the web SQLite schema
	cd $(WEB_DIR) && bun run db:push

docker:           ## build + start web(:3000) and api(127.0.0.1:8000)
	docker compose up --build -d
	@echo "web on :3000 · api on 127.0.0.1:8000 (/docs) — loopback by design: nothing in apps/web calls it, and the API has no auth layer"
	@echo "fresh volume: docker compose run --rm schema   (one-shot; the schema is never pushed at boot — MS-05)"
	@echo "hosted origin: NEXT_PUBLIC_SITE_URL=https://your.origin make docker   (baked at BUILD time — a runtime env change does not move /sitemap.xml)"

container-pins:   ## the built API image runs exactly the pins in constraints.txt (needs `docker compose build`)
	$(PY) tools/check_container_pins.py

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; true
	rm -f $(API_DIR)/medisaathi.db $(API_DIR)/medisaathi.db-wal $(API_DIR)/medisaathi.db-shm 2>/dev/null; true
	rm -rf $(WEB_DIR)/.next $(WEB_DIR)/node_modules 2>/dev/null; true
