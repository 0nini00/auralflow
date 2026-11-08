import {
  IMMERSIVE_BACKGROUND_VERTEX_SHADER,
  IMMERSIVE_BACKGROUND_FRAGMENT_SHADER,
  type DynamicImmersiveBackgroundMode,
} from '@lx/core';

export interface ImmersiveBackgroundConfiguration {
  mode: DynamicImmersiveBackgroundMode;
  color: string;
  playing: boolean;
  active: boolean;
  reducedMotion: boolean;
}

/** 只注入模式、颜色和运行状态；不把文件地址或播放会话带入背景页面。 */
export function createImmersiveBackgroundUpdate(config: ImmersiveBackgroundConfiguration): string {
  if (!config || (config.mode !== 'liquid' && config.mode !== 'aurora')
      || typeof config.color !== 'string' || !/^#[\da-f]{6}$/i.test(config.color)
      || typeof config.playing !== 'boolean' || typeof config.active !== 'boolean'
      || typeof config.reducedMotion !== 'boolean') {
    throw new Error('沉浸背景配置无效：请检查模式、颜色及播放状态');
  }
  const { mode, color, playing, active, reducedMotion } = config;
  return `window.AuralFlowImmersiveBackground.update(${JSON.stringify({ mode, color, playing, active, reducedMotion })});true;`;
}

// 静态页面里的代码由测试在 vm 中完整运行；不依赖 Hermes 的函数源码序列化。
const RUNTIME = String.raw`
(function () {
  'use strict';
  const canvas = document.getElementById('background');
  const FRAME_MS = 1000 / 30;
  const MAX_PIXELS = 540 * 960;
  const MAX_DIMENSION = 960;
  const MAX_DPR = 1.5;
  let gl = null, program = null, buffer = null, shaders = [], uniforms = null;
  let config = null, color = null, targetColor = null;
  let frame = null, time = 12, lastDraw = performance.now();
  let disposed = false, failed = false, lost = false, hasSize = false;

  function post(type, message) {
    const payload = { channel: 'auralflow-immersive-background', type: type };
    if (message !== undefined) payload.message = message;
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function release() {
    if (gl) {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
    }
    buffer = null; program = null; uniforms = null; shaders = [];
  }
  function fail(error) {
    failed = true;
    stop(); release();
    post('error', error instanceof Error ? error.message : String(error));
  }
  function canDraw() {
    return !disposed && !failed && !lost && !document.hidden && hasSize && config && color && program;
  }
  function animating() {
    return canDraw() && config.active && config.playing && !config.reducedMotion;
  }
  function draw() {
    if (!canDraw()) return;
    try {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.uniform1i(uniforms.mode, config.mode === 'liquid' ? 0 : 1);
      gl.uniform3fv(uniforms.color, color);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } catch (error) { fail(error); }
  }
  function tick(now) {
    frame = null;
    if (!animating()) return;
    if (now - lastDraw >= FRAME_MS) {
      const elapsed = Math.min((now - lastDraw) / 1000, 0.1);
      lastDraw = now;
      time += elapsed;
      const blend = 1 - Math.exp(-elapsed / 0.7);
      color = color.map((channel, index) => channel + (targetColor[index] - channel) * blend);
      draw();
    }
    if (animating()) frame = requestAnimationFrame(tick);
  }
  function syncAnimation() {
    if (!animating()) { stop(); return; }
    if (frame !== null) return;
    lastDraw = performance.now();
    frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    hasSize = rect.width > 0 && rect.height > 0;
    if (!hasSize) { stop(); return; }
    const scale = Math.min(window.devicePixelRatio || 1, MAX_DPR,
      Math.sqrt(MAX_PIXELS / (rect.width * rect.height)), MAX_DIMENSION / Math.max(rect.width, rect.height));
    const width = Math.max(1, Math.floor(rect.width * scale));
    const height = Math.max(1, Math.floor(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
    }
    draw(); syncAnimation();
  }
  function update(next) {
    if (disposed) return;
    if (!next || (next.mode !== 'liquid' && next.mode !== 'aurora')
        || typeof next.color !== 'string' || !/^#[\da-f]{6}$/i.test(next.color)
        || typeof next.playing !== 'boolean' || typeof next.active !== 'boolean'
        || typeof next.reducedMotion !== 'boolean') {
      fail(new Error('沉浸背景收到无效配置')); return;
    }
    const modeChanged = !config || config.mode !== next.mode;
    const colorChanged = !config || config.color !== next.color;
    const first = !config;
    config = { mode: next.mode, color: next.color, playing: next.playing,
      active: next.active, reducedMotion: next.reducedMotion };
    if (colorChanged) {
      targetColor = [1, 3, 5].map(index => parseInt(next.color.slice(index, index + 2), 16) / 255);
      if (!color || !animating()) color = targetColor.slice();
    }
    if (first || modeChanged || (colorChanged && !animating())) draw();
    syncAnimation();
  }
  function visibility() {
    if (disposed) return;
    if (!document.hidden && targetColor && !animating()) color = targetColor.slice();
    draw(); syncAnimation();
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('无法创建背景着色器');
    shaders.push(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('背景着色器编译失败：' + (gl.getShaderInfoLog(shader) || '驱动未提供诊断'));
    }
    return shader;
  }
  function uniform(name) {
    const value = gl.getUniformLocation(program, name);
    if (value === null) throw new Error('背景着色器缺少参数：' + name);
    return value;
  }
  function initialize() {
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false,
        depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('当前设备无法创建 WebGL 沉浸背景');
      const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error('无法创建背景图形程序');
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error('背景图形程序链接失败：' + (gl.getProgramInfoLog(program) || '驱动未提供诊断'));
      }
      buffer = gl.createBuffer();
      if (!buffer) throw new Error('无法创建背景顶点缓冲区');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition');
      if (position < 0) throw new Error('背景着色器缺少顶点输入');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = { time: uniform('uTime'), aspect: uniform('uAspect'),
        mode: uniform('uMode'), color: uniform('uColor') };
      failed = false;
      if (targetColor) color = targetColor.slice();
      resize();
    } catch (error) { fail(error); }
  }
  function contextLost(event) {
    event.preventDefault();
    if (disposed) return;
    lost = true; stop(); release();
    post('error', '背景图形上下文已丢失，请选择原背景或等待恢复');
  }
  function contextRestored() {
    if (disposed || !lost) return;
    lost = false; initialize();
    if (!failed) post('restored');
  }
  function dispose() {
    if (disposed) return;
    disposed = true; stop(); release();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', dispose);
    document.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', contextRestored);
  }
  window.AuralFlowImmersiveBackground = { update: update, dispose: dispose };
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', dispose);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  initialize();
  if (!failed) post('ready');
})();`;

/** 固定离线页面；改变播放状态、模式或封面色只通过 update 注入，不重新加载。 */
export function createImmersiveBackgroundDocument(): string {
  const vertex = JSON.stringify(IMMERSIVE_BACKGROUND_VERTEX_SHADER).replace(/</g, '\\u003c');
  const fragment = JSON.stringify(IMMERSIVE_BACKGROUND_FRAGMENT_SHADER).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%;pointer-events:none}</style>
</head><body><canvas id="background" aria-hidden="true"></canvas><script>
const VERTEX_SHADER=${vertex};const FRAGMENT_SHADER=${fragment};
${RUNTIME}
</script></body></html>`;
}
