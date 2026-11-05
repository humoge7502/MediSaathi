#!/usr/bin/env python3
"""Re-derive every figure a document quotes as current, from a real run.

    python tools/check_claims.py                 # both suites, every doc site
    python tools/check_claims.py --tier web      # CI's web job (bun only)
    python tools/check_claims.py --tier api      # CI's api job (pytest only)
    python tools/check_claims.py --json          # machine-readable

`docs/TESTING.md`'s whole claim is that the numbers in it are measurements. The
gate that already protects the landing page (`apps/web/tests/claims.test.ts`)
derives those tiles from artifacts -- a corpus, a CSV, a version constant -- and
deliberately pins the *suite* figures as lower bounds, because a parametrized
case runs more times than it is written and no test can re-derive a run count
from inside a test. That exclusion is TD-16's remainder, and it has been
drifting: `RES-30` in `docs/TECH_DEBT.md` printed "20 contract tests" for a file
holding 19, the README/TESTING pair lagged the suite by four tests for two
passes, and the parity step *name* in CI quoted 148 cases while the corpus held
164. All three were found by hand, which is the argument for this tool.

So this tool does what a unit test cannot: it runs the suites, parses their own
summaries, and compares the measured numbers against every place a document
states them as current. Historical counts -- a changelog block about an older
pass, a `443->476` delta inside a RES row -- are not claims about now, so each
site is anchored to the phrasing that makes it present-tense, and a site whose
wording moved, matched twice, or matched nothing is reported as a failure rather
than guessed past. The parity figures are counted from the corpus file itself, so
they are checked on every tier without running either suite.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent

# Documents separate thousands with a plain space, an NBSP, a figure space or a
# narrow NBSP, and markdown bold sits right against the digits. Fold every space
# codepoint to " " by ordinal (so this file contains no invisible characters and
# no escape sequence Python warns about), then match on plain ASCII patterns.
SEPARATOR_CODES = (0x00A0, 0x2007, 0x202F, 0x2009, 0x0009)
NUM = r"\d[\d ]*"
# A dataset snapshot id is a digest, not a count: one wrong hex character is a
# wrong provenance claim, so it is derived and compared as a string.
HEX = r"[0-9a-f]{16}"
HEX_KEYS = frozenset({"dataset.snapshot"})


def _normalize(text: str) -> str:
    return "".join(" " if ord(ch) in SEPARATOR_CODES else ch for ch in text)


def _count(text: str) -> int:
    stripped = text.replace(" ", "")
    if not stripped.isdigit():
        raise ValueError(f"not a number after folding separators: {text!r}")
    return int(stripped)


# --------------------------------------------------------------------- measuring


def _run(cmd: list[str], cwd: Path) -> str:
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    out = proc.stdout + proc.stderr
    if proc.returncode != 0 and not re.search(r"^\s*\d+ fail", out, re.M):
        # A non-zero exit that reports no failures is the harness dying, not a red
        # suite -- bun missing, pytest unable to import. Say so instead of measuring
        # a number that was never produced.
        raise SystemExit(f"check_claims: {' '.join(cmd)} exited {proc.returncode}:\n{out[-2000:]}")
    return out


def measure_web() -> dict[str, int]:
    """`bun test`, parsed from its own summary block."""
    out = _run(["bun", "test", "tests/", "--timeout=20000"], REPO / "apps" / "web")

    def grab(pattern: str) -> int:
        m = re.search(pattern, out, re.M)
        if not m:
            raise SystemExit(
                f"check_claims: `bun test` output no longer matches /{pattern}/. "
                "Fix this parser before trusting a number that came from it."
            )
        return int(m.group(1))

    return {
        "web.pass": grab(r"^\s*(\d+) pass\s*$"),
        "web.fail": grab(r"^\s*(\d+) fail\s*$"),
        "web.assertions": grab(r"^\s*(\d+) expect\(\) calls\s*$"),
        "web.files": grab(r"Ran \d+ tests across (\d+) files"),
    }


def measure_api(python: str) -> dict[str, int]:
    """`pytest apps/api -q`, parsed from its own summary line."""
    out = _run([python, "-m", "pytest", "apps/api", "-q"], REPO)

    def grab(pattern: str) -> int | None:
        m = re.search(pattern, out)
        return int(m.group(1)) if m else None

    passed = grab(r"(\d+) passed")
    if passed is None:
        raise SystemExit(f"check_claims: `pytest -q` printed no pass summary:\n{out[-2000:]}")
    return {
        "api.pass": passed,
        "api.fail": grab(r"(\d+) failed") or 0,
        "api.error": grab(r"(\d+) error") or 0,
    }


def measure_parity() -> dict[str, int]:
    """The shared golden corpus, counted from the artifact both runners load."""
    path = REPO / "eval" / "parity" / "golden.json"
    if not path.exists():
        raise SystemExit(f"check_claims: missing parity corpus {path}")
    corpus = json.loads(path.read_text(encoding="utf-8"))
    return {
        "parity.cases": len(corpus["cases"]),
        "parity.version": int(corpus["parity_version"]),
    }


def measure_dataset() -> dict[str, str]:
    """The dataset identity, recomputed from the bytes on disk by the same
    function a run manifest uses.

    `README.md` and `docs/TESTING.md` both state "current snapshot `<hex>`" as a
    present-tense claim, and it is the one figure in either document that a code
    change cannot see: when the tracked set widened to `data/reference/` the id
    moved and every prose citation of it went stale with it. `ml.manifest` has no
    third-party imports, so deriving it costs eleven-to-twenty file hashes and no
    suite run.
    """
    sys.path.insert(0, str(REPO))
    from ml import manifest

    return {"dataset.snapshot": manifest.snapshot_id()}


# ---------------------------------------------------------------------- claiming
# `keys` maps capture groups 1..n onto measurement names, so a site's group count
# must equal its key count -- that is asserted at import, below. `pick` is for
# files that are *history*: only the newest block in them makes a present-tense
# claim, and an older block with an older number is correct, not stale. Which
# match is "newest" depends on how the file grows -- CHANGELOG prepends, so its
# newest block is the first; the resolved-debt table appends, so its newest row
# is the last. Getting that backwards pins the oldest claim in the file, which
# is worse than not checking: it goes red on the day the count is correct. A
# `n/n` pair is written as two groups rather than a backreference, so a document
# that says 164/163 fails instead of slipping through unmatched.
PICK_FIRST = "first"
PICK_LAST = "last"
SITES: list[dict[str, Any]] = [
    {
        "file": "README.md",
        "label": "README web-suite row",
        "re": rf"\| Web suite \(unit \+ route\) \| \*\*({NUM}) passing\*\* across "
        rf"({NUM}) files \(({NUM}) assertions\)",
        "keys": ["web.pass", "web.files", "web.assertions"],
    },
    {
        "file": "README.md",
        "label": "README API-suite row",
        "re": rf"\| API suite \| \*\*({NUM}) tests passing\*\*",
        "keys": ["api.pass"],
    },
    {
        "file": "README.md",
        "label": "README parity row",
        "re": rf"\*\*({NUM})/({NUM}) golden cases agree\*\* between the TypeScript and "
        rf"Python safety planes, from one shared versioned corpus \(parity law \*\*v({NUM})\*\*",
        "keys": ["parity.cases", "parity.cases", "parity.version"],
    },
    {
        "file": "docs/TESTING.md",
        "label": "TESTING latest-runs web bullet",
        "re": rf"- Web tier: \*\*({NUM}) tests / ({NUM}) files / ({NUM}) assertions\*\*",
        "keys": ["web.pass", "web.files", "web.assertions"],
    },
    {
        "file": "docs/TESTING.md",
        "label": "TESTING pyramid-table count",
        "re": rf"\| \*\*({NUM}) tests / ({NUM}) files / ({NUM}) assertions\*\* \|",
        "keys": ["web.pass", "web.files", "web.assertions"],
    },
    {
        "file": "docs/TESTING.md",
        "label": "TESTING latest-runs API bullet",
        "re": rf"- API tier: \*\*({NUM}) passed\*\*",
        "keys": ["api.pass"],
    },
    {
        "file": "docs/TESTING.md",
        "label": "TESTING parity bullet",
        "re": rf"- Cross-engine parity: \*\*({NUM})/({NUM}) golden cases agree in both "
        rf"planes\*\* at corpus law \*\*v({NUM})\*\*",
        "keys": ["parity.cases", "parity.cases", "parity.version"],
    },
    # The dataset identity two documents quote as present tense. It is derived from
    # disk by `ml.manifest.snapshot_id()` -- the same call a run manifest makes --
    # so a data edit or a widened tracked set turns this red instead of leaving a
    # stale provenance id in the README.
    {
        "file": "README.md",
        "label": "README evidence-chain snapshot",
        "re": rf"Current snapshot `({HEX})`",
        "keys": ["dataset.snapshot"],
    },
    {
        "file": "docs/TESTING.md",
        "label": "TESTING latest-runs snapshot",
        "re": rf"against dataset snapshot `({HEX})`",
        "keys": ["dataset.snapshot"],
    },
    {
        # The audit's page-1 table is a snapshot the reader meets first, which is
        # exactly why its web row is registered below -- but the API row beside it
        # was not, and it went stale on the day two tests landed. Same page, same
        # failure mode, same gate.
        "file": "docs/audit/PROJECT_ANALYSIS_2026-10.md",
        "label": "audit opening snapshot API row",
        "re": rf"\| API suite \| \*\*({NUM}) passed\*\*",
        "keys": ["api.pass"],
    },
    {
        "file": "docs/audit/PROJECT_ANALYSIS_2026-10.md",
        "label": "audit unit-tier row",
        "re": rf"\| Unit \(pure law\) \| ({NUM}) web tests / ({NUM}) assertions across "
        rf"({NUM}) files",
        "keys": ["web.pass", "web.assertions", "web.files"],
    },
    {
        "file": "docs/audit/PROJECT_ANALYSIS_2026-10.md",
        "label": "audit unit-tier expect column",
        "re": rf"`bun run test` . \*\*0 fail, ({NUM}) expect\(\) calls\*\*",
        "keys": ["web.assertions"],
    },
    {
        "file": "docs/audit/PROJECT_ANALYSIS_2026-10.md",
        "label": "audit parity summary row",
        "re": rf"\| Cross-engine parity \| \*\*({NUM})/({NUM})\*\* golden cases agree between "
        rf"TS and Python at corpus law v({NUM})",
        "keys": ["parity.cases", "parity.cases", "parity.version"],
    },
    {
        "file": "docs/audit/PROJECT_ANALYSIS_2026-10.md",
        "label": "audit conformance pyramid row",
        "re": rf"\| ({NUM})/({NUM}) golden cases, versioned law \(v({NUM})\), same corpus "
        rf"both runners",
        "keys": ["parity.cases", "parity.cases", "parity.version"],
    },
    {
        # Page 1 of the audit is a snapshot table, not prose a pass re-reads, so it was
        # the one figure nothing could see drift: 443 sat there a full day after the
        # suite had run 509. A number a reader meets first is the one that must be derived.
        "file": "docs/audit/PROJECT_ANALYSIS_2026-10.md",
        "label": "audit opening snapshot web row",
        "re": rf"\| Web suite \| \*\*({NUM}) tests / ({NUM}) files / ({NUM}) assertions\*\*, 0 fail",
        "keys": ["web.pass", "web.files", "web.assertions"],
    },
    {
        "file": "CHANGELOG.md",
        "label": "CHANGELOG newest 'Gates after this pass'",
        "re": rf"`bun run test` \*\*({NUM}) tests / ({NUM}) files / ({NUM}) assertions, "
        rf"0 fail\*\*",
        "keys": ["web.pass", "web.files", "web.assertions"],
        "pick": PICK_FIRST,
    },
    {
        "file": "docs/TECH_DEBT.md",
        "label": "TECH_DEBT newest 'Web suite after this pass'",
        "re": rf"Web suite after this pass: \*\*({NUM}) tests / ({NUM}) files / "
        rf"({NUM}) assertions\*\*",
        "keys": ["web.pass", "web.files", "web.assertions"],
        "pick": PICK_LAST,
    },
    {
        "file": ".github/workflows/ci.yml",
        "label": "CI parity step name",
        "re": rf"shared ({NUM})-case golden corpus",
        "keys": ["parity.cases"],
    },
]

for _site in SITES:
    _groups = re.compile(_site["re"]).groups
    if _groups != len(_site["keys"]):
        raise SystemExit(
            f"check_claims: site {_site['label']!r} captures {_groups} group(s) but "
            f"declares {len(_site['keys'])} key(s) -- one of them would be silently unchecked"
        )


def check(measured: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for site in SITES:
        path = REPO / site["file"]
        if not path.exists():
            rows.append({**site, "status": "FAIL: file missing", "values": ""})
            continue
        text = _normalize(path.read_text(encoding="utf-8", errors="replace"))
        matches = list(re.finditer(site["re"], text, re.M))
        if site.get("pick") == PICK_FIRST:
            matches = matches[:1]
        elif site.get("pick") == PICK_LAST:
            matches = matches[-1:]
        if not matches:
            rows.append({**site, "status": "FAIL: claim not found (its wording moved)", "values": ""})
            continue
        if len(matches) > 1:
            rows.append({**site, "status": f"FAIL: ambiguous ({len(matches)} matches)", "values": ""})
            continue
        m = matches[0]
        line = text[: m.start()].count("\n") + 1
        bad: list[str] = []
        shown: list[str] = []
        unmeasured: list[str] = []
        for i, key in enumerate(site["keys"], start=1):
            written = m.group(i) if key in HEX_KEYS else _count(m.group(i))
            if key not in measured:
                unmeasured.append(key)
                shown.append(f"{key}={written} (tier not run)")
                continue
            shown.append(f"{key}={written}")
            if written != measured[key]:
                bad.append(f"{key}: doc says {written}, the measurement says {measured[key]}")
        if bad:
            status = "FAIL: " + "; ".join(bad)
        elif unmeasured:
            # Calling a site OK because its number was never measured is how a gate
            # turns into decoration, so a partial run is reported as a partial result.
            status = "SKIP: unmeasured " + ", ".join(unmeasured)
        else:
            status = "OK"
        rows.append({**site, "line": line, "values": ", ".join(shown), "status": status})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Re-derive documented suite counts from a real run.")
    ap.add_argument("--tier", choices=["web", "api", "all"], default="all")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--python", default=sys.executable, help="interpreter for pytest")
    args = ap.parse_args()

    measured: dict[str, Any] = dict(measure_parity())
    measured.update(measure_dataset())
    if args.tier in ("web", "all"):
        measured.update(measure_web())
    if args.tier in ("api", "all"):
        measured.update(measure_api(args.python))

    rows = check(measured)
    failures = sorted(k for k in ("web.fail", "api.fail", "api.error") if measured.get(k, 0))
    bad_rows = [r for r in rows if r["status"].startswith("FAIL")]
    ok_rows = [r for r in rows if r["status"] == "OK"]

    if args.json:
        print(
            json.dumps(
                {
                    "measured": measured,
                    "tier": args.tier,
                    "sites": rows,
                    "suite_failures": failures,
                    "ok": not bad_rows and not failures,
                },
                indent=2,
            )
        )
    else:
        for key in sorted(measured):
            print(f"  measured {key:<16} {measured[key]}")
        print()
        for r in rows:
            loc = r["file"] + (f":{r['line']}" if r.get("line") else "")
            print(f"[{r['status']}] {r['label']}  {loc}  {r.get('values', '')}")
        print()
        if failures:
            print(f"FAIL: the suites are not clean: {failures}")
        if bad_rows:
            print(f"FAIL: {len(bad_rows)} doc site(s) state a number the measurement disagrees with")
        if not failures and not bad_rows:
            print(f"OK: {len(ok_rows)} doc site(s) match (tier={args.tier})")
    return 1 if (bad_rows or failures) else 0


if __name__ == "__main__":
    raise SystemExit(main())
