const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  createLocalStateStore: createStore,
  defaultState,
} = require('../js/storage');

const serialLockManager = {
  request(_name, _options, callback) {
    return Promise.resolve().then(() => callback({ mode: 'exclusive' }));
  },
};

function createLocalStateStore(storage) {
  return createStore(storage, { lockManager: serialLockManager });
}

function loadChatApp(fetchImpl = async () => ({
  ok: true,
  json: async () => ({ reply: '回答' }),
}), documentImpl, sandboxOverrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/chat.js'), 'utf8');
  let confirmCalls = 0;
  const sandbox = {
    AbortController,
    clearTimeout,
    console: { error() {} },
    defaultState,
    fetch: fetchImpl,
    getAIReply: scene => ({ parts: [{ type: 'text', text: `兜底${scene}` }] }),
    getCareerTrack: () => ({ version: '通用版', welcome: '欢迎', tabs: [], topics: [] }),
    isCrisis: () => false,
    requestAnimationFrame: callback => callback(),
    SCENES: [
      { name: '校园', welcome: '', tabs: [] },
      { name: '成长', welcome: '', tabs: [] },
      { name: '心理', welcome: '', tabs: [] },
      { name: '事务', welcome: '', tabs: [] },
    ],
    setTimeout,
    window: {
      confirm() {
        confirmCalls += 1;
        return true;
      },
    },
  };
  if (documentImpl) sandbox.document = documentImpl;
  Object.assign(sandbox, sandboxOverrides);
  vm.runInNewContext(`${source}\nthis.ChatApp = ChatApp;`, sandbox);
  return {
    ChatApp: sandbox.ChatApp,
    getConfirmCalls: () => confirmCalls,
  };
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this._textContent = '';
    this.classList = {
      add: (...names) => this.updateClasses(names, true),
      remove: (...names) => this.updateClasses(names, false),
      toggle: (name, force) => {
        const hasClass = this.className.split(/\s+/).includes(name);
        const enabled = force === undefined ? !hasClass : Boolean(force);
        this.updateClasses([name], enabled);
        return enabled;
      },
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }

  updateClasses(names, enabled) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
    names.forEach(name => enabled ? classes.add(name) : classes.delete(name));
    this.className = [...classes].join(' ');
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  addEventListener() {}

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  focus() {}

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent || '').join('');
  }

  set innerHTML(value) {
    this._textContent = String(value || '');
    this.children = [];
  }

  get innerHTML() {
    return this._textContent;
  }
}

function createFakeDocument() {
  return {
    activeElement: null,
    createElement: tagName => new FakeElement(tagName),
    querySelectorAll: () => [],
  };
}

function installRealChatView(app, ChatApp) {
  app.messageSequence = 0;
  app.navScene = new FakeElement('div');
  app.safetyBar = new FakeElement('div');
  app.fabBtn = new FakeElement('button');
  app.chatScreen = new FakeElement('main');
  app.renderCurrentSession = ChatApp.prototype.renderCurrentSession.bind(app);
  app.scrollBottom = () => {};
}

function createApp(ChatApp, scene = 0) {
  const app = Object.create(ChatApp.prototype);
  app.currentScene = scene;
  app.currentView = 'chat';
  app.sessions = [[], [], [], []];
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  app.profile = { grade: '', major: '', goal: '' };
  app.isProcessing = false;
  app.lastSendTime = 0;
  app.debounceDelay = 0;
  app.sendBtn = { disabled: false };
  app.msgInput = { value: '', disabled: false, focus() {} };
  app.toasts = [];
  app.toast = message => app.toasts.push(message);
  app.showTyping = () => {};
  app.removeTyping = () => {};
  app.updateComposer = () => {};
  app.resetProcessingState = () => { app.isProcessing = false; };
  app.renderCurrentSession = () => { app.renderCalls = (app.renderCalls || 0) + 1; };
  app.navigateTo = () => { app.navigateCalls = (app.navigateCalls || 0) + 1; };
  app.updateProfileStats = () => {};
  app.renderHistoryList = () => {};
  app.renderProfileForm = () => {};
  app.renderCareerTrack = () => {};
  return app;
}

function installMessageHarness(app, ChatApp) {
  let sequence = 0;
  app.addUserMessage = async (text, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = { who: 'user', id: `user-${sequence += 1}`, text, createdAt: Date.now() };
    app.sessions[targetScene].push(message);
    const result = await ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    if (app.notePersistenceResult) app.notePersistenceResult(result);
    return message;
  };
  app.addAIMessage = async (reply, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = {
      who: 'ai',
      id: `ai-${sequence += 1}`,
      parts: reply.parts,
      createdAt: Date.now(),
    };
    app.sessions[targetScene].push(message);
    const result = await ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    if (app.notePersistenceResult) app.notePersistenceResult(result);
    return message;
  };
}

