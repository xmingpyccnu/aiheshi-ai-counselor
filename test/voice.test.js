const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createVoiceController, voiceErrorMessage } = require('../js/voice');

test('浏览器无语音API时返回不支持状态', () => {
  const controller = createVoiceController({
    root: {},
    onTranscript() {},
    onState() {},
    onError() {},
  });

  assert.equal(controller.supported, false);
  assert.equal(controller.start(), false);
  assert.equal(controller.stop(), false);
  assert.equal(controller.toggle(), false);
  assert.equal(controller.cancel(), false);
});

test('语音识别使用中文、单次且非中间结果', () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }

  const controller = createVoiceController({
    root: { webkitSpeechRecognition: FakeRecognition },
    onTranscript() {},
    onState() {},
    onError() {},
  });
  assert.equal(controller.start(), true);

  assert.equal(instances[0].lang, 'zh-CN');
  assert.equal(instances[0].continuous, false);
  assert.equal(instances[0].interimResults, false);
});

test('单一识别结果仅在正常结束时交付一次，空结果不交付', () => {
  let instance;
  class FakeRecognition {
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  const transcripts = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: FakeRecognition },
    onTranscript: text => transcripts.push(text),
    onState() {},
    onError() {},
  });

  controller.start();
  instance.onresult({ results: [[{ transcript: ' 我想咨询' }], [{ transcript: '转专业 ' }]] });
  assert.deepEqual(transcripts, []);
  instance.onend();
  assert.deepEqual(transcripts, ['我想咨询转专业']);

  controller.start();
  instance.onresult({ results: [[{ transcript: '   ' }], []] });
  instance.onend();
  assert.deepEqual(transcripts, ['我想咨询转专业']);
});

test('同一识别轮按resultIndex累计最终结果且onend只交付完整文本一次', () => {
  let instance;
  class FakeRecognition {
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  const transcripts = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: FakeRecognition },
    onTranscript: text => transcripts.push(text),
    onState() {},
    onError() {},
  });

  controller.start();
  instance.onresult({
    resultIndex: 0,
    results: { 0: { 0: { transcript: '我想' }, length: 1, isFinal: true }, length: 1 },
  });
  instance.onresult({
    resultIndex: 1,
    results: {
      0: { 0: { transcript: '我想' }, length: 1, isFinal: true },
      1: { 0: { transcript: '咨询转专业' }, length: 1, isFinal: true },
      length: 2,
    },
  });

  assert.deepEqual(transcripts, []);
  instance.onend();
  instance.onend();
  assert.deepEqual(transcripts, ['我想咨询转专业']);
});

test('识别错误或取消后不交付已缓冲文本', () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    abort() {}
  }
  const transcripts = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: FakeRecognition },
    onTranscript: text => transcripts.push(text),
    onState() {},
    onError() {},
  });

  controller.start();
  instances[0].onresult({ results: [[{ transcript: '错误前文本' }]] });
  instances[0].onerror({ error: 'network' });
  instances[0].onend();

  controller.start();
  instances[1].onresult({ results: [[{ transcript: '取消前文本' }]] });
  controller.cancel();
  instances[1].onend();

  assert.deepEqual(transcripts, []);
});

test('语音错误返回可操作的中文提示', () => {
  assert.match(voiceErrorMessage('not-allowed'), /麦克风权限/);
  assert.match(voiceErrorMessage('service-not-allowed'), /禁止语音识别/);
  assert.match(voiceErrorMessage('no-speech'), /未检测到语音/);
  assert.match(voiceErrorMessage('network'), /网络/);
  assert.match(voiceErrorMessage('aborted'), /已停止语音输入/);
  assert.match(voiceErrorMessage('unknown'), /语音识别失败/);
});

test('启动抛错时恢复空闲且不会卡在听写状态', () => {
  class ThrowingRecognition {
    start() { throw new Error('permission bridge failed'); }
    stop() {}
  }
  const states = [];
  const errors = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: ThrowingRecognition },
    onTranscript() {},
    onState: state => states.push(state),
    onError: message => errors.push(message),
  });

  assert.equal(controller.start(), false);
  assert.equal(controller.listening, false);
  assert.equal(states.at(-1), 'idle');
  assert.match(errors[0], /语音识别失败/);
  assert.equal(controller.start(), false);
});

test('error后的end重复事件只落一次空闲状态', () => {
  let instance;
  class FakeRecognition {
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() {}
  }
  const states = [];
  const errors = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: FakeRecognition },
    onTranscript() {},
    onState: state => states.push(state),
    onError: message => errors.push(message),
  });

  controller.start();
  instance.onerror({ error: 'network' });
  instance.onend();
  instance.onend();

  assert.deepEqual(states, ['listening', 'idle']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /网络/);
  assert.equal(controller.listening, false);
});

