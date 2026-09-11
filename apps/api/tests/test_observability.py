"""Observability tests: JSON logs, latency SLOs, Prometheus exposition.

The law: observability must be *demonstrated*, not claimed. Every claim in the
README's "measured, not claimed" table is pinned here:
  * logs are JSON-lines (one object per line, machine-parseable)
  * /slo reports p50/p95/p99 that include the requests made in this test
  * /metrics.prometheus parses as the Prometheus text format (HELP/TYPE pairs,
    valid metric lines, escaped labels) and counts match /metrics
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.main import app  # noqa: E402

client = TestClient(app)


# ------------------------------------------------------------------- logging
def test_json_log_lines_are_machine_parseable():
    """One JSON object per line, with the structured fields we promise."""
    from app.obs import _JsonFormatter
    rec = logging.LogRecord(
        "medisaathi", logging.INFO, __file__, 1,
        "http_request", (), None)
    rec.request_id = "abc123"
    rec.route = "/api/v1/prescriptions"
    rec.method = "POST"
    rec.status = 200
    rec.latency_ms = 12
    line = _JsonFormatter().format(rec)
    payload = json.loads(line)  # must parse
    assert payload["msg"] == "http_request"
    assert payload["request_id"] == "abc123"
    assert payload["route"] == "/api/v1/prescriptions"
    assert payload["status"] == 200
    assert payload["latency_ms"] == 12
    assert payload["level"] == "info"
    # ts is ISO-8601-ish with milliseconds
    assert re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", payload["ts"])


def test_log_event_whitelists_fields():
    """Random kwargs must not leak uncontrolled keys into the log stream."""
    from app.obs import _JsonFormatter, log_event
    stream = __import__("io").StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(_JsonFormatter())
    logger = logging.getLogger("medisaathi.obs-test")
    logger.addHandler(handler)
    logger.propagate = False
    old = logger.handlers[:]
    logger.handlers = [handler]
    try:
        log_event.__globals__["logging"].getLogger("medisaathi.obs-test").info(
            "probe", extra={"route": "/x", "secret": "nope"})
    finally:
        logger.handlers = old
    payload = json.loads(stream.getvalue().splitlines()[-1])
    assert "secret" not in payload  # unwhitelisted extras dropped
    assert payload["route"] == "/x"


# ----------------------------------------------------------------- /slo
def test_slo_reports_percentiles_for_observed_routes():
    """/slo includes the routes this test just hit, with sane percentiles."""
    for _ in range(3):
        client.get("/healthz")
    data = client.get("/slo").json()
    assert data["window_per_route"] == 512
    eps = data["endpoints"]
    assert "/healthz" in eps, f"healthz not tracked: {list(eps)}"
    get = eps["/healthz"]["GET"]
    assert get["n"] >= 3
    assert 0 <= get["p50_ms"] <= get["p95_ms"] <= get["p99_ms"] + 1e-9
    assert get["p99_ms"] <= get["max_ms"] + 1e-9
    # write routes appear under their method too
    assert "POST /api/v1/prescriptions" not in json.dumps(data)  # no raw concat bugs


def test_slo_percentile_math_on_known_input():
    """Nearest-rank percentile against a hand-checked series."""
    from app.obs import LatencyTracker, _percentile
    vals = sorted([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    assert _percentile(vals, 50) == 50
    assert _percentile(vals, 95) == 100  # ceil-style nearest-rank
    assert _percentile([], 50) == 0.0
    t = LatencyTracker()
    for v in (5, 5, 5):
        t.observe("GET", "/t", v)
    s = t.summary()["/t"]["GET"]
    assert s["n"] == 3 and s["p50_ms"] == 5


def test_latency_tracker_is_bounded():
    """Memory law: never more than WINDOW observations per route."""
    from app.obs import LatencyTracker
    t = LatencyTracker()
    for i in range(2000):
        t.observe("GET", "/flood", i)
    with t._lock:
        assert len(t._rings[("GET", "/flood")]) == LatencyTracker.WINDOW


# ------------------------------------------------------- prometheus endpoint
_PROM_LINE = re.compile(
    r"^(?P<metric>[a-zA-Z_:][a-zA-Z0-9_:]*)(\{(?P<labels>.+)\})?\s+(?P<value>-?\d+(\.\d+)?)$")


def _parse_prometheus(text: str) -> list[dict]:
    """Parse the exposition format. Label values may legally contain braces
    (e.g. route templates like /cases/{sample_id}/cached) — only backslash,
    quote and newline are escaped inside quoted values, so the labels block is
    matched greedily to the LAST '}' on the line."""
    out = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        m = _PROM_LINE.match(line)
        assert m, f"invalid prometheus line: {line!r}"
        labels = {}
        if m.group("labels"):
            for pair in re.findall(r'(\w+)="((?:[^"\\]|\\.)*)"', m.group("labels")):
                labels[pair[0]] = pair[1].replace('\\"', '"').replace("\\n", "\n").replace("\\\\", "\\")
        out.append({"metric": m.group("metric"), "labels": labels, "value": float(m.group("value"))})
    return out


def test_prometheus_exposition_parses_and_counts_match():
    """/metrics.prometheus: valid text format; counters agree with /metrics."""
    r = client.get("/metrics.prometheus")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    series = _parse_prometheus(r.text)
    assert series, "no metric lines"
    names = {s["metric"] for s in series}
    assert "medisaathi_pipeline_started_total" in names
    assert "medisaathi_verdict_total" in names
    # every HELP has a TYPE
    helps = [ln for ln in r.text.splitlines() if ln.startswith("# HELP")]
    types = [ln for ln in r.text.splitlines() if ln.startswith("# TYPE")]
    assert {h.split()[2] for h in helps} == {t.split()[2] for t in types}
    # counts must match the JSON /metrics endpoint
    j = client.get("/metrics").json()
    started = next(s for s in series if s["metric"] == "medisaathi_pipeline_started_total")
    assert started["value"] == j["pipeline_started_total"]
    verdict_series = {s["labels"].get("kind"): s["value"]
                      for s in series if s["metric"] == "medisaathi_verdict_total"}
    assert verdict_series == {k: float(v) for k, v in j["verdicts"].items()}


def test_prometheus_label_escaping():
    """Labels are escaped per the exposition format (quotes, backslash, newline)."""
    from app.obs import _escape_label, render_prometheus
    assert _escape_label('a"b\\c\nd') == 'a\\"b\\\\c\\nd'
    text = render_prometheus(pipeline_started=1,
                             verdicts={'weird"kind': 2, "refused": 3},
                             schema_failures=0)
    series = _parse_prometheus(text)  # must still parse
    weird = next(s for s in series if s["labels"].get("kind") == 'weird"kind')
    assert weird["value"] == 2
    refused = next(s for s in series if s["labels"].get("kind") == "refused")
    assert refused["value"] == 3


def test_prometheus_latency_summary_present_after_traffic():
    """/metrics.prometheus carries the latency summary once traffic was served."""
    client.get("/readyz")
    text = client.get("/metrics.prometheus").text
    series = _parse_prometheus(text)
    lat = [s for s in series if s["metric"] == "medisaathi_http_request_duration_ms"]
    assert lat, "no latency quantile series"
    q50 = [s for s in lat if s["labels"].get("quantile") == "0.5"]
    assert q50, "missing 0.5 quantile"
    counts = [s for s in series if s["metric"] == "medisaathi_http_request_duration_ms_count"]
    assert counts and all(s["value"] >= 1 for s in counts)
