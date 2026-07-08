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

export class GeoTracker {
  constructor(anchorLat, anchorLon) {
    this.anchorLat = anchorLat;
    this.anchorLon = anchorLon;
    this.position = { e: 0, n: 0 };   // smoothed ENU
    this.raw = null;
    this.accuracy = Infinity;
    this.hasFix = false;
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
          this.hasFix = true;
        }
      },
      (err) => { this.error = err; },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  // low-pass filter toward latest fix; call each frame
  update(dt) {
    if (!this.hasFix || !this.raw) return;
    const t = 1 - Math.exp(-dt * 1.5);
    this.position.e += (this.raw.e - this.position.e) * t;
    this.position.n += (this.raw.n - this.position.n) * t;
  }

  stop() {
    if (this._watchId != null) {
      navigator.geolocation.clearWatch(this._watchId);
    }
  }
}
