// Small-area WGS84 lat/lon -> local east/north meters around an anchor.
const A = 6378137.0;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);

export function latLonToEnu(lat, lon, lat0, lon0) {
  const phi = (lat0 * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi); // prime vertical radius
  const m = (A * (1 - E2)) / Math.pow(1 - E2 * sinPhi * sinPhi, 1.5);
  const de = ((lon - lon0) * Math.PI / 180) * n * Math.cos(phi);
  const dn = ((lat - lat0) * Math.PI / 180) * m;
  return { e: de, n: dn };
}
