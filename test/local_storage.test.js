const test = require('node:test');
const assert = require('node:assert/strict');

const {
  defaultState,
  createLocalStateStore,
} = require('../js/storage');

const LEGACY_STORAGE_KEY = 'aihesh.local.v1';
const STORAGE_KEY = 'aihesh.local.v2';

class MemoryStorage {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
    this.setCalls = 0;
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.setCalls += 1;
    this.data.set(key, String(value));
  }
}

function readSaved(storage) {
  return JSON.parse(storage.getItem(STORAGE_KEY));
}

function readSavedV2(storage) {
  return JSON.parse(storage.getItem(STORAGE_KEY));
}

function userMessage(index, overrides = {}) {
  return {
    who: 'user',
    id: `user-${index}`,
    text: `问题${index}`,
    createdAt: 1_700_000_000_000 + index,
    ...overrides,
  };
}

test('defaultState返回相互独立的默认数据', () => {
  const first = defaultState();
  const second = defaultState();

  assert.deepEqual(first, {
    version: 2,
    profile: { grade: '', major: '', goal: '' },
    sessions: { 0: [], 1: [], 3: [] },
    sessionRevisions: { 0: 0, 1: 0, 3: 0 },
  });
  first.sessions[0].push(userMessage(1));
  assert.equal(second.sessions[0].length, 0);
});

test('load在JSON损坏时回退到默认状态', () => {
  const storage = new MemoryStorage({ [STORAGE_KEY]: '{broken json' });

  assert.deepEqual(createLocalStateStore(storage).load(), defaultState());
});

test('load在读取异常、非对象或版本不符时不阻断应用', () => {
  const throwingStorage = {
    getItem() { throw new Error('unavailable'); },
    setItem() {},
  };
  assert.deepEqual(createLocalStateStore(throwingStorage).load(), defaultState());

  for (const raw of ['null', '[]', '{"version":1}']) {
    const storage = new MemoryStorage({ [STORAGE_KEY]: raw });
    assert.deepEqual(createLocalStateStore(storage).load(), defaultState());
  }
});

test('读取异常时所有读改写接口返回失败且不覆盖存储', () => {
  let setCalls = 0;
  const storage = {
    getItem() { throw new Error('temporary read failure'); },
    setItem() { setCalls += 1; },
  };
  const store = createLocalStateStore(storage);

  assert.equal(store.saveProfile({ grade: 'senior' }), false);
  assert.deepEqual(store.saveSession(1, [userMessage(1)], 0), { ok: false, reason: 'unavailable' });
  assert.deepEqual(store.clearSession(1, 0), { ok: false, reason: 'unavailable' });
  assert.deepEqual(store.clearAllSessions({ 0: 0, 1: 0, 3: 0 }), { ok: false, reason: 'unavailable' });
  assert.equal(setCalls, 0);
});

test('超过1MB的原始JSON不解析且不被读改写覆盖', () => {
  const oversizedRaw = JSON.stringify({
    version: 2,
    profile: { grade: 'junior', major: '心理学', goal: 'x'.repeat(1_100_000) },
    sessions: { 0: [], 1: [], 3: [] },
  });
  const storage = new MemoryStorage({ [STORAGE_KEY]: oversizedRaw });
  const store = createLocalStateStore(storage);
  const originalParse = JSON.parse;
  let parseCalls = 0;
  let loaded;
  let saveResult;

  JSON.parse = (...args) => {
    parseCalls += 1;
    return originalParse(...args);
  };
  try {
    loaded = store.load();
    saveResult = store.saveProfile({ grade: 'senior' });
  } finally {
    JSON.parse = originalParse;
  }

  assert.deepEqual(loaded, defaultState());
  assert.equal(saveResult, false);
  assert.equal(parseCalls, 0);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.getItem(STORAGE_KEY), oversizedRaw);
});

