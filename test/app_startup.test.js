const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeClassList {
  constructor(classes = []) {
    this.classes = new Set(classes);
  }

  add(name) {
    this.classes.add(name);
  }

  remove(name) {
    this.classes.delete(name);
  }

  contains(name) {
    return this.classes.has(name);
  }
}

class FakeElement {
  constructor({ text = '', classes = [], disabled = false } = {}) {
    this.textContent = text;
    this.disabled = disabled;
    this.style = {};
    this.classList = new FakeClassList(classes);
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    if (!this.disabled) this.listeners.get('click')?.();
  }
}

function createHarness(readyPromise) {
  const enterBtn = new FakeElement({ text: '开始使用', disabled: true });
  const splash = new FakeElement();
  const app = new FakeElement({ classes: ['hidden'] });
  const splashStatus = new FakeElement({ text: '正在初始化服务，请稍候…' });
  const elements = { enterBtn, splash, app, splashStatus };
  let domReadyListener;
  const timers = [];
  const navigateCalls = [];

  class FakeChatApp {
    constructor() {
      this.ready = readyPromise;
    }

    navigateTo(view) {
      navigateCalls.push(view);
    }
  }

  const window = {};
  const context = vm.createContext({
    ChatApp: FakeChatApp,
    window,
    document: {
      addEventListener(type, listener) {
        if (type === 'DOMContentLoaded') domReadyListener = listener;
      },
      getElementById(id) {
        return elements[id];
      },
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  });
  vm.runInContext(appSource, context, { filename: 'js/app.js' });
  domReadyListener();

  return {
    elements,
    navigateCalls,
    window,
    runAllTimers() {
      while (timers.length) timers.shift()();
    },
  };
}

test('初始化pending时入口禁用，点击不会导航或触发未初始化DOM', async () => {
  const ready = deferred();
  const harness = createHarness(ready.promise);

  assert.match(html, /<button[^>]+id="enterBtn"[^>]+disabled/);
  assert.equal(harness.elements.enterBtn.disabled, true);
  assert.match(harness.elements.splashStatus.textContent, /初始化|加载|准备/);
  assert.doesNotThrow(() => {
    harness.elements.enterBtn.click();
    harness.runAllTimers();
  });
  assert.deepEqual(harness.navigateCalls, []);

  ready.resolve();
  await harness.window.appStartup;
  harness.runAllTimers();
  assert.equal(harness.elements.enterBtn.disabled, false);
  assert.deepEqual(harness.navigateCalls, []);
});

test('ready resolve后恢复入口，用户快速点击两次也只导航一次', async () => {
  const ready = deferred();
  const harness = createHarness(ready.promise);
  ready.resolve();

  const startupResult = await harness.window.appStartup;
  assert.equal(startupResult.ok, true);
  assert.equal(harness.elements.enterBtn.disabled, false);
  assert.equal(harness.elements.enterBtn.textContent, '开始使用');

  harness.elements.enterBtn.click();
  harness.elements.enterBtn.click();
  harness.runAllTimers();
  assert.deepEqual(harness.navigateCalls, ['home']);
});

test('ready reject被消化，入口保持安全禁用并显示可见错误', async () => {
  const ready = deferred();
  const harness = createHarness(ready.promise);
  ready.reject(new Error('startup failed'));

  let startupResult;
  await assert.doesNotReject(async () => {
    startupResult = await harness.window.appStartup;
  });
  assert.equal(startupResult.ok, false);
  assert.equal(startupResult.reason, 'initialization-failed');
  assert.equal(harness.elements.enterBtn.disabled, true);
  assert.match(harness.elements.splashStatus.textContent, /初始化失败|暂时无法/);
  harness.elements.enterBtn.click();
  harness.runAllTimers();
  assert.deepEqual(harness.navigateCalls, []);
});
