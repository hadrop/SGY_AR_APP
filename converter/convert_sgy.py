#!/usr/bin/env python3
"""Convert a GPR SEG-Y time section into web-ready AR viewer assets.

Pure standard library (works on any Python >= 3.6, no pip installs).

Outputs into web/public/data/profiles/<name>/:
  amplitude.png  - 8-bit grayscale amplitude texture (columns = traces,
                   rows = depth samples, 128 = zero amplitude)
  meta.json      - georeferencing + geometry metadata
  preview.png    - human-checkable radargram with depth tick marks
and updates web/public/data/manifest.json.

Usage:
  python convert_sgy.py <file.sgy> [--epsilon 9] [--depth 2.0]
                        [--dt-units ps] [--epsg 25834] [--name NAME]
"""
import argparse
import json
import math
import os
import struct
import sys
import zlib

TEXT_HEADER_LEN = 3200
BIN_HEADER_LEN = 400
TRACE_HEADER_LEN = 240

SAMPLE_FORMATS = {
    1: ('ibm', 4), 2: ('i4', 4), 3: ('i2', 2), 5: ('f4', 4), 8: ('i1', 1),
}


# ---------------------------------------------------------------- SEG-Y I/O

def ibm_to_float(word):
    """Convert a 32-bit IBM float (as unsigned int) to a Python float."""
    if word == 0:
        return 0.0
    sign = -1.0 if word & 0x80000000 else 1.0
    exponent = (word >> 24) & 0x7f
    mantissa = word & 0x00ffffff
    return sign * mantissa * 16.0 ** (exponent - 64) / 16777216.0


def decode_samples(raw, fmt, count):
    kind, _ = SAMPLE_FORMATS[fmt]
    if kind == 'ibm':
        words = struct.unpack('>%dI' % count, raw)
        return [ibm_to_float(w) for w in words]
    if kind == 'f4':
        return list(struct.unpack('>%df' % count, raw))
    if kind == 'i4':
        return [float(v) for v in struct.unpack('>%di' % count, raw)]
    if kind == 'i2':
        return [float(v) for v in struct.unpack('>%dh' % count, raw)]
    return [float(v) for v in struct.unpack('>%db' % count, raw)]


def apply_scalar(value, scalar):
    """Apply a SEG-Y coordinate/elevation scalar field."""
    if scalar > 0:
        return value * scalar
    if scalar < 0:
        return value / float(-scalar)
    return float(value)


def read_segy(path, dt_units, clip_samples_fn):
    """Read traces; returns (traces, coords, dt_ns, n_clip, ns_total)."""
    filesize = os.path.getsize(path)
    with open(path, 'rb') as f:
        f.seek(TEXT_HEADER_LEN)
        binhdr = f.read(BIN_HEADER_LEN)
        dt_raw = struct.unpack('>H', binhdr[16:18])[0]
        ns = struct.unpack('>H', binhdr[20:22])[0]
        fmt = struct.unpack('>h', binhdr[24:26])[0]
        if fmt not in SAMPLE_FORMATS:
            sys.exit('Unsupported SEG-Y sample format code: %d' % fmt)
        _, bps = SAMPLE_FORMATS[fmt]

        dt_ns = {'ps': dt_raw * 1e-3, 'ns': float(dt_raw),
                 'us': dt_raw * 1e3}[dt_units]
        n_clip = clip_samples_fn(dt_ns, ns)

        trace_len = TRACE_HEADER_LEN + ns * bps
        n_traces = (filesize - TEXT_HEADER_LEN - BIN_HEADER_LEN) // trace_len

        traces = []   # list of lists of floats (clipped)
        coords = []   # list of (easting, northing)
        offset = TEXT_HEADER_LEN + BIN_HEADER_LEN
        for i in range(n_traces):
            f.seek(offset + i * trace_len)
            hdr = f.read(TRACE_HEADER_LEN)
            scalco = struct.unpack('>h', hdr[70:72])[0]
            sx = struct.unpack('>i', hdr[72:76])[0]
            sy = struct.unpack('>i', hdr[76:80])[0]
            ns_tr = struct.unpack('>H', hdr[114:116])[0] or ns
            n_read = min(n_clip, ns_tr)
            raw = f.read(n_read * bps)
            samples = decode_samples(raw, fmt, n_read)
            if len(samples) < n_clip:
                samples += [0.0] * (n_clip - len(samples))
            traces.append(samples)
            coords.append((apply_scalar(sx, scalco), apply_scalar(sy, scalco)))
    return traces, coords, dt_ns, n_clip, ns


# ------------------------------------------------- UTM inverse (GRS80/ETRS89)