function installRevisionHarness(app, ChatApp) {
  let sequence = 0;
  app.addUserMessage = async (text, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = { who: 'user', id: `user-r${sequence += 1}`, text, createdAt: Date.now() };
    app.sessions[targetScene].push(message);
    app.sessions[targetScene] = app.localStore.normalizeSession(app.sessions[targetScene]);
    const result = await ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    app.lastPersistenceResult = result;
    ChatApp.prototype.notePersistenceResult.call(app, result);
    return message;
  };
  app.addAIMessage = async (reply, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = {
      who: 'ai',
      id: `ai-r${sequence += 1}`,
      parts: reply.parts,
      createdAt: Date.now(),
    };
    app.sessions[targetScene].push(message);
    app.sessions[targetScene] = app.localStore.normalizeSession(app.sessions[targetScene]);
    const result = await ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    app.lastPersistenceResult = result;
    ChatApp.prototype.notePersistenceResult.call(app, result);
    return message;
  };
}

function deferredResponse() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function runStorageConflictRound({ rejectResponse = false } = {}) {
  const delayed = deferredResponse();
  const fakeDocument = createFakeDocument();
  const { ChatApp } = loadChatApp(() => delayed.promise, fakeDocument);
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  const initial = await firstStore.load();
  await secondStore.load();
  const app = createApp(ChatApp, 0);
  app.localStore = firstStore;
  app.sessionRevisions = { ...initial.sessionRevisions };
  installRealChatView(app, ChatApp);
  app.msgInput.value = 'A页面在途问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  const afterUser = await secondStore.load();
  const externalSave = await secondStore.saveSession(0, [
    ...afterUser.sessions[0],
    { who: 'user', id: 'external-round', text: 'B页面推进内容', createdAt: Date.now() },
  ], afterUser.sessionRevisions[0]);
  assert.equal(externalSave.ok, true);
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });

  if (rejectResponse) delayed.reject(new Error('offline'));
  else delayed.resolve({ ok: true, json: async () => ({ reply: '迟到成功回复' }) });
  await requestTask;

  return { app, stored: await secondStore.load() };
}

test('延迟的心理回复不会因恢复历史而混入普通模块', async () => {
  const delayed = deferredResponse();
  const { ChatApp } = loadChatApp(() => delayed.promise);
  const app = createApp(ChatApp, 2);
  const savedScenes = [];
  app.localStore = {
    normalizeSession: messages => messages.slice(-40),
    saveSession(scene) {
      savedScenes.push(scene);
      return true;
    },
    load: () => ({ sessions: { 0: app.sessions[0], 1: app.sessions[1], 3: app.sessions[3] } }),
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '我现在很难受';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  ChatApp.prototype.restoreHistory.call(app, 0);
  delayed.resolve({ ok: true, json: async () => ({ reply: '这是心理回复' }) });
  await requestTask;

  assert.equal(app.currentScene, 2);
  assert.equal(app.sessions[2].at(-1).parts[0].text, '这是心理回复');
  assert.deepEqual(savedScenes.filter(scene => [0, 1, 3].includes(scene)), []);
  assert.equal(app.sessions[0].length, 0);
});

test('请求处理中禁止恢复、删除、清空和保存资料', async () => {
  const { ChatApp, getConfirmCalls } = loadChatApp();
  const app = createApp(ChatApp, 1);
  app.isProcessing = true;
  app.sessions[0] = [{ who: 'user', text: '原记录' }];
  app.profile = { grade: 'freshman', major: '数学', goal: '实习' };
  let storageCalls = 0;
  app.localStore = {
    clearSession() { storageCalls += 1; return true; },
    clearAllSessions() { storageCalls += 1; return true; },
    saveProfile() { storageCalls += 1; return true; },
  };
  app.gradeSelect = { value: 'senior' };
  app.majorInput = { value: '中文' };
  app.goalInput = { value: '毕业' };

  ChatApp.prototype.restoreHistory.call(app, 0);
  await ChatApp.prototype.deleteHistory.call(app, 0);
  await ChatApp.prototype.clearAllHistory.call(app);
  await ChatApp.prototype.handleProfileSubmit.call(app, { preventDefault() {} });

  assert.equal(app.currentScene, 1);
  assert.equal(app.sessions[0].length, 1);
  assert.deepEqual(app.profile, { grade: 'freshman', major: '数学', goal: '实习' });
  assert.equal(getConfirmCalls(), 0);
  assert.equal(storageCalls, 0);
  assert.equal(app.toasts.length, 4);
});

test('延迟的普通回复期间删除和清空不生效', async () => {
  const delayed = deferredResponse();
  const { ChatApp, getConfirmCalls } = loadChatApp(() => delayed.promise);
  const app = createApp(ChatApp, 0);
  let clearCalls = 0;
  app.localStore = {
    normalizeSession: messages => messages.slice(-40),
    saveSession: () => true,
    clearSession() { clearCalls += 1; return true; },
    clearAllSessions() { clearCalls += 1; return true; },
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '校园问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await ChatApp.prototype.deleteHistory.call(app, 0);
  await ChatApp.prototype.clearAllHistory.call(app);
  delayed.resolve({ ok: true, json: async () => ({ reply: '校园回复' }) });
  await requestTask;

  assert.equal(getConfirmCalls(), 0);
  assert.equal(clearCalls, 0);
  assert.equal(app.sessions[0].at(-1).parts[0].text, '校园回复');
});

test('目标场景与当前场景不同时只写内存不插入DOM', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  let saveCalls = 0;
  app.localStore = {
    normalizeSession: messages => messages,
    saveSession() { saveCalls += 1; return true; },
  };
  app.notePersistenceResult = () => {};
  app.scrollBottom = () => {};
  app.nextMessageId = () => 'ai-delayed';

  await ChatApp.prototype.addAIMessage.call(
    app,
    { parts: [{ type: 'text', text: '心理回复' }] },
    { scene: 2, feedbackEligible: false }
  );

  assert.equal(app.sessions[2].length, 1);
  assert.equal(app.sessions[0].length, 0);
  assert.equal(saveCalls, 0);
});

test('持久化前替换为规范会话，下次请求不超出文本上限', async () => {
  let requestBody;
  const { ChatApp } = loadChatApp(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ reply: '已收到' }) };
  });
  const app = createApp(ChatApp, 0);
  const storage = new Map();
  app.localStore = createLocalStateStore({
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
  });
  app.sessionRevisions = (await app.localStore.load()).sessionRevisions;
  app.sessions[0] = Array.from({ length: 41 }, (_, index) => ({
    who: 'user',
    id: `user-${index}`,
    text: index === 40 ? '长'.repeat(9_000) : `问题${index}`,
    createdAt: 1_700_000_000_000 + index,
  }));
  app.addAIMessage = () => {};

  assert.equal((await ChatApp.prototype.persistCurrentSession.call(app, 0)).ok, true);
  assert.equal(app.sessions[0].length, 40);
  assert.equal(app.sessions[0].at(-1).text.length, 8_000);

  await ChatApp.prototype.fetchAIReply.call(app, '继续', { scene: 0 });
  assert.ok(requestBody.history.every(message => message.content.length <= 8_000));
});

