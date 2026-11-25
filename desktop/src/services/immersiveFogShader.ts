// SPDX-License-Identifier: AGPL-3.0-only
// 改编自 egoist/mygo-music，提交 a717245f18e773f27ffe9ee08b330dd101218515。
// 原文件：https://github.com/egoist/mygo-music/blob/a717245f18e773f27ffe9ee08b330dd101218515/internal/app/backdrop.go
// 将 fogSource 从 MyGo shader 转为 WebGL GLSL；当前播放引擎没有频谱输入，采用 Bass = 0。
// 来源、修改说明与许可证见 desktop/third-party/mygo-music/。
export const IMMERSIVE_FOG_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uDeep;
uniform vec3 uFog;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return v;
}

void main() {
  // MyGo 的坐标从顶部向下，WebGL UV 从底部向上。
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 pos = uv * uResolution;
  vec2 p = pos / uResolution.y * 2.4;
  float t = uTime;
  vec2 rise = vec2(0.0, t * 0.1);
  vec2 q = vec2(
    fbm(p + rise + vec2(0.0, t * 0.04)),
    fbm(p + rise + vec2(5.2, 1.3) - vec2(t * 0.05, 0.0))
  );
  float f = fbm(p + rise + 0.9 * q);
  float bank = fbm(p * 0.45 + rise * 0.6 + vec2(3.7, 0.0));
  float cloud = smoothstep(0.3, 0.78, f)
    * (0.45 + 0.75 * smoothstep(0.3, 0.65, bank));
  float m = smoothstep(-0.1, 0.4, uv.y)
    * (1.0 - 0.5 * smoothstep(0.65, 1.0, uv.y));
  vec3 c = mix(uDeep, uFog, min(cloud * m * 0.85, 1.0));
  float g = length((uv - vec2(0.5, 0.42)) * vec2(1.0, 1.25));
  c *= 1.08 - 0.45 * smoothstep(0.2, 0.85, g);

  float cell = uResolution.y / 22.0;
  vec2 sp = (pos + vec2(0.0, t * cell * 0.9)) / cell;
  vec2 id = floor(sp);
  float h = hash(id + vec2(3.1, 7.7));
  if (h > 0.93) {
    vec2 at = vec2(hash(id + vec2(1.3, 2.9)), hash(id + vec2(8.1, 4.3))) * 0.8 + 0.1;
    float d = length((fract(sp) - at) * cell) / max(cell * 0.05, 0.7);
    float glint = 0.5 + 0.5 * sin(t * (1.5 + 2.0 * h) + h * 40.0);
    c += vec3(0.75, 0.82, 1.0) * exp(-d * d) * glint * (0.25 + 0.3 * m);
  }
  gl_FragColor = vec4(c, 1.0);
}`;