test('会话只扫描尾部200项且AI部件只扫描前48项', () => {
  const oldMessages = Array.from({ length: 20 }, (_, index) => userMessage(index));
  const recentMessages = Array.from({ length: 39 }, (_, index) => userMessage(1_000 + index));
  const parts = [
    ...Array.from({ length: 37 }, () => ({ type: 'unknown', text: '不扫描' })),
    ...Array.from({ length: 11 }, (_, index) => ({ type: 'text', text: `前窗口${index}` })),
    ...Array.from({ length: 12 }, (_, index) => ({ type: 'text', text: `窗口外${index}` })),
  ];
  const raw = JSON.stringify({
    version: 2,
    profile: { grade: '', major: '', goal: '' },
    sessions: {
      0: [...oldMessages, ...Array(161).fill(null), ...recentMessages],
      1: [],
      3: [{ who: 'ai', parts }],
    },
  });

  const loaded = createLocalStateStore(new MemoryStorage({ [STORAGE_KEY]: raw })).load();
  assert.equal(loaded.sessions[0].length, 39);
  assert.equal(loaded.sessions[0][0].text, '问题1000');
  assert.equal(loaded.sessions[3][0].parts.length, 11);
  assert.equal(loaded.sessions[3][0].parts.at(-1).text, '前窗口10');
});

test('场景2会话被心理隔离且不产生任何写入', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);

  const state = store.load();
  const callsBeforeRejectedSave = storage.setCalls;
  assert.deepEqual(store.saveSession(2, [userMessage(1)], 0), { ok: false, reason: 'invalid' });
  assert.equal(storage.setCalls, callsBeforeRejectedSave);
  assert.notEqual(storage.getItem(STORAGE_KEY), null);
  assert.equal(Object.hasOwn(state.sessions, '2'), false);
});

test('场景1可以保存合法消息', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const state = store.load();

  assert.deepEqual(store.saveSession(1, [userMessage(1)], state.sessionRevisions[1]), { ok: true, revision: 1 });
  assert.deepEqual(readSaved(storage).sessions['1'], [userMessage(1)]);
});

test('45条合法消息只保留最后40条', () => {
  const storage = new MemoryStorage();
  const messages = Array.from({ length: 45 }, (_, index) => userMessage(index));
  const store = createLocalStateStore(storage);
  const state = store.load();

  assert.deepEqual(store.saveSession(0, messages, state.sessionRevisions[0]), { ok: true, revision: 1 });
  const savedMessages = readSaved(storage).sessions['0'];
  assert.equal(savedMessages.length, 40);
  assert.equal(savedMessages[0].text, '问题5');
  assert.equal(savedMessages.at(-1).text, '问题44');
});

test('normalizeSession为程序内存提供与持久化一致的规范化结果', () => {
  const store = createLocalStateStore(new MemoryStorage());
  const messages = Array.from({ length: 41 }, (_, index) => userMessage(index));
  messages[40].text = `  ${'长'.repeat(9_000)}  `;

  const normalized = store.normalizeSession(messages);

  assert.equal(normalized.length, 40);
  assert.equal(normalized[0].text, '问题1');
  assert.equal(normalized.at(-1).text, '长'.repeat(8_000));
  assert.notEqual(normalized, messages);
});

test('合法会话序列化超过1MB时拒绝写入并保留原存储', () => {
  const originalRaw = JSON.stringify({
    version: 2,
    profile: { grade: 'senior', major: '心理学', goal: '毕业' },
    sessions: { 0: [userMessage(1)], 1: [], 3: [] },
  });
  const storage = new MemoryStorage({ [STORAGE_KEY]: originalRaw });
  const longBody = '内'.repeat(8_000);
  const messages = Array.from({ length: 40 }, (_, messageIndex) => ({
    who: 'ai',
    id: `ai-${messageIndex}`,
    createdAt: 1_700_000_000_000 + messageIndex,
    parts: Array.from({ length: 12 }, (_, partIndex) => ({
      type: 'card',
      title: `建议${partIndex}`,
      body: longBody,
    })),
  }));
  assert.ok(JSON.stringify(messages).length > 1024 * 1024);

  const result = createLocalStateStore(storage).saveSession(1, messages, 0);

  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.getItem(STORAGE_KEY), originalRaw);
});