test('持久化失败时保留原内存会话', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  const original = [{ who: 'user', text: '长'.repeat(9_000) }];
  app.sessions[0] = original;
  app.localStore = {
    normalizeSession: () => [{ who: 'user', text: '长'.repeat(8_000) }],
    saveSession: () => false,
  };

  assert.equal(await ChatApp.prototype.persistCurrentSession.call(app, 0), false);
  assert.equal(app.sessions[0], original);
  assert.equal(app.sessions[0][0].text.length, 9_000);
});

test('同一轮多次存储失败只提示一次', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  app.localStore = {
    normalizeSession: messages => messages,
    saveSession: () => false,
    load: () => ({ sessions: { 0: app.sessions[0], 1: [], 3: [] } }),
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '校园问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await requestTask;

  assert.deepEqual(app.toasts, ['对话未能保存']);
});

test('本轮后续完整会话保存成功时不误报失败', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  const saveResults = [false, true];
  app.localStore = {
    normalizeSession: messages => messages,
    saveSession: () => saveResults.shift(),
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '校园问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await requestTask;

  assert.deepEqual(app.toasts, []);
});

test('网络与存储同时失败时用一次toast完整说明', async () => {
  const { ChatApp } = loadChatApp(async () => { throw new Error('offline'); });
  const app = createApp(ChatApp, 0);
  app.localStore = {
    normalizeSession: messages => messages,
    saveSession: () => false,
    load: () => ({ sessions: { 0: app.sessions[0], 1: [], 3: [] } }),
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '校园问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await requestTask;

  assert.deepEqual(app.toasts, ['获取回复失败，请稍后重试；当前对话未保存']);
});

test('仅网络失败时保留明确的获取回复提示', async () => {
  const { ChatApp } = loadChatApp(async () => { throw new Error('offline'); });
  const app = createApp(ChatApp, 0);
  app.localStore = {
    normalizeSession: messages => messages,
    saveSession: () => true,
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '校园问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await requestTask;

  assert.deepEqual(app.toasts, ['获取回复失败，请稍后重试']);
});

test('scene2超长AI回复进入下一次请求前会统一规范化', async () => {
  const requestBodies = [];
  let requestCount = 0;
  const { ChatApp } = loadChatApp(async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    requestCount += 1;
    return {
      ok: true,
      json: async () => ({ reply: requestCount === 1 ? '心'.repeat(9_000) : '继续回答' }),
    };
  });
  const app = createApp(ChatApp, 0);
  const normalizer = createLocalStateStore({ getItem: () => null, setItem() {} });
  app.localStore = {
    normalizeSession: normalizer.normalizeSession,
    saveSession() { throw new Error('scene2不应持久化'); },
  };
  app.nextMessageId = () => 'ai-scene2-long';

  await ChatApp.prototype.fetchAIReply.call(app, '第一次', { scene: 2 });
  assert.equal(app.sessions[2][0].parts[0].text.length, 8_000);

  app.addAIMessage = () => {};
  await ChatApp.prototype.fetchAIReply.call(app, '继续', { scene: 2 });
  assert.ok(requestBodies[1].history.length <= 40);
  assert.ok(requestBodies[1].history.every(message => message.content.length <= 8_000));
});

test('非心理场景0、1、3存储失败后超长AI回复也不进入下次请求', async () => {
  for (const scene of [0, 1, 3]) {
    let requestBody;
    const { ChatApp } = loadChatApp(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ reply: '继续回答' }) };
    });
    const app = createApp(ChatApp, scene === 0 ? 1 : 0);
    const normalizer = createLocalStateStore({ getItem: () => null, setItem() {} });
    app.localStore = {
      normalizeSession: normalizer.normalizeSession,
      saveSession: () => false,
    };
    app.nextMessageId = () => `ai-scene${scene}-long`;

    await ChatApp.prototype.addAIMessage.call(app, {
      parts: [{ type: 'text', text: '长'.repeat(9_000) }],
    }, { scene, feedbackEligible: false });
    assert.equal(app.sessions[scene][0].parts[0].text.length, 8_000);

    app.addAIMessage = () => {};
    await ChatApp.prototype.fetchAIReply.call(app, '继续', { scene });
    assert.ok(requestBody.history.length <= 40);
    assert.ok(requestBody.history.every(message => message.content.length <= 8_000));
  }
});

