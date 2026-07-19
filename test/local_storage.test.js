const test = require('node:test');
const assert = require('node:assert/strict');

const {
  defaultState,
  createLocalStateStore,
} = require('../js/storage');

const STORAGE_KEY = 'aihesh.local.v1';

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
    version: 1,
    profile: { grade: '', major: '', goal: '' },
    sessions: { 0: [], 1: [], 3: [] },
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

  for (const raw of ['null', '[]', '{"version":2}']) {
    const storage = new MemoryStorage({ [STORAGE_KEY]: raw });
    assert.deepEqual(createLocalStateStore(storage).load(), defaultState());
  }
});

test('场景2会话被心理隔离且不产生任何写入', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);

  assert.equal(store.saveSession(2, [userMessage(1)]), false);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(Object.hasOwn(store.load().sessions, '2'), false);
});

test('场景1可以保存合法消息', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);

  assert.equal(store.saveSession(1, [userMessage(1)]), true);
  assert.deepEqual(readSaved(storage).sessions['1'], [userMessage(1)]);
});

test('45条合法消息只保留最后40条', () => {
  const storage = new MemoryStorage();
  const messages = Array.from({ length: 45 }, (_, index) => userMessage(index));

  assert.equal(createLocalStateStore(storage).saveSession(0, messages), true);
  const savedMessages = readSaved(storage).sessions['0'];
  assert.equal(savedMessages.length, 40);
  assert.equal(savedMessages[0].text, '问题5');
  assert.equal(savedMessages.at(-1).text, '问题44');
});

test('saveProfile清洗年级并截断专业和目标', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);

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

  assert.equal(store.saveSession(3, messages), true);
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

  assert.equal(store.saveSession(0, [{
    who: 'ai',
    parts: [{ type: 'text', text: '高风险提示', coral: 1 }],
  }]), true);
  assert.equal(readSaved(storage).sessions['0'][0].parts[0].coral, true);
});

test('clearSession和clearAllSessions保留个人资料且不接受场景2', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  store.saveProfile({ grade: 'junior', major: '心理学', goal: '毕业' });
  store.saveSession(0, [userMessage(0)]);
  store.saveSession(1, [userMessage(1)]);
  store.saveSession(3, [userMessage(3)]);

  const callsBeforeRejectedClear = storage.setCalls;
  assert.equal(store.clearSession(2), false);
  assert.equal(storage.setCalls, callsBeforeRejectedClear);
  assert.equal(store.clearSession(1), true);
  assert.deepEqual(readSaved(storage).sessions['1'], []);

  assert.equal(store.clearAllSessions(), true);
  const saved = readSaved(storage);
  assert.deepEqual(saved.profile, { grade: 'junior', major: '心理学', goal: '毕业' });
  assert.deepEqual(saved.sessions, { 0: [], 1: [], 3: [] });
});

test('存储写入异常时修改接口返回false', () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded'); },
  };
  const store = createLocalStateStore(storage);

  assert.equal(store.saveProfile({ grade: 'freshman' }), false);
  assert.equal(store.saveSession(0, [userMessage(0)]), false);
  assert.equal(store.clearSession(0), false);
  assert.equal(store.clearAllSessions(), false);
});
