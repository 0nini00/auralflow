// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rendererModule from '../src/services/immersiveBackgroundRenderer';

type Renderer = ReturnType<typeof rendererModule.createImmersiveBackgroundRenderer>;
const controllers: Renderer[] = [];

function setup(options: { playing?: boolean; context?: boolean; compile?: boolean; link?: boolean; reduced?: boolean } = {}) {
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
  const mutationTargets: Node[] = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
    observe = vi.fn();
    disconnect = resizeDisconnect;
  });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) { mutationCallbacks.push(callback); }
    observe = vi.fn((target: Node) => { mutationTargets.push(target); });
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
  const frames: { time: number; deep: number[]; fog: number[] }[] = [];
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
    uniform2f: vi.fn((location: { name: string }, x: number, y: number) => uniforms.set(location.name, [x, y])),
    uniform3fv: vi.fn((location: { name: string }, value: number[]) => uniforms.set(location.name, [...value])),
    viewport: vi.fn(),
    drawArrays: vi.fn(() => frames.push({
      time: uniforms.get('uTime') as number,
      deep: uniforms.get('uDeep') as number[],
      fog: uniforms.get('uFog') as number[],
    })),
  };
  vi.spyOn(canvas, 'getContext').mockImplementation(() => options.context === false ? null : gl as unknown as WebGLRenderingContext);
  const onError = vi.fn();
  const start = () => {
    const controller = rendererModule.createImmersiveBackgroundRenderer(canvas, {
      playing: options.playing ?? false, onError,
    });
    controllers.push(controller);
    return controller;
  };
  return {
    canvas, host, gl, frames, uniforms, onError, start, callbacks, requestFrame, cancelFrame,
    resizeDisconnect, mutationDisconnect, mutationTargets, removePreference,
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
    expect(h.frames[0].deep).toEqual([11 / 255, 48 / 255, 77 / 255]);
    expect(h.frames[0].fog).toEqual([90 / 255, 142 / 255, 184 / 255]);
    expect(h.uniforms.get('uResolution')).toEqual([600, 400]);
    expect(h.callbacks.size).toBe(0);
    expect(h.canvas.getContext).toHaveBeenCalledWith('webgl', expect.objectContaining({ alpha: false, antialias: false, preserveDrawingBuffer: true }));
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('播放时最多每秒绘制30帧，暂停后烟雾逐渐停下并释放动画循环', () => {
    const h = setup({ playing: true }); const renderer = h.start();
    for (let time = 0; time <= 1000; time += 10) h.frame(time);
    expect(h.frames.length).toBeGreaterThan(20);
    expect(h.frames.length).toBeLessThanOrEqual(31);
    const lastTime = h.frames.at(-1)!.time;
    const playingStep = lastTime - h.frames.at(-2)!.time;
    renderer.update({ playing: false });
    expect(h.callbacks.size).toBe(1);
    h.frame(1040);
    expect(h.frames.at(-1)!.time).toBeGreaterThan(lastTime);
    expect(h.frames.at(-1)!.time - lastTime).toBeLessThan(playingStep);
    for (let time = 1080; time <= 5000; time += 40) h.frame(time);
    expect(h.callbacks.size).toBe(0);
    const count = h.frames.length;
    const stoppedTime = h.frames.at(-1)!.time;
    h.frame(10000);
    expect(h.frames).toHaveLength(count);
    renderer.update({ playing: true });
    h.frame(10050);
    expect(h.frames.at(-1)!.time - stoppedTime).toBeLessThan(0.2);
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

  it('暂停渐停期间收到新封面色，停稳的最后一帧必须呈现完整的新配色', () => {
    const h = setup({ playing: true }); const renderer = h.start();
    for (let time = 40; time <= 1000; time += 40) h.frame(time);
    renderer.update({ playing: false });
    for (let time = 1040; time <= 2800; time += 40) h.frame(time);
    expect(h.callbacks.size).toBe(1);
    h.color('128, 128, 128');
    for (let time = 2840; time <= 5000; time += 40) h.frame(time);
    expect(h.callbacks.size).toBe(0);
    expect(h.frames.at(-1)!.deep).toEqual([77 / 255, 77 / 255, 77 / 255]);
    expect(h.frames.at(-1)!.fog).toEqual([184 / 255, 184 / 255, 184 / 255]);
  });

  it('启用减少动态效果时只显示静帧，尺寸和颜色改变仍重绘一次', () => {
    const h = setup({ playing: true, reduced: true }); const renderer = h.start();
    renderer.update({ playing: false });
    expect(h.frames).toHaveLength(1);
    h.resize(640, 400);
    expect(h.frames).toHaveLength(2);
    h.color('200, 60, 30');
    expect(h.frames).toHaveLength(3);
    expect(h.frames.at(-1)!.fog[0]).toBeGreaterThan(h.frames.at(-1)!.fog[2]);
    expect(h.callbacks.size).toBe(0);
  });

  it('暂停后调整尺寸和主题会保留动画时间并更新静帧', () => {
    const h = setup(); h.start();
    const time = h.frames[0].time;
    h.resize(500, 300);
    h.color('', '70, 80, 90');
    expect(h.frames).toHaveLength(3);
    expect(h.frames.at(-1)!.time).toBe(time);
    expect(h.frames.at(-1)!.deep).not.toEqual(h.frames[0].deep);
    expect(h.callbacks.size).toBe(0);
  });

  it('有效封面色不受主题强调色影响，灰阶封面保持灰阶', () => {
    const h = setup(); h.start();
    h.color('48, 128, 192', '10, 20, 30');
    expect(h.frames).toHaveLength(1);
    h.color('128, 128, 128', '255, 0, 0');
    expect(h.frames.at(-1)!.deep).toEqual([77 / 255, 77 / 255, 77 / 255]);
    expect(h.frames.at(-1)!.fog).toEqual([184 / 255, 184 / 255, 184 / 255]);
    h.color('0, 0, 0');
    expect(h.frames.at(-1)!.fog).toEqual([184 / 255, 184 / 255, 184 / 255]);
  });

  it('只观察根节点：封面色与强调色都写在那里，沉浸页每帧改进度样式不会触发取色', () => {
    const h = setup(); h.start();
    expect(h.mutationTargets).toEqual([document.documentElement]);
  });

  it('播放中的封面色变更渐进过渡，无关根属性变化不重复绘制', () => {
    const h = setup({ playing: true }); h.start();
    const count = h.frames.length;
    h.color('48, 128, 192');
    expect(h.frames).toHaveLength(count);
    const before = h.frames.at(-1)!.deep[0];
    h.color('240, 128, 192');
    h.frame(40);
    const red = h.frames.at(-1)!.deep[0];
    expect(red).toBeGreaterThan(before);
    expect(red).toBeLessThan(77 / 255);
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
    renderer.update({ playing: true });
    expect(h.frames).toHaveLength(count);
    expect(h.callbacks.size).toBe(0);
  });
});