test('storage事件在处理中作废被删场景请求且不触碰scene2', async () => {
  const delayed = deferredResponse();
  const { ChatApp } = loadChatApp(() => delayed.promise);
  const app = createApp(ChatApp, 0);
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  app.sessions[2] = [{ who: 'user', text: '私密心理对话' }];
  app.localStore = {
    storageKey: 'aihesh.local.v3',
    normalizeSession: messages => messages,
    saveSession: () => true,
    load: () => ({
      version: 3,
      profile: { grade: '', major: '', goal: '' },
      sessions: { 0: [], 1: [], 3: [] },
      sessionRevisions: { 0: 1, 1: 0, 3: 0 },
    }),
  };
  installMessageHarness(app, ChatApp);
  app.msgInput.value = '待删除问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });
  delayed.resolve({ ok: true, json: async () => ({ reply: '不应复活' }) });
  await requestTask;

  assert.deepEqual(app.sessions[0], []);
  assert.equal(app.sessions[2][0].text, '私密心理对话');
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === '不应复活'), false);
});

test('资料保存成功直接使用合法表单值并刷新成长对话', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 1);
  app.profile = { grade: '', major: '', goal: '' };
  app.gradeSelect = { value: 'junior' };
  app.majorInput = { value: '  心理学  ' };
  app.goalInput = { value: '  准备实习  ' };
  let saveArgument;
  app.localStore = {
    saveProfile(profile) { saveArgument = profile; return true; },
    load() { throw new Error('保存后不应二次读取'); },
  };

  await ChatApp.prototype.handleProfileSubmit.call(app, { preventDefault() {} });

  const expected = { grade: 'junior', major: '心理学', goal: '准备实习' };
  assert.deepEqual({ ...saveArgument }, expected);
  assert.deepEqual({ ...app.profile }, expected);
  assert.equal(app.renderCalls, 1);
  assert.deepEqual(app.toasts, ['本地资料已保存']);
});

test('资料保存失败不修改内存资料', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 1);
  const original = { grade: 'freshman', major: '数学', goal: '教资' };
  app.profile = original;
  app.gradeSelect = { value: 'senior' };
  app.majorInput = { value: '中文' };
  app.goalInput = { value: '毕业' };
  app.localStore = { saveProfile: () => false };

  await ChatApp.prototype.handleProfileSubmit.call(app, { preventDefault() {} });

  assert.equal(app.profile, original);
  assert.deepEqual(app.toasts, ['本地资料保存失败，请检查浏览器存储设置']);
});

test('A请求中B普通保存推进revision后A迟到回复不会附到B会话', async () => {
  const delayed = deferredResponse();
  const { ChatApp } = loadChatApp(() => delayed.promise);
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  const initial = await firstStore.load();
  await secondStore.load();
  const app = createApp(ChatApp, 0);
  app.localStore = firstStore;
  app.sessionRevisions = { ...(initial.sessionRevisions || { 0: 0, 1: 0, 3: 0 }) };
  app.sessions[2] = [{ who: 'user', text: '心理私密记录' }];
  installRevisionHarness(app, ChatApp);
  app.msgInput.value = 'A页面问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  const afterUser = await secondStore.load();
  const externalMessages = [
    ...afterUser.sessions[0],
    { who: 'user', id: 'user-b', text: 'B页面追加', createdAt: Date.now() },
  ];
  const externalSave = await secondStore.saveSession(0, externalMessages, afterUser.sessionRevisions?.[0] ?? 0);
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });

  delayed.resolve({ ok: true, json: async () => ({ reply: 'A页面迟到回复' }) });
  await requestTask;

  assert.equal(externalSave.ok, true);
  assert.equal(app.sessions[0].at(-1).text, 'B页面追加');
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === 'A页面迟到回复'), false);
  assert.equal(app.sessions[2][0].text, '心理私密记录');

  app.sessions[0].push({ who: 'user', id: 'user-next', text: '同步后继续', createdAt: Date.now() });
  const nextSave = await ChatApp.prototype.persistCurrentSession.call(app, 0);
  assert.equal(nextSave.ok, true);
  assert.equal(nextSave.revision, externalSave.revision + 1);
});

