export type DynamicImmersiveBackgroundMode = 'liquid' | 'aurora';

export const IMMERSIVE_BACKGROUND_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// 桌面端的两种动态背景（uMode 0 = 液态渐变，1 = 极光光幕）。
//
// 两者都只用低频正弦叠加出形状，不采样哈希噪声：值噪声的格点在内部分辨率被压低、
// 再放大到整窗后会露出方块和竖条。颜色在线性空间里混合，最后统一压暗并加抖动，
// 给歌词留出对比度，也避免暗部渐变出现色带。
export const IMMERSIVE_BACKGROUND_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform int uMode;
uniform vec3 uColor;
uniform vec3 uAccent;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

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
  return max(c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca), vec3(0.0));
}
// 只留色相：封面主色不论明暗都落到同一档，再把蓝紫这类天生偏暗的色相提一点。
vec3 tint(vec3 c) {
  vec3 h = c / max(max(max(c.r, c.g), c.b), 1e-3);
  return h * mix(1.0, 0.5 / max(dot(h, LUMA), 0.12), 0.45);
}
// 背景主色跟随封面；封面接近灰阶时没有色相可用，借主题强调色的色相并降低饱和度。
vec3 keyColor() {
  vec3 art = srgb2lin(uColor);
  float peak = max(max(art.r, art.g), art.b);
  float low = min(min(art.r, art.g), art.b);
  float colorful = smoothstep(0.1, 0.4, (peak - low) / max(peak, 1e-3));
  vec3 borrowed = tint(srgb2lin(uAccent));
  borrowed = mix(vec3(dot(borrowed, LUMA)), borrowed, 0.55);
  return mix(borrowed, tint(art), colorful);
}

// 液态渐变：逐级扭曲坐标，让三块相邻色相像颜料一样互相推挤。
vec3 liquid(vec2 p, float t, vec3 key) {
  vec2 q = p * 1.7;
  for (int i = 1; i < 5; i++) {
    float f = float(i);
    q += vec2(sin(q.y * (0.8 + 0.50 * f) + t * (0.10 + 0.017 * f) + f * 1.7),
              cos(q.x * (0.7 + 0.55 * f) - t * (0.085 + 0.021 * f) + f * 2.3)) * (0.5 / f);
  }
  float a = 0.5 + 0.5 * sin(q.x * 1.6 + q.y * 0.7);
  float b = 0.5 + 0.5 * sin(q.y * 1.8 - q.x * 0.6 + 1.9);
  float c = 0.5 + 0.5 * sin(q.x - q.y + 3.7);
  vec3 col = mix(key * 0.012, key * 0.15, smoothstep(0.05, 0.95, a));
  col = mix(col, hueShift(key, 0.45) * 0.14, b * b * 0.65);
  col = mix(col, hueShift(key, -0.55) * 0.11, c * c * 0.55);
  // 两股色流交汇处的一线高光
  return col + key * pow(a * b, 3.0) * 0.07;
}

// 极光光幕：三层光幕各有一条起伏的下缘，下缘最亮，光向上拖出长尾并被竖向射线切开。
vec3 aurora(vec2 p, float t, vec3 key) {
  vec3 col = key * (0.008 + 0.022 * smoothstep(0.1, -0.55, p.y));
  for (int i = 0; i < 3; i++) {
    float f = float(i);
    float x = p.x * (1.0 - f * 0.12) + f * 0.41;
    float base = -0.16 + f * 0.11
      + 0.13 * sin(x * 1.3 + t * 0.09 + f * 2.1)
      + 0.05 * sin(x * 3.1 - t * 0.13 + f * 1.3);
    float d = p.y - base;
    float rise = exp(-max(d, 0.0) * (4.2 - f * 0.7));
    float foot = smoothstep(-0.09, 0.02, d);
    float xr = x + 0.04 * sin(p.y * 3.1 + t * 0.2 + f);
    float ray = 0.5 + 0.5 * sin(xr * 13.0 + t * 0.21 + f * 4.0) * sin(xr * 5.3 - t * 0.16 + f);
    float rays = mix(1.0, 0.3 + 0.9 * ray * ray, smoothstep(0.0, 0.3, d));
    vec3 hue = hueShift(key, -0.35 + f * 0.35 + d * 0.6);
    col += hue * rise * foot * rays * (0.095 - f * 0.018);
  }
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  vec3 key = keyColor();
  vec3 col;
  if (uMode == 0) col = liquid(p, uTime, key);
  else col = aurora(p, uTime, key);
  vec2 edge = vUv - 0.5;
  col *= 1.0 - dot(edge, edge) * 0.7;
  vec3 outc = lin2srgb(vec3(1.0) - exp(-col * 1.6));
  // 抖动：抑制 8bit 渐变在暗部的色带。固定图样，暂停时的静帧不会闪。
  outc += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(outc, 1.0);
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
