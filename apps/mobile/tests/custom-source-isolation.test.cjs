const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const assets = path.resolve(__dirname, '../android/app/src/main/assets/lx_bridge');

function bridge(options = {}) {
  const messages = [];
  let receive;
  const context = vm.createContext({
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    encodeText: value => [...new TextEncoder().encode(value)],
    decodeText: value => new TextDecoder().decode(value),
    crypto: { getRandomValues: value => crypto.randomFillSync(value) },
    ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) },
    addEventListener: (_name, handler) => { receive = handler; },
  });
  vm.runInContext('globalThis.window=globalThis; globalThis.self=globalThis; globalThis.top=globalThis; globalThis.parent=globalThis;', context);
  if (options.temporal) vm.runInContext('globalThis.Temporal=Object.create(null);', context);
  vm.runInContext(`(() => {
    const encode=encodeText, decode=decodeText;
    delete globalThis.encodeText; delete globalThis.decodeText;
    globalThis.TextEncoder=class TextEncoder { encode(value) { return new Uint8Array(encode(value)); } };
    globalThis.TextDecoder=class TextDecoder { decode(value) { return decode(value); } };
  })();`, context);
  const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<script(?: src="\.\/([^"]+)")?>([\s\S]*?)<\/script>/g)) {
    const source = match[1] ? fs.readFileSync(path.join(assets, match[1]), 'utf8') : match[2];
    try {
      vm.runInContext(source, context, { timeout: 5000, displayErrors: false, filename: match[1] || 'lx-bridge-inline.js' });
    } catch (error) {
      throw new Error(`${match[1] || 'inline'}: ${error.message}`);
    }
  }
  const send = data => receive({ data: JSON.stringify(data) });
  const run = (script, rid = 'fixture') => send({ type: 'run', rid, script, scriptInfo: {} });
  return { messages, run, send, context };
}

test('真实脚本执行入口不暴露 DOM、宿主桥或网络全局对象', () => {
  const h = bridge();
  h.run(`lx.send(lx.EVENT_NAMES.inited,{top:typeof top,parent:typeof parent,bridge:typeof globalThis.ReactNativeWebView,fetch:typeof fetch,document:typeof document});`);
  assert.deepEqual(h.messages.find(item => item.type === 'inited').sources, {
    top: 'undefined', parent: 'undefined', bridge: 'undefined', fetch: 'undefined', document: 'undefined',
  });
});

test('桥页面只保留声明的时间 API，不受宿主 Temporal 实现影响', () => {
  const h = bridge({ temporal: true });
  h.run(`lx.send(lx.EVENT_NAMES.inited,{temporal:typeof Temporal,time:Date.now()>0});`);
  assert.deepEqual(h.messages.find(item => item.type === 'inited').sources, { temporal: 'undefined', time: true });
});

test('动态构造器不能取得宿主全局对象，运行时之间也不共享 globals', () => {
  const h = bridge();
  h.run(`globalThis.auditMarker='private'; let escaped=false; try { escaped=!!({})['con'+'structor']['con'+'structor']('return globalThis')().ReactNativeWebView; } catch {} lx.send(lx.EVENT_NAMES.inited,{escaped});`, 'one');
  h.run(`lx.send(lx.EVENT_NAMES.inited,{marker:typeof globalThis.auditMarker});`, 'two');
  assert.equal(h.messages.find(item => item.rid === 'one' && item.type === 'inited').sources.escaped, false);
  assert.equal(h.messages.find(item => item.rid === 'two' && item.type === 'inited').sources.marker, 'undefined');
});

test('标准 SPKI RSA 公钥的 RAW 加密与平台实现一致', () => {
  const h = bridge();
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  h.run(`const encrypted=lx.utils.crypto.rsaEncrypt(new Uint8Array([1,2,3]),${JSON.stringify(pem)}); lx.send(lx.EVENT_NAMES.inited,{hex:lx.utils.buffer.bufToString(encrypted,'hex')});`);
  const error = h.messages.find(item => item.type === 'error');
  assert.equal(error, undefined);
  const padded = Buffer.alloc(128);
  padded.set([1, 2, 3], 125);
  const expected = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_NO_PADDING }, padded).toString('hex');
  assert.equal(h.messages.find(item => item.type === 'inited').sources.hex, expected);
});

test('脚本同步抛错返回 request-response，不遗留等待超时', async () => {
  const h = bridge();
  h.run(`lx.on(lx.EVENT_NAMES.request,()=>{throw new Error('fixture failure')}); lx.send(lx.EVENT_NAMES.inited,{});`);
  h.send({ type: 'request', rid: 'fixture', id: 'r1', payload: {} });
  await new Promise(setImmediate);
  assert.equal(h.messages.find(item => item.id === 'r1').error, 'fixture failure');
});

test('释放运行时不执行可能抛错的脚本 HTTP 回调，所有资源仍完成清理', () => {
  const h = bridge();
  h.run(`lx.request('https://fixture.invalid',{},()=>{throw new Error('callback failed')}); lx.on(lx.EVENT_NAMES.request,()=> 'alive');`);
  assert.doesNotThrow(() => h.send({ type: 'dispose', rid: 'fixture' }));
  h.send({ type: 'request', rid: 'fixture', id: 'disposed', payload: {} });
  assert.match(h.messages.find(item => item.id === 'disposed').error, /未注册/);
});

test('释放之后在途取链结果不会回流到宿主', async () => {
  const h = bridge();
  h.run(`lx.on(lx.EVENT_NAMES.request,()=>Promise.resolve('late'));`);
  h.send({ type: 'request', rid: 'fixture', id: 'late', payload: {} });
  await Promise.resolve();
  h.send({ type: 'dispose', rid: 'fixture' });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(h.messages.some(item => item.id === 'late'), false);
});

test('兼容周期计时，释放只清理本运行时拥有的定时器', async () => {
  const h = bridge();
  h.run(`let timer=setInterval(()=>{clearInterval(timer);lx.send(lx.EVENT_NAMES.inited,{tick:true});},2);`);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.messages.find(item => item.type === 'error'), undefined);
  assert.equal(h.messages.find(item => item.type === 'inited')?.sources.tick, true);
  h.send({ type: 'dispose', rid: 'fixture' });
});

test('AES 与压缩工具在冻结环境中仍可完成往返', async () => {
  const h = bridge();
  h.run(`(async()=>{const bytes=lx.utils.buffer.from('fixture'); const zip=await lx.utils.zlib.deflate(bytes); const plain=await lx.utils.zlib.inflate(zip); const encrypted=lx.utils.crypto.aesEncrypt(bytes,'cbc','0123456789abcdef','0123456789abcdef'); lx.send(lx.EVENT_NAMES.inited,{plain:lx.utils.buffer.bufToString(plain),bytes:encrypted.length});})().catch(e=>lx.send(lx.EVENT_NAMES.inited,{error:e.message}));`);
  await new Promise(setImmediate);
  assert.deepEqual(h.messages.find(item => item.type === 'inited').sources, { plain: 'fixture', bytes: 16 });
});

test('保留脚本日志能力，不把整个宿主 console 对象传入', () => {
  const h = bridge();
  h.run(`console.debug('fixture runtime'); lx.send(lx.EVENT_NAMES.inited,{console:typeof console.log,bridge:typeof console.ReactNativeWebView});`);
  assert.equal(h.messages.find(item => item.type === 'error'), undefined);
  assert.deepEqual(h.messages.find(item => item.type === 'inited').sources, { console: 'function', bridge: 'undefined' });
});
