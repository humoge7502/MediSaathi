#!/usr/bin/env python3
"""Read the dependency pins back out of the built API image.

    python tools/check_container_pins.py          # needs `docker compose build` first
    python tools/check_container_pins.py --json   # machine-readable

`constraints.txt` exists because a floating install in CI once disagreed with the
machine the gates were run on. The Dockerfile had the same hole and nobody had
looked: it installed `packages/contracts` and `apps/api[prod]` with no `-c`, so
the image resolved whatever was newest on PyPI at build time and two builds of
the same commit could ship FastAPI / Starlette / pydantic versions that no test
in this repository had ever run. Fixing that line is one edit; the reason this
tool exists is that the fix cannot be seen. The image is green either way.

So the gate is two laws:
  1. Static -- every `pip install` in `apps/api/Dockerfile` carries
     `-c constraints.txt`. Without this, a pin check passes today and fails by
     luck the day upstream releases: the image only drifts once a newer release
     exists, which is exactly when nobody is looking.
  2. Measured -- the versions installed in the image equal the file, read out of
     the image's own metadata rather than trusted from the build log, and
     `pip check` reports no broken requirements.

Dev-only pins (pytest, hypothesis, ruff, httpx2) are not expected in the prod
image; if one appears it must still match. Any other pin missing from the image
is a failure -- that is how a pin that stopped reaching the image is caught.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONSTRAINTS = REPO / "constraints.txt"
DOCKERFILE = REPO / "apps" / "api" / "Dockerfile"
SERVICE = "api"
# Pins that the `prod` extra does not declare. Listed rather than inferred so a
# new pin has to be classified here instead of silently skipping its check.
DEV_ONLY = {"pytest", "hypothesis", "ruff", "httpx2"}

PROBE = r"""
import importlib.metadata as meta, json, sys
names = json.loads(sys.argv[1])
out = {}
for name in names:
    try:
        out[name] = meta.version(name)
    except meta.PackageNotFoundError:
        out[name] = None
print("PINS_JSON " + json.dumps(out, sort_keys=True))
"""


def parse_pins() -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in CONSTRAINTS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Za-z0-9_.\-]+)==([^\s;]+)", line)
        if not match:
            raise SystemExit(f"constraints.txt: cannot parse pin {line!r}")
        pins[match.group(1).lower()] = match.group(2)
    if not pins:
        raise SystemExit("constraints.txt: no pins found")
    return pins


def static_law() -> list[str]:
    """Every non-comment pip install must be constrained. Returns the failures."""
    failures: list[str] = []
    installs = 0
    for number, line in enumerate(DOCKERFILE.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#") or "pip install" not in stripped:
            continue
        installs += 1
        if "-c constraints.txt" not in stripped:
            failures.append(f"{DOCKERFILE.name}:{number}: unconstrained install -> {stripped}")
    if installs == 0:
        failures.append(f"{DOCKERFILE.name}: no `pip install` found - the install moved, update this gate")
    return failures


def in_image() -> tuple[dict[str, str | None], list[str]]:
    failures: list[str] = []
    pins = parse_pins()
    # `run` not `exec`: the gate must not require a booted stack, only a built image.
    probe = subprocess.run(
        ["docker", "compose", "run", "--rm", "--no-deps", "--entrypoint", "python",
         SERVICE, "-c", PROBE, json.dumps(sorted(pins))],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    installed: dict[str, str | None] = {}
    marker = "PINS_JSON "
    for line in probe.stdout.splitlines():
        if line.startswith(marker):
            installed = json.loads(line[len(marker):])
            break
    if not installed:
        failures.append(
            "could not read versions from the image - is it built? "
            f"(docker compose run rc {probe.returncode})"
        )
        for stream in (probe.stderr or "").strip().splitlines()[-5:]:
            failures.append(f"  {stream}")
        return installed, failures

    check = subprocess.run(
        ["docker", "compose", "run", "--rm", "--no-deps", SERVICE, "pip", "check"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    check_text = (check.stdout or "") + (check.stderr or "")
    if check.returncode != 0 or "No broken requirements found" not in check_text:
        failures.append(f"pip check failed in the image (rc {check.returncode})")

    for name, pinned in pins.items():
        actual = installed.get(name)
        if actual is None:
            if name not in DEV_ONLY:
                failures.append(f"{name}: pinned {pinned}, absent from the image")
            continue
        if actual != pinned:
            failures.append(f"{name}: pinned {pinned}, image has {actual}")
    return installed, failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="machine-readable result")
    args = parser.parse_args()

    pins = parse_pins()
    failures = static_law()
    installed: dict[str, str | None] = {}
    measured = not failures
    if measured:
        installed, image_failures = in_image()
        failures.extend(image_failures)

    checked = sum(1 for name in pins if installed.get(name) is not None)
    if args.json:
        print(json.dumps({
            "status": "FAIL" if failures else "OK",
            "pins": len(pins),
            "measured": measured,
            "checked_in_image": checked,
            "installed": installed,
            "failures": failures,
        }, indent=2))
    else:
        if measured:
            print(f"container pins: {len(pins)} in constraints.txt, {checked} checked in the image")
            for name in sorted(pins):
                actual = installed.get(name)
                if actual is None:
                    state = "dev-only, not in image" if name in DEV_ONLY else "MISSING"
                else:
                    state = actual if actual == pins[name] else f"{actual} != pin"
                print(f"  {name:16} {pins[name]:12} {state}")
        else:
            # The static law short-circuits: printing the table here would read as
            # "every pin is missing from the image" when nothing was measured.
            print(f"container pins: {len(pins)} in constraints.txt, not measured (static law failed)")
        for failure in failures:
            print(f"FAIL {failure}")
        if failures:
            print("container pins: FAIL")
        else:
            print("container pins: OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