test('saveProfile清洗年级并截断专业和目标', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);

  store.load();
  assert.equal(store.saveProfile({
    grade: 'graduate',
    major: `  ${'专'.repeat(45)}  `,
    goal: `  ${'目'.repeat(125)}  `,
  }), true);

  const profile = readSaved(storage).profile;
  assert.equal(profile.grade, '');
  assert.equal(profile.major, '专'.repeat(40));
  assert.equal(profile.goal, '目'.repeat(120));
});

test('消息清洗限制字段、长度和AI部件类型', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const messages = [
    userMessage(1, {
      id: 'u'.repeat(100),
      text: `  ${'x'.repeat(8_005)}  `,
      createdAt: Infinity,
      ignored: 'do not persist',
    }),
    {
      who: 'ai',
      id: 'ai-1',
      createdAt: 1_700_000_000_100,
      parts: [
        { type: 'text', text: ' 回答 ', coral: true, html: '<script>bad()</script>' },
        { type: 'source', text: ' 来源 ' },
        { type: 'card', title: '标'.repeat(205), body: '内'.repeat(8_005) },
        { type: 'html', text: '<img onerror=bad()>' },
        ...Array.from({ length: 12 }, (_, index) => ({ type: 'text', text: `extra-${index}` })),
      ],
      feedbackEligible: 1,
      feedbackStatus: 'unknown',
      followupDepth: 2.8,
    },
    { who: 'user', text: '   ' },
    { who: 'other', text: '不保存' },
    { who: 'ai', parts: [] },
  ];

  const state = store.load();
  assert.deepEqual(store.saveSession(3, messages, state.sessionRevisions[3]), { ok: true, revision: 1 });
  const saved = readSaved(storage).sessions['3'];
  assert.equal(saved.length, 2);
  assert.equal(saved[0].id.length, 80);
  assert.equal(saved[0].text.length, 8_000);
  assert.equal(Number.isFinite(saved[0].createdAt), true);
  assert.equal(Object.hasOwn(saved[0], 'ignored'), false);
  assert.equal(saved[1].parts.length, 12);
  assert.deepEqual(saved[1].parts.map(part => part.type).slice(0, 3), ['text', 'source', 'card']);
  assert.equal(saved[1].parts[0].coral, true);
  assert.equal(Object.hasOwn(saved[1].parts[0], 'html'), false);
  assert.equal(saved[1].parts[2].title.length, 200);
  assert.equal(saved[1].parts[2].body.length, 8_000);
  assert.equal(saved[1].feedbackEligible, true);
  assert.equal(saved[1].feedbackStatus, null);
  assert.equal(saved[1].followupDepth, 2);
});

test('AI部件的coral值转换为布尔值', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);

  const state = store.load();
  assert.deepEqual(store.saveSession(0, [{
    who: 'ai',
    parts: [{ type: 'text', text: '高风险提示', coral: 1 }],
  }], state.sessionRevisions[0]), { ok: true, revision: 1 });
  assert.equal(readSaved(storage).sessions['0'][0].parts[0].coral, true);
});

