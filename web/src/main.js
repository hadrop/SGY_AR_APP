import * as THREE from 'three';
import { createCurtain } from './curtain.js';
import { DebugControls } from './debugControls.js';
import { Minimap } from './minimap.js';
import { startCameraFeed, OrientationTracker, GeoTracker } from './pose.js';
import { EnuFrame, isXrSupported, startXrSession } from './xrMode.js';

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

// ------------------------------------------------------------- data load

async function loadProfile() {
  const manifest = await (await fetch('data/manifest.json')).json();
  const entry = manifest.profiles[0]; // v1: single/first profile
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

// ------------------------------------------------------- settings persist

function settingsKey() { return `gprar:${state.meta.name}`; }

function saveSettings() {
  const o = state.orientation;
  localStorage.setItem(settingsKey(), JSON.stringify({
    palette: +$('ctl-palette').value,
    gain: +$('ctl-gain').value,
    opacity: +$('ctl-opacity').value,
    height: state.height,
    headingOffset: o ? o.userHeadingOffsetDeg : 0,
    posOffset: state.posOffset,
  }));
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

async function startXr() {
  try {
    state.enuFrame = new EnuFrame();
    // Phase 1: fixed placement — profile start 3 m in front of the phone
    state.enuFrame.setAlignment(0, { e: 0, n: -3 });
    state.enuFrame.applyToGroup(state.profileGroup);
    await startXrSession(renderer, {
      overlayRoot: document.body,
      onEnd: exitXr,
    });
  } catch (err) {
    $('start-hint').textContent = 'WebXR error: ' + err.message;
    return;
  }
  state.mode = 'xr';
  renderer.setClearColor(0x000000, 0);
  grid.visible = false;
  enterViewer('XR');
}

function exitXr() {
  if (state.mode !== 'xr') return;
  state.mode = null;
  state.profileGroup.rotation.set(0, 0, 0);
  applyProfileOffset();
  camera.position.set(0, state.height, 0);
  camera.quaternion.identity();
  camera.updateProjectionMatrix();
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
  if (btn.id === 'btn-anchor') continue;
  btn.addEventListener('click', () => {
    const o = state.orientation;
    if (btn.dataset.cal === 'reset') {
      state.posOffset = { e: 0, n: 0 };
      if (o) { o.userHeadingOffsetDeg = 0; o.recalibrateCompass(); }
      applyProfileOffset();
    } else if (o) {
      o.userHeadingOffsetDeg += btn.dataset.cal === 'rot+' ? 2 : -2;
    }
    saveSettings();
  });
}

// --------------------------------------------- touch calibration gestures

let touchState = null;
renderer.domElement.addEventListener('touchstart', (e) => {
  if (state.mode !== 'ar') return;
  touchState = {
    n: e.touches.length,
    x: avg(e.touches, 'clientX'),
    y: avg(e.touches, 'clientY'),
  };
});
renderer.domElement.addEventListener('touchmove', (e) => {
  if (!touchState || state.mode !== 'ar') return;
  e.preventDefault();
  const x = avg(e.touches, 'clientX');
  const y = avg(e.touches, 'clientY');
  const dx = x - touchState.x, dy = y - touchState.y;

  if (e.touches.length === 1 && touchState.n === 1) {
    // rotate heading: full screen width ~ 40 degrees
    state.orientation.userHeadingOffsetDeg += dx / window.innerWidth * 40;
  } else if (e.touches.length >= 2) {
    // shift profile in camera-aligned ground axes
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const k = 0.01; // meters per pixel
    state.posOffset.e += right.x * dx * k - fwd.x * dy * k;
    state.posOffset.n += -(right.z * dx * k - fwd.z * dy * k);
    applyProfileOffset();
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
    user = state.enuFrame.xrToEnu(camera.position.x, camera.position.z);
    gpsChip.textContent = 'SLAM tracking';
    gpsChip.className = 'chip good';
  } else if (state.mode === 'debug') {
    user = { e: camera.position.x, n: -camera.position.z };
    gpsChip.textContent = 'GPS simulated';
    gpsChip.className = 'chip';
  }

  if (user && state.meta) {
    let dMin = Infinity;
    for (const [pe, pn] of state.meta.points_en) {
      dMin = Math.min(dMin, Math.hypot(pe + state.posOffset.e - user.e,
                                       pn + state.posOffset.n - user.n));
    }
    distChip.textContent = `dist ${dMin.toFixed(1)} m`;
  }

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const heading = state.mode === 'xr'
    ? state.enuFrame.enuHeadingOfXrDir(fwd.x, fwd.z)
    : Math.atan2(fwd.x, -fwd.z);
  state.minimap.draw(user, heading);
  updateAnchorButton();
}

// ------------------------------------------------------------ render loop

const clock = new THREE.Clock();
let hudTimer = 0;

function animate() {
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
  }
  // 'xr': three's WebXRManager drives the camera from SLAM poses

  hudTimer += dt;
  if (state.mode && hudTimer > 0.2) {
    hudTimer = 0;
    updateHud();
  }
  renderer.render(scene, camera);
}

loadProfile().catch((err) => {
  $('profile-info').textContent = 'Failed to load profile: ' + err.message;
});
renderer.setAnimationLoop(animate);  // rAF replacement that also runs in XR
