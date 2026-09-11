"""MediSaathi research & evidence package (MED-004..MED-019).

Everything in here exists to turn the repository's engineering claims into
*reproducible* experimental evidence:

    ml.manifest   -- sha256 dataset manifests + run manifests (provenance)
    ml.corpus     -- labeled corpus loading, splits, strata
    ml.runner     -- experiment run manifests (config, SHAs, metrics archive)
    ml.ladder     -- the A0-A4 baseline ladder + component ablations
    ml.calibration-- ECE / Brier / reliability curves + threshold sweep
    ml.adversarial-- corruption ladder, injection, confusables, invented brands
    ml.hitl       -- human-in-the-loop simulation (confirm-queue arms)

No number in the docs may be quoted without a run manifest produced here
(reproducibility law, Section 11.2 of the transformation plan).
"""

__all__ = [
    "adversarial",
    "calibration",
    "corpus",
    "hitl",
    "ladder",
    "manifest",
    "runner",
]