test('clearSession和clearAllSessions保留个人资料且不接受场景2', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const revisions = store.load().sessionRevisions;
  store.saveProfile({ grade: 'junior', major: '心理学', goal: '毕业' });
  const saved0 = store.saveSession(0, [userMessage(0)], revisions[0]);
  const saved1 = store.saveSession(1, [userMessage(1)], revisions[1]);
  const saved3 = store.saveSession(3, [userMessage(3)], revisions[3]);

  const callsBeforeRejectedClear = storage.setCalls;
  assert.deepEqual(store.clearSession(2, 0), { ok: false, reason: 'invalid' });
  assert.equal(storage.setCalls, callsBeforeRejectedClear);
  assert.deepEqual(store.clearSession(1, saved1.revision), { ok: true, revision: 2 });
  assert.deepEqual(readSaved(storage).sessions['1'], []);

  assert.deepEqual(store.clearAllSessions({
    0: saved0.revision,
    1: 2,
    3: saved3.revision,
  }), { ok: true, revisions: { 0: 2, 1: 3, 3: 2 } });
  const saved = readSaved(storage);
  assert.deepEqual(saved.profile, { grade: 'junior', major: '心理学', goal: '毕业' });
  assert.deepEqual(saved.sessions, { 0: [], 1: [], 3: [] });
});

test('共享存储中单场景删除后陈旧标签无法复活历史', () => {
  const storage = new MemoryStorage();
  const staleStore = createLocalStateStore(storage);
  const deletingStore = createLocalStateStore(storage);
  const staleState = staleStore.load();
  const firstSave = staleStore.saveSession(0, [userMessage(1)], staleState.sessionRevisions[0]);
  const deletingState = deletingStore.load();

  assert.deepEqual(deletingStore.clearSession(0, deletingState.sessionRevisions[0]), { ok: true, revision: 2 });
  const staleSave = staleStore.saveSession(0, [userMessage(1), userMessage(2)], firstSave.revision);
  assert.equal(staleSave.ok, false);
  assert.equal(staleSave.reason, 'conflict');

  const state = deletingStore.load();
  assert.deepEqual(state.sessions[0], []);
  assert.equal(state.sessionRevisions[0], 2);
  assert.deepEqual(state.profile, { grade: '', major: '', goal: '' });
  assert.equal(Object.hasOwn(state.sessions, '2'), false);
});

test('共享存储清空后陈旧标签无法复活任一历史', () => {
  const storage = new MemoryStorage();
  const staleStore = createLocalStateStore(storage);
  const clearingStore = createLocalStateStore(storage);
  const staleState = staleStore.load();
  const firstSave = staleStore.saveSession(1, [userMessage(1)], staleState.sessionRevisions[1]);
  const clearingState = clearingStore.load();

  assert.deepEqual(clearingStore.clearAllSessions(clearingState.sessionRevisions), {
    ok: true,
    revisions: { 0: 1, 1: 2, 3: 1 },
  });
  const staleSave = staleStore.saveSession(1, [userMessage(1), userMessage(2)], firstSave.revision);
  assert.equal(staleSave.ok, false);
  assert.equal(staleSave.reason, 'conflict');

  const state = clearingStore.load();
  assert.deepEqual(state.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(state.sessionRevisions, { 0: 1, 1: 2, 3: 1 });
});

test('无删除竞态时同一store可正常连续写入', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const state = store.load();

  const first = store.saveSession(3, [userMessage(1)], state.sessionRevisions[3]);
  const second = store.saveSession(3, [userMessage(1), userMessage(2)], first.revision);
  assert.deepEqual(first, { ok: true, revision: 1 });
  assert.deepEqual(second, { ok: true, revision: 2 });
  assert.deepEqual(store.load().sessions[3], [userMessage(1), userMessage(2)]);
  assert.equal(store.load().sessionRevisions[3], 2);
});

test('存储写入异常时修改接口返回失败', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded'); },
  };
  const store = createLocalStateStore(storage);

  assert.equal(store.saveProfile({ grade: 'freshman' }), false);
  assert.deepEqual(store.saveSession(0, [userMessage(0)], 0), { ok: false, reason: 'unavailable' });
  assert.deepEqual(store.clearSession(0, 0), { ok: false, reason: 'unavailable' });
  assert.deepEqual(store.clearAllSessions({ 0: 0, 1: 0, 3: 0 }), { ok: false, reason: 'unavailable' });
});

