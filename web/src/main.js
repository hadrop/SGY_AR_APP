import * as THREE from 'three';
import { createCurtain } from './curtain.js';
import { DebugControls } from './debugControls.js';
import { Minimap } from './minimap.js';
import { startCameraFeed, OrientationTracker, GeoTracker } from './pose.js';
import { EnuFrame, isXrSupported, startXrSession, transformPoint,
         anchorPoseInit } from './xrMode.js';
import { latLonToEnu } from './geo.js';

const $ = (id) => document.getElementById(id);

const state = {
  mode: null,           // 'ar' | 'xr' | 'debug'
  meta: null,
  curtain: null,
  profileGroup: null,
  minimap: null,
  orientation: null,
  geo: null,
  enuFrame: null,       // ENU <-> XR-local mapping (XR mode only)
  xrCapture: null,      // pre-session compass+GPS capture (start screen)
  xrPosOffset: { e: 0, n: 0 },  // manual profile shift in XR mode (m, ENU)
  xrGroundY: 0,         // XR y of the profile top (ground level)
  xrGroundSource: null, // 'estimate' | 'auto' (hit-test) | 'manual'
  xrNeedsAlign: false,  // waiting for the first XR frame to align
  xrHeadingAtStart: 0,  // compass heading captured at the start tap
  xrUserEnu: null,      // GPS position captured at the start tap
  xrSession: null,
  hitTestSource: null,
  lastHitY: null,
  // --- XR tracking / anchoring state (never persisted) ---
  xrTracking: 'none',   // 'none' (no pose) | 'limited' (emulated) | 'ok'
  xrOkFrames: 0,        // consecutive frames with tracking 'ok'
  xrOkTime: 0,          // seconds of consecutive 'ok' tracking
  xrCamPos: null,       // camera position from the pose we fetched (m)
  xrCamQuat: null,      // camera orientation from that pose
  xrFirstPos: null,     // first tracked camera position (diagnostic)
  xrMaxTranslation: 0,  // max horizontal camera travel since first pose
  xrHitSeen: false,     // a hit-test result was seen in the current frame
  xrLowestHitY: null,   // lowest near-horizontal hit seen so far
  xrAnchor: null,       // XRAnchor holding the curtain pose (if supported)
  xrAnchorStatus: 'none', // 'none' | 'tracked' | 'lost' | 'failed' | 'unsupported'
  xrAnchorDirty: false, // placement changed -> recreate anchor next frame
  xrAnchorReq: 0,       // createAnchor request counter (drop stale results)
  xrRefSpace: null,     // reference space we listen to for 'reset'
  debugControls: null,
  height: 1.6,          // phone height above ground (m)
  posOffset: { e: 0, n: 0 },  // manual profile shift (m)
};

// ------------------------------------------------------------- three.js

const renderer = new THREE.WebGLRenderer({
  canvas: $('scene'),
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  65, window.innerWidth / window.innerHeight, 0.05, 500);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const grid = new THREE.GridHelper(40, 40, 0x3a4450, 0x232a32);
grid.visible = false;
scene.add(grid);

// hit-test reticle: marks where the center ray meets a real surface (XR)
let reticle = null;
function ensureReticle() {
  if (reticle) return;
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(
      { color: 0xffc02e, transparent: true, opacity: 0.9 }));
  reticle.visible = false;
  scene.add(reticle);
}

// ------------------------------------------------------------- data load

let manifest = null;

