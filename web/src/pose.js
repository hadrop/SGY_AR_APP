import * as THREE from 'three';
import { latLonToEnu } from './geo.js';

// ---------------------------------------------------------- camera feed

export async function startCameraFeed(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.classList.add('active');
  await videoEl.play();
}

// ------------------------------------------------- device orientation

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
// rotate device frame (camera looks out the back) into three.js camera frame
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

export class OrientationTracker {
  constructor() {
    this.quaternion = new THREE.Quaternion();
    this.deviceQuaternion = new THREE.Quaternion();
    this.hasReading = false;
    // compass alignment: effective alpha = event.alpha + compassOffsetDeg
    this.compassOffsetDeg = 0;
    this.compassLocked = false;
    // user calibration on top of the compass (degrees, + = rotate view CW)
    this.userHeadingOffsetDeg = 0;
    this.screenAngle = 0;
    this._onEvent = this._onEvent.bind(this);
    this._onScreen = () => {
      this.screenAngle = (screen.orientation && screen.orientation.angle) || 0;
    };
    this._onScreen();
  }

  // Must be called from a user gesture (button tap) for iOS permission.
  async start() {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') throw new Error('Motion permission denied');
    }
    // prefer absolute orientation (Android); iOS fires plain event
    window.addEventListener('deviceorientationabsolute', this._onEvent);
    window.addEventListener('deviceorientation', this._onEvent);
    window.addEventListener('orientationchange', this._onScreen);
  }

  _onEvent(ev) {
    if (ev.type === 'deviceorientation' && this._hasAbsolute) return;
    if (ev.type === 'deviceorientationabsolute') this._hasAbsolute = true;
    if (ev.alpha == null) return;

    // iOS: alpha is arbitrary-relative; anchor it to the compass once.
    if (!this.compassLocked) {
      if (typeof ev.webkitCompassHeading === 'number' &&
          ev.webkitCompassHeading >= 0) {
        this.compassOffsetDeg = -(ev.webkitCompassHeading + ev.alpha);
        this.compassLocked = true;
      } else if (ev.absolute || ev.type === 'deviceorientationabsolute') {
        this.compassOffsetDeg = 0;
        this.compassLocked = true;
      }
    }

    const alpha = THREE.MathUtils.degToRad(
      ev.alpha + this.compassOffsetDeg + this.userHeadingOffsetDeg);
    const beta = THREE.MathUtils.degToRad(ev.beta || 0);
    const gamma = THREE.MathUtils.degToRad(ev.gamma || 0);
    const orient = THREE.MathUtils.degToRad(this.screenAngle);

    // standard deviceorientation -> camera quaternion (world: -z = north)
    euler.set(beta, alpha, -gamma, 'YXZ');
    this.deviceQuaternion.setFromEuler(euler);
    this.deviceQuaternion.multiply(q1);
    this.deviceQuaternion.multiply(q0.setFromAxisAngle(zee, -orient));
    this.hasReading = true;
  }

  // slerp toward the latest reading to damp sensor noise
  update(dt) {
    if (!this.hasReading) return;
    const t = 1 - Math.exp(-dt * 12);
    this.quaternion.slerp(this.deviceQuaternion, t);
  }

  recalibrateCompass() {
    this.compassLocked = false;
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this._onEvent);
    window.removeEventListener('deviceorientation', this._onEvent);
    window.removeEventListener('orientationchange', this._onScreen);
  }
}

// --------------------------------------------------------------- GPS

// Position modes:
//   follow   - tracks GPS with smoothing + deadband (default, for walking)
//   anchoring - standing still, averaging fixes for a robust position
//   anchored - position hard-locked; only gyro moves the view
const DEADBAND_M = 1.5;      // ignore smoothed GPS moves smaller than this
const GLIDE_STOP_M = 0.15;   // stop gliding when this close to target
const WALK_AWAY_M = 4.0;     // warn when this far from the locked anchor

