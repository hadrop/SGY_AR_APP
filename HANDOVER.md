# Session handover — 2026-07-09

## Where the project stands

Everything planned for v1 is **built, deployed, and field-tested once**.
Live app: **https://hadrop.github.io/SGY_AR_APP/** (auto-deploys from
master via `.github/workflows/deploy.yml`; repo hadrop/SGY_AR_APP).

User feedback from first field test: "works very good for 1st try", but the
profile drifted with GPS noise → fixed the same day with the anchor feature
(commit `bc95f3c`): 20 s accuracy-weighted GPS averaging that hard-locks the
camera position, plus a 1.5 m deadband in follow mode. Logic verified
headlessly in Node (jitter → zero drift, anchored → immune to GPS noise);
**not yet field-tested** — that's the immediate next validation step.

## What exists

- `converter/convert_sgy.py` — stdlib-only SEG-Y converter (see CLAUDE.md
  for the asset format). Verified against the sample file; UTM inverse
  round-trips sub-mm.
- `web/` — the AR viewer (Vite + Three.js). Desktop debug mode for PC
  development; AR mode uses camera + gyro/compass + GPS with manual
  calibration gestures and the anchor button.
- README.md — user-facing usage, phone testing, deploy, field checklist.
- CLAUDE.md — constraints, domain facts, architecture, verification recipes.
- Memory files (auto-memory dir) — isolation constraint + project decisions.

## Likely next steps (none committed to)

1. **Field-test the anchor feature** (user will report).
2. Auto compass re-sync while anchored, if gyro drift over minutes annoys
   the user (a 1-finger drag already corrects it manually).
3. Multi-profile support: load nearest profile instead of `profiles[0]`;
   the manifest already stores anchor + length per profile.
4. If client data confidentiality comes up: move to Netlify + private repo.
5. Possible later: WebXR path on Android for true SLAM tracking; native
   iOS only if a Mac appears.

## Gotchas learned this session

- Embedded preview panel tab is usually `hidden` → rAF suspended → HUD/chips
  don't update; verify logic in Node instead of fighting the preview.
- `preview_click` sometimes lands before `loadProfile()` enables buttons —
  poll for `!btn.disabled` or click via eval.
- GitHub Pages had to be enabled manually once (Settings → Pages → Source:
  GitHub Actions); the workflow token cannot enable it itself.
- User's PC: only Miniconda Python 3.6.5 (no py launcher), Node 24, git
  identity repo-local only. `gh` CLI is NOT installed (user chose plain
  HTTPS push auth via credential manager).
- WebFetch caches GitHub API responses ~15 min — add a junk query param
  when polling workflow runs.
