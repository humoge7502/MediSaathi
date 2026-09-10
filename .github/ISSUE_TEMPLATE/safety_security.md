---
name: Safety or security concern
about: A safety-plane miss, an injection path, a privacy concern, or a verdict that should have been refused
labels: security, safety
---

> If this is a **vulnerability with exploit details**, prefer responsible
> disclosure per [SECURITY.md](../SECURITY.md) rather than a public issue.

**Area**

- [ ] Safety plane (interactions / contraindications / duplicates / dose caps)
- [ ] Confidence gate (refuse / confirm / auto-confirm)
- [ ] Copilot gates (emergency triage / scope refusal / grounded generation)
- [ ] Double-dose guardrail / adherence engine
- [ ] Authentication / authorization / rate limiting
- [ ] Input validation / injection
- [ ] Privacy / data handling

**Description**

What can go wrong, and how the system currently behaves.

**Reproduction / attack sketch**

For input-validation issues, include the minimal payload or request.

**Suggested law**

How should the system behave? Refusal is a valid, often preferable answer.
