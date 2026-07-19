const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createLocalStateStore } = require('../js/storage');

function loadChatApp(fetchImpl = async () => ({
  ok: true,
  json: async () => ({ reply: '回答' }),
})) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/chat.js'), 'utf8');
  let confirmCalls = 0;
  const sandbox = {
    AbortController,
    clearTimeout,
    console: { error() {} },
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
  vm.runInNewContext(`${source}\nthis.ChatApp = ChatApp;`, sandbox);
  return {
    ChatApp: sandbox.ChatApp,
    getConfirmCalls: () => confirmCalls,
  };
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
  app.addUserMessage = (text, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = { who: 'user', id: `user-${sequence += 1}`, text, createdAt: Date.now() };
    app.sessions[targetScene].push(message);
    const result = ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    if (app.notePersistenceResult) app.notePersistenceResult(result);
    return message;
  };
  app.addAIMessage = (reply, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = {
      who: 'ai',
      id: `ai-${sequence += 1}`,
      parts: reply.parts,
      createdAt: Date.now(),
    };
    app.sessions[targetScene].push(message);
    const result = ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    if (app.notePersistenceResult) app.notePersistenceResult(result);
    return message;
  };
}

function installRevisionHarness(app, ChatApp) {
  let sequence = 0;
  app.addUserMessage = (text, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = { who: 'user', id: `user-r${sequence += 1}`, text, createdAt: Date.now() };
    app.sessions[targetScene].push(message);
    app.sessions[targetScene] = app.localStore.normalizeSession(app.sessions[targetScene]);
    const result = ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    app.lastPersistenceResult = result;
    ChatApp.prototype.notePersistenceResult.call(app, result);
    return message;
  };
  app.addAIMessage = (reply, options = {}) => {
    const targetScene = options.scene ?? app.currentScene;
    const message = {
      who: 'ai',
      id: `ai-r${sequence += 1}`,
      parts: reply.parts,
      createdAt: Date.now(),
    };
    app.sessions[targetScene].push(message);
    app.sessions[targetScene] = app.localStore.normalizeSession(app.sessions[targetScene]);
    const result = ChatApp.prototype.persistCurrentSession.call(app, targetScene);
    app.lastPersistenceResult = result;
    ChatApp.prototype.notePersistenceResult.call(app, result);
    return message;
  };
}

function deferredResponse() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
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

  ChatApp.prototype.handleSend.call(app);
  ChatApp.prototype.restoreHistory.call(app, 0);
  delayed.resolve({ ok: true, json: async () => ({ reply: '这是心理回复' }) });
  await requestTask;

  assert.equal(app.currentScene, 2);
  assert.equal(app.sessions[2].at(-1).parts[0].text, '这是心理回复');
  assert.deepEqual(savedScenes.filter(scene => [0, 1, 3].includes(scene)), []);
  assert.equal(app.sessions[0].length, 0);
});

test('请求处理中禁止恢复、删除、清空和保存资料', () => {
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
  ChatApp.prototype.deleteHistory.call(app, 0);
  ChatApp.prototype.clearAllHistory.call(app);
  ChatApp.prototype.handleProfileSubmit.call(app, { preventDefault() {} });

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

  ChatApp.prototype.handleSend.call(app);
  ChatApp.prototype.deleteHistory.call(app, 0);
  ChatApp.prototype.clearAllHistory.call(app);
  delayed.resolve({ ok: true, json: async () => ({ reply: '校园回复' }) });
  await requestTask;

  assert.equal(getConfirmCalls(), 0);
  assert.equal(clearCalls, 0);
  assert.equal(app.sessions[0].at(-1).parts[0].text, '校园回复');
});