test('重复启动被拒绝，停止抛错后仍可开启新一轮', () => {
  const instances = [];
  class ThrowingStopRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    stop() { throw new Error('already stopped'); }
  }
  const states = [];
  const errors = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: ThrowingStopRecognition },
    onTranscript() {},
    onState: state => states.push(state),
    onError: message => errors.push(message),
  });

  assert.equal(controller.start(), true);
  assert.equal(controller.start(), false);
  assert.equal(controller.stop(), false);
  assert.equal(controller.listening, false);
  assert.match(errors[0], /已停止语音输入/);
  assert.equal(controller.toggle(), true);
  assert.equal(instances.length, 2);
  assert.deepEqual(states, ['listening', 'idle', 'listening']);
});

test('取消后作废迟到结果，新一轮使用独立识别实例', () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    stop() {}
  }
  const transcripts = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: FakeRecognition },
    onTranscript: text => transcripts.push(text),
    onState() {},
    onError() {},
  });

  controller.start();
  const stale = instances[0];
  assert.equal(controller.cancel(), true);
  controller.start();
  const active = instances[1];
  stale.onresult({ results: [[{ transcript: '迟到内容' }]] });
  active.onresult({ results: [[{ transcript: '新一轮内容' }]] });
  active.onend();

  assert.deepEqual(transcripts, ['新一轮内容']);
});

function loadChatApp(windowImpl = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js/chat.js'), 'utf8');
  const document = { querySelectorAll: () => [] };
  const sandbox = {
    AbortController,
    clearTimeout,
    console: { error() {} },
    createVoiceController,
    document,
    fetch: async () => ({ ok: true, json: async () => ({ reply: '回答' }) }),
    getAIReply: () => ({ parts: [] }),
    getCareerTrack: () => ({ version: '通用版', welcome: '', tabs: [], topics: [] }),
    isCrisis: () => false,
    requestAnimationFrame: callback => callback(),
    SCENES: [0, 1, 2, 3].map(index => ({ name: `场景${index}`, welcome: '', tabs: [] })),
    setTimeout,
    window: windowImpl,
  };
  vm.runInNewContext(`${source}\nthis.ChatApp = ChatApp;`, sandbox);
  return { ChatApp: sandbox.ChatApp, document };
}

function createChatApp(ChatApp) {
  const app = Object.create(ChatApp.prototype);
  app.currentScene = 0;
  app.currentView = 'chat';
  app.sessions = [[], [], [], []];
  app.sessionRevisions = { 0: 0, 1: 0, 3: 0 };
  app.profile = { grade: '', major: '', goal: '' };
  app.isProcessing = false;
  app.lastSendTime = 0;
  app.debounceDelay = 0;
  app.roundSequence = 0;
  app.msgInput = {
    value: '',
    maxLength: 8_000,
    disabled: false,
    scrollHeight: 40,
    style: {},
    focus() { app.focusCalls += 1; },
  };
  app.sendBtn = { disabled: false, classList: { toggle() {} } };
  app.voiceBtn = {
    disabled: false,
    title: '',
    classList: { toggle() {} },
    setAttribute(name, value) { this[name] = String(value); },
    addEventListener(_name, handler) { this.click = handler; },
    querySelector() { return app.voiceLabel; },
  };
  app.voiceLabel = { textContent: '话' };
  app.voiceStatus = { textContent: '' };
  app.focusCalls = 0;
  app.toasts = [];
  app.toast = message => app.toasts.push(message);
  app.addUserMessage = () => {};
  app.getLastPersistenceResult = () => ({ ok: true });
  app.getSceneRevision = () => 0;
  app.showTyping = () => {};
  app.fetchAIReply = () => { app.fetchCalls += 1; };
  app.fetchCalls = 0;
  app.renderCurrentSession = () => {};
  app.scrollBottom = () => {};
  app.updateProfileStats = () => {};
  app.renderHistoryList = () => {};
  return app;
}

test('不支持语音API时禁用按钮并保留文本输入说明', () => {
  const { ChatApp } = loadChatApp({});
  const app = createChatApp(ChatApp);

  ChatApp.prototype.setupVoiceInput.call(app);

  assert.equal(app.voiceController.supported, false);
  assert.equal(app.voiceBtn.disabled, true);
  assert.match(app.voiceBtn.title, /不支持/);
  assert.match(app.voiceStatus.textContent, /可继续使用文本输入/);
});

test('转写只进输入框且不自动发送', () => {
  const { ChatApp } = loadChatApp({});
  const app = createChatApp(ChatApp);
  app.msgInput.value = '已有内容';

  ChatApp.prototype.acceptVoiceTranscript.call(app, '语音补充');

  assert.equal(app.msgInput.value, '已有内容，语音补充');
  assert.equal(app.fetchCalls, 0);
  assert.equal(app.focusCalls, 1);
  assert.match(app.toasts[0], /请确认后发送/);
});

