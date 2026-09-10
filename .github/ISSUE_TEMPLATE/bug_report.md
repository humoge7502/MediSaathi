---
name: Bug report
about: Something in MediSaathi is broken or behaves against its documented laws
labels: bug
---

**What happened**

A clear, factual description. If a verdict, dose action, or copilot answer
behaved against the documented law (see `docs/ARCHITECTURE.md`), say which law.

**How to reproduce**

Minimal steps / payload. For the API tier, include the exact request:

```bash
curl -X POST "localhost:8000/api/v1/prescriptions?sample_id=RX-001"
```

**Expected behavior**

What the deterministic safety plane / gate law should have done instead.

**Environment**

- Tier: web (`apps/web`) / API (`apps/api`) / both
- OS, runtime versions (bun / python), commit SHA

**Evidence**

Logs, response JSON, screenshots. No real patient data, please — this is a demo.
