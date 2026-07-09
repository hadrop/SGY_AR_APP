# GPR AR Field Viewer — project instructions

Phone web-AR viewer for GPR SEG-Y profiles: point the camera at the ground on
site, see the radargram as a curtain below the surface. Owner: Piotr (GPR
professional, iPhone user, develops on Windows — that's why web AR, not native).

## Hard constraints

- **Never touch global environments.** No pip/conda installs, no global npm.
  The converter must stay pure Python stdlib (runs on his Miniconda 3.6.5
  base without modifying it). If a third-party package ever becomes
  unavoidable: project-local `.venv` and notify him first.
- Git identity is configured **repo-local only** (Piotr Hadro
  <piotr.hadro@gmail.com>); don't set global git config.

## Domain facts (confirmed by user, don't re-ask)

- GPR SEG-Y sample-interval fields are **picoseconds** (sample file: 327 ps).
- Time→depth: ε = 9 → v = 0.1 m/ns; clip profiles to **2 m** depth.
- Profile coordinates: **EPSG:25834** (ETRS89 / UTM 34N).
- Trace-header elevations (scalel = -10000) have ambiguous units → ignored;
  profile top anchors at local ground level.

## Architecture

- `converter/convert_sgy.py` — stdlib-only SEG-Y → `web/public/data/profiles/
  <name>/{amplitude.png, meta.json, preview.png}` + updates `manifest.json`.
  amplitude.png is 8-bit gray, 128 = zero amplitude; color palettes are
  applied in the viewer shader, never baked into textures.
- `web/` — Vite + Three.js, vanilla JS. World frame: local ENU at profile
  anchor; x = east, y = up, **z = -north**.
  - `curtain.js` — ribbon mesh + ShaderMaterial (palette/gain/opacity
    uniforms, ground line, 0.5 m depth ticks).
  - `pose.js` — camera feed, DeviceOrientation → quaternion (iOS
    webkitCompassHeading anchoring), GeoTracker with three modes:
    follow (1.5 m deadband + glide), anchoring (20 s weighted average),
    anchored (position hard-locked, gyro-only).
  - `main.js` — orchestration, calibration gestures (1-finger = heading,
    2-finger = profile shift), localStorage persistence per profile.
- Deploy: push to master → GitHub Actions builds `web/` → GitHub Pages at
  https://hadrop.github.io/SGY_AR_APP/ (repo hadrop/SGY_AR_APP, public).

## Workflows

- Desktop dev: `cd web && npm run dev` (HTTP), use "Desktop debug mode"
  (WASD + drag; sensors unavailable on desktop).
- Phone-on-LAN test: `npm run dev:https` (basic-ssl, accept cert warning).
- Verify converter changes against the sample:
  `python converter/convert_sgy.py Sample_sgy_gpr/TLAB25_007_BIG_Parking_1B1X_TIME.sgy`
  → expect 359 traces, 124 samples kept, anchor 49.9866096 N 19.8387892 E,
  length 17.97 m; eyeball preview.png.
- GeoTracker logic can be tested headlessly in Node (stub `navigator`,
  `window`, `screen` globals, import `web/src/pose.js`, drive `update(dt)`).
- The embedded preview panel's tab is often `hidden` → requestAnimationFrame
  is suspended and the HUD won't tick; don't chase that as an app bug.

## Known limitations / open ends

- AR sensor path verified in the field once (works); gyro-only orientation
  may drift over minutes while anchored — auto compass re-sync is a
  candidate feature.
- No occlusion with real ground (web has no depth sensing).
- Repo is public → profile data is publicly reachable; switch to
  Netlify + private repo if client data ever goes in.
- Start screen has a profile picker (nearest profile auto-selected from a
  one-shot GPS fix). Planned next level: "projects" grouping — user picks
  a project, then a profile within it.
