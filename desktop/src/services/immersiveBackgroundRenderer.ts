import { IMMERSIVE_BACKGROUND_VERTEX_SHADER as VERTEX_SHADER } from '@lx/core';
import { IMMERSIVE_FOG_FRAGMENT_SHADER as FRAGMENT_SHADER } from './immersiveFogShader';

export interface ImmersiveBackgroundState {
  playing: boolean;
}
export interface ImmersiveBackgroundOptions extends ImmersiveBackgroundState {
  /** 非空值报告错误；图形上下文成功恢复后以空值清除错误。 */
  onError?: (message: string) => void;
}
export interface ImmersiveBackgroundRenderer {
  update(state: ImmersiveBackgroundState): void;
  dispose(): void;
}

type Color = [number, number, number];
/** 封面色相派生的深底与亮雾，灰阶封面仍保持灰阶。 */
interface Palette {
  deep: Color;
  fog: Color;
}
const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_PIXELS = 1280 * 720;
const RENDER_SCALE = 0.5;
const MAX_DIMENSION = 1600;
const COLOR_BLEND_SECONDS = 0.7;
const DRIFT_RESPONSE = 2.5;
const DRIFT_STOP_THRESHOLD = 0.005;

function parseColor(value: string): Color | null {
  const channels = value.trim().split(/[\s,]+/);
  if (channels.length !== 3 || channels.some((channel) => !/^\d+(?:\.\d+)?$/.test(channel))) return null;
  const rgb = channels.map(Number);
  if (rgb.some((channel) => channel < 0 || channel > 255)) return null;
  return rgb.map((channel) => channel / 255) as Color;
}

function readPalette(parent: HTMLElement): Palette {
  const computed = getComputedStyle(parent);
  // 与沉浸页 CSS 的声明一致：没有有效封面色时使用当前主题强调色。
  const color = parseColor(computed.getPropertyValue('--af-immersive-artwork-rgb'))
    ?? parseColor(computed.getPropertyValue('--af-accent-primary-rgb'));
  if (!color) throw new Error('无法读取沉浸背景颜色：封面色和主题强调色均无效');
  return fogPalette(color);
}

