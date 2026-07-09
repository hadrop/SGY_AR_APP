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
- Profile coordinates: **EPSG:25834** (ETRS89 / UTM 34N) by default; the
  converter also accepts `--epsg 326xx/327xx` (WGS84 UTM). Both sample
  variants ship: original (25834) and `_coor_recalc` (32634, ~1.3 km away,
  10.76 m — coordinates genuinely differ, not just the datum).
- User has an **Android phone that supports WebXR** immersive-ar (verified
  in the field); iPhone stays on the v1 sensor path (no WebXR in iOS Safari).
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
  - `xrMode.js` — WebXR (SLAM) mode: immersive-ar session setup
    (local-floor + hit-test required, dom-overlay optional) and `EnuFrame`,
    a pure-math ENU↔XR-local mapping (headlessly testable in Node).
    Feature-detected "Start AR (SLAM · WebXR)" button — Android Chrome only.
  - `main.js` — orchestration, profile picker (nearest by one-shot GPS
    auto-selected), calibration gestures (1-finger = heading, 2-finger =
    profile shift), localStorage persistence per profile, render loop via
    `renderer.setAnimationLoop` (required for XR).
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
  `EnuFrame` (xrMode.js) is pure math — import and test directly, no stubs.
- WebXR can't run on desktop: XR mode is only testable on the Android phone
  (LAN https or the live Pages site; `chrome://inspect` over USB for console).
- The embedded preview panel's tab is often `hidden` → requestAnimationFrame
  is suspended and the HUD won't tick (screenshots may time out); don't
  chase that as an app bug.
- `.panel button { display: block }` overrides the `hidden` attribute —
  keep the `.panel button[hidden]` rule in mind when hiding start buttons.

## Known limitations / open ends

- **WebXR mode is Phase 1 only**: curtain is placed at a fixed spot 3 m in
  front of the session-start pose — not georeferenced yet. Phase 2 (next):
  pre-session GPS+compass capture → `EnuFrame.setAlignment`, hit-test
  ground set, calibration gestures on the dom-overlay root, settings under
  a `:xr` key suffix. Full plan: HANDOVER.md.
- v1 sensor path verified in the field once (works); gyro-only orientation
  may drift over minutes while anchored — auto compass re-sync is a
  candidate feature. Anchor feature itself not yet field-tested.
- No occlusion with real ground (WebXR `depth-sensing` could fix this in
  XR mode — Phase 4 candidate).
- Repo is public → profile data is publicly reachable; switch to
  Netlify + private repo if client data ever goes in.
- Start screen has a profile picker (nearest profile auto-selected from a
  one-shot GPS fix). Planned next level: "projects" grouping — user picks
  a project, then a profile within it.