test('storage事件先推进请求revision且响应成功时只提示一次冲突', async () => {
  const { app, stored } = await runStorageConflictRound();

  assert.deepEqual(app.toasts, ['对话已在其他页面更新，请重试']);
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === '迟到成功回复'), false);
  assert.doesNotMatch(app.chatScreen.textContent, /迟到成功回复/);
  assert.equal(stored.sessions[0].some(message => message.parts?.[0]?.text === '迟到成功回复'), false);
  assert.match(app.chatScreen.textContent, /B页面推进内容/);
});

test('storage事件先推进请求revision且响应失败时只提示一次冲突', async () => {
  const { app, stored } = await runStorageConflictRound({ rejectResponse: true });

  assert.deepEqual(app.toasts, ['对话已在其他页面更新，请重试']);
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === '兜底0'), false);
  assert.doesNotMatch(app.chatScreen.textContent, /兜底0/);
  assert.equal(stored.sessions[0].some(message => message.parts?.[0]?.text === '兜底0'), false);
  assert.match(app.chatScreen.textContent, /B页面推进内容/);
});

test('用户消息revision冲突时同步外部状态并取消网络请求', async () => {
  const { ChatApp } = loadChatApp();
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const staleStore = createLocalStateStore(storage);
  const otherStore = createLocalStateStore(storage);
  const staleState = await staleStore.load();
  const otherState = await otherStore.load();
  const externalSave = await otherStore.saveSession(0, [{
    who: 'user', id: 'external', text: '其他页面内容', createdAt: Date.now(),
  }], otherState.sessionRevisions?.[0] ?? 0);

  const app = createApp(ChatApp, 0);
  app.localStore = staleStore;
  app.sessionRevisions = { ...(staleState.sessionRevisions || { 0: 0, 1: 0, 3: 0 }) };
  installRevisionHarness(app, ChatApp);
  let fetchCalls = 0;
  app.fetchAIReply = () => { fetchCalls += 1; };
  app.msgInput.value = '不要覆盖外部内容';

  await ChatApp.prototype.handleSend.call(app);

  assert.equal(externalSave.ok, true);
  assert.equal(fetchCalls, 0);
  assert.equal(app.isProcessing, false);
  assert.equal(app.msgInput.value, '不要覆盖外部内容');
  assert.equal(app.sessions[0][0].text, '其他页面内容');
  assert.deepEqual(app.toasts, ['对话已在其他页面更新，请重试']);
});

test('用户消息revision冲突后真实DOM重绘外部历史且scene2仍可恢复', async () => {
  const fakeDocument = createFakeDocument();
  const { ChatApp } = loadChatApp(undefined, fakeDocument);
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const staleStore = createLocalStateStore(storage);
  const otherStore = createLocalStateStore(storage);
  const staleState = await staleStore.load();
  const otherState = await otherStore.load();
  const externalMessages = [
    { who: 'user', id: 'external-user', text: '外部页面用户消息', createdAt: Date.now() },
    {
      who: 'ai',
      id: 'external-ai',
      parts: [{ type: 'text', text: '外部页面AI回复' }],
      createdAt: Date.now(),
      feedbackEligible: false,
    },
  ];
  const externalSave = await otherStore.saveSession(
    0,
    externalMessages,
    otherState.sessionRevisions[0]
  );
  assert.equal(externalSave.ok, true);

  const app = createApp(ChatApp, 0);
  app.localStore = staleStore;
  app.sessions = [staleState.sessions[0], staleState.sessions[1], [{
    who: 'user', id: 'private-scene2', text: 'scene2内存消息', createdAt: Date.now(),
  }], staleState.sessions[3]];
  app.sessionRevisions = { ...staleState.sessionRevisions };
  app.messageSequence = 0;
  app.navScene = new FakeElement('div');
  app.safetyBar = new FakeElement('div');
  app.fabBtn = new FakeElement('button');
  app.chatScreen = new FakeElement('main');
  app.renderCurrentSession = ChatApp.prototype.renderCurrentSession.bind(app);
  app.scrollBottom = () => {};
  let fetchCalls = 0;
  app.fetchAIReply = () => { fetchCalls += 1; };
  app.msgInput.value = '冲突页面待写消息';

  await ChatApp.prototype.handleSend.call(app);

  const externalDomText = app.chatScreen.textContent;
  assert.equal(fetchCalls, 0);
  assert.match(externalDomText, /外部页面用户消息/);
  assert.match(externalDomText, /外部页面AI回复/);
  assert.doesNotMatch(externalDomText, /冲突页面待写消息/);
  assert.equal(app.sessions[0].some(message => message.text === '冲突页面待写消息'), false);

  ChatApp.prototype.switchScene.call(app, 2);
  assert.match(app.chatScreen.textContent, /scene2内存消息/);
});