// MyGo Music backdrop.go 的 fogColors/hsvColor 配色，来源与许可证见 third-party/mygo-music。
function fogPalette([r, g, b]: Color): Palette {
  const peak = Math.max(r, g, b);
  const delta = peak - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) {
    if (peak === r) hue = ((g - b) / delta + 6) % 6;
    else if (peak === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  let saturation = peak > 0 ? delta / peak : 0;
  if (saturation > 0.12) saturation = Math.min(Math.max(saturation * 1.3, 0.6), 0.85);
  const hsv = (s: number, v: number): Color => {
    const c = v * s;
    const x = c * (1 - Math.abs(hue % 2 - 1));
    const m = v - c;
    const sectors = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
    return sectors[Math.floor(hue)].map(channel => Math.round((channel + m) * 255) / 255) as Color;
  };
  return { deep: hsv(saturation, 0.3), fog: hsv(saturation * 0.6, 0.72) };
}

function samePalette(a: Palette, b: Palette): boolean {
  return a.deep.every((channel, i) => channel === b.deep[i])
    && a.fog.every((channel, i) => channel === b.fog[i]);
}

function blendPalette(from: Palette, to: Palette, amount: number): Palette {
  const mix = (a: Color, b: Color) => a.map((channel, i) => channel + (b[i] - channel) * amount) as Color;
  return { deep: mix(from.deep, to.deep), fog: mix(from.fog, to.fog) };
}

interface Graphics {
  draw(time: number, palette: Palette): void;
  dispose(): void;
}

function createGraphics(gl: WebGLRenderingContext, canvas: HTMLCanvasElement): Graphics {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  const dispose = () => {
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    buffer = null; program = null; shaders.length = 0;
  };
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('无法创建 WebGL 着色器');
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`背景着色器编译失败：${gl.getShaderInfoLog(shader) || '驱动未提供诊断'}`);
    }
    return shader;
  };
  try {
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    program = gl.createProgram();
    if (!program) throw new Error('无法创建 WebGL 背景程序');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`背景着色器链接失败：${gl.getProgramInfoLog(program) || '驱动未提供诊断'}`);
    }
    buffer = gl.createBuffer();
    if (!buffer) throw new Error('无法创建 WebGL 背景缓冲区');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    if (position < 0) throw new Error('背景着色器缺少顶点输入');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => {
      const location = gl.getUniformLocation(program!, name);
      if (location === null) throw new Error(`背景着色器缺少参数：${name}`);
      return location;
    };
    const timeUniform = uniform('uTime');
    const resolutionUniform = uniform('uResolution');
    const deepUniform = uniform('uDeep');
    const fogUniform = uniform('uFog');
    return {
      draw(time, palette) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.uniform1f(timeUniform, time);
        gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
        gl.uniform3fv(deepUniform, palette.deep);
        gl.uniform3fv(fogUniform, palette.fog);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function createImmersiveBackgroundRenderer(
  canvas: HTMLCanvasElement,
  options: ImmersiveBackgroundOptions,
): ImmersiveBackgroundRenderer {
  const parent = canvas.parentElement;
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = options.playing;
  let graphics: Graphics | null = null;
  let palette: Palette | null = null;
  let target: Palette | null = null;
  let disposed = false;
  let failed = false;
  let contextLost = false;
  let hasSize = false;
  let frame: number | null = null;
  let lastDraw = performance.now();
  let time = 0;
  let speed = 0;

  const report = (message: string) => {
    if (options.onError) options.onError(message);
    else if (message) console.error(`[ImmersiveBackground] ${message}`);
  };
  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const fail = (error: unknown) => {
    failed = true;
    stop();
    graphics?.dispose(); graphics = null;
    report(error instanceof Error ? error.message : String(error));
  };
  const canDraw = () => !disposed && !failed && !contextLost && hasSize && !document.hidden;
  const animating = () => canDraw() && !preference.matches && (playing || speed > 0);
  const draw = () => {
    if (!canDraw() || !graphics || !palette) return;
    try {
      graphics.draw(time, palette);
    } catch (error) {
      fail(error);
    }
  };
  const tick = (now: number) => {
    frame = null;
    if (!animating()) return;
    if (now - lastDraw >= FRAME_INTERVAL_MS) {
      const elapsed = Math.min((now - lastDraw) / 1000, 0.1);
      lastDraw = now;
      // 沿用上游的渐入/渐停：暂停后短暂漂移，停稳后释放 RAF。
      const desiredSpeed = playing ? 1 : 0;
      speed += (desiredSpeed - speed) * Math.min(1, DRIFT_RESPONSE * elapsed);
      if (Math.abs(desiredSpeed - speed) < DRIFT_STOP_THRESHOLD) speed = desiredSpeed;
      time += speed * elapsed;
      if (palette && target) {
        // 最后一帧完成配色，避免渐停末尾到达的封面色永久卡在插值中。
        palette = speed === 0 ? target
          : blendPalette(palette, target, 1 - Math.exp(-elapsed / COLOR_BLEND_SECONDS));
      }
      draw();
    }
    if (animating()) frame = requestAnimationFrame(tick);
  };
  const syncAnimation = () => {
    if (!canDraw() || preference.matches) speed = 0;
    if (!animating()) { stop(); return; }
    if (frame !== null) return;
    lastDraw = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    if (disposed || !parent) return;
    const { width, height } = parent.getBoundingClientRect();
    hasSize = width > 0 && height > 0;
    if (!hasSize) { stop(); return; }
    const scale = Math.min(RENDER_SCALE,
      Math.sqrt(MAX_PIXELS / (width * height)), MAX_DIMENSION / Math.max(width, height));
    const nextWidth = Math.max(1, Math.floor(width * scale));
    const nextHeight = Math.max(1, Math.floor(height * scale));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth; canvas.height = nextHeight;
    }
    draw();
    syncAnimation();
  };
  const updateColor = () => {
    if (disposed || failed || !parent) return;
    try {
      const next = readPalette(parent);
      if (target && samePalette(target, next)) return;
      target = next;
      if (!animating()) { palette = next; draw(); }
    } catch (error) {
      fail(error);
    }
  };
  const refresh = () => {
    if (disposed) return;
    if (!animating() && target) palette = target;
    draw();
    syncAnimation();
  };
  const initialize = () => {
    try {
      if (!parent) throw new Error('沉浸背景画布缺少父容器');
      palette = target = readPalette(parent);
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('当前环境无法创建 WebGL 沉浸背景');
      graphics = createGraphics(gl, canvas);
      failed = false;
      resize();
    } catch (error) {
      fail(error);
    }
  };
  const lost = (event: Event) => {
    event.preventDefault();
    if (disposed) return;
    contextLost = true;
    stop();
    graphics?.dispose(); graphics = null;
    report('背景图形上下文已丢失，可选择原背景或等待图形恢复');
  };
  const restored = () => {
    if (disposed || !contextLost) return;
    contextLost = false;
    initialize();
    if (!failed) report('');
  };

  const resizeObserver = new ResizeObserver(resize);
  const colorObserver = new MutationObserver(updateColor);
  if (parent) resizeObserver.observe(parent);
  // 封面色（--af-artwork-rgb）与强调色都写在根节点上，只观察根节点。
  // 沉浸页自己的 inline style 每帧都在改播放进度，而它上面的 --af-immersive-artwork-rgb
  // 是一段固定的 var() 引用，观察它既每帧空转，也看不出封面色变没变。
  colorObserver.observe(document.documentElement, { attributes: true });
  document.addEventListener('visibilitychange', refresh);
  preference.addEventListener('change', refresh);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  initialize();

  return {
    update(next) {
      if (disposed) return;
      playing = next.playing;
      if (!animating() && target) palette = target;
      syncAnimation();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      resizeObserver.disconnect();
      colorObserver.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      preference.removeEventListener('change', refresh);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      graphics?.dispose(); graphics = null;
    },
  };
}
