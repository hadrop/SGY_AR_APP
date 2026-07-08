import * as THREE from 'three';

// World frame: x = east, y = up, z = -north (local ENU around profile anchor).

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform int uPalette;
  uniform float uGain;
  uniform float uOpacity;
  uniform float uDepth;    // meters
  uniform float uLength;   // meters
  varying vec2 vUv;

  void main() {
    // recover signed amplitude (-1..1) from 8-bit texture (128 = zero)
    float a = texture2D(uMap, vUv).r * 2.0 - 1.0;
    a = clamp(a * uGain, -1.0, 1.0);

    vec3 color;
    if (uPalette == 1) {
      // diverging blue-white-red
      vec3 blue = vec3(0.10, 0.25, 0.85);
      vec3 red  = vec3(0.85, 0.12, 0.10);
      color = a >= 0.0 ? mix(vec3(1.0), red, a) : mix(vec3(1.0), blue, -a);
    } else {
      // classic grayscale, positive = dark
      color = vec3(0.5 - 0.5 * a);
    }

    float depth = vUv.y * uDepth;    // meters below ground
    float along = vUv.x * uLength;   // meters along profile

    // depth ruler ticks every 0.5 m near both ends of the profile
    float nearEnd = step(along, 0.45) + step(uLength - 0.45, along);
    float tickDist = abs(depth - 0.5 * floor(depth / 0.5 + 0.5));
    if (nearEnd > 0.0 && tickDist < 0.012 && depth > 0.05) {
      color = mix(color, vec3(1.0, 0.75, 0.2), 0.85);
    }

    // bright ground-intersection line along the top edge
    float groundLine = 1.0 - smoothstep(0.0, 0.035, depth);
    color = mix(color, vec3(1.0, 0.85, 0.30), groundLine * 0.9);

    // soft fade at the bottom so the curtain ends gracefully
    float alpha = uOpacity * (1.0 - smoothstep(uDepth - 0.12, uDepth, depth));
    alpha = max(alpha, groundLine * uOpacity);

    gl_FragColor = vec4(color, alpha);
  }
`;

export function createCurtain(meta, texture) {
  const pts = meta.points_en; // [[east, north], ...] relative to anchor
  const n = pts.length;
  const depth = meta.depth_m;

  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  // cumulative along-profile distance for even texture spacing
  const dist = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    dist[i] = dist[i - 1] + Math.hypot(dx, dz);
  }
  const total = dist[n - 1] || 1;

  for (let i = 0; i < n; i++) {
    const x = pts[i][0];
    const z = -pts[i][1];
    const u = dist[i] / total;
    // top vertex
    positions.set([x, 0, z], i * 6);
    uvs.set([u, 0], i * 4);
    // bottom vertex
    positions.set([x, -depth, z], i * 6 + 3);
    uvs.set([u, 1], i * 4 + 2);
  }

  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uMap: { value: texture },
      uPalette: { value: 0 },
      uGain: { value: 1.0 },
      uOpacity: { value: 0.95 },
      uDepth: { value: depth },
      uLength: { value: total },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}