test('storage事件尚未送达时AI保存revision冲突也会回读外部会话', async () => {
  const delayed = deferredResponse();
  const { ChatApp } = loadChatApp(() => delayed.promise);
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  const initial = await firstStore.load();
  await secondStore.load();
  const app = createApp(ChatApp, 0);
  app.localStore = firstStore;
  app.sessionRevisions = { ...initial.sessionRevisions };
  installRevisionHarness(app, ChatApp);
  app.msgInput.value = 'A页面问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  const afterUser = await secondStore.load();
  const externalSave = await secondStore.saveSession(0, [
    ...afterUser.sessions[0],
    { who: 'user', id: 'user-b-late-event', text: 'B页面内容', createdAt: Date.now() },
  ], afterUser.sessionRevisions[0]);
  assert.equal(externalSave.ok, true);

  delayed.resolve({ ok: true, json: async () => ({ reply: '不应覆盖B页面' }) });
  await requestTask;

  assert.equal(app.sessions[0].at(-1).text, 'B页面内容');
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === '不应覆盖B页面'), false);
  assert.deepEqual(app.toasts, ['对话已在其他页面更新，请重试']);
});

test('storage事件只响应v3键并保留scene2', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  app.sessions[2] = [{ who: 'user', text: '心理私密记录' }];
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  let loadCalls = 0;
  app.localStore = {
    storageKey: 'aihesh.local.v3',
    async load() {
      loadCalls += 1;
      return {
        version: 3,
        profile: { grade: '', major: '', goal: '' },
        sessions: { 0: [], 1: [], 3: [] },
        sessionRevisions: { 0: 1, 1: 0, 3: 0 },
      };
    },
  };

  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v1' });
  assert.equal(loadCalls, 0);
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v2' });
  assert.equal(loadCalls, 0);
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });
  assert.equal(loadCalls, 1);
  assert.equal(app.sessions[2][0].text, '心理私密记录');
});

test('event.key为null时同步外部clear、重建v3且旧v1不能复活', async () => {
  const { ChatApp } = loadChatApp();
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const store = createLocalStateStore(storage);
  let state = await store.load();
  await store.saveProfile({ grade: 'junior', major: '心理学', goal: '实习' });
  for (const scene of [0, 1, 3]) {
    const result = await store.saveSession(scene, [{
      who: 'user', id: `scene-${scene}`, text: `场景${scene}历史`, createdAt: Date.now(),
    }], state.sessionRevisions[scene]);
    assert.equal(result.ok, true);
    state = await store.load();
  }
  const app = createApp(ChatApp, 0);
  app.localStore = store;
  app.profile = state.profile;
  app.sessions = [state.sessions[0], state.sessions[1], [{
    who: 'user', id: 'private-clear', text: 'clear后仍保留的scene2', createdAt: Date.now(),
  }], state.sessions[3]];
  app.sessionRevisions = { ...state.sessionRevisions };
  app.renderCalls = 0;
  app.historyCalls = 0;
  app.renderCurrentSession = () => { app.renderCalls += 1; };
  app.renderHistoryList = () => { app.historyCalls += 1; };

  storageData.clear();
  await ChatApp.prototype.handleStorageEvent.call(app, { key: null });

  assert.deepEqual(app.sessions[0], []);
  assert.deepEqual(app.sessions[1], []);
  assert.deepEqual(app.sessions[3], []);
  assert.equal(app.sessions[2][0].text, 'clear后仍保留的scene2');
  assert.deepEqual(app.profile, { grade: '', major: '', goal: '' });
  assert.equal(app.renderCalls, 1);
  assert.equal(app.historyCalls, 1);
  assert.notEqual(storage.getItem('aihesh.local.v3'), null);

  storage.setItem('aihesh.local.v1', JSON.stringify({
    version: 1,
    profile: { grade: 'senior', major: '旧资料', goal: '复活' },
    sessions: {
      0: [{ who: 'user', text: '旧v1历史', createdAt: Date.now() }],
      1: [],
      3: [],
    },
  }));
  const reloaded = await createLocalStateStore(storage).load();
  assert.deepEqual(reloaded.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(reloaded.profile, { grade: '', major: '', goal: '' });
});

test('外部profile变化会重绘成长入口且下一请求使用新profile', async () => {
  const fakeDocument = createFakeDocument();
  let requestBody;
  const getCareerTrack = grade => grade === 'junior'
    ? { version: '大三版', welcome: '大三成长欢迎', tabs: ['大三实习入口'], topics: [] }
    : { version: '大一版', welcome: '大一成长欢迎', tabs: ['大一适应入口'], topics: [] };
  const { ChatApp } = loadChatApp(async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ reply: '成长回复' }) };
  }, fakeDocument, { getCareerTrack });
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  await firstStore.load();
  await firstStore.saveProfile({ grade: 'freshman', major: '心理学', goal: '适应大学' });
  const initial = await firstStore.load();
  await secondStore.load();
  const app = createApp(ChatApp, 1);
  app.localStore = firstStore;
  app.profile = initial.profile;
  app.sessions = [initial.sessions[0], initial.sessions[1], [], initial.sessions[3]];
  app.sessionRevisions = { ...initial.sessionRevisions };
  installRealChatView(app, ChatApp);
  app.renderCurrentSession();
  assert.match(app.chatScreen.textContent, /大一适应入口/);

  await secondStore.saveProfile({ grade: 'junior', major: '心理学', goal: '准备实习' });
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });

  assert.match(app.chatScreen.textContent, /大三实习入口/);
  assert.doesNotMatch(app.chatScreen.textContent, /大一适应入口/);

  app.msgInput.value = '下一轮成长问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };
  await ChatApp.prototype.handleSend.call(app);
  await requestTask;

  assert.deepEqual(requestBody.profile, {
    grade: 'junior', major: '心理学', goal: '准备实习',
  });
});

