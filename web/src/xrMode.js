// WebXR immersive-ar session setup + ENU <-> XR-local frame mapping.
//
// XR local-floor space: y = up (0 at the estimated floor), origin at the
// phone's pose when the session started, -z = the direction the phone
// faced at that moment. SLAM keeps poses stable in this space; geography
// enters only through the one-time alignment stored in EnuFrame.

// rotate an ENU vector so its heading increases by deg (north -> east)
function rotEN(e, n, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { e: e * c + n * s, n: n * c - e * s };
}

// Maps ENU world coordinates (meters east/north of the profile anchor,
// the frame curtain geometry lives in: x = east, y = up, z = -north)
// into XR-local space. Pure math — testable headlessly in Node.
//
// Alignment = one correspondence captured at session start: the phone's
// compass heading (= ENU heading of XR -z after subtracting the phone's
// yaw within XR space) plus (user GPS position in ENU <-> camera x/z in
// XR). userHeadingOffsetDeg is the manual compass correction; changing
// it rotates the world around the session-start point (v1 semantics).
export class EnuFrame {
  constructor() {
    this.headingDeg = 0;              // measured ENU heading of XR -z
    this.userHeadingOffsetDeg = 0;    // manual correction (persisted)
    this.userEnu = { e: 0, n: 0 };    // user's ENU position at alignment
    this.xrPos = { x: 0, z: 0 };      // camera XR x/z at the same moment
  }

  setAlignment(headingDeg, userEnu, xrPos = { x: 0, z: 0 }) {
    this.headingDeg = headingDeg;
    this.userEnu = { ...userEnu };
    this.xrPos = { ...xrPos };
  }

  get effHeadingDeg() { return this.headingDeg + this.userHeadingOffsetDeg; }
  get headingRad() { return this.effHeadingDeg * Math.PI / 180; }

  // translation part: where the ENU origin (profile anchor) sits in XR x/z
  _t() {
    const th = this.headingRad, c = Math.cos(th), s = Math.sin(th);
    return {
      tx: this.xrPos.x - (this.userEnu.e * c - this.userEnu.n * s),
      tz: this.xrPos.z + this.userEnu.e * s + this.userEnu.n * c,
    };
  }

  enuToXr(e, n) {
    const th = this.headingRad, c = Math.cos(th), s = Math.sin(th);
    const { tx, tz } = this._t();
    return { x: e * c - n * s + tx, z: -e * s - n * c + tz };
  }

  xrToEnu(x, z) {
    const th = this.headingRad, c = Math.cos(th), s = Math.sin(th);
    const { tx, tz } = this._t();
    const X = x - tx, Z = z - tz;
    return { e: X * c - Z * s, n: -(X * s + Z * c) };
  }

  // ENU heading (rad, 0 = north) of an XR-space direction (x, z)
  enuHeadingOfXrDir(x, z) {
    return Math.atan2(x, -z) + this.headingRad;
  }

  // XR-space direction (x, z) -> ENU direction vector (for drag gestures)
  xrDirToEnu(x, z) {
    return rotEN(x, -z, this.effHeadingDeg);
  }

  // position a THREE.Group holding ENU-frame geometry into XR space;
  // posOffset shifts the profile in ENU meters (manual calibration)
  applyToGroup(group, posOffset = { e: 0, n: 0 }, groundY = 0) {
    const th = this.headingRad, c = Math.cos(th), s = Math.sin(th);
    const { tx, tz } = this._t();
    const ox = posOffset.e * c - posOffset.n * s;
    const oz = -posOffset.e * s - posOffset.n * c;
    group.rotation.set(0, th, 0);
    group.position.set(tx + ox, groundY, tz + oz);
  }
}

// ------------------------------------------------------------- session

export async function isXrSupported() {
  if (!navigator.xr || !navigator.xr.isSessionSupported) return false;
  try {
    return await navigator.xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

// Must be called from a user gesture. HUD/controls stay usable in-session
// via dom-overlay; three.js drives the camera from SLAM poses.
export async function startXrSession(renderer, { overlayRoot, onEnd } = {}) {
  const init = {
    requiredFeatures: ['local-floor', 'hit-test'],
    optionalFeatures: ['dom-overlay', 'anchors'],
  };
  if (overlayRoot) init.domOverlay = { root: overlayRoot };
  const session = await navigator.xr.requestSession('immersive-ar', init);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  session.addEventListener('end', () => {
    renderer.xr.enabled = false;
    if (onEnd) onEnd();
  });
  return session;
}
