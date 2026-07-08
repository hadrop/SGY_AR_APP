import * as THREE from 'three';

// Desktop fly controls: click-drag to look, WASD to move, R/F up/down.
export class DebugControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = false;
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 3; // m/s
    this._keys = new Set();
    this._dragging = false;
    this._last = { x: 0, y: 0 };

    domElement.addEventListener('mousedown', (e) => {
      this._dragging = true;
      this._last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { this._dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this._dragging || !this.enabled) return;
      this.yaw -= (e.clientX - this._last.x) * 0.004;
      this.pitch -= (e.clientY - this._last.y) * 0.004;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      this._last = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('keydown', (e) => this._keys.add(e.code));
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
  }

  update(dt) {
    if (!this.enabled) return;
    this.camera.quaternion.setFromEuler(
      new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    const v = this.speed * (this._keys.has('ShiftLeft') ? 4 : 1) * dt;
    const fwd = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();

    if (this._keys.has('KeyW')) this.camera.position.addScaledVector(fwd, v);
    if (this._keys.has('KeyS')) this.camera.position.addScaledVector(fwd, -v);
    if (this._keys.has('KeyA')) this.camera.position.addScaledVector(right, -v);
    if (this._keys.has('KeyD')) this.camera.position.addScaledVector(right, v);
    if (this._keys.has('KeyR')) this.camera.position.y += v;
    if (this._keys.has('KeyF')) this.camera.position.y -= v;
  }
}
