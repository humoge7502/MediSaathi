# Skill Evaluation

**Evaluation date:** 2026-09-10  
**Policy:** inspect and selectively apply principles; do not install runtime dependencies or agent hooks without a project need and explicit verification.

| Resource | Purpose | Decision | Installation status | Use in MediSaathi | Risk |
|---|---|---|---|---|---|
| `pbakaus/impeccable` <https://github.com/pbakaus/impeccable> | design audit, hierarchy, responsive/a11y/performance critique, anti-pattern detection | Selected as a reference | Not installed; repository inspection only | informed the audit-first visual review and the decision to avoid generic AI SaaS styling | external CLI/hooks can alter agent behavior; static build already has an established design system |
| `Leonxlnx/taste-skill` <https://github.com/Leonxlnx/taste-skill> | anti-slop layout, typography, spacing, motion | Selected as a reference | Not installed | informed restraint: clinical hierarchy, no decorative gradient/blob system, purposeful density | v2 is described as experimental; unnecessary motion would harm healthcare clarity |
| `emilkowalski/skills` <https://github.com/emilkowalski/skills> | animation and interaction critique | Selected as a reference | Not installed | applied reduced-motion and feedback-only motion principles | animation skill is not a substitute for browser/a11y testing |
| `nutlope/hallmark` <https://github.com/nutlope/hallmark>` | anti-AI-slop design gates | Evaluated, not selected for install | Not installed; `npx` install not run | used as a conceptual check against repetitive cards, vague hero copy, and generated-looking UI | large skill and hook surface; no need to add it to the runtime repository |
| `VoltAgent/awesome-agent-skills` <https://github.com/VoltAgent/awesome-agent-skills>` | catalog of agent skills | Evaluated, not installed | Not installed | confirmed available testing/security/frontend skill categories for future work | a catalog is not evidence that every listed skill is maintained or suitable |
| `ACM-VIT` <https://www.acmvit.in/>` | design/reference research | Selected as a public design reference | N/A | principles captured in `docs/design/ACM_VIT_DESIGN_ANALYSIS.md` | do not copy branding/assets |

## Other requested resources

The repository itself was inspected and the external URLs were searched/read where accessible. No claim is made that `npx skills add nutlope/hallmark` succeeded: it was deliberately not executed because this run did not require installing agent tooling, and installation could alter the working environment.

## Practical result

The active codebase already has a small dependency surface and a restrained CSS-token design. Adding multiple skill packages would not improve the product as much as closing P1 identity/privacy gaps and adding browser/a11y tests. The selected principles were incorporated manually and documented; no hidden tooling dependency was added.