def utm_to_latlon(easting, northing, zone, northern=True):
    """UTM (GRS80 ellipsoid, e.g. ETRS89 / EPSG:258xx) to lat/lon degrees.

    Classic USGS/Snyder series; accuracy well below 1 cm.
    """
    a = 6378137.0
    f = 1 / 298.257222101
    k0 = 0.9996
    e2 = f * (2 - f)
    ep2 = e2 / (1 - e2)
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))

    x = easting - 500000.0
    y = northing if northern else northing - 10000000.0

    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))

    phi1 = (mu
            + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
            + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))

    sin1, cos1, tan1 = math.sin(phi1), math.cos(phi1), math.tan(phi1)
    c1 = ep2 * cos1 ** 2
    t1 = tan1 ** 2
    n1 = a / math.sqrt(1 - e2 * sin1 ** 2)
    r1 = a * (1 - e2) / (1 - e2 * sin1 ** 2) ** 1.5
    d = x / (n1 * k0)

    lat = phi1 - (n1 * tan1 / r1) * (
        d ** 2 / 2
        - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
        + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2
           - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d
           - (1 + 2 * t1 + c1) * d ** 3 / 6
           + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2
              + 24 * t1 ** 2) * d ** 5 / 120) / cos1

    lon0 = math.radians(zone * 6 - 183)
    return math.degrees(lat), math.degrees(lon0 + lon)


def latlon_to_enu(lat, lon, lat0, lon0):
    """Small-area lat/lon to local east/north meters around (lat0, lon0)."""
    a = 6378137.0
    f = 1 / 298.257222101
    e2 = f * (2 - f)
    phi = math.radians(lat0)
    sin_phi = math.sin(phi)
    n = a / math.sqrt(1 - e2 * sin_phi ** 2)          # prime vertical radius
    m = a * (1 - e2) / (1 - e2 * sin_phi ** 2) ** 1.5  # meridional radius
    de = math.radians(lon - lon0) * n * math.cos(phi)
    dn = math.radians(lat - lat0) * m
    return de, dn


# ----------------------------------------------------------------- PNG output

def write_png_gray(path, width, height, rows):
    """Write an 8-bit grayscale PNG. rows = list of bytearrays (len=width)."""
    def chunk(tag, data):
        payload = tag + data
        return (struct.pack('>I', len(data)) + payload
                + struct.pack('>I', zlib.crc32(payload) & 0xffffffff))

    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n')
        fh.write(chunk(b'IHDR', ihdr))
        fh.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        fh.write(chunk(b'IEND', b''))