test('非空输入剩两字容量时追加分隔符和一个转写字符', () => {
  const { ChatApp } = loadChatApp({});
  const app = createChatApp(ChatApp);
  const existing = '已'.repeat(7_998);
  app.msgInput.value = existing;

  ChatApp.prototype.acceptVoiceTranscript.call(app, '语音内容');

  assert.equal(app.msgInput.value.length, 8_000);
  assert.equal(app.msgInput.value, `${existing}，语`);
  assert.match(app.toasts[0], /请确认后发送/);
  assert.equal(app.fetchCalls, 0);
});

test('非空输入只剩一字容量时不单独追加分隔符', () => {
  const { ChatApp } = loadChatApp({});
  const app = createChatApp(ChatApp);
  const existing = '已'.repeat(7_999);
  app.msgInput.value = existing;

  ChatApp.prototype.acceptVoiceTranscript.call(app, '语音内容');

  assert.equal(app.msgInput.value, existing);
  assert.match(app.toasts[0], /已达上限/);
  assert.equal(app.fetchCalls, 0);
});

test('空输入在maxlength只剩一字时可输入一个转写字符', () => {
  const { ChatApp } = loadChatApp({});
  const app = createChatApp(ChatApp);
  app.msgInput.maxLength = 1;

  ChatApp.prototype.acceptVoiceTranscript.call(app, '语音内容');

  assert.equal(app.msgInput.value, '语');
  assert.match(app.toasts[0], /请确认后发送/);
  assert.equal(app.fetchCalls, 0);
});

test('发送时停止并作废本轮听写，迟到转写不污染新输入', () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    abort() {}
  }
  const { ChatApp } = loadChatApp({ SpeechRecognition: FakeRecognition });
  const app = createChatApp(ChatApp);
  ChatApp.prototype.setupVoiceInput.call(app);
  app.voiceController.start();
  app.msgInput.value = '要发送的问题';

  ChatApp.prototype.handleSend.call(app);
  app.msgInput.value = '新一轮手动输入';
  instances[0].onresult({ results: [[{ transcript: '迟到语音' }]] });
  instances[0].onend();

  assert.equal(app.fetchCalls, 1);
  assert.equal(app.msgInput.value, '新一轮手动输入');
  assert.equal(app.voiceController.listening, false);
});

test('切换场景和离开对话均作废迟到转写', () => {
  const instances = [];
  class FakeRecognition {
    constructor() { instances.push(this); }
    start() { this.onstart?.(); }
    abort() {}
  }
  const windowImpl = { SpeechRecognition: FakeRecognition };
  const { ChatApp, document } = loadChatApp(windowImpl);
  const app = createChatApp(ChatApp);
  app.homeScreen = { classList: { toggle() {} } };
  app.chatView = { classList: { toggle() {} } };
  app.profileView = { classList: { toggle() {} } };
  document.querySelectorAll = () => [];
  ChatApp.prototype.setupVoiceInput.call(app);

  app.voiceController.start();
  const sceneResult = instances[0];
  ChatApp.prototype.switchScene.call(app, 1);
  sceneResult.onresult({ results: [[{ transcript: '场景迟到' }]] });
  sceneResult.onend();
  assert.equal(app.msgInput.value, '');

  app.voiceController.start();
  const viewResult = instances[1];
  ChatApp.prototype.navigateTo.call(app, 'home');
  viewResult.onresult({ results: [[{ transcript: '页面迟到' }]] });
  viewResult.onend();
  assert.equal(app.msgInput.value, '');
});

test('AI请求中语音按钮禁用，结束后仅在支持时恢复', () => {
  const { ChatApp } = loadChatApp({ SpeechRecognition: class {} });
  const app = createChatApp(ChatApp);
  ChatApp.prototype.setupVoiceInput.call(app);

  ChatApp.prototype.beginProcessing.call(app);
  assert.equal(app.voiceBtn.disabled, true);

  ChatApp.prototype.resetProcessingState.call(app);
  assert.equal(app.voiceBtn.disabled, false);

  app.voiceController = { supported: false, cancel: () => false };
  ChatApp.prototype.beginProcessing.call(app);
  ChatApp.prototype.resetProcessingState.call(app);
  assert.equal(app.voiceBtn.disabled, true);
});

test('听写与空闲状态同步更新按钮语义和状态文字', () => {
  const { ChatApp } = loadChatApp({});
  const app = createChatApp(ChatApp);

  ChatApp.prototype.updateVoiceState.call(app, 'listening');
  assert.equal(app.voiceBtn['aria-pressed'], 'true');
  assert.equal(app.voiceBtn['aria-label'], '停止语音输入');
  assert.equal(app.voiceLabel.textContent, '停');
  assert.match(app.voiceStatus.textContent, /正在听/);

  ChatApp.prototype.updateVoiceState.call(app, 'idle');
  assert.equal(app.voiceBtn['aria-pressed'], 'false');
  assert.equal(app.voiceBtn['aria-label'], '开始语音输入');
  assert.equal(app.voiceLabel.textContent, '话');
  assert.match(app.voiceStatus.textContent, /已停止/);
});