async function loadManifest() {
  manifest = await (await fetch('data/manifest.json')).json();
  const sel = $('profile-pick');
  sel.innerHTML = '';
  manifest.profiles.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${p.name} (${p.length_m} m)`;
    sel.appendChild(opt);
  });
  $('profile-pick-row').hidden = manifest.profiles.length < 2;
  await loadProfile(manifest.profiles[0]);
  annotateDistances();
}

async function loadProfile(entry) {
  stopXrCapture();  // capture is anchored to the old profile
  for (const id of ['btn-ar', 'btn-xr', 'btn-debug']) $(id).disabled = true;
  if (state.profileGroup) {
    scene.remove(state.profileGroup);
    state.curtain.geometry.dispose();
    state.curtain.material.uniforms.uMap.value.dispose();
    state.curtain.material.dispose();
  }

  const meta = await (await fetch(`${entry.dir}/meta.json`)).json();
  const texture = await new THREE.TextureLoader()
    .loadAsync(`${entry.dir}/amplitude.png`);

  state.meta = meta;
  state.curtain = createCurtain(meta, texture);
  state.profileGroup = new THREE.Group();
  state.profileGroup.add(state.curtain);
  scene.add(state.profileGroup);
  state.minimap = new Minimap($('minimap'), meta.points_en);

  $('profile-info').textContent =
    `${meta.name}\n${meta.length_m} m long, ${meta.depth_m} m deep, ` +
    `${meta.n_traces} traces`;
  loadSettings();
  $('btn-ar').disabled = false;
  $('btn-xr').disabled = false;
  $('btn-debug').disabled = false;
}

// One-shot GPS fix on the start screen: label each profile with its
// distance and auto-select the nearest unless the user already chose.
function annotateDistances() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const { latitude, longitude } = pos.coords;
    const sel = $('profile-pick');
    let best = 0, bestD = Infinity;
    manifest.profiles.forEach((p, i) => {
      const { e, n } = latLonToEnu(
        latitude, longitude, p.anchor.lat, p.anchor.lon);
      const d = Math.hypot(e, n);
      sel.options[i].textContent = `${p.name} — ${d < 1000
        ? d.toFixed(0) + ' m' : (d / 1000).toFixed(1) + ' km'} away`;
      if (d < bestD) { bestD = d; best = i; }
    });
    if (!state._userPickedProfile && +sel.value !== best && !state.mode) {
      sel.value = String(best);
      loadProfile(manifest.profiles[best]);
    }
  }, () => { /* no fix: keep manifest order */ },
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

$('profile-pick').addEventListener('change', () => {
  state._userPickedProfile = true;
  loadProfile(manifest.profiles[+$('profile-pick').value]);
});

// ------------------------------------------------------- settings persist

function settingsKey() {
  return `gprar:${state.meta.name}` + (state.mode === 'xr' ? ':xr' : '');
}

function saveSettings() {
  const xr = state.mode === 'xr';
  const o = state.orientation;
  localStorage.setItem(settingsKey(), JSON.stringify({
    palette: +$('ctl-palette').value,
    gain: +$('ctl-gain').value,
    opacity: +$('ctl-opacity').value,
    height: state.height,
    headingOffset: xr ? state.enuFrame.userHeadingOffsetDeg
                      : (o ? o.userHeadingOffsetDeg : 0),
    posOffset: xr ? state.xrPosOffset : state.posOffset,
  }));
}

// XR calibration is per profile but separate from the v1 offsets
function loadXrCalibration() {
  state.xrPosOffset = { e: 0, n: 0 };
  state.enuFrame.userHeadingOffsetDeg = 0;
  try {
    const s = JSON.parse(
      localStorage.getItem(`gprar:${state.meta.name}:xr`) || '{}');
    state.enuFrame.userHeadingOffsetDeg = s.headingOffset ?? 0;
    state.xrPosOffset = s.posOffset ?? { e: 0, n: 0 };
  } catch { /* ignore corrupt settings */ }
}

function loadSettings() {
  const raw = localStorage.getItem(settingsKey());
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    $('ctl-palette').value = s.palette ?? 0;
    $('ctl-gain').value = s.gain ?? 1;
    $('ctl-opacity').value = s.opacity ?? 0.95;
    $('ctl-height').value = s.height ?? 1.6;
    state.height = s.height ?? 1.6;
    state.posOffset = s.posOffset ?? { e: 0, n: 0 };
    state._savedHeadingOffset = s.headingOffset ?? 0;
    applyUniforms();
  } catch { /* ignore corrupt settings */ }
}

function applyUniforms() {
  if (!state.curtain) return;
  const u = state.curtain.material.uniforms;
  u.uPalette.value = +$('ctl-palette').value;
  u.uGain.value = +$('ctl-gain').value;
  u.uOpacity.value = +$('ctl-opacity').value;
  $('height-val').textContent = (+$('ctl-height').value).toFixed(2) + ' m';
}

function applyProfileOffset() {
  if (state.mode === 'xr') return;  // EnuFrame owns the transform in XR
  state.profileGroup.position.set(
    state.posOffset.e, 0, -state.posOffset.n);
}

// ---------------------------------------------------------------- modes

async function startAr() {
  try {
    state.orientation = new OrientationTracker();
    state.orientation.userHeadingOffsetDeg = state._savedHeadingOffset || 0;
    await state.orientation.start();         // needs user gesture (this tap)
    await startCameraFeed($('camera'));
    state.geo = new GeoTracker(state.meta.anchor.lat, state.meta.anchor.lon);
    state.geo.start();
  } catch (err) {
    $('start-hint').textContent = 'Sensor error: ' + err.message;
    return;
  }
  state.mode = 'ar';
  renderer.setClearColor(0x000000, 0);      // transparent over video
  grid.visible = false;
  enterViewer('AR');
}

// compass heading (deg, 0 = N) the camera faces, from a world quaternion
// (v1 world frame: -z = north). Falls back to the screen-up direction
// when the phone is pitched steeply down at the ground.
const _hv = new THREE.Vector3();
function compassHeadingOf(q) {
  _hv.set(0, 0, -1).applyQuaternion(q);
  if (Math.hypot(_hv.x, _hv.z) < 0.3) _hv.set(0, 1, 0).applyQuaternion(q);
  return (Math.atan2(_hv.x, -_hv.z) * 180 / Math.PI + 360) % 360;
}

// XR start is two taps: tap 1 starts the compass+GPS capture on the
// start screen (WebXR may suppress deviceorientation once immersive);
// tap 2 freezes both readings and enters the session.
function startXrCapture() {
  const cap = state.xrCapture = {
    orientation: new OrientationTracker(),
    geo: new GeoTracker(state.meta.anchor.lat, state.meta.anchor.lon),
    fake: false,
    timer: 0,
  };
  cap.orientation.start().catch(() => {});
  try { cap.geo.start(); } catch { /* no geolocation: fake mode only */ }
  $('btn-xr-fake').hidden = false;
  cap.timer = setInterval(() => {
    const gps = cap.fake ? 'test placement'
      : cap.geo.hasFix ? `GPS ±${cap.geo.accuracy.toFixed(0)} m`
      : 'GPS acquiring…';
    const h = cap.orientation.hasReading
      ? ` · ${compassHeadingOf(cap.orientation.deviceQuaternion).toFixed(0)}°`
      : '';
    $('btn-xr').textContent = `📍 Place & start — ${gps}${h}`;
  }, 500);
  $('start-hint').textContent =
    'Stand at your reference point, hold the phone upright, tap again.';
}

function stopXrCapture(restoreButton = true) {
  const cap = state.xrCapture;
  if (!cap) return;
  clearInterval(cap.timer);
  cap.orientation.stop();
  cap.geo.stop();
  state.xrCapture = null;
  $('btn-xr-fake').hidden = true;
  if (restoreButton) {
    $('btn-xr').textContent = 'Start AR (SLAM · WebXR)';
    $('start-hint').textContent = '';
  }
}

async function startXr() {
  if (!state.xrCapture) return startXrCapture();
  const cap = state.xrCapture;
  if (!cap.orientation.hasReading) {
    $('start-hint').textContent = 'Waiting for the compass…';
    return;
  }
  if (!cap.fake && !cap.geo.hasFix) {
    $('start-hint').textContent =
      'Waiting for a GPS fix… (or tap "test placement")';
    return;
  }
  // freeze readings as late as possible — the phone barely moves between
  // this tap and the first XR frame, where the yaw is compared
  const headingDeg = compassHeadingOf(cap.orientation.deviceQuaternion);
  const p0 = state.meta.points_en[0];
  const userEnu = cap.fake
    ? { e: p0[0], n: p0[1] - 3 }        // pretend: 3 m south of the start
    : { ...cap.geo.raw };
  stopXrCapture(false);
  try {
    state.enuFrame = new EnuFrame();
    loadXrCalibration();
    state.xrHeadingAtStart = headingDeg;
    state.xrUserEnu = userEnu;
    state.xrNeedsAlign = true;
    state.lastHitY = null;
    resetXrTrackingState();
    state.profileGroup.visible = false;   // until the gated alignment
    state.xrSession = await startXrSession(renderer, {
      overlayRoot: document.body,
      onEnd: exitXr,
    });
    // ARCore map corrections arrive as reference-space resets; carry the
    // stored alignment through the rigid transform so the curtain stays
    // put in the real world (see EnuFrame.applyXrTransform)
    state.xrRefSpace = renderer.xr.getReferenceSpace();
    if (state.xrRefSpace) {
      state.xrRefSpace.addEventListener('reset', onXrReferenceReset);
    }
    state.xrSession.requestReferenceSpace('viewer')
      .then((vs) => state.xrSession.requestHitTestSource({ space: vs }))
      .then((src) => { state.hitTestSource = src; })
      .catch(() => { /* no hit-test: ground stays at local-floor y=0 */ });
  } catch (err) {
    $('start-hint').textContent = 'WebXR error: ' + err.message;
    $('btn-xr').textContent = 'Start AR (SLAM · WebXR)';
    state.profileGroup.visible = true;
    return;
  }
  state.mode = 'xr';
  renderer.setClearColor(0x000000, 0);
  grid.visible = false;
  enterViewer('XR');
}

function applyXrPlacement() {
  state.enuFrame.applyToGroup(
    state.profileGroup, state.xrPosOffset, state.xrGroundY);
  // gestures/buttons run outside the XR frame callback; the anchor is
  // (re)created inside the next animate() frame
  state.xrAnchorDirty = true;
}

function resetXrTrackingState() {
  state.xrTracking = 'none';
  state.xrOkFrames = 0;
  state.xrOkTime = 0;
  state.xrCamPos = null;
  state.xrCamQuat = null;
  state.xrFirstPos = null;
  state.xrMaxTranslation = 0;
  state.xrHitSeen = false;
  state.xrLowestHitY = null;
  deleteXrAnchor();
  state.xrAnchorStatus = 'none';
  state.xrAnchorDirty = false;
  state.xrAnchorReq++;   // invalidate any in-flight createAnchor
}

function deleteXrAnchor() {
  if (state.xrAnchor) {
    try { state.xrAnchor.delete(); } catch { /* session may be gone */ }
  }
  state.xrAnchor = null;
}

function onXrReferenceReset(e) {
  // positions/hits recorded before the reset live in the old coordinates
  state.xrFirstPos = null;
  state.xrMaxTranslation = 0;
  state.xrLowestHitY = null;
  if (!e.transform || !state.enuFrame || state.xrNeedsAlign) return;
  const xp = state.enuFrame.xrPos;
  state.xrGroundY = transformPoint(
    e.transform, { x: xp.x, y: state.xrGroundY, z: xp.z }).y;
  state.enuFrame.applyXrTransform(e.transform);
  applyXrPlacement();
}

function exitXr() {
  if (state.mode !== 'xr') return;
  state.mode = null;
  if (state.xrRefSpace) {
    state.xrRefSpace.removeEventListener('reset', onXrReferenceReset);
  }
  state.xrRefSpace = null;
  resetXrTrackingState();
  state.xrSession = null;
  state.hitTestSource = null;
  state.xrNeedsAlign = false;
  state.xrGroundY = 0;
  state.xrGroundSource = null;
  $('xr-diag').hidden = true;
  if (reticle) reticle.visible = false;
  state.profileGroup.visible = true;
  state.profileGroup.rotation.set(0, 0, 0);
  applyProfileOffset();
  camera.position.set(0, state.height, 0);
  camera.quaternion.identity();
  camera.updateProjectionMatrix();
  $('btn-xr').textContent = 'Start AR (SLAM · WebXR)';
  $('start-hint').textContent = '';
  $('start-overlay').classList.remove('hidden');
  $('hud').classList.remove('active');
  $('controls').classList.remove('active');
}

function startDebug() {
  state.mode = 'debug';
  renderer.setClearColor(0x161b22, 1);
  grid.visible = true;
  state.debugControls = new DebugControls(camera, renderer.domElement);
  state.debugControls.enabled = true;
  // start a few meters south of the profile, looking north at it
  camera.position.set(state.meta.points_en[0][0], state.height,
                      -(state.meta.points_en[0][1] - 6));
  state.debugControls.yaw = 0;              // yaw 0 faces north (-z)
  enterViewer('DEBUG');
}

function enterViewer(label) {
  $('start-overlay').classList.add('hidden');
  $('hud').classList.add('active');
  $('controls').classList.add('active');
  $('chip-mode').textContent = label;
  // SLAM tracks true height; the manual phone-height slider is v1-only
  $('ctl-height').parentElement.style.display =
    state.mode === 'xr' ? 'none' : '';
  $('btn-ground').hidden = state.mode !== 'xr';
  $('xr-diag').hidden = state.mode !== 'xr';
  applyProfileOffset();
  applyUniforms();
  updateAnchorButton();
}

$('btn-ar').addEventListener('click', startAr);
$('btn-xr').addEventListener('click', startXr);
$('btn-debug').addEventListener('click', startDebug);

isXrSupported().then((ok) => { $('btn-xr').hidden = !ok; });

// ------------------------------------------------------------ UI bindings

for (const id of ['ctl-palette', 'ctl-gain', 'ctl-opacity']) {
  $(id).addEventListener('input', () => { applyUniforms(); saveSettings(); });
}
$('ctl-height').addEventListener('input', () => {
  state.height = +$('ctl-height').value;
  applyUniforms();
  saveSettings();
});

$('btn-anchor').addEventListener('click', () => {
  const g = state.geo;
  if (!g) return;                       // debug mode: no GPS
  if (g.mode === 'follow') {
    if (!g.startAnchor(20)) return;     // needs a GPS fix first
  } else {
    g.unlock();                         // anchoring/anchored -> follow again
  }
  updateAnchorButton();
});

function updateAnchorButton() {
  const btn = $('btn-anchor');
  const g = state.geo;
  if (!g) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  if (g.mode === 'anchoring') {
    btn.className = 'cal active';
    btn.textContent = `⚓ hold still… ${Math.round(g.anchorProgress * 100)}%`;
  } else if (g.mode === 'anchored') {
    btn.className = 'cal locked';
    btn.textContent = g.walkedAway
      ? '⚓ moved — tap to unlock' : '⚓ anchored (tap to unlock)';
  } else {
    btn.className = 'cal';
    btn.textContent = '⚓ Anchor (stand still 20 s)';
  }
}

for (const btn of document.querySelectorAll('#calib-row .cal')) {
  if (btn.id === 'btn-anchor' || btn.id === 'btn-ground') continue;
  btn.addEventListener('click', () => {
    const xr = state.mode === 'xr';
    const o = state.orientation;
    if (btn.dataset.cal === 'reset') {
      if (xr) {
        state.xrPosOffset = { e: 0, n: 0 };
        state.enuFrame.userHeadingOffsetDeg = 0;
        applyXrPlacement();
      } else {
        state.posOffset = { e: 0, n: 0 };
        if (o) { o.userHeadingOffsetDeg = 0; o.recalibrateCompass(); }
        applyProfileOffset();
      }
    } else {
      const d = btn.dataset.cal === 'rot+' ? 2 : -2;
      if (xr) {
        state.enuFrame.userHeadingOffsetDeg += d;
        applyXrPlacement();
      } else if (o) {
        o.userHeadingOffsetDeg += d;
      }
    }
    saveSettings();
  });
}

$('btn-ground').addEventListener('click', () => {
  if (state.mode !== 'xr' || state.lastHitY == null) return;
  state.xrGroundY = state.lastHitY;
  state.xrGroundSource = 'manual';
  applyXrPlacement();
});

$('btn-xr-fake').addEventListener('click', () => {
  const cap = state.xrCapture;
  if (!cap) return;
  cap.fake = !cap.fake;
  $('btn-xr-fake').classList.toggle('active', cap.fake);
});

// --------------------------------------------- touch calibration gestures

let touchState = null;
const gestureModes = new Set(['ar', 'xr']);
renderer.domElement.addEventListener('touchstart', (e) => {
  if (!gestureModes.has(state.mode)) return;
  touchState = {
    n: e.touches.length,
    x: avg(e.touches, 'clientX'),
    y: avg(e.touches, 'clientY'),
  };
});
renderer.domElement.addEventListener('touchmove', (e) => {
  if (!touchState || !gestureModes.has(state.mode)) return;
  e.preventDefault();
  const x = avg(e.touches, 'clientX');
  const y = avg(e.touches, 'clientY');
  const dx = x - touchState.x, dy = y - touchState.y;
  const xr = state.mode === 'xr';

  if (e.touches.length === 1 && touchState.n === 1) {
    // rotate heading: full screen width ~ 40 degrees
    const d = dx / window.innerWidth * 40;
    if (xr) {
      state.enuFrame.userHeadingOffsetDeg += d;
      applyXrPlacement();
    } else {
      state.orientation.userHeadingOffsetDeg += d;
    }
  } else if (e.touches.length >= 2) {
    // shift profile in camera-aligned ground axes
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const k = 0.01; // meters per pixel
    if (xr) {
      // camera axes live in XR space; convert to ENU before offsetting
      const f = state.enuFrame.xrDirToEnu(fwd.x, fwd.z);
      const r = state.enuFrame.xrDirToEnu(right.x, right.z);
      state.xrPosOffset.e += (r.e * dx - f.e * dy) * k;
      state.xrPosOffset.n += (r.n * dx - f.n * dy) * k;
      applyXrPlacement();
    } else {
      state.posOffset.e += right.x * dx * k - fwd.x * dy * k;
      state.posOffset.n += -(right.z * dx * k - fwd.z * dy * k);
      applyProfileOffset();
    }
  }
  touchState.x = x; touchState.y = y; touchState.n = e.touches.length;
}, { passive: false });
renderer.domElement.addEventListener('touchend', (e) => {
  if (touchState) saveSettings();
  if (e.touches.length === 0) touchState = null;
});

function avg(touches, key) {
  let s = 0;
  for (const t of touches) s += t[key];
  return s / touches.length;
}

// ------------------------------------------------------------- HUD update

function updateHud() {
  const gpsChip = $('chip-gps');
  const distChip = $('chip-dist');
  let user = null;

  if (state.mode === 'ar' && state.geo) {
    if (state.geo.hasFix) {
      user = state.geo.position;
      const acc = state.geo.accuracy;
      if (state.geo.mode === 'anchored') {
        gpsChip.textContent = state.geo.walkedAway
          ? '⚓ you moved — re-anchor' : '⚓ position locked';
        gpsChip.className = 'chip ' + (state.geo.walkedAway ? 'warn' : 'good');
      } else {
        gpsChip.textContent = `GPS ±${acc.toFixed(0)} m`;
        gpsChip.className = 'chip ' + (acc <= 8 ? 'good' : 'warn');
      }
    } else {
      gpsChip.textContent = state.geo.error
        ? 'GPS error' : 'GPS acquiring…';
      gpsChip.className = 'chip warn';
    }
  } else if (state.mode === 'xr') {
    // three's camera is stale while ARCore has no pose; use ours
    const cp = state.xrCamPos || camera.position;
    user = state.enuFrame.xrToEnu(cp.x, cp.z);
    if (state.xrTracking === 'none') {
      gpsChip.textContent = '⚠ tracking lost — move slowly';
      gpsChip.className = 'chip warn';
    } else if (state.xrNeedsAlign) {
      gpsChip.textContent = 'placing — scan the ground slowly';
      gpsChip.className = 'chip warn';
    } else {
      gpsChip.textContent = state.xrTracking === 'ok'
        ? 'SLAM tracking' : 'SLAM tracking (limited)';
      gpsChip.className = 'chip ' + (state.xrTracking === 'ok' ? 'good' : 'warn');
    }
    const f2 = (v) => (v == null ? '—' : v.toFixed(2));
    $('xr-diag').textContent =
      `trk ${state.xrTracking} ok×${state.xrOkFrames}\n` +
      `cam ${f2(cp.x)} ${f2(cp.y)} ${f2(cp.z)} ` +
      `Δmax ${state.xrMaxTranslation.toFixed(2)} m\n` +
      `gnd ${state.xrGroundSource || 'n/a'} y=${f2(state.xrGroundY)} ` +
      `hit ${state.xrHitSeen ? 'y' : 'n'}\n` +
      `anchor ${state.xrAnchorStatus}`;
  } else if (state.mode === 'debug') {
    user = { e: camera.position.x, n: -camera.position.z };
    gpsChip.textContent = 'GPS simulated';
    gpsChip.className = 'chip';
  }

  if (user && state.meta) {
    const off = state.mode === 'xr' ? state.xrPosOffset : state.posOffset;
    let dMin = Infinity;
    for (const [pe, pn] of state.meta.points_en) {
      dMin = Math.min(dMin, Math.hypot(pe + off.e - user.e,
                                       pn + off.n - user.n));
    }
    distChip.textContent = `dist ${dMin.toFixed(1)} m`;
  }

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(
    (state.mode === 'xr' && state.xrCamQuat) || camera.quaternion);
  const heading = state.mode === 'xr'
    ? state.enuFrame.enuHeadingOfXrDir(fwd.x, fwd.z)
    : Math.atan2(fwd.x, -fwd.z);
  state.minimap.draw(user, heading);
  updateAnchorButton();
}

// ------------------------------------------------------------ render loop

const clock = new THREE.Clock();
let hudTimer = 0;

// Per-frame ARCore tracking state. Chrome returns a null viewer pose
// whenever tracking is PAUSED (featureless ground, fast motion, low
// light); three r170 then leaves the camera stale but still renders, so
// the curtain would freeze on screen while the camera image moves.
function updateXrTracking(pose, dt) {
  if (!pose) {
    state.xrTracking = 'none';
    state.xrOkFrames = 0;
    state.xrOkTime = 0;
    return;
  }
  const p = pose.transform.position, o = pose.transform.orientation;
  state.xrCamPos = { x: p.x, y: p.y, z: p.z };
  state.xrCamQuat = (state.xrCamQuat || new THREE.Quaternion())
    .set(o.x, o.y, o.z, o.w);
  if (pose.emulatedPosition) {
    state.xrTracking = 'limited';
    state.xrOkFrames = 0;
    state.xrOkTime = 0;
  } else {
    state.xrTracking = 'ok';
    state.xrOkFrames++;
    state.xrOkTime += dt;
  }
  if (!state.xrFirstPos) state.xrFirstPos = { x: p.x, z: p.z };
  const d = Math.hypot(p.x - state.xrFirstPos.x, p.z - state.xrFirstPos.z);
  if (d > state.xrMaxTranslation) state.xrMaxTranslation = d;
}

// Gated alignment: ARCore needs a map before its origin/ground mean
// anything, so wait for >= 15 consecutive solid frames plus a hit-test
// result (or 10 s of solid tracking if hit-test never delivers). The
// compass heading was captured at the start tap; here we read the
// camera's yaw inside XR space and tie the two.
const ALIGN_OK_FRAMES = 15, ALIGN_FALLBACK_S = 10;
function alignXrGated(pose) {
  if (state.xrTracking !== 'ok') return;
  const ready = (state.xrOkFrames >= ALIGN_OK_FRAMES && state.xrHitSeen) ||
                state.xrOkTime >= ALIGN_FALLBACK_S;
  if (!ready) return;
  const p = pose.transform.position, o = pose.transform.orientation;
  const q = new THREE.Quaternion(o.x, o.y, o.z, o.w);
  const yawDeg = compassHeadingOf(q);  // same fwd/up convention both sides
  state.enuFrame.setAlignment(
    state.xrHeadingAtStart - yawDeg, state.xrUserEnu, { x: p.x, z: p.z });
  // local-floor on ARCore is a fixed offset below the start pose, not a
  // detected floor: prefer the lowest horizontal hit seen so far, else
  // camera height minus phone height; either way keep 'estimate' so the
  // hit-test auto-snap below still refines it
  state.xrGroundY = state.xrLowestHitY != null
    ? state.xrLowestHitY : p.y - state.height;
  state.xrGroundSource = 'estimate';
  applyXrPlacement();
  state.profileGroup.visible = true;
  state.xrNeedsAlign = false;
}

// hit orientation's +Y axis must be near vertical (within 20°) to count
// as ground — rejects walls, bushes, the user's own legs
const HORIZ_COS = Math.cos(20 * Math.PI / 180);
const _hitQ = new THREE.Quaternion(), _hitUp = new THREE.Vector3();
function updateReticle(frame, camY) {
  state.xrHitSeen = false;
  if (!state.hitTestSource) return;
  ensureReticle();
  const hits = frame.getHitTestResults(state.hitTestSource);
  const pose = hits.length &&
    hits[0].getPose(renderer.xr.getReferenceSpace());
  if (pose) {
    const p = pose.transform.position, o = pose.transform.orientation;
    state.xrHitSeen = true;
    reticle.position.set(p.x, p.y, p.z);
    reticle.visible = true;
    state.lastHitY = p.y;
    _hitUp.set(0, 1, 0).applyQuaternion(_hitQ.set(o.x, o.y, o.z, o.w));
    const groundLike = _hitUp.y > HORIZ_COS && p.y < camY - 0.8;
    if (groundLike) {
      if (state.xrLowestHitY == null || p.y < state.xrLowestHitY) {
        state.xrLowestHitY = p.y;
      }
      // first horizontal hit well below the camera = the real ground;
      // snap the profile top there once (manual "set ground" always wins)
      if (state.xrGroundSource === 'estimate') {
        state.xrGroundY = p.y;
        state.xrGroundSource = 'auto';
        applyXrPlacement();
      }
    }
  } else {
    reticle.visible = false;
  }
}

// XR anchors: let ARCore carry the curtain through map corrections. The
// anchor is recreated whenever the placement changes (flagged by
// applyXrPlacement); while it tracks, its pose overrides the directly
// computed group transform.
function updateXrAnchor(frame, ref) {
  if (typeof frame.createAnchor !== 'function' ||
      typeof XRRigidTransform === 'undefined') {
    state.xrAnchorStatus = 'unsupported';
    return;
  }
  if (state.xrAnchorDirty) {
    // drop the old anchor at once (its tracked pose would undo the new
    // placement), but create the new one only after the gesture ends —
    // otherwise a drag would churn one ARCore anchor per frame
    deleteXrAnchor();
    state.xrAnchorStatus = 'none';
    if (touchState) return;
    state.xrAnchorDirty = false;
    const g = state.profileGroup;
    const init = anchorPoseInit(g.position, g.rotation.y);
    const req = ++state.xrAnchorReq;
    frame.createAnchor(
      new XRRigidTransform(init.position, init.orientation), ref)
      .then((anchor) => {
        if (req !== state.xrAnchorReq || state.mode !== 'xr') {
          try { anchor.delete(); } catch { /* ignore */ }
          return;
        }
        state.xrAnchor = anchor;
      })
      .catch(() => {
        // rejected (e.g. 'anchors' not granted): keep the direct
        // placement; no retry until the placement changes again
        if (req === state.xrAnchorReq) state.xrAnchorStatus = 'failed';
      });
    return;
  }
  if (!state.xrAnchor) return;
  const pose = frame.getPose(state.xrAnchor.anchorSpace, ref);
  if (pose) {
    const p = pose.transform.position, o = pose.transform.orientation;
    state.profileGroup.position.set(p.x, p.y, p.z);
    state.profileGroup.quaternion.set(o.x, o.y, o.z, o.w);
    state.xrAnchorStatus = 'tracked';
  } else if (state.xrAnchorStatus !== 'lost') {
    state.xrAnchorStatus = 'lost';
    state.enuFrame.applyToGroup(          // fall back, no anchor recreate
      state.profileGroup, state.xrPosOffset, state.xrGroundY);
  }
}

function animate(time, frame) {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (state.mode === 'ar') {
    state.orientation.update(dt);
    camera.quaternion.copy(state.orientation.quaternion);
    state.geo.update(dt);
    camera.position.set(
      state.geo.position.e, state.height, -state.geo.position.n);
  } else if (state.mode === 'debug') {
    state.debugControls.update(dt);
    camera.position.y = Math.max(camera.position.y, 0.2);
  } else if (state.mode === 'xr' && frame) {
    // camera itself is driven by three's WebXRManager from SLAM poses;
    // we read the pose ourselves to know when there is none
    const ref = renderer.xr.getReferenceSpace();
    const pose = frame.getViewerPose(ref);
    updateXrTracking(pose, dt);
    if (!pose) {
      // frozen camera: hide the curtain instead of letting it ride the screen
      state.profileGroup.visible = false;
      if (reticle) reticle.visible = false;
    } else {
      updateReticle(frame, pose.transform.position.y);
      if (state.xrNeedsAlign) {
        alignXrGated(pose);
      } else {
        state.profileGroup.visible = true;
        updateXrAnchor(frame, ref);
      }
    }
  }

  hudTimer += dt;
  if (state.mode && hudTimer > 0.2) {
    hudTimer = 0;
    updateHud();
  }
  renderer.render(scene, camera);
}

loadManifest().catch((err) => {
  $('profile-info').textContent = 'Failed to load profile: ' + err.message;
});
renderer.setAnimationLoop(animate);  // rAF replacement that also runs in XR
