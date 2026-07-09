# Session handover — 2026-07-09 (late)

## Where the project stands

Live app: **https://hadrop.github.io/SGY_AR_APP/** (auto-deploys from
master; repo hadrop/SGY_AR_APP). Two tracks:

- **v1 (sensor AR)** — GPS + compass + gyro. Complete; iPhone path.
  Anchor feature still not field-tested.
- **v2 (WebXR / SLAM)** — **Phase 2 (georeferencing) is built, deployed,
  and field-tested: "works great."** One issue found in the field — the
  curtain sat ~phone-height too high (local-floor's y=0 landed at the
  device, not the ground). Fixed the same day (commit `68f0bfc`,
  layered ground estimate, see below); **the fix is deployed but not yet
  re-tested in the field** — that's the immediate next validation.

## How XR mode works now (all in `web/src/xrMode.js` + `main.js`)

1. Two-tap start: tap 1 runs OrientationTracker + GeoTracker on the
   start screen (button shows live `GPS ±Xm · H°`); tap 2 freezes
   heading + position and requests the immersive-ar session.
   "test placement" button fakes standing 3 m south of the profile
   start (real compass) for at-home testing.
2. First XR frame: `alignXr()` compares the captured compass heading
   with the camera yaw inside XR space and calls
   `EnuFrame.setAlignment(heading, userEnu, cameraXZ)`; the profile
   group is then placed via `applyToGroup(group, posOffset, groundY)`.
3. Ground (the field-found fix): groundY starts at camera y − phone
   height ('estimate'), auto-snaps once to the first hit-test result
   >0.8 m below the camera ('auto'), manual ⏚ set-ground overrides
   ('manual'); tracked in `state.xrGroundSource`.
4. Gestures in XR: 1-finger rotates `enuFrame.userHeadingOffsetDeg`
   (pivot = session-start point), 2-finger shifts `state.xrPosOffset`
   in ENU (drag converted with `xrDirToEnu`). Persist per profile under
   `gprar:<name>:xr` (separate from v1 offsets).
5. Hit-test reticle (amber ring) follows the center ray; anchor button
   and phone-height slider are hidden in XR mode.

`node web/test/enuframe.test.mjs` — 17 headless checks on the mapping
math (round-trips, pivots, group-transform equivalence). Run after any
xrMode.js change.

## Next steps

1. **Field re-test of the ground fix** (user drives; expect profile top
   at the ground, curtain going down into the subsurface).
2. **Phase 3 polish**: tracking-state HUD (session `visibilitychange` /
   tracking-loss warning), README section on XR mode, maybe show
   ground-source in a chip.
3. **Projects → profiles hierarchy** (user request): manifest lists
   projects (name + center), each with its own profile set; two-step
   picker; converter grows a `--project` arg.
4. Phase 4 ideas: `depth-sensing` occlusion, anchors API, auto re-place
   from GPS when far off, v1 anchor field test.

Approved plan file (phases, risks, math rationale):
`C:\Users\piotr\.claude\plans\abstract-pondering-sunset.md`

## Gotchas learned (cumulative)

- **local-floor y=0 is not trustworthy outdoors** — on the user's phone
  it sat at device height. Never assume floor=0; use the layered ground
  estimate (already implemented).
- Compass heading must be captured BEFORE the immersive session
  (deviceorientation may stop once immersive) — hence the two-tap flow.
- Embedded preview tab is usually `hidden` → rAF suspended → HUD frozen,
  `preview_screenshot` can time out. Verify via DOM/eval instead.
- `.panel button { display: block }` overrides the `hidden` attribute —
  a `.panel button[hidden]` rule exists; same trap for new elements.
- `preview_click` can land before `loadProfile()` enables buttons — poll
  `!btn.disabled` via eval.
- WebXR is untestable on desktop (isSessionSupported → false): test on
  the phone via the live site (deploy ~1 min) or LAN https; USB
  `chrome://inspect` for console.
- GitHub API polling: add a junk query param (cache ~15 min); Actions
  runs can sit in "queued" for a while — don't assume failure.
- User's PC: Miniconda Python 3.6.5 (`python`), Node 24, repo-local git
  identity, no `gh` CLI.
