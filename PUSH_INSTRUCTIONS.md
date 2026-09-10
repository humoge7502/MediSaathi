# How to publish the transformed MediSaathi to GitHub

You have two equivalent options. Option A is simplest.

## Option A — apply the commits (recommended, keeps clean history)

The 9 transformation commits are bundled as a git bundle. From any machine
with a clone of your repository:

```bash
# 1. fetch the bundle into your existing clone
cd path/to/your/MediSaathi-clone
git fetch /path/to/medisaathi-transformed.bundle main:transformed-branch

# 2. review the 9 commits
git log transformed-branch --oneline -9

# 3. fast-forward main and push
git checkout main
git merge --ff-only transformed-branch
git push origin main
```

If you don't have a clone handy, start from the zip:

```bash
unzip medisaathi-transformed-repo.zip && cd medisaathi
git remote add origin https://github.com/humoge7502/MediSaathi.git
git fetch origin
git rebase --onto origin/main f0fb9ec main   # replay the 9 commits on your remote head
git push origin main
```

## Option B — fresh clone from the bundle, force-push (replaces remote state)

```bash
git clone medisaathi-transformed.bundle medisaathi
cd medisaathi && git checkout main
git remote set-url origin https://github.com/humoge7502/MediSaathi.git
git push --force-with-lease origin main
```

(Your remote `main` is at `f0fb9ec`; the 9 new commits build directly on it,
so a normal push works — no force needed unless history diverged.)

## After pushing — 5 minutes of GitHub UI settings (code cannot set these)

1. **Settings → Social preview**: upload `medisaathi-social-preview.png`
   (also in this folder) — this is what LinkedIn/X/slacks unfurl.
2. **About (gear icon)**: description =
   `Closed-loop medication guardian — the model reads, the rules decide. Deterministic safety plane, grounded copilot, measured AI.`
   Topics: `healthcare`, `patient-safety`, `medication-safety`, `llm`, `ai-safety`,
   `fastapi`, `nextjs`, `typescript`, `python`, `clinical-informatics`.
3. **Settings → General → Features**: enable Issues (templates now exist).
4. **Settings → Branches**: protect `main` (require the `ci` checks to pass).
5. Pin the repository on your profile.

## Verify CI passes

The new CI runs: gitleaks → ruff → pip-audit → 104 pytest → eval → ablation →
demo-check (API job) and eslint → typecheck → 18-case selftest → 14
integration tests → production build (web job). Everything was verified green
locally before packaging; if CI differs, check the gitleaks history scan
first (it scans all past commits — any secret ever committed will surface).
