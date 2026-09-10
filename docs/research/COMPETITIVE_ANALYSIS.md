# Competitive Analysis

**Access date:** 2026-09-10. This is a public capability comparison, not a claim about private architectures or clinical efficacy.

## Public comparison

| Category | Medisafe | MyTherapy | Tata 1mg | MediSaathi |
|---|---|---|---|---|
| Medication reminders/tracking | Publicly advertised | Publicly advertised | App listing describes health features | Not the current core; planned after identity/consent |
| Pharmacy/commerce | Not the primary public positioning | Not the primary public positioning | Publicly advertised medicine ordering and health services | Informational generic price comparison only; no fulfillment |
| Prescription image extraction | Not established from sources reviewed | Not established from sources reviewed | Not established from sources reviewed | Fixture tier plus key-gated OpenAI-compatible vision path |
| Deterministic interaction checks | Not established from sources reviewed | Not established from sources reviewed | Not established from sources reviewed | Implemented over synthetic-curated/versioned seed tables |
| Refusal/confirmation behavior | Not established from sources reviewed | Not established from sources reviewed | Not established from sources reviewed | Explicit confidence gate and human queue |
| Source/provenance at verdict | Not established from sources reviewed | Not established from sources reviewed | Health information is advertised, but this comparison does not infer source quality | Snapshot/source entries carried through verdict and UI |
| Multilingual spoken plan | Not established from sources reviewed | Not established from sources reviewed | Not established from sources reviewed | English/Tamil/Hindi template-grounded browser speech |
| Pharmacovigilance draft | Not established from sources reviewed | Not established from sources reviewed | Not established from sources reviewed | Review-only PvPI-shaped draft |

## Sources reviewed

- Medisafe public product/features result: <https://medisafeapp.com/en/features/> and public app listing, accessed 2026-09-10.
- MyTherapy public app listing: <https://play.google.com/store/apps/details?id=eu.smartpatient.mytherapy>, accessed 2026-09-10.
- Tata 1mg public site/about page: <https://www.1mg.com/aboutUs>, accessed 2026-09-10.
- WHO Medication Without Harm: <https://www.who.int/initiatives/medication-without-harm>, accessed 2026-09-10.

## What MediSaathi can credibly do better

1. Treat “cannot verify” as a successful, measurable outcome rather than a generic error.
2. Separate perception from safety decisions so a model provider can be replaced or removed.
3. Keep a deterministic confirmation boundary before any plan is spoken.
4. Show source snapshots and rule findings in the user-facing result.
5. Make multilingual audio traceable to verified slots rather than free-generated dosing prose.
6. Demonstrate the value of the safety plane with a reproducible A1/A4 ablation.
7. Degrade to sealed, offline fixtures without fabricating live-model output.
8. Keep the MVP non-commerce and non-diagnostic, reducing incentive and safety ambiguity.

## Credibility constraints

The comparison does not establish that competitors lack capabilities; it only records what was publicly discoverable from the cited pages. MediSaathi likewise does not claim clinical accuracy: its current benchmark has only 12 synthetic-curated cases, and live vision accuracy is not measured.