test('处理中的外部profile变化延迟到finally重绘且不重复消息', async () => {
  const delayed = deferredResponse();
  const fakeDocument = createFakeDocument();
  let requestBody;
  const getCareerTrack = grade => grade === 'junior'
    ? { version: '大三版', welcome: '大三成长欢迎', tabs: ['大三实习入口'], topics: [] }
    : { version: '大一版', welcome: '大一成长欢迎', tabs: ['大一适应入口'], topics: [] };
  const { ChatApp } = loadChatApp((_url, options) => {
    requestBody = JSON.parse(options.body);
    return delayed.promise;
  }, fakeDocument, { getCareerTrack });
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  await firstStore.load();
  await firstStore.saveProfile({ grade: 'freshman', major: '数学', goal: '适应大学' });
  const initial = await firstStore.load();
  await secondStore.load();
  const app = createApp(ChatApp, 1);
  app.localStore = firstStore;
  app.profile = initial.profile;
  app.sessions = [initial.sessions[0], initial.sessions[1], [], initial.sessions[3]];
  app.sessionRevisions = { ...initial.sessionRevisions };
  installRealChatView(app, ChatApp);
  app.renderCurrentSession();
  app.msgInput.value = '处理中成长问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  await ChatApp.prototype.handleSend.call(app);
  await secondStore.load();
  await secondStore.saveProfile({ grade: 'junior', major: '数学', goal: '准备实习' });
  await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });

  assert.match(app.chatScreen.textContent, /大一适应入口/);
  assert.doesNotMatch(app.chatScreen.textContent, /大三实习入口/);
  assert.equal(requestBody.profile.grade, 'freshman');

  delayed.resolve({ ok: true, json: async () => ({ reply: '本轮成长回复' }) });
  await requestTask;

  const finalText = app.chatScreen.textContent;
  assert.match(finalText, /大三实习入口/);
  assert.doesNotMatch(finalText, /大一适应入口/);
  assert.equal((finalText.match(/处理中成长问题/g) || []).length, 1);
  assert.equal((finalText.match(/本轮成长回复/g) || []).length, 1);
});

for (const awayView of ['home', 'profile']) {
  test(`处理中离开成长页到${awayView}后返回时才消费profile重绘`, async () => {
    const delayed = deferredResponse();
    const fakeDocument = createFakeDocument();
    const requestBodies = [];
    const getCareerTrack = grade => grade === 'junior'
      ? { version: '大三版', welcome: '大三成长欢迎', tabs: ['大三实习入口'], topics: [] }
      : { version: '大一版', welcome: '大一成长欢迎', tabs: ['大一适应入口'], topics: [] };
    const { ChatApp } = loadChatApp((_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      if (requestBodies.length === 1) return delayed.promise;
      return Promise.resolve({ ok: true, json: async () => ({ reply: '第二轮成长回复' }) });
    }, fakeDocument, { getCareerTrack });
    const storageData = new Map();
    const storage = {
      getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
      setItem(key, value) { storageData.set(key, String(value)); },
    };
    const firstStore = createLocalStateStore(storage);
    const secondStore = createLocalStateStore(storage);
    await firstStore.load();
    await firstStore.saveProfile({ grade: 'freshman', major: '数学', goal: '适应大学' });
    const initial = await firstStore.load();
    await secondStore.load();
    const app = createApp(ChatApp, 1);
    app.localStore = {
      ...firstStore,
      // Keep this scenario focused on the deferred-profile redraw path. The
      // storage layer still performs real sanitization and locked revision validation on save.
      normalizeSession: messages => messages.slice(-40),
    };
    app.profile = initial.profile;
    app.sessions = [initial.sessions[0], initial.sessions[1], [], initial.sessions[3]];
    app.sessionRevisions = { ...initial.sessionRevisions };
    app.homeScreen = new FakeElement('section');
    app.chatView = new FakeElement('section');
    app.profileView = new FakeElement('section');
    installRealChatView(app, ChatApp);
    app.renderCurrentSession();
    app.msgInput.value = '离页前的成长问题';
    let requestTask;
    const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
    app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

    await ChatApp.prototype.handleSend.call(app);
    await secondStore.saveProfile({ grade: 'junior', major: '数学', goal: '准备实习' });
    await ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v3' });
    ChatApp.prototype.navigateTo.call(app, awayView);
    delayed.resolve({ ok: true, json: async () => ({ reply: '离页前的成长回复' }) });
    await requestTask;

    assert.equal(app.pendingProfileRender, true);
    assert.match(app.chatScreen.textContent, /大一成长欢迎/);
    ChatApp.prototype.navigateTo.call(app, 'chat');

    const returnedText = app.chatScreen.textContent;
    assert.equal(app.pendingProfileRender, false);
    assert.match(returnedText, /大三成长欢迎/);
    assert.match(returnedText, /大三版/);
    assert.match(returnedText, /大三实习入口/);
    assert.doesNotMatch(returnedText, /大一适应入口/);
    assert.equal((returnedText.match(/离页前的成长问题/g) || []).length, 1);
    assert.equal((returnedText.match(/离页前的成长回复/g) || []).length, 1);

    app.msgInput.value = '返回后的成长问题';
    await ChatApp.prototype.handleSend.call(app);
    await requestTask;
    assert.equal(requestBodies[1].profile.grade, 'junior');
  });
}

