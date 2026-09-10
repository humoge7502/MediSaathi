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

.PHONY: setup test eval ablation audit demo-check bake-judge run web web-build web-typecheck web-selftest db-push docker clean

setup:            ## install contracts + api (editable) and dev deps
	cd packages/contracts && $(PY) -m pip install -e . -q
	cd $(API_DIR) && $(PY) -m pip install -e ".[dev]" -q
	@echo "setup complete"

test:             ## API tier: safety-plane properties + API golden paths + red-team
	cd $(API_DIR) && $(PY) -m pytest -q

eval:             ## fixture benchmark (A4 full pipeline)
	$(PY) eval/eval.py

ablation:         ## A1 (raw read, no gate) vs A4 (full) counterfactual table
	$(PY) eval/eval.py --ablation A1
	$(PY) eval/eval.py --ablation A4

audit:            ## static sanity: contracts importable, eval harness runs
	$(PY) -c "import medisaathi_contracts as m; print('contracts', m.__version__)"
	$(PY) eval/eval.py --json > /dev/null && echo "eval harness OK"

demo-check:       ## FULL offline demo gate - API tier (sealed cases + tests + eval)
	@echo "== demo-check: offline pipeline through sealed cases =="
	$(PY) tools/demo_check.py
	$(MAKE) -s test
	$(MAKE) -s eval

bake-judge:       ## re-bake the zero-network judge cache from the live pipeline
	$(PY) tools/bake_judge_cache.py

run:              ## local API on :8000
	cd $(API_DIR) && $(PY) -m uvicorn app.main:app --reload --port 8000

# ------------------------------------------------------------------ web tier
web:              ## web app dev server on :3000 (demo product)
	cd $(WEB_DIR) && bun install && bun run dev

web-build:        ## production standalone build
	cd $(WEB_DIR) && bun install && bun run db:generate && bun run build

web-typecheck:    ## web TypeScript check
	cd $(WEB_DIR) && bun run typecheck

web-selftest:     ## deterministic engine self-test (18 cases) + copilot gates
	cd $(WEB_DIR) && bun run selftest

db-push:          ## create/update the web SQLite schema
	cd $(WEB_DIR) && bun run db:push

web-check:        ## full web gate: typecheck + selftest + build
	cd $(WEB_DIR) && bun run typecheck && bun run selftest && bun run build

docker:           ## build + start api(:8000) and web(:3000)
	docker compose up --build -d
	@echo "api on :8000 (/docs) · web on :3000"

clean:
	find . -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; true
	rm -f $(API_DIR)/medisaathi.db $(API_DIR)/medisaathi.db-wal $(API_DIR)/medisaathi.db-shm 2>/dev/null; true
	rm -rf $(WEB_DIR)/.next $(WEB_DIR)/node_modules 2>/dev/null; true