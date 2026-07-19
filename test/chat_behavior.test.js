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
  app.sessions[0] = Array.from({ length: 41 }, (_, index) => ({
    who: 'user',
    id: `user-${index}`,
    text: index === 40 ? '长'.repeat(9_000) : `问题${index}`,
    createdAt: 1_700_000_000_000 + index,
  }));
  app.addAIMessage = () => {};

  assert.equal(ChatApp.prototype.persistCurrentSession.call(app, 0), true);
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

test('网络失败提示不被本地存储失败覆盖', async () => {
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

  assert.deepEqual(app.toasts, ['获取回复失败，请稍后重试']);
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
