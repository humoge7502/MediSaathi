# MediSaathi monorepo - the verbs your muscle memory needs.
#
# Two tiers:
#   apps/api  - FastAPI verification service (Python; the deep-verification tier)
#   apps/web  - self-contained Next.js fullstack app (bun; the demo product tier)
#
# make setup | test | eval | demo-check | run | web | web-build | selftest | docker

PY ?= python3
API_DIR := apps/api
WEB_DIR := apps/web

.PHONY: setup test eval ablation audit demo-check bake-judge run parity parity-py experiments experiments-quick evidence binder web web-build web-typecheck web-selftest web-test web-check web-e2e db-push docker clean

setup:            ## install contracts + api (editable) and dev deps
	cd packages/contracts && $(PY) -m pip install -e . -q
	cd $(API_DIR) && $(PY) -m pip install -e ".[dev]" -q
	@echo "setup complete"

test:             ## API tier: safety-plane properties + API golden paths + red-team + parity gate
	cd $(API_DIR) && $(PY) -m pytest -q

eval:             ## fixture benchmark (A4 full pipeline)
	$(PY) eval/eval.py

ablation:         ## A1 (raw read, no gate) vs A4 (full) counterfactual table
	$(PY) eval/eval.py --ablation A1
	$(PY) eval/eval.py --ablation A4

audit:            ## static sanity: contracts importable, eval harness runs
	$(PY) -c "import medisaathi_contracts as m; print('contracts', m.__version__)"
	$(PY) eval/eval.py --json > /dev/null && echo "eval harness OK"

parity:           ## cross-engine parity gate (ADR-0012/MED-015): both planes must agree 110/110 on the shared golden corpus (needs bun)
	$(MAKE) -s parity-py
	cd $(WEB_DIR) && bun run parity

parity-py:        ## Python-side parity gate (110/110) — the API tier's engine-only check
	$(PY) eval/parity/parity.py

demo-check:       ## FULL offline demo gate - API tier (sealed cases + tests + eval + python parity)
	@echo "== demo-check: offline pipeline through sealed cases =="
	$(PY) tools/demo_check.py
	$(MAKE) -s test
	$(MAKE) -s eval
	$(MAKE) -s parity-py

bake-judge:       ## re-bake the zero-network judge cache from the live pipeline
	$(PY) tools/bake_judge_cache.py

run:              ## local API on :8000
	cd $(API_DIR) && $(PY) -m uvicorn app.main:app --reload --port 8000

# ------------------------------------------------------------------ evidence
# The evidence spine (MED-007..MED-020). Every reported number must come from a
# run manifest under eval/runs/; these targets produce and compile them.
experiments:      ## run E-A..E-G and archive a run manifest for each
	$(PY) tools/run_experiments.py --all

# same, with reduced case counts (fast smoke; does NOT overwrite eval/results)
experiments-quick: ## quick E-A..E-G smoke (small case counts)
	$(PY) tools/run_experiments.py --all --quick --json > /dev/null && echo "experiments quick: OK"

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

web-e2e:          ## browser E2E: build + boot standalone + Playwright suite
	cd $(WEB_DIR) && bun run e2e

db-push:          ## create/update the web SQLite schema
	cd $(WEB_DIR) && bun run db:push

docker:           ## build + start api(:8000) and web(:3000)
	docker compose up --build -d
	@echo "api on :8000 (/docs) · web on :3000"

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; true
	rm -f $(API_DIR)/medisaathi.db $(API_DIR)/medisaathi.db-wal $(API_DIR)/medisaathi.db-shm 2>/dev/null; true
	rm -rf $(WEB_DIR)/.next $(WEB_DIR)/node_modules 2>/dev/null; true
