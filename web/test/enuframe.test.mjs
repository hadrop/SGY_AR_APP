// Headless checks for EnuFrame (pure math, no browser globals needed).
// Run: node web/test/enuframe.test.mjs
import { EnuFrame, transformPoint, yawDegOf, anchorPoseInit } from '../src/xrMode.js';

let fails = 0;
const close = (a, b) => Math.abs(a - b) < 1e-9;
function check(name, got, want) {
  const ok = Object.keys(want).every((k) => close(got[k], want[k]));
  if (!ok) { fails++; console.log(`FAIL ${name}: got`, got, 'want', want); }
  else console.log(`ok   ${name}`);
}

const f = new EnuFrame();

// facing north at the anchor: 5 m north must be 5 m in front (-z)
f.setAlignment(0, { e: 0, n: 0 });
check('N-facing, point north', f.enuToXr(0, 5), { x: 0, z: -5 });
check('N-facing, point east', f.enuToXr(5, 0), { x: 5, z: 0 });

// facing east: east is in front, north is to the left (-x)
f.setAlignment(90, { e: 0, n: 0 });
check('E-facing, point east', f.enuToXr(5, 0), { x: 0, z: -5 });
check('E-facing, point north', f.enuToXr(0, 5), { x: -5, z: 0 });

// user standing away from the anchor maps to the alignment XR position
f.setAlignment(237, { e: 12.3, n: -4.56 });
check('user -> origin', f.enuToXr(12.3, -4.56), { x: 0, z: 0 });
f.setAlignment(237, { e: 12.3, n: -4.56 }, { x: 1.5, z: -0.7 });
check('user -> xrPos', f.enuToXr(12.3, -4.56), { x: 1.5, z: -0.7 });

// round trips at an arbitrary alignment
for (const [e, n] of [[0, 0], [17.97, 0], [-3.2, 8.8], [100, -50]]) {
  const p = f.enuToXr(e, n);
  check(`roundtrip (${e},${n})`, f.xrToEnu(p.x, p.z), { e, n });
}

// heading conversion: XR -z direction has the alignment heading
check('heading of -z', { h: f.enuHeadingOfXrDir(0, -1) },
      { h: 237 * Math.PI / 180 });

// heading offset pivots around the session-start point: the user's
// position must not move, a point elsewhere must rotate around it
f.userHeadingOffsetDeg = 25;
check('offset: user pinned', f.enuToXr(12.3, -4.56), { x: 1.5, z: -0.7 });
{
  const p = f.enuToXr(12.3, 5.44);  // 10 m north of the user
  const d = Math.hypot(p.x - 1.5, p.z - (-0.7));
  check('offset: distance kept', { d }, { d: 10 });
}
f.userHeadingOffsetDeg = 0;

// xrDirToEnu inverts the direction mapping: ENU north -> XR -> back
{
  const th = f.headingRad;
  // ENU north maps to XR direction (sin(-th)... take from enuToXr delta:
  const a = f.enuToXr(0, 0), b = f.enuToXr(0, 1);
  const d = f.xrDirToEnu(b.x - a.x, b.z - a.z);
  check('xrDirToEnu roundtrip north', d, { e: 0, n: 1 });
  const c = f.enuToXr(1, 0);
  const d2 = f.xrDirToEnu(c.x - a.x, c.z - a.z);
  check('xrDirToEnu roundtrip east', d2, { e: 1, n: 0 });
}

// applyToGroup must equal enuToXr for a group-local ENU point,
// with posOffset acting as an ENU-space shift of the profile
const group = {
  rotation: { set: (x, y, z) => { group.ry = y; } },
  position: { set: (x, y, z) => { group.px = x; group.py = y; group.pz = z; } },
};
const off = { e: 2.5, n: -1.25 };
f.applyToGroup(group, off, 0.42);
const pt = { e: 5.5, n: -2.2 };                       // ENU point
const c = Math.cos(group.ry), s = Math.sin(group.ry); // three rotation.y
const lx = pt.e, lz = -pt.n;                          // ENU -> local x/z
const gx = lx * c + lz * s + group.px;
const gz = -lx * s + lz * c + group.pz;
check('group transform = enuToXr(p + off)', { x: gx, z: gz },
      f.enuToXr(pt.e + off.e, pt.n + off.n));
check('groundY applied', { y: group.py }, { y: 0.42 });

// applyXrTransform (reference-space `reset`): identity is a no-op, a pure
// translation shifts xrPos, a 90° yaw rotates the stored point and heading.
// Invariant: every ENU point must map to transformPoint(t, old XR point).
const ID = { x: 0, y: 0, z: 0, w: 1 };
{
  const g = new EnuFrame();
  g.setAlignment(237, { e: 12.3, n: -4.56 }, { x: 1.5, z: -0.7 });
  g.applyXrTransform({ position: { x: 0, y: 0, z: 0 }, orientation: ID });
  check('reset identity: xrPos', g.xrPos, { x: 1.5, z: -0.7 });
  check('reset identity: heading', { h: g.headingDeg }, { h: 237 });

  g.applyXrTransform({ position: { x: 2, y: 5, z: -3 }, orientation: ID });
  check('reset translate: xrPos', g.xrPos, { x: 3.5, z: -3.7 });
  check('reset translate: heading', { h: g.headingDeg }, { h: 237 });
  check('reset translate: user maps to new xrPos',
        g.enuToXr(12.3, -4.56), { x: 3.5, z: -3.7 });

  // 90° yaw about +y (three rotation.y sense): (0,0,-1) -> (-1,0,0)
  const q90 = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
  check('yawDegOf 90', { y: yawDegOf(q90) }, { y: 90 });
  check('yawDegOf identity', { y: yawDegOf(ID) }, { y: 0 });
  const before = g.enuToXr(-3.2, 8.8);
  const t90 = { position: { x: 0.4, y: 0, z: -1.1 }, orientation: q90 };
  g.applyXrTransform(t90);
  check('reset yaw90: xrPos rotated', g.xrPos, { x: -3.7 + 0.4, z: -3.5 - 1.1 });
  check('reset yaw90: heading', { h: g.headingDeg }, { h: 327 });
  const want = transformPoint(t90, { x: before.x, y: 0, z: before.z });
  check('reset yaw90: ENU point follows transform', g.enuToXr(-3.2, 8.8),
        { x: want.x, z: want.z });
}

// anchorPoseInit: heading 0 -> identity orientation; heading pi -> 180° yaw
{
  const a = anchorPoseInit({ x: 1, y: 2, z: 3 }, 0);
  check('anchor init pos', a.position, { x: 1, y: 2, z: 3, w: 1 });
  check('anchor init identity', a.orientation, { x: 0, y: 0, z: 0, w: 1 });
  const b = anchorPoseInit({ x: 0, y: 0, z: 0 }, Math.PI / 2);
  check('anchor init yaw 90', { y: yawDegOf(b.orientation) }, { y: 90 });
}

console.log(fails ? `\n${fails} FAILURES` : '\nall passed');
process.exit(fails ? 1 : 0);
