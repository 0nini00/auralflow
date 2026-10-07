const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader, deferred } = require('./helpers/loadTs.cjs');
const options = { timeout: 5000 };
const item = id => ({ id, voice: { url: `https://example.test/${id}.m4a`, duration: 14 } });
function setup() {
  const events = [], states = [], errors = [], sessions = [];
  let interrupted;
  const behavior = { start: async () => true, stop: async () => {} };
  const controller = createLoader({})('src/services/commentVoiceController.ts').createCommentVoiceController({
    createSession(onInterrupted) {
      interrupted = onInterrupted;
      const session = { start: () => behavior.start(), close: async resume => { events.push(['close', resume]); } };
      sessions.push(session); return session;
    },
    stopMedia: async () => { events.push(['stopMedia']); await behavior.stop(); },
    onChange: state => states.push(state), onError: error => errors.push(error),
  });
  return { controller, events, states, errors, sessions, behavior, interrupt: () => interrupted() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('歌曲暂停确认后才挂载语音，完成后先停止语音再恢复歌曲', options, async () => {
  const h = setup(), gate = deferred();
  h.behavior.start = () => gate.promise;
  const pending = h.controller.toggle(item('A'));
  await flush();
  assert.equal(h.controller.getState().phase, 'preparing');
  gate.resolve(true); await pending;
  const token = h.controller.getState().token;
  assert.equal(h.controller.getState().phase, 'loading');
  h.controller.loaded(token);
  assert.equal(h.controller.getState().phase, 'playing');
  await h.controller.ended(token);
  assert.equal(h.controller.getState().phase, 'idle');
  assert.deepEqual(h.events.slice(-2), [['stopMedia'], ['close', true]]);
});

test('切换语音复用同一暂停会话，中间不恢复歌曲；再次点当前语音停止', options, async () => {
  const h = setup();
  await h.controller.toggle(item('A'));
  const oldToken = h.controller.getState().token;
  await h.controller.toggle(item('B'));
  assert.equal(h.sessions.length, 1);
  assert.equal(h.events.some(e => e[0] === 'close'), false);
  await h.controller.ended(oldToken);
  assert.equal(h.controller.getState().item.id, 'B');
  await h.controller.toggle(item('B'));
  assert.deepEqual(h.events.at(-1), ['close', true]);
});

for (const resume of [true, false]) {
  test(`准备期间关闭时不能迟到启动语音，恢复策略=${resume}`, options, async () => {
    const h = setup(), gate = deferred();
    h.behavior.start = () => gate.promise;
    const pending = h.controller.toggle(item('A'));
    await flush();
    const closing = h.controller.stop(resume);
    gate.resolve(true);
    await Promise.all([pending, closing]);
    assert.equal(h.states.some(s => s.phase === 'loading'), false);
    assert.equal(h.controller.getState().phase, 'idle');
    assert.deepEqual(h.events.at(-1), ['close', resume]);
  });
}

test('快速选择 A/B/C 只装载最终语音', options, async () => {
  const h = setup(), gate = deferred();
  h.behavior.start = () => gate.promise;
  const a = h.controller.toggle(item('A'));
  await flush();
  const b = h.controller.toggle(item('B'));
  const c = h.controller.toggle(item('C'));
  gate.resolve(true); await Promise.all([a, b, c]);
  assert.deepEqual(h.states.filter(s => s.phase === 'loading').map(s => s.item.id), ['C']);
  await h.controller.stop();
});

test('外部播放意图/退后台中断关闭语音，不自动恢复；旧回调无效', options, async () => {
  const h = setup(); await h.controller.toggle(item('A'));
  const token = h.controller.getState().token;
  h.interrupt(); await flush();
  h.controller.loaded(token);
  await h.controller.failed(token, new Error('late error'));
  assert.equal(h.controller.getState().phase, 'idle');
  assert.deepEqual(h.events.at(-1), ['close', false]);
  assert.deepEqual(h.errors, []);
});

test('播放失败显示错误并恢复原歌曲，下一次点击可重试', options, async () => {
  const h = setup(); await h.controller.toggle(item('A'));
  await h.controller.failed(h.controller.getState().token, new Error('HTTP 403'));
  assert.equal(h.controller.getState().phase, 'error');
  assert.match(h.controller.getState().error, /HTTP 403/);
  assert.deepEqual(h.events.at(-1), ['close', true]);
  assert.equal(h.errors.length, 1);
  await h.controller.toggle(item('A'));
  assert.equal(h.controller.getState().phase, 'loading');
  await h.controller.stop();
});

test('原生停止失败不得恢复歌曲造成混音，并显式报错', options, async () => {
  const h = setup(); await h.controller.toggle(item('A'));
  h.behavior.stop = async () => { throw new Error('cannot stop native audio'); };
  assert.equal(await h.controller.stop(true), false);
  assert.equal(h.controller.getState().phase, 'error');
  assert.deepEqual(h.events.at(-1), ['close', false]);
  assert.equal(h.errors.length, 1);
});

test('加载超时明确失败且恢复，已过期计时器不能终止新语音', options, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(); await h.controller.toggle(item('A'));
  t.mock.timers.tick(20_000); await flush();
  assert.equal(h.controller.getState().phase, 'error');
  assert.match(h.controller.getState().error, /超时/);
  await h.controller.toggle(item('B'));
  h.controller.loaded(h.controller.getState().token);
  t.mock.timers.tick(30_000); await flush();
  assert.equal(h.controller.getState().phase, 'playing');
  await h.controller.stop();
});

test('停止等待期间通过声明式 paused 状态防止重渲染重新开声', options, async () => {
  const h = setup(); await h.controller.toggle(item('A'));
  const gate = deferred(); h.behavior.stop = () => gate.promise;
  const closing = h.controller.stop(); await flush();
  assert.equal(h.controller.getState().phase, 'stopping');
  gate.resolve(); await closing;
  assert.equal(h.controller.getState().phase, 'idle');
});