export class GeoTracker {
  constructor(anchorLat, anchorLon) {
    this.anchorLat = anchorLat;
    this.anchorLon = anchorLon;
    this.position = { e: 0, n: 0 };   // rendered position (drives camera)
    this.raw = null;
    this.accuracy = Infinity;
    this.hasFix = false;
    this.mode = 'follow';
    this.anchorProgress = 0;          // 0..1 while anchoring
    this.walkedAway = false;          // true if user left a locked anchor
    this._smoothed = null;
    this._gliding = false;
    this._samples = [];
    this._anchorEnd = 0;
    this._anchorDurationMs = 0;
    this._watchId = null;
  }

  start() {
    if (!navigator.geolocation) throw new Error('Geolocation unavailable');
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const enu = latLonToEnu(latitude, longitude,
                                this.anchorLat, this.anchorLon);
        this.raw = enu;
        this.accuracy = accuracy;
        if (!this.hasFix) {
          this.position = { ...enu };
          this._smoothed = { ...enu };
          this.hasFix = true;
        }
        if (this.mode === 'anchoring') {
          this._samples.push({ ...enu, acc: Math.max(accuracy, 1) });
        }
      },
      (err) => { this.error = err; },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  // Begin averaging fixes; user should stand still for the duration.
  startAnchor(durationS = 20) {
    if (!this.hasFix) return false;
    this.mode = 'anchoring';
    this._samples = this.raw ? [{ ...this.raw, acc: Math.max(this.accuracy, 1) }] : [];
    this._anchorDurationMs = durationS * 1000;
    this._anchorEnd = performance.now() + this._anchorDurationMs;
    this.anchorProgress = 0;
    this.walkedAway = false;
    return true;
  }

  unlock() {
    this.mode = 'follow';
    this.walkedAway = false;
    this._smoothed = this.raw ? { ...this.raw } : this._smoothed;
  }

  _finishAnchor() {
    // robust accuracy-weighted mean: drop samples much worse than median
    const s = this._samples;
    if (s.length) {
      const accs = s.map((x) => x.acc).sort((a, b) => a - b);
      const medAcc = accs[Math.floor(accs.length / 2)];
      const kept = s.filter((x) => x.acc <= 2 * medAcc);
      let we = 0, wn = 0, w = 0;
      for (const x of kept) {
        const wi = 1 / (x.acc * x.acc);
        we += x.e * wi; wn += x.n * wi; w += wi;
      }
      if (w > 0) this.position = { e: we / w, n: wn / w };
    }
    this.mode = 'anchored';
    this.anchorProgress = 1;
  }

  update(dt) {
    if (!this.hasFix || !this.raw) return;

    if (this.mode === 'anchoring') {
      // hold still visually while collecting; finish when time is up
      const remaining = this._anchorEnd - performance.now();
      this.anchorProgress = 1 - Math.max(remaining, 0) / this._anchorDurationMs;
      if (remaining <= 0) this._finishAnchor();
      return;
    }

    if (this.mode === 'anchored') {
      const d = Math.hypot(this.raw.e - this.position.e,
                           this.raw.n - this.position.n);
      this.walkedAway = d > Math.max(WALK_AWAY_M, this.accuracy);
      return;
    }

    // follow: low-pass the raw fixes, then apply a deadband so the view
    // stays perfectly still unless the position really moved
    const t = 1 - Math.exp(-dt * 1.5);
    this._smoothed.e += (this.raw.e - this._smoothed.e) * t;
    this._smoothed.n += (this.raw.n - this._smoothed.n) * t;

    const dist = Math.hypot(this._smoothed.e - this.position.e,
                            this._smoothed.n - this.position.n);
    if (dist > DEADBAND_M) this._gliding = true;
    if (this._gliding) {
      const g = 1 - Math.exp(-dt * 2.5);
      this.position.e += (this._smoothed.e - this.position.e) * g;
      this.position.n += (this._smoothed.n - this.position.n) * g;
      if (dist < GLIDE_STOP_M) this._gliding = false;
    }
  }

  stop() {
    if (this._watchId != null) {
      navigator.geolocation.clearWatch(this._watchId);
    }
  }
}