def percentile(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * p / 100.0
    lo = int(math.floor(k))
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def normalize_traces(traces, clip_percent):
    """Symmetric percentile normalization -> rows of bytes (128 = zero)."""
    abs_vals = sorted(abs(s) for tr in traces for s in tr)
    clip = percentile(abs_vals, clip_percent) or 1.0
    n_samples = len(traces[0])
    rows = []
    for j in range(n_samples):
        row = bytearray(len(traces))
        for i, tr in enumerate(traces):
            v = tr[j] / clip
            v = -1.0 if v < -1.0 else (1.0 if v > 1.0 else v)
            row[i] = int(round((v + 1.0) * 127.5))
        rows.append(row)
    return rows, clip


def make_preview(rows, width, depth_m, out_path):
    """Upscaled radargram with tick lines every 0.5 m for visual QC."""
    n_samples = len(rows)
    v_scale = max(1, int(round(480.0 / n_samples)))
    h_scale = max(1, int(round(1440.0 / width)))
    pw, ph = width * h_scale, n_samples * v_scale
    out_rows = []
    for j in range(n_samples):
        src = rows[j]
        row = bytearray(pw)
        for i in range(width):
            row[i * h_scale:(i + 1) * h_scale] = bytes([src[i]]) * h_scale
        for _ in range(v_scale):
            out_rows.append(bytearray(row))
    # tick lines every 0.5 m: dark full-width 1px line + white stub at left
    n_ticks = int(depth_m / 0.5)
    for t in range(n_ticks + 1):
        y = min(int(round(t * 0.5 / depth_m * (ph - 1))), ph - 1)
        for x in range(pw):
            out_rows[y][x] = max(0, out_rows[y][x] - 100)
        for x in range(40):
            out_rows[y][x] = 255
    write_png_gray(out_path, pw, ph, out_rows)


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('sgy', help='input SEG-Y file (time section)')
    ap.add_argument('--epsilon', type=float, default=9.0,
                    help='relative permittivity for time->depth (default 9)')
    ap.add_argument('--depth', type=float, default=2.0,
                    help='depth clip in meters (default 2.0)')
    ap.add_argument('--dt-units', choices=['ps', 'ns', 'us'], default='ps',
                    help='units of the SEG-Y sample interval field '
                         '(GPR files usually use picoseconds; default ps)')
    ap.add_argument('--epsg', type=int, default=25834,
                    help='EPSG code of trace coordinates; must be a UTM '
                         'zone on GRS80: 258xx (ETRS89) or 326xx (WGS84)')
    ap.add_argument('--clip-percent', type=float, default=98.0,
                    help='amplitude percentile for display clip (default 98)')
    ap.add_argument('--name', help='profile name (default: file stem)')
    ap.add_argument('--out-root', default=None,
                    help='output data dir (default: <repo>/web/public/data)')
    args = ap.parse_args()

    if args.epsg // 100 in (258, 326):
        zone, northern = args.epsg % 100, True
    elif args.epsg // 100 == 327:
        zone, northern = args.epsg % 100, False
    else:
        sys.exit('Unsupported EPSG %d: expected UTM 258xx/326xx/327xx'
                 % args.epsg)

    velocity = 0.3 / math.sqrt(args.epsilon)          # m/ns
    twt_max_ns = 2.0 * args.depth / velocity          # two-way time for clip

    def clip_fn(dt_ns, ns_total):
        return min(int(math.ceil(twt_max_ns / dt_ns)) + 1, ns_total)

    traces, coords, dt_ns, n_clip, ns_total = read_segy(
        args.sgy, args.dt_units, clip_fn)
    if not traces:
        sys.exit('No traces found in file.')

    # georeference: per-trace lat/lon, ENU offsets relative to first trace
    lls = [utm_to_latlon(e, n, zone, northern) for e, n in coords]
    lat0, lon0 = lls[0]
    points = [latlon_to_enu(lat, lon, lat0, lon0) for lat, lon in lls]
    length_m = sum(
        math.hypot(points[i + 1][0] - points[i][0],
                   points[i + 1][1] - points[i][1])
        for i in range(len(points) - 1))

    actual_depth = min(args.depth, (n_clip - 1) * dt_ns * velocity / 2.0)

    name = args.name or os.path.splitext(os.path.basename(args.sgy))[0]
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_root = args.out_root or os.path.join(repo_root, 'web', 'public', 'data')
    out_dir = os.path.join(out_root, 'profiles', name)
    os.makedirs(out_dir, exist_ok=True)

    rows, clip_amp = normalize_traces(traces, args.clip_percent)
    write_png_gray(os.path.join(out_dir, 'amplitude.png'),
                   len(traces), n_clip, rows)
    make_preview(rows, len(traces), actual_depth,
                 os.path.join(out_dir, 'preview.png'))

    meta = {
        'name': name,
        'source_file': os.path.basename(args.sgy),
        'anchor': {'lat': lat0, 'lon': lon0},
        'points_en': [[round(e, 3), round(n, 3)] for e, n in points],
        'depth_m': round(actual_depth, 3),
        'n_traces': len(traces),
        'n_samples': n_clip,
        'dt_ns': dt_ns,
        'epsilon': args.epsilon,
        'velocity_m_per_ns': velocity,
        'length_m': round(length_m, 2),
        'epsg_source': args.epsg,
    }
    with open(os.path.join(out_dir, 'meta.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)

    manifest_path = os.path.join(out_root, 'manifest.json')
    manifest = {'profiles': []}
    if os.path.exists(manifest_path):
        with open(manifest_path) as fh:
            manifest = json.load(fh)
    entry = {'name': name, 'dir': 'data/profiles/%s' % name,
             'anchor': meta['anchor'], 'length_m': meta['length_m']}
    manifest['profiles'] = ([p for p in manifest['profiles']
                             if p['name'] != name] + [entry])
    with open(manifest_path, 'w') as fh:
        json.dump(manifest, fh, indent=1)

    print('Profile        : %s' % name)
    print('Traces         : %d   samples/trace kept: %d of %d'
          % (len(traces), n_clip, ns_total))
    print('Sample interval: %.4g ns (%s in file)' % (dt_ns, args.dt_units))
    print('Velocity       : %.3f m/ns (epsilon=%.3g)'
          % (velocity, args.epsilon))
    print('Depth extent   : %.3f m (requested clip %.2f m)'
          % (actual_depth, args.depth))
    print('Profile length : %.2f m' % length_m)
    print('Anchor (WGS84) : lat %.7f, lon %.7f' % (lat0, lon0))
    print('First trace UTM: E %.2f, N %.2f' % coords[0])
    print('Last trace UTM : E %.2f, N %.2f' % coords[-1])
    print('Display clip   : +/- %.6g (p%.4g of |amplitude|)'
          % (clip_amp, args.clip_percent))
    print('Output         : %s' % out_dir)


if __name__ == '__main__':
    main()
