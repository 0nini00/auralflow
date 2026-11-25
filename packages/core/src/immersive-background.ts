export const IMMERSIVE_BACKGROUND_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// 移动端专用：低频色团 + 抖动。不依赖高频噪声，低分辨率放大后依然平滑。
export const IMMERSIVE_BLOOM_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform vec3 uColor;
uniform vec3 uAccent;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec3 srgb2lin(vec3 c) { return c * c; }
vec3 lin2srgb(vec3 c) { return sqrt(max(c, vec3(0.0))); }
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735026919);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
// 保留色相、归一化亮度：灰白封面也能得到有颜色的背景。
vec3 chroma(vec3 c, float aim) {
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 h = c / l;
  float m = max(max(h.r, h.g), h.b);
  return (h / max(m, 1e-3)) * aim;
}
vec3 saturate3(vec3 c, float k) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, k), vec3(0.0));
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float t = uTime * 0.45;
  vec3 art = srgb2lin(uColor);
  vec3 acc = srgb2lin(uAccent);
  vec3 c1 = saturate3(mix(chroma(art, 1.0), chroma(acc, 1.0), 0.42), 1.45);

  vec3 col = vec3(0.0035);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = 0.54 * vec2(sin(t * (0.16 + fi * 0.043) + fi * 1.7),
                         cos(t * (0.13 + fi * 0.037) + fi * 2.3));
    float r = 0.35 + 0.07 * sin(t * 0.22 + fi * 1.1);
    float w = exp(-dot(p - c, p - c) / (r * r));
    col += saturate3(hueShift(c1, -0.55 + fi * 0.36), 1.35) * w * 0.135;
  }
  col += c1 * 0.022 * smoothstep(0.5, -0.5, p.y);

  col *= 1.0 - exp(-dot(p * vec2(1.0, 1.35), p * vec2(1.0, 1.35)) * 2.4) * 0.28;

  vec3 outc = lin2srgb(vec3(1.0) - exp(-col * 1.20));
  // 抖动：抑制 8bit 渐变在暗部的色带。
  outc += (hash21(gl_FragCoord.xy + fract(uTime)) - 0.5) / 200.0;
  gl_FragColor = vec4(outc, 1.0);
}`;