test('目标场景与当前场景不同时只写内存不插入DOM', () => {
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

  ChatApp.prototype.addAIMessage.call(
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
  app.sessionRevisions = app.localStore.load().sessionRevisions;
  app.sessions[0] = Array.from({ length: 41 }, (_, index) => ({
    who: 'user',
    id: `user-${index}`,
    text: index === 40 ? '长'.repeat(9_000) : `问题${index}`,
    createdAt: 1_700_000_000_000 + index,
  }));
  app.addAIMessage = () => {};

  assert.equal(ChatApp.prototype.persistCurrentSession.call(app, 0).ok, true);
  assert.equal(app.sessions[0].length, 40);
  assert.equal(app.sessions[0].at(-1).text.length, 8_000);

  await ChatApp.prototype.fetchAIReply.call(app, '继续', { scene: 0 });
  assert.ok(requestBody.history.every(message => message.content.length <= 8_000));
});

test('持久化失败时保留原内存会话', () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  const original = [{ who: 'user', text: '长'.repeat(9_000) }];
  app.sessions[0] = original;
  app.localStore = {
    normalizeSession: () => [{ who: 'user', text: '长'.repeat(8_000) }],
    saveSession: () => false,
  };

  assert.equal(ChatApp.prototype.persistCurrentSession.call(app, 0), false);
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

  ChatApp.prototype.handleSend.call(app);
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

  ChatApp.prototype.handleSend.call(app);
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

  ChatApp.prototype.handleSend.call(app);
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

  ChatApp.prototype.handleSend.call(app);
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

    ChatApp.prototype.addAIMessage.call(app, {
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
    storageKey: 'aihesh.local.v2',
    normalizeSession: messages => messages,
    saveSession: () => true,
    load: () => ({
      version: 2,
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

  ChatApp.prototype.handleSend.call(app);
  ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v2' });
  delayed.resolve({ ok: true, json: async () => ({ reply: '不应复活' }) });
  await requestTask;

  assert.deepEqual(app.sessions[0], []);
  assert.equal(app.sessions[2][0].text, '私密心理对话');
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === '不应复活'), false);
});

test('资料保存成功直接使用合法表单值并刷新成长对话', () => {
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

  ChatApp.prototype.handleProfileSubmit.call(app, { preventDefault() {} });

  const expected = { grade: 'junior', major: '心理学', goal: '准备实习' };
  assert.deepEqual({ ...saveArgument }, expected);
  assert.deepEqual({ ...app.profile }, expected);
  assert.equal(app.renderCalls, 1);
  assert.deepEqual(app.toasts, ['本地资料已保存']);
});

test('资料保存失败不修改内存资料', () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 1);
  const original = { grade: 'freshman', major: '数学', goal: '教资' };
  app.profile = original;
  app.gradeSelect = { value: 'senior' };
  app.majorInput = { value: '中文' };
  app.goalInput = { value: '毕业' };
  app.localStore = { saveProfile: () => false };

  ChatApp.prototype.handleProfileSubmit.call(app, { preventDefault() {} });

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
  const initial = firstStore.load();
  secondStore.load();
  const app = createApp(ChatApp, 0);
  app.localStore = firstStore;
  app.sessionRevisions = { ...(initial.sessionRevisions || { 0: 0, 1: 0, 3: 0 }) };
  app.sessions[2] = [{ who: 'user', text: '心理私密记录' }];
  installRevisionHarness(app, ChatApp);
  app.msgInput.value = 'A页面问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  ChatApp.prototype.handleSend.call(app);
  const afterUser = secondStore.load();
  const externalMessages = [
    ...afterUser.sessions[0],
    { who: 'user', id: 'user-b', text: 'B页面追加', createdAt: Date.now() },
  ];
  const externalSave = secondStore.saveSession(0, externalMessages, afterUser.sessionRevisions?.[0] ?? 0);
  ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v2' });

  delayed.resolve({ ok: true, json: async () => ({ reply: 'A页面迟到回复' }) });
  await requestTask;

  assert.equal(externalSave.ok, true);
  assert.equal(app.sessions[0].at(-1).text, 'B页面追加');
  assert.equal(app.sessions[0].some(message => message.parts?.[0]?.text === 'A页面迟到回复'), false);
  assert.equal(app.sessions[2][0].text, '心理私密记录');

  app.sessions[0].push({ who: 'user', id: 'user-next', text: '同步后继续', createdAt: Date.now() });
  const nextSave = ChatApp.prototype.persistCurrentSession.call(app, 0);
  assert.equal(nextSave.ok, true);
  assert.equal(nextSave.revision, externalSave.revision + 1);
});

test('用户消息CAS冲突时同步外部状态并取消网络请求', () => {
  const { ChatApp } = loadChatApp();
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const staleStore = createLocalStateStore(storage);
  const otherStore = createLocalStateStore(storage);
  const staleState = staleStore.load();
  const otherState = otherStore.load();
  const externalSave = otherStore.saveSession(0, [{
    who: 'user', id: 'external', text: '其他页面内容', createdAt: Date.now(),
  }], otherState.sessionRevisions?.[0] ?? 0);

  const app = createApp(ChatApp, 0);
  app.localStore = staleStore;
  app.sessionRevisions = { ...(staleState.sessionRevisions || { 0: 0, 1: 0, 3: 0 }) };
  installRevisionHarness(app, ChatApp);
  let fetchCalls = 0;
  app.fetchAIReply = () => { fetchCalls += 1; };
  app.msgInput.value = '不要覆盖外部内容';

  ChatApp.prototype.handleSend.call(app);

  assert.equal(externalSave.ok, true);
  assert.equal(fetchCalls, 0);
  assert.equal(app.isProcessing, false);
  assert.equal(app.msgInput.value, '不要覆盖外部内容');
  assert.equal(app.sessions[0][0].text, '其他页面内容');
  assert.deepEqual(app.toasts, ['对话已在其他页面更新，请重试']);
});

test('storage事件尚未送达时AI保存CAS冲突也会回读外部会话', async () => {
  const delayed = deferredResponse();
  const { ChatApp } = loadChatApp(() => delayed.promise);
  const storageData = new Map();
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
  };
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  const initial = firstStore.load();
  secondStore.load();
  const app = createApp(ChatApp, 0);
  app.localStore = firstStore;
  app.sessionRevisions = { ...initial.sessionRevisions };
  installRevisionHarness(app, ChatApp);
  app.msgInput.value = 'A页面问题';
  let requestTask;
  const fetchAIReply = ChatApp.prototype.fetchAIReply.bind(app);
  app.fetchAIReply = (...args) => { requestTask = fetchAIReply(...args); };

  ChatApp.prototype.handleSend.call(app);
  const afterUser = secondStore.load();
  const externalSave = secondStore.saveSession(0, [
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

test('storage事件只响应v2键并保留scene2', () => {
  const { ChatApp } = loadChatApp();
  const app = createApp(ChatApp, 0);
  app.sessions[2] = [{ who: 'user', text: '心理私密记录' }];
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  let loadCalls = 0;
  app.localStore = {
    storageKey: 'aihesh.local.v2',
    load() {
      loadCalls += 1;
      return {
        version: 2,
        profile: { grade: '', major: '', goal: '' },
        sessions: { 0: [], 1: [], 3: [] },
        sessionRevisions: { 0: 1, 1: 0, 3: 0 },
      };
    },
  };

  ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v1' });
  assert.equal(loadCalls, 0);
  ChatApp.prototype.handleStorageEvent.call(app, { key: 'aihesh.local.v2' });
  assert.equal(loadCalls, 1);
  assert.equal(app.sessions[2][0].text, '心理私密记录');
});

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