test('请求前裁掉第41条历史时重绘当前DOM以匹配40条内存', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  app.localStore = createLocalStateStore({ getItem: () => null, setItem() {} });
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  app.sessions[0] = Array.from({ length: 41 }, (_, index) => ({
    who: 'user', id: `u-${index}`, text: `问题${index}`, createdAt: Date.now() + index,
  }));
  app.addAIMessage = () => {};

  await ChatApp.prototype.fetchAIReply.call(app, '继续', { scene: 0, revision: 0 });

  assert.equal(app.sessions[0].length, 40);
  assert.equal(app.renderCalls, 1);
});

test('请求前截断可见长内容时重绘当前DOM', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  app.localStore = createLocalStateStore({ getItem: () => null, setItem() {} });
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  app.sessions[0] = [{
    who: 'user', id: 'long', text: '长'.repeat(9_000), createdAt: Date.now(),
  }];
  app.addAIMessage = () => {};

  await ChatApp.prototype.fetchAIReply.call(app, '继续', { scene: 0, revision: 0 });

  assert.equal(app.sessions[0][0].text.length, 8_000);
  assert.equal(app.renderCalls, 1);
});

test('用户消息等待exclusive锁内落盘后才发起AI请求', async () => {
  const delayedSave = deferredResponse();
  const fakeDocument = createFakeDocument();
  const { ChatApp } = loadChatApp(undefined, fakeDocument);
  const app = createApp(ChatApp, 0);
  installRealChatView(app, ChatApp);
  let fetchCalls = 0;
  let capturedRevision;
  app.localStore = {
    normalizeSession: messages => messages.slice(),
    saveSession: () => delayedSave.promise,
  };
  app.fetchAIReply = (_text, options) => {
    fetchCalls += 1;
    capturedRevision = options.revision;
  };
  app.msgInput.value = '等待安全保存';

  const sendTask = ChatApp.prototype.handleSend.call(app);
  assert.equal(fetchCalls, 0);
  assert.equal(app.isProcessing, true);

  delayedSave.resolve({ ok: true, revision: 1 });
  await sendTask;
  assert.equal(fetchCalls, 1);
  assert.equal(capturedRevision, 1);
});

test('不支持Web Locks时仅内存继续对话并单次明示安全保存降级', async () => {
  const fakeDocument = createFakeDocument();
  const { ChatApp } = loadChatApp(undefined, fakeDocument);
  const app = createApp(ChatApp, 0);
  installRealChatView(app, ChatApp);
  let fetchCalls = 0;
  app.localStore = {
    normalizeSession: messages => messages.slice(),
    saveSession: async () => ({ ok: false, reason: 'locking-unsupported' }),
  };
  app.fetchAIReply = () => {
    fetchCalls += 1;
    app.finishProcessingRound();
    app.resetProcessingState();
  };
  app.msgInput.value = '仅内存对话';

  await ChatApp.prototype.handleSend.call(app);

  assert.equal(fetchCalls, 1);
  assert.equal(app.sessions[0].some(message => message.text === '仅内存对话'), true);
  assert.deepEqual(app.toasts, ['当前浏览器不支持安全的本地保存']);
});

test('用户消息异步落盘冲突时取消网络请求并同步外部状态', async () => {
  const fakeDocument = createFakeDocument();
  const { ChatApp } = loadChatApp(undefined, fakeDocument);
  const app = createApp(ChatApp, 0);
  installRealChatView(app, ChatApp);
  let fetchCalls = 0;
  const externalState = {
    version: 3,
    profile: { grade: '', major: '', goal: '' },
    sessions: { 0: [{ who: 'user', id: 'external', text: '外部对话', createdAt: 1 }], 1: [], 3: [] },
    sessionRevisions: { 0: 2, 1: 0, 3: 0 },
  };
  app.localStore = {
    normalizeSession: messages => messages.slice(),
    saveSession: async () => ({ ok: false, reason: 'conflict', state: externalState, revision: 2 }),
  };
  app.fetchAIReply = () => { fetchCalls += 1; };
  app.msgInput.value = '冲突问题';

  await ChatApp.prototype.handleSend.call(app);

  assert.equal(fetchCalls, 0);
  assert.equal(app.isProcessing, false);
  assert.deepEqual(app.sessions[0], externalState.sessions[0]);
  assert.deepEqual(app.toasts, ['对话已在其他页面更新，请重试']);
});

test('外部clear的异步重建v3失败不产生unhandled rejection', async () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  app.localStore = {
    storageKey: 'aihesh.local.v3',
    resetAfterExternalClear: async () => { throw new Error('lock crashed'); },
  };

  await assert.doesNotReject(
    ChatApp.prototype.handleStorageEvent.call(app, { key: null })
  );
  assert.deepEqual(app.toasts, ['本地保存暂不可用']);
});