test('v2不存在时只迁移一次v1，之后忽略v1更新', () => {
  const legacy = {
    version: 1,
    profile: { grade: 'junior', major: '心理学', goal: '毕业' },
    sessions: { 0: [userMessage(1)], 1: [], 3: [] },
    sessionGenerations: { 0: 4, 1: 0, 3: 2 },
  };
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(legacy) });
  const store = createLocalStateStore(storage);

  const migrated = store.load();
  assert.equal(store.storageKey, STORAGE_KEY);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.sessions[0], [userMessage(1)]);
  assert.deepEqual(migrated.sessionRevisions, { 0: 4, 1: 0, 3: 2 });
  assert.deepEqual(readSavedV2(storage), migrated);

  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
    ...legacy,
    sessions: { 0: [userMessage(99)], 1: [], 3: [] },
    sessionGenerations: { 0: 99, 1: 0, 3: 2 },
  }));
  assert.deepEqual(store.load(), migrated);
});

test('v2清空后旧标签继续写v1也不能恢复历史或倒退revision', () => {
  const legacy = {
    version: 1,
    profile: { grade: '', major: '', goal: '' },
    sessions: { 0: [userMessage(1)], 1: [userMessage(2)], 3: [] },
  };
  const storage = new MemoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(legacy) });
  const store = createLocalStateStore(storage);
  const initial = store.load();

  const cleared = store.clearAllSessions(initial.sessionRevisions);
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.revisions, { 0: 1, 1: 1, 3: 1 });

  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({
    ...legacy,
    sessions: { 0: [userMessage(88)], 1: [userMessage(89)], 3: [userMessage(90)] },
  }));
  const reloaded = createLocalStateStore(storage).load();
  assert.deepEqual(reloaded.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(reloaded.sessionRevisions, { 0: 1, 1: 1, 3: 1 });
  assert.notEqual(storage.getItem(STORAGE_KEY), null);
});

test('两个v2标签从同一revision并发保存时只有一个CAS成功', () => {
  const storage = new MemoryStorage();
  const firstStore = createLocalStateStore(storage);
  const secondStore = createLocalStateStore(storage);
  const firstState = firstStore.load();
  const secondState = secondStore.load();

  const firstResult = firstStore.saveSession(0, [userMessage(1)], firstState.sessionRevisions?.[0] ?? 0);
  const secondResult = secondStore.saveSession(0, [userMessage(2)], secondState.sessionRevisions?.[0] ?? 0);

  assert.deepEqual(firstResult, { ok: true, revision: 1 });
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.reason, 'conflict');
  assert.equal(secondResult.revision, 1);
  assert.deepEqual(secondStore.load().sessions[0], [userMessage(1)]);
});

test('普通保存和删除每次成功都递增各自场景revision', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const initial = store.load();

  const first = store.saveSession(3, [userMessage(1)], initial.sessionRevisions?.[3] ?? 0);
  const second = store.saveSession(3, [userMessage(1), userMessage(2)], first.revision);
  const removed = store.clearSession(3, second.revision);

  assert.deepEqual(first, { ok: true, revision: 1 });
  assert.deepEqual(second, { ok: true, revision: 2 });
  assert.deepEqual(removed, { ok: true, revision: 3 });
  assert.deepEqual(store.load().sessions[3], []);
  assert.equal(store.load().sessionRevisions[3], 3);
});

test('保存资料保留v2中的全部会话与revision', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const initial = store.load();
  const saved = store.saveSession(1, [userMessage(1)], initial.sessionRevisions?.[1] ?? 0);

  assert.equal(store.saveProfile({ grade: 'senior', major: '心理学', goal: '毕业' }), true);
  const state = store.load();
  assert.deepEqual(state.sessions[1], [userMessage(1)]);
  assert.equal(state.sessionRevisions?.[1], saved.revision);
  assert.deepEqual(state.profile, { grade: 'senior', major: '心理学', goal: '毕业' });
});
