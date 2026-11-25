// GLSL for the admin operations scene («مِحطة التشغيل»).
//
// All colours arrive as uniforms from token-derived JS constants — nothing is
// hardcoded in shader source. Motion speeds are deliberately tiny (ambient
// layer: 14–22s cycles), and the scene never mounts under
// prefers-reduced-motion (the CSS frame stays instead).

/** Fullscreen graphite field: value-noise fbm drift + a low jade horizon. */
export const backdropVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const backdropFragment = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec3 uDeep;
  uniform vec3 uDeep2;
  uniform vec3 uGlow;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vec2(vUv.x * uAspect, vUv.y);
    // Two slow drifts: the graphite field breathes over ~18s.
    float w = fbm(uv * 1.6 + vec2(uTime * 0.010, -uTime * 0.007));
    float w2 = fbm(uv * 3.3 - vec2(uTime * 0.016, uTime * 0.011));

    // The signal band: a low, wide jade horizon that reads as "live data",
    // breathing gently. It sits low so the headline text above stays clean.
    float band = smoothstep(0.42, 0.0, abs(vUv.y - 0.34));
    float pulse = 0.72 + 0.28 * sin(uTime * 0.32);

    vec3 col = mix(uDeep, uDeep2, w * 0.92);
    col += uGlow * band * (0.11 + 0.07 * w2) * pulse;

    // A single cool vertical shaft on the far side — depth without noise.
    float shaft = smoothstep(0.30, 0.0, distance(uv, vec2(uAspect * 0.88, 0.62)));
    col += uGlow * shaft * 0.045;

    // Floor line: the room gets darker below the band.
    col *= mix(0.74, 1.05, smoothstep(0.0, 0.6, vUv.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Motes: slow rise, round soft sprites, jade tint near the signal band. */
export const dustVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aScale;
  uniform float uTime;
  varying float vGlow;
  void main() {
    vec3 p = position;
    float t = uTime * 0.05 + aSeed * 6.2831;
    p.y = mod(p.y + uTime * 0.05 * (0.4 + aSeed * 0.6), 6.5) - 0.5;
    p.x += sin(t) * 0.32;
    p.z += cos(t * 0.8) * 0.32;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aScale * (24.0 / -mv.z);
    // Motes close to the signal band pick up its jade.
    vGlow = smoothstep(2.4, 0.4, abs(p.y - 1.6));
  }
`;

export const dustFragment = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uWarm;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = smoothstep(0.5, 0.14, d);
    vec3 col = mix(uColor, uWarm, vGlow * 0.55);
    gl_FragColor = vec4(col, alpha * 0.34);
  }
`;
