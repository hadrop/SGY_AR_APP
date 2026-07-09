# Session handover — 2026-07-09 (evening)

## Where the project stands

Live app: **https://hadrop.github.io/SGY_AR_APP/** (auto-deploys from
master; repo hadrop/SGY_AR_APP). Two tracks:

- **v1 (sensor AR)** — GPS + compass + gyro. Complete, field-tested,
  untouched this session except the profile picker. Stays as the iPhone
  path. The anchor feature (20 s GPS averaging) is still **not
  field-tested**.
- **v2 (WebXR / SLAM)** — new this session. **Phase 1 done and
  field-verified**: user's Android phone runs the immersive-ar session and
  the curtain stays rock-solid while walking around ("works great").
  Currently the curtain is placed at a **fixed spot 3 m in front** of the
  session-start pose — georeferencing is Phase 2, the immediate next step.

Approved plan for the WebXR track:
`C:\Users\piotr\.claude\plans\abstract-pondering-sunset.md` (phases,
risks, alignment math rationale).

## Done this session

1. Profile data: converted `_coor_recalc.sgy` (EPSG:32634; converter
   already supported it via `--epsg`), then restored the original
   (EPSG:25834) alongside it. Note: the recalc variant is ~1.3 km away
   and 10.76 m vs 17.97 m — genuinely different coordinates.
2. **Profile picker** on the start screen: lists manifest profiles,
   labels each with distance from a one-shot GPS fix, auto-selects the
   nearest unless the user picked manually. Switch tears down and
   rebuilds curtain/minimap/settings (settings were already per-profile).
3. **WebXR Phase 1** (`web/src/xrMode.js`): feature-detected
   "Start AR (SLAM · WebXR)" button; immersive-ar session with
   `local-floor` + `hit-test` required, `dom-overlay` + `anchors`
   optional (overlay root = document.body, keeps existing HUD/controls);
   render loop moved to `renderer.setAnimationLoop`; `EnuFrame` pure-math
   ENU↔XR mapping, 11 headless Node checks pass (round-trips, heading,
   three.js group-transform equivalence).

## Next: WebXR Phase 2 (georeferencing) — design already settled

1. **Pre-session capture** (WebXR may suppress deviceorientation once
   immersive): run `OrientationTracker` + `GeoTracker` briefly on the
   start screen; show accuracy; user taps to place when happy.
2. `EnuFrame.setAlignment(headingDeg, userEnu)` — heading = compass
   heading the phone faces at session start (XR −z), userEnu = GPS
   position relative to profile anchor. Then
   `enuFrame.applyToGroup(profileGroup, groundY)`.
3. Ground: `local-floor` puts y=0 at estimated floor; refine with a
   hit-test reticle ("tap ground to set profile top") — replaces the
   phone-height slider (already hidden in XR mode).
4. Gestures: port 1-finger rotate / 2-finger shift to the dom-overlay
   root (current handlers are on the canvas and guarded to mode==='ar').
   Rotation must pivot around the user's position. Persist under
   settingsKey + `:xr` suffix.
5. For at-home testing add a temporary "place here" debug override
   (profile would otherwise be far away).
6. Phase 3 after: HUD tracking-state chip, README/docs. Phase 4 ideas:
   `depth-sensing` occlusion, anchors persistence, auto re-place.

Also queued (user request): **projects → profiles hierarchy** — manifest
lists projects (name + center), each with its own profile set; two-step
picker; converter grows a `--project` arg. Slot after XR Phase 2.

## Gotchas learned (cumulative)

- Embedded preview tab is usually `hidden` → rAF suspended → HUD frozen,
  `preview_screenshot` can time out. Verify via DOM/eval instead.
- `.panel button { display: block }` in style.css overrides the `hidden`
  attribute — `.panel button[hidden] { display: none }` rule added; same
  trap applies to any new hidden-by-attribute element.
- `preview_click` can land before `loadProfile()` enables buttons — poll
  `!btn.disabled` via eval.
- WebXR is untestable on desktop (isSessionSupported → false): test on
  the phone via LAN https (`npm run dev:https`, accept cert) or the live
  site; `chrome://inspect` over USB for console.
- WebFetch/curl of the GitHub API caches ~15 min — add a junk query param
  when polling workflow runs.
- User's PC: Miniconda Python 3.6.5 (`python`, no py launcher), Node 24,
  repo-local git identity, no `gh` CLI (plain HTTPS push auth).
