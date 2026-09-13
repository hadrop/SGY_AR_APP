# Session handover — 2026-09-13

Read `CLAUDE.md` first (constraints, domain facts, architecture). This file
is the current state + what the next session needs to know.

## Restore point (if anything goes wrong)

Known-good state before handing the project to another session:

- **Tag `restore-2026-09-13`** (annotated, local) — the commit that adds this
  handover. Deployed app code is identical to `ab1bc51`.
- **Full backup bundle** (outside the repo, all history + tag):
  `D:\RAZER_BLADE_BACKUP\D\PRACA\SGY_field_view_app_backups\SGY_AR_APP_restore-2026-09-13.bundle`

To go back (discards later work — ask the user first):

```bash
git -c safe.directory='*' log --oneline restore-2026-09-13 -1
git -c safe.directory='*' switch -c recovered restore-2026-09-13   # inspect safely
# or, to rewind master itself (destructive):
git -c safe.directory='*' reset --hard restore-2026-09-13
```

If the repo itself is damaged: `git clone <bundle> SGY_field_view_app_restored`.
To redeploy the old state to Pages, master on GitHub must point at it again
(needs a push; a force-push if new commits were pushed meanwhile — user's call).

## Where the project stands

Live app: **https://hadrop.github.io/SGY_AR_APP/** (auto-deploys from
master in ~30–60 s; repo hadrop/SGY_AR_APP, public).

- **v1 (sensor AR)** — GPS + compass + gyro. Complete; iPhone path.
  Anchor feature still not field-tested.
- **v2 (WebXR / SLAM)** — Phase 2 (georeferencing) built, deployed,
  field-tested ("works great"). The ground-height fix (`68f0bfc`, layered
  ground estimate) is deployed but **still not re-tested in the field**.

### Profiles shipped (`web/public/data/manifest.json`)

| name | site | EPSG | ε / clip | notes |
|---|---|---|---|---|
| TLAB25_007_BIG_Parking_1B1X_TIME_coor_recalc | Kraków | 32634 | 9 / 2 m | 359 tr, 10.76 m |
| TLAB25_007_BIG_Parking_1B1X_TIME | Kraków | 25834 | 9 / 2 m | 359 tr, 17.97 m |
| 1_0003_X_1 | 52.3400 N 23.0469 E | 32634 | 9 / 2.5 m | 410 tr, 20.46 m, dt 375 ps |
| ARKADIA_TEST_1_0003_X_1_ramp_ramp | 52.4335 N 22.8930 E | 32634 | 9 / 2.5 m | same traces as 1_0003_X_1, coordinates rewritten to an even straight line (relocation test) |

Source `.sgy` for the two new profiles live in `C:\Users\piotr\Downloads\`
and are deliberately **not committed** (public repo; app only needs the
converted PNG + meta).

### Open question on the new profiles (ask the user, don't assume)

`1_0003_X_1` (and therefore the ARKADIA test) has a quiet top ~5 ns and the
first strong event at ~9–10 ns ≈ 0.5 m displayed depth, unlike the Kraków
sample which is bright from the top. Either the file isn't time-zero
corrected (then AR shows everything ~0.5 m too deep) or the near surface is
just quiet. If the user says it needs correcting: add a `--t0 <ns>` option
to `convert_sgy.py` (drop leading samples) and regenerate. Not done yet.

## Adding a profile (the workflow used this session)

```bash
python converter/convert_sgy.py <file.sgy> --epsg 32634 --epsilon 9 --depth 2.5 --dt-units ps
```

(`python` = any stdlib Python 3; see environment notes below.) Then sanity-
check the printed anchor/length, eyeball `preview.png`, commit
`manifest.json` + `profiles/<name>/`, and push only with the user's OK.
The picker and nearest-by-GPS auto-select need no code changes.

## Next steps (backlog, unchanged unless the user redirects)

1. Field re-test of the XR ground fix.
2. Time-zero decision for the `1_0003_X_1` data (above).
3. Phase 3 polish: tracking-state HUD, README section on XR mode.
4. Projects → profiles hierarchy (manifest groups profiles by project,
   two-step picker, converter `--project` arg). More relevant now that
   profiles span several sites.
5. Phase 4 ideas: `depth-sensing` occlusion, anchors API, v1 anchor test.

The earlier plan file `C:\Users\piotr\.claude\plans\abstract-pondering-sunset.md`
is **not present on this machine**; the phase summary above is all that
survives of it.

## Environment on the current machine (changed since July)

The project now lives on `D:\RAZER_BLADE_BACKUP\...` — apparently copied
from the old laptop. Consequences:

- **git "dubious ownership"**: the drive doesn't record owners. Use
  `git -c safe.directory='*' <cmd>` per command; do **not** change global
  git config unless the user does it themselves.
- **Miniconda is not installed/on PATH** (`python` is the Microsoft Store
  stub). The converter was run with the uv-managed Python:
  `C:\Users\piotr\.local\bin\python3.12.exe` (stdlib only, nothing installed).
- Node v24.19.0; `web/node_modules` present. No `gh` CLI — use the public
  GitHub API with curl, or poll the live `data/manifest.json`.
- A sibling folder `..\FABLE_GPR_APP` exists; unrelated to this repo as far
  as this session knows — don't touch it without the user asking.

## Gotchas learned (cumulative)

- **local-floor y=0 is not trustworthy outdoors** — use the layered ground
  estimate (implemented).
- Compass heading must be captured BEFORE the immersive session — hence
  the two-tap XR flow.
- Embedded preview tab is often `hidden` → rAF suspended → HUD frozen,
  screenshots may time out. Verify via DOM/eval instead.
- `.panel button { display: block }` overrides `hidden` — a
  `.panel button[hidden]` rule exists; same trap for new elements.
- Clicks can land before `loadProfile()` enables buttons — wait for
  `!btn.disabled`.
- WebXR is untestable on desktop: test on the Android phone via the live
  site or LAN https; USB `chrome://inspect` for console.
- GitHub/Pages polling: add a junk query param to dodge caches; Actions
  runs can sit "queued" for a while.
