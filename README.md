# GPR AR Field Viewer

Augmented-reality viewer for GPR (ground-penetrating radar) SEG-Y profiles.
Open the web app on a phone at the survey site, point the camera at the ground
where a profile was measured, and see the radargram as a vertical curtain
hanging below the ground surface.

## Components

- `converter/` — Python tool (standard library only, no installs needed) that
  converts a `.sgy` file into web-ready assets: an amplitude texture (PNG) and
  georeferencing metadata (JSON). Run on the PC before going to the field.
- `web/` — the AR viewer: a web app (Vite + Three.js) that runs in Safari
  (iPhone) or Chrome (Android). Uses the phone camera, GPS and compass, with
  manual calibration controls for fine alignment.

## Quick start

```
# 1. Convert a profile (time section, coordinates in EPSG:25834)
python converter/convert_sgy.py Sample_sgy_gpr/TLAB25_007_BIG_Parking_1B1X_TIME.sgy

# 2. Run the viewer (dev server with HTTPS for phone testing)
cd web
npm install
npm run dev
```

Time-to-depth conversion uses ε=9 (v = 0.1 m/ns) and clips profiles to 2 m
depth by default; see `python converter/convert_sgy.py --help` for options.
