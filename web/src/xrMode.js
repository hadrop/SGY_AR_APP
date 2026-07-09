// WebXR immersive-ar session setup + ENU <-> XR-local frame mapping.
//
// XR local-floor space: y = up (0 at the estimated floor), origin at the
// phone's pose when the session started, -z = the direction the phone
// faced at that moment. SLAM keeps poses stable in this space; geography
// enters only through the one-time alignment stored in EnuFrame.

// Maps ENU world coordinates (meters east/north of the profile anchor,
// the frame curtain geometry lives in: x = east, y = up, z = -north)
// into XR-local space. Pure math — testable headlessly in Node.
export class EnuFrame {
  constructor() {
    this.headingDeg = 0;            // compass heading of XR -z (0 = N, 90 = E)
    this.userEnu = { e: 0, n: 0 };  // user's ENU position at session start
  }

  setAlignment(headingDeg, userEnu) {
    this.headingDeg = headingDeg;
    this.userEnu = { ...userEnu };
  }

  get headingRad() { return this.headingDeg * Math.PI / 180; }

  // translation part: where the ENU origin (profile anchor) sits in XR x/z
  _t() {
    const th = this.headingRad, c = Math.cos(th), s = Math.sin(th);
    return {
      tx: -(this.userEnu.e * c - this.userEnu.n * s),
      tz: this.userEnu.e * s + this.userEnu.n * c,
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

  // position a THREE.Group holding ENU-frame geometry into XR space
  applyToGroup(group, groundY = 0) {
    const { tx, tz } = this._t();
    group.rotation.set(0, this.headingRad, 0);
    group.position.set(tx, groundY, tz);
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
