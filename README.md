# GPR AR Field Viewer

Augmented-reality viewer for GPR (ground-penetrating radar) SEG-Y profiles.
Open the web app on a phone at the survey site, point the camera at the ground
where a profile was measured, and see the radargram as a vertical curtain
hanging below the ground surface, starting at the ground intersection.

## Components

- `converter/` — Python tool (**standard library only, no installs, does not
  touch your conda setup**) that converts a `.sgy` file into web-ready assets:
  an amplitude texture (PNG) and georeferencing metadata (JSON). Run on the PC
  before going to the field.
- `web/` — the AR viewer: a web app (Vite + Three.js) that runs in Safari
  (iPhone) or Chrome (Android). Uses the phone camera, GPS and compass, with
  manual calibration controls for fine alignment. All npm packages install
  locally into `web/node_modules`.

## 1. Convert a profile

```
python converter/convert_sgy.py Sample_sgy_gpr/TLAB25_007_BIG_Parking_1B1X_TIME.sgy
```

Defaults: coordinates EPSG:25834, sample interval in **picoseconds**,
ε = 9 (v = 0.1 m/ns), depth clip 2.0 m. See `--help` for options
(`--epsilon`, `--depth`, `--dt-units`, `--epsg`, `--name`).

Outputs to `web/public/data/profiles/<name>/` and registers the profile in
`web/public/data/manifest.json`. **Check `preview.png`** (depth ticks every
0.5 m) to confirm the depth scale looks right before field use.

## 2. Run the viewer

```
cd web
npm install          # first time only
npm run dev          # desktop development (HTTP)
npm run dev:https    # phone testing on LAN (HTTPS, required for camera/GPS)
```

Desktop: open http://localhost:5173 and use **Desktop debug mode** —
click-drag to look, WASD to move, R/F for up/down, Shift = faster.

Phone: connect the phone to the same Wi-Fi as the PC, open the
`https://<pc-ip>:5173` URL that vite prints (accept the self-signed
certificate warning once), tap **Start AR** and allow motion, camera and
location permissions.

## 3. Field use / sharing

Build and host the static site anywhere with HTTPS (GitHub Pages, Netlify):

```
cd web
npm run build        # output in web/dist/
```

Colleagues then just open the URL — no app install. Add the page to the
home screen for fullscreen (PWA).

### Field checklist

1. Convert the profile(s) on the PC; check `preview.png`; deploy or start
   the LAN dev server.
2. On site, open the app, tap **Start AR**, grant all three permissions.
3. Watch the **GPS chip** — wait until accuracy is ≤ 5–8 m.
4. Use the **minimap** (orange line = profile, blue dot = you) to walk to
   the profile.
5. Point the camera at the ground along the profile line. The section hangs
   below the yellow ground line, 2 m deep, depth ticks every 0.5 m.
6. **Anchor**: stand still where you want to view from and tap
   **⚓ Anchor** — the app averages GPS for 20 s, then locks your position
   so the view stops drifting (only the gyro moves it). Tap again to
   unlock when you walk to a new spot; the app also warns if you moved
   more than a few meters while anchored.
7. Calibrate: **1-finger drag** rotates the view heading (fix compass error),
   **2-finger drag** shifts the profile on the ground (fix GPS offset).
   Settings persist per profile on the device; **reset align** clears them.
7. Adjust palette / gain / opacity / phone height in the bottom panel.

### Accuracy notes (v1)

- Anchoring is GPS + compass: expect meter-level position and ~10° heading
  error before manual calibration. Calibrate against a known surface feature
  (e.g. the start/end point of the profile) for best results.
- The profile top is assumed flat at local ground level (trace elevations
  are ignored).
