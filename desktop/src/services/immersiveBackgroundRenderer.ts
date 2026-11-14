import {
  IMMERSIVE_BACKGROUND_VERTEX_SHADER as VERTEX_SHADER,
  IMMERSIVE_BACKGROUND_FRAGMENT_SHADER as FRAGMENT_SHADER,
  type DynamicImmersiveBackgroundMode,
} from '@lx/core';

export type ImmersiveBackgroundMode = DynamicImmersiveBackgroundMode;
export interface ImmersiveBackgroundState {
  mode: ImmersiveBackgroundMode;
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
/** 着色器的两个颜色输入：背景主色，以及封面接近灰阶时借用色相的主题强调色。 */
interface Palette {
  color: Color;
  accent: Color;
}
const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_PIXELS = 1280 * 720;
const MAX_DPR = 1.5;
const MAX_DIMENSION = 1600;
const COLOR_BLEND_SECONDS = 0.7;
const INITIAL_TIME = 12;


function parseColor(value: string): Color | null {
  const channels = value.trim().split(/[\s,]+/);
  if (channels.length !== 3 || channels.some((channel) => !/^\d+(?:\.\d+)?$/.test(channel))) return null;
  const rgb = channels.map(Number);
  if (rgb.some((channel) => channel < 0 || channel > 255)) return null;
  return rgb.map((channel) => channel / 255) as Color;
}

function readPalette(parent: HTMLElement): Palette {
  const computed = getComputedStyle(parent);
  const accent = parseColor(computed.getPropertyValue('--af-accent-primary-rgb'));
  if (!accent) throw new Error('无法读取沉浸背景颜色：主题强调色无效');
  // 与沉浸页 CSS 的声明一致：没有有效封面色时使用当前主题强调色。
  return { color: parseColor(computed.getPropertyValue('--af-immersive-artwork-rgb')) ?? accent, accent };
}

function samePalette(a: Palette, b: Palette): boolean {
  return a.color.every((channel, i) => channel === b.color[i])
    && a.accent.every((channel, i) => channel === b.accent[i]);
}

function blendPalette(from: Palette, to: Palette, amount: number): Palette {
  const mix = (a: Color, b: Color) => a.map((channel, i) => channel + (b[i] - channel) * amount) as Color;
  return { color: mix(from.color, to.color), accent: mix(from.accent, to.accent) };
}

interface Graphics {
  draw(time: number, mode: ImmersiveBackgroundMode, palette: Palette): void;
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
    const aspectUniform = uniform('uAspect');
    const modeUniform = uniform('uMode');
    const colorUniform = uniform('uColor');
    const accentUniform = uniform('uAccent');
    return {
      draw(time, mode, palette) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.uniform1f(timeUniform, time);
        gl.uniform1f(aspectUniform, canvas.width / canvas.height);
        gl.uniform1i(modeUniform, mode === 'liquid' ? 0 : 1);
        gl.uniform3fv(colorUniform, palette.color);
        gl.uniform3fv(accentUniform, palette.accent);
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
  let state: ImmersiveBackgroundState = { mode: options.mode, playing: options.playing };
  let graphics: Graphics | null = null;
  let palette: Palette | null = null;
  let target: Palette | null = null;
  let disposed = false;
  let failed = false;
  let contextLost = false;
  let hasSize = false;
  let frame: number | null = null;
  let lastDraw = performance.now();
  let time = INITIAL_TIME;

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
  const animating = () => canDraw() && state.playing && !preference.matches;
  const draw = () => {
    if (!canDraw() || !graphics || !palette) return;
    try {
      graphics.draw(time, state.mode, palette);
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
      time += elapsed;
      if (palette && target) {
        palette = blendPalette(palette, target, 1 - Math.exp(-elapsed / COLOR_BLEND_SECONDS));
      }
      draw();
    }
    if (animating()) frame = requestAnimationFrame(tick);
  };
  const syncAnimation = () => {
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
    const scale = Math.min(devicePixelRatio || 1, MAX_DPR,
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
      const modeChanged = next.mode !== state.mode;
      state = { mode: next.mode, playing: next.playing };
      if (!animating() && target) palette = target;
      if (modeChanged) draw();
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
