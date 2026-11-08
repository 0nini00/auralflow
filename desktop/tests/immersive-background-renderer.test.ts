// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rendererModule from '../src/services/immersiveBackgroundRenderer';

type Renderer = ReturnType<typeof rendererModule.createImmersiveBackgroundRenderer>;
type Mode = 'liquid' | 'aurora';
const controllers: Renderer[] = [];

function setup(options: { playing?: boolean; mode?: Mode; context?: boolean; compile?: boolean; link?: boolean; reduced?: boolean } = {}) {
  let now = 0;
  let hidden = false;
  let width = 1200;
  let height = 800;
  let artwork = '48, 128, 192';
  let accent = '100, 150, 200';
  let reduced = options.reduced ?? false;
  const callbacks = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId; });
  const cancelFrame = vi.fn((id: number) => callbacks.delete(id));
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('devicePixelRatio', 3);

  const preference = new EventTarget() as MediaQueryList;
  Object.defineProperty(preference, 'matches', { get: () => reduced });
  const removePreference = vi.spyOn(preference, 'removeEventListener');
  vi.stubGlobal('matchMedia', vi.fn(() => preference));

  const resizeCallbacks: ResizeObserverCallback[] = [];
  const mutationCallbacks: MutationCallback[] = [];
  const resizeDisconnect = vi.fn();
  const mutationDisconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
    observe = vi.fn();
    disconnect = resizeDisconnect;
  });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) { mutationCallbacks.push(callback); }
    observe = vi.fn();
    disconnect = mutationDisconnect;
  });
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({
    getPropertyValue: (name: string) => name === '--af-immersive-artwork-rgb' ? artwork
      : name === '--af-accent-primary-rgb' ? accent : '',
  })));

  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.append(canvas);
  document.body.append(host);
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({
    width, height, x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, toJSON: () => ({}),
  }));
  const uniforms = new Map<string, number | number[]>();
  const frames: { time: number; mode: number; color: number[] }[] = [];
  let resource = 0;
  const gl = {
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126, TRIANGLES: 4,
    createShader: vi.fn(() => ({ id: ++resource })), shaderSource: vi.fn(), compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => options.compile !== false), getShaderInfoLog: vi.fn(() => 'shader failure'),
    deleteShader: vi.fn(), createProgram: vi.fn(() => ({ id: ++resource })), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => options.link !== false), getProgramInfoLog: vi.fn(() => 'link failure'),
    deleteProgram: vi.fn(), useProgram: vi.fn(), createBuffer: vi.fn(() => ({ id: ++resource })),
    bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name })),
    uniform1f: vi.fn((location: { name: string }, value: number) => uniforms.set(location.name, value)),
    uniform1i: vi.fn((location: { name: string }, value: number) => uniforms.set(location.name, value)),
    uniform3fv: vi.fn((location: { name: string }, value: number[]) => uniforms.set(location.name, [...value])),
    viewport: vi.fn(),
    drawArrays: vi.fn(() => frames.push({
      time: uniforms.get('uTime') as number,
      mode: uniforms.get('uMode') as number,
      color: uniforms.get('uColor') as number[],
    })),
  };
  vi.spyOn(canvas, 'getContext').mockImplementation(() => options.context === false ? null : gl as unknown as WebGLRenderingContext);
  const onError = vi.fn();
  const start = () => {
    const controller = rendererModule.createImmersiveBackgroundRenderer(canvas, {
      mode: options.mode ?? 'liquid', playing: options.playing ?? false, onError,
    });
    controllers.push(controller);
    return controller;
  };
  return {
    canvas, host, gl, frames, uniforms, onError, start, callbacks, requestFrame, cancelFrame,
    resizeDisconnect, mutationDisconnect, removePreference,
    frame(time: number) {
      now = time;
      const scheduled = [...callbacks.values()];
      callbacks.clear();
      for (const callback of scheduled) callback(time);
    },
    resize(w: number, h: number) {
      width = w; height = h;
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    },
    color(next: string, nextAccent = accent) {
      artwork = next; accent = nextAccent;
      for (const callback of mutationCallbacks) callback([], {} as MutationObserver);
    },
    visibility(value: boolean) {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    motion(value: boolean) {
      reduced = value;
      preference.dispatchEvent(new Event('change'));
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('沉浸背景渲染生命周期', () => {
  it('暂停时绘制静帧，使用现有封面色且无需 RAF', () => {
    const h = setup(); h.start();
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].mode).toBe(0);
    expect(h.frames[0].color).toEqual([48 / 255, 128 / 255, 192 / 255]);
    expect(h.callbacks.size).toBe(0);
    expect(h.canvas.getContext).toHaveBeenCalledWith('webgl', expect.objectContaining({ alpha: false, antialias: false, preserveDrawingBuffer: true }));
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('播放时最多每秒绘制30帧，暂停后取消帧并冻结时间', () => {
    const h = setup({ playing: true }); const renderer = h.start();
    for (let time = 0; time <= 1000; time += 10) h.frame(time);
    expect(h.frames.length).toBeGreaterThan(20);
    expect(h.frames.length).toBeLessThanOrEqual(31);
    const lastTime = h.frames.at(-1)!.time;
    renderer.update({ mode: 'liquid', playing: false });
    expect(h.callbacks.size).toBe(0);
    const count = h.frames.length;
    h.frame(10000);
    expect(h.frames).toHaveLength(count);
    renderer.update({ mode: 'liquid', playing: true });
    h.frame(10050);
    expect(h.frames.at(-1)!.time - lastTime).toBeLessThan(0.2);
  });

  it('窗口隐藏和减少动态效果均停止帧，恢复后才继续', () => {
    const h = setup({ playing: true }); h.start();
    expect(h.callbacks.size).toBe(1);
    h.visibility(true);
    expect(h.callbacks.size).toBe(0);
    const count = h.frames.length;
    h.frame(5000);
    expect(h.frames).toHaveLength(count);
    h.visibility(false);
    expect(h.callbacks.size).toBe(1);
    h.motion(true);
    expect(h.callbacks.size).toBe(0);
    h.motion(false);
    expect(h.callbacks.size).toBe(1);
  });

  it('启用减少动态效果时只显示静帧，模式、尺寸和颜色改变仍重绘一次', () => {
    const h = setup({ playing: true, reduced: true }); const renderer = h.start();
    renderer.update({ mode: 'aurora', playing: true });
    expect(h.frames).toHaveLength(2);
    expect(h.frames.at(-1)!.mode).toBe(1);
    h.resize(640, 400);
    expect(h.frames).toHaveLength(3);
    h.color('200, 60, 30');
    expect(h.frames).toHaveLength(4);
    expect(h.frames.at(-1)!.color).toEqual([200 / 255, 60 / 255, 30 / 255]);
    expect(h.callbacks.size).toBe(0);
  });

  it('暂停后切模式、调整尺寸和主题会保留动画时间并更新静帧', () => {
    const h = setup(); const renderer = h.start();
    const time = h.frames[0].time;
    renderer.update({ mode: 'aurora', playing: false });
    h.resize(500, 300);
    h.color('', '70, 80, 90');
    expect(h.frames).toHaveLength(4);
    expect(h.frames.at(-1)).toEqual({ time, mode: 1, color: [70 / 255, 80 / 255, 90 / 255] });
    expect(h.callbacks.size).toBe(0);
  });

  it('播放中的封面色变更渐进过渡，无关根属性变化不重复绘制', () => {
    const h = setup({ playing: true }); h.start();
    const count = h.frames.length;
    h.color('48, 128, 192');
    expect(h.frames).toHaveLength(count);
    h.color('240, 128, 192');
    h.frame(40);
    const red = h.frames.at(-1)!.color[0];
    expect(red).toBeGreaterThan(48 / 255);
    expect(red).toBeLessThan(240 / 255);
  });

  it('大窗口高DPR限制像素预算，零尺寸不绘制和空转', () => {
    const h = setup({ playing: true }); h.start();
    h.resize(7680, 4320);
    expect(h.canvas.width * h.canvas.height).toBeLessThanOrEqual(1280 * 720);
    expect(h.canvas.width / h.canvas.height).toBeCloseTo(7680 / 4320, 2);
    h.resize(0, 0);
    expect(h.callbacks.size).toBe(0);
    const count = h.frames.length;
    h.frame(1000);
    expect(h.frames).toHaveLength(count);
    h.resize(640, 480);
    expect(h.frames.length).toBe(count + 1);
    expect(h.callbacks.size).toBe(1);
  });

  it('上下文不可用明确报告且没有伪造绘制', () => {
    const h = setup({ context: false, playing: true }); h.start();
    expect(h.onError).toHaveBeenCalledWith(expect.stringMatching(/WebGL/));
    expect(h.frames).toHaveLength(0);
    expect(h.callbacks.size).toBe(0);
  });

  it.each(['compile', 'link'] as const)('%s失败报告原始诊断并释放已创建资源', (step) => {
    const h = setup({ [step]: false }); h.start();
    expect(h.onError).toHaveBeenCalledWith(expect.stringMatching(step === 'compile' ? /shader failure/ : /link failure/));
    expect(h.gl.deleteShader).toHaveBeenCalledTimes(h.gl.createShader.mock.calls.length);
    expect(h.gl.deleteProgram).toHaveBeenCalledTimes(h.gl.createProgram.mock.calls.length);
    expect(h.frames).toHaveLength(0);
  });

  it('封面色和现有强调色均无效时报告错误，不编造默认色', () => {
    const h = setup(); h.color('not-a-color', ''); h.start();
    expect(h.onError).toHaveBeenCalledWith(expect.stringMatching(/颜色/));
    expect(h.frames).toHaveLength(0);
    expect(h.callbacks.size).toBe(0);
  });

  it('上下文丢失停止绘制，恢复后重建程序并清除错误', () => {
    const h = setup({ playing: true }); h.start();
    const lost = new Event('webglcontextlost', { cancelable: true });
    h.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(h.callbacks.size).toBe(0);
    expect(h.onError).toHaveBeenCalledWith(expect.stringMatching(/上下文.*丢失/));
    const count = h.frames.length;
    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(h.gl.createProgram).toHaveBeenCalledTimes(2);
    expect(h.frames.length).toBe(count + 1);
    expect(h.onError).toHaveBeenLastCalledWith('');
    expect(h.callbacks.size).toBe(1);
  });

  it('卸载释放所有GL资源和观察器，迟到事件不能继续绘制', () => {
    const h = setup({ playing: true }); const renderer = h.start();
    const count = h.frames.length;
    renderer.dispose(); renderer.dispose();
    expect(h.callbacks.size).toBe(0);
    expect(h.resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(h.mutationDisconnect).toHaveBeenCalledTimes(1);
    expect(h.removePreference).toHaveBeenCalledWith('change', expect.any(Function));
    expect(h.gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(h.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(h.gl.deleteBuffer).toHaveBeenCalledTimes(1);
    h.frame(2000); h.color('120, 20, 30'); h.resize(200, 300); h.visibility(false); h.motion(false);
    h.canvas.dispatchEvent(new Event('webglcontextrestored'));
    renderer.update({ mode: 'aurora', playing: true });
    expect(h.frames).toHaveLength(count);
    expect(h.callbacks.size).toBe(0);
  });
});
