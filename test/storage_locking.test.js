const test = require('node:test');
const assert = require('node:assert/strict');

const { createLocalStateStore, defaultState } = require('../js/storage');

const V1_KEY = 'aihesh.local.v1';
const V2_KEY = 'aihesh.local.v2';
const V3_KEY = 'aihesh.local.v3';
const LOCK_NAME = 'aihesh.local.v3.root';

class MemoryStorage {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, String(value));
  }

  clear() {
    this.data.clear();
  }
}

class QueuedLockManager {
  constructor({ holdFirst = false } = {}) {
    this.queue = [];
    this.active = false;
    this.requests = [];
    this.holdFirst = false;
    this.releaseFirst = null;
    this.firstHeld = Promise.resolve();
    if (holdFirst) this.holdNext();
  }

  holdNext() {
    this.holdFirst = true;
    this.firstHeld = new Promise(resolve => { this.resolveFirstHeld = resolve; });
  }

  request(name, options, callback) {
    this.requests.push({ name, options });
    return new Promise((resolve, reject) => {
      this.queue.push({ name, options, callback, resolve, reject });
      this.drain();
    });
  }

  async drain() {
    if (this.active || this.queue.length === 0) return;
    this.active = true;
    const entry = this.queue.shift();
    try {
      const value = await entry.callback({ name: entry.name, mode: entry.options.mode });
      if (this.holdFirst) {
        this.holdFirst = false;
        this.resolveFirstHeld();
        await new Promise(resolve => { this.releaseFirst = resolve; });
      }
      entry.resolve(value);
    } catch (error) {
      entry.reject(error);
    } finally {
      this.active = false;
      this.drain();
    }
  }
}

function userMessage(index) {
  return {
    who: 'user',
    id: `user-${index}`,
    text: `问题${index}`,
    createdAt: 1_700_000_000_000 + index,
  };
}

function legacyV2(index = 8) {
  return {
    version: 2,
    profile: { grade: 'senior', major: '旧版专业', goal: '旧版目标' },
    sessions: { 0: [userMessage(index)], 1: [], 3: [] },
    sessionRevisions: { 0: 8, 1: 8, 3: 8 },
  };
}

test('v3存储与锁名固定，Node不注入lockManager时禁止写入', async () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  const unsupported = { ok: false, reason: 'locking-unsupported' };

  assert.equal(store.storageKey, V3_KEY);
  assert.equal(store.lockName, LOCK_NAME);
  assert.deepEqual(store.capability, {
    safePersistence: false,
    reason: 'locking-unsupported',
  });
  assert.deepEqual(await store.load(), defaultState());
  assert.deepEqual(await store.saveProfile({ grade: 'senior' }), unsupported);
  assert.deepEqual(await store.saveSession(0, [userMessage(1)], 0), unsupported);
  assert.deepEqual(await store.clearSession(0, 0), unsupported);
  assert.deepEqual(await store.clearAllSessions({ 0: 0, 1: 0, 3: 0 }), unsupported);
  assert.deepEqual(await store.resetAfterExternalClear(), unsupported);
  assert.equal(storage.data.size, 0);
});

test('v3缺失时在锁内优先迁移v2，有v3后忽略旧版写入', async () => {
  const v1 = {
    version: 1,
    profile: { grade: 'senior', major: '旧v1', goal: '不应选择' },
    sessions: { 0: [userMessage(1)], 1: [], 3: [] },
  };
  const v2 = {
    version: 2,
    profile: { grade: 'junior', major: '心理学', goal: '实习' },
    sessions: { 0: [], 1: [userMessage(2)], 3: [] },
    sessionRevisions: { 0: 4, 1: 7, 3: 2 },
  };
  const storage = new MemoryStorage({
    [V1_KEY]: JSON.stringify(v1),
    [V2_KEY]: JSON.stringify(v2),
  });
  const locks = new QueuedLockManager();
  const store = createLocalStateStore(storage, { lockManager: locks });

  const migrated = await store.load();
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.profile, v2.profile);
  assert.deepEqual(migrated.sessions[1], [userMessage(2)]);
  assert.deepEqual(migrated.sessionRevisions, v2.sessionRevisions);
  assert.equal(locks.requests[0].name, LOCK_NAME);
  assert.equal(locks.requests[0].options.mode, 'exclusive');

  storage.setItem(V2_KEY, JSON.stringify({
    ...v2,
    profile: { grade: 'freshman', major: '旧页面', goal: '不得回写' },
    sessions: { 0: [userMessage(99)], 1: [], 3: [] },
  }));
  assert.deepEqual(await createLocalStateStore(storage, { lockManager: locks }).load(), migrated);
});

test('全新store首次无v3时正常迁移v2，之后不再迁移', async () => {
  const oldState = legacyV2();
  const storage = new MemoryStorage({ [V2_KEY]: JSON.stringify(oldState) });
  const store = createLocalStateStore(storage, { lockManager: new QueuedLockManager() });

  const migrated = await store.load();

  assert.deepEqual(migrated.sessions[0], oldState.sessions[0]);
  assert.deepEqual(migrated.sessionRevisions, oldState.sessionRevisions);
  assert.equal(JSON.parse(storage.getItem(V3_KEY)).version, 3);

  storage.clear();
  storage.setItem(V2_KEY, JSON.stringify(legacyV2(99)));
  const recreated = await store.load();
  assert.deepEqual(recreated.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(recreated.sessionRevisions, { 0: 0, 1: 0, 3: 0 });
});

test('已观察v3后clear与旧v2回写之间的mutation不得复活旧历史', async () => {
  const storage = new MemoryStorage({ [V3_KEY]: JSON.stringify(defaultState()) });
  const store = createLocalStateStore(storage, { lockManager: new QueuedLockManager() });
  await store.load();

  storage.clear();
  storage.setItem(V2_KEY, JSON.stringify(legacyV2()));
  const profileResult = await store.saveProfile({
    grade: 'junior',
    major: '应用心理学',
    goal: '实习',
  });

  assert.equal(profileResult.ok, true);
  let state = JSON.parse(storage.getItem(V3_KEY));
  assert.deepEqual(state.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(state.sessionRevisions, { 0: 0, 1: 0, 3: 0 });
  assert.equal(state.profile.major, '应用心理学');

  const resetResult = await store.resetAfterExternalClear();
  assert.equal(resetResult.ok, true);
  state = resetResult.state;
  assert.deepEqual(state.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(state.sessionRevisions, { 0: 0, 1: 0, 3: 0 });
});

test('reset在等锁前即关闭legacy迁移，已排队load也不重新读v2', async () => {
  const storage = new MemoryStorage({ [V2_KEY]: JSON.stringify(legacyV2()) });
  const locks = new QueuedLockManager();
  locks.holdNext();
  const blocker = locks.request(LOCK_NAME, { mode: 'exclusive' }, () => ({ ok: true }));
  await locks.firstHeld;
  const store = createLocalStateStore(storage, { lockManager: locks });

  const loading = store.load();
  const resetting = store.resetAfterExternalClear();
  assert.equal(locks.queue.length, 2);
  assert.equal(storage.getItem(V3_KEY), null);
  locks.releaseFirst();
  await blocker;

  const loaded = await loading;
  const resetResult = await resetting;
  assert.deepEqual(loaded.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(loaded.sessionRevisions, { 0: 0, 1: 0, 3: 0 });
  assert.equal(resetResult.ok, true);
  assert.deepEqual(resetResult.state.sessions, { 0: [], 1: [], 3: [] });
  assert.deepEqual(resetResult.state.sessionRevisions, { 0: 0, 1: 0, 3: 0 });
});

test('两个store真并发保存同revision时第二个在exclusive锁后冲突', async () => {
  const storage = new MemoryStorage();
  const locks = new QueuedLockManager();
  const firstStore = createLocalStateStore(storage, { lockManager: locks });
  const secondStore = createLocalStateStore(storage, { lockManager: locks });
  const initial = await firstStore.load();
  locks.holdNext();

  const firstSave = firstStore.saveSession(0, [userMessage(1)], initial.sessionRevisions[0]);
  const secondSave = secondStore.saveSession(0, [userMessage(2)], initial.sessionRevisions[0]);
  await locks.firstHeld;
  assert.equal(locks.queue.length, 1);
  locks.releaseFirst();
  const [firstResult, secondResult] = await Promise.all([firstSave, secondSave]);

  assert.deepEqual(firstResult, { ok: true, revision: 1 });
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.reason, 'conflict');
  assert.deepEqual((await secondStore.load()).sessions[0], [userMessage(1)]);
});

test('并发save/delete时已成功的删除不会被陈旧save复活', async () => {
  for (const deleteFirst of [true, false]) {
    const storage = new MemoryStorage();
    const locks = new QueuedLockManager();
    const store = createLocalStateStore(storage, { lockManager: locks });
    let state = await store.load();
    await store.saveSession(0, [userMessage(1)], state.sessionRevisions[0]);
    state = await store.load();

    const save = () => store.saveSession(0, [userMessage(1), userMessage(2)], state.sessionRevisions[0]);
    const remove = () => store.clearSession(0, state.sessionRevisions[0]);
    const operations = deleteFirst ? [remove(), save()] : [save(), remove()];
    const [first, second] = await Promise.all(operations);
    assert.equal(first.ok, true);
    assert.equal(second.reason, 'conflict');
    const finalState = await store.load();
    if (deleteFirst) {
      assert.deepEqual(finalState.sessions[0], []);
    } else {
      assert.deepEqual(finalState.sessions[0], [userMessage(1), userMessage(2)]);
      const deleteResult = await store.clearSession(0, finalState.sessionRevisions[0]);
      assert.equal(deleteResult.ok, true);
      const staleSave = await store.saveSession(0, [userMessage(99)], state.sessionRevisions[0]);
      assert.equal(staleSave.reason, 'conflict');
      assert.deepEqual((await store.load()).sessions[0], []);
    }
  }
});

test('saveProfile与会话写并发不丢字段，clearAll与会话写并发不覆盖新状态', async () => {
  const storage = new MemoryStorage();
  const locks = new QueuedLockManager();
  const profileStore = createLocalStateStore(storage, { lockManager: locks });
  const sessionStore = createLocalStateStore(storage, { lockManager: locks });
  const initial = await profileStore.load();

  const [profileResult, sessionResult] = await Promise.all([
    profileStore.saveProfile({ grade: 'junior', major: '心理学', goal: '实习' }),
    sessionStore.saveSession(1, [userMessage(3)], initial.sessionRevisions[1]),
  ]);
  assert.equal(profileResult.ok, true);
  assert.equal(sessionResult.ok, true);
  let state = await profileStore.load();
  assert.equal(state.profile.grade, 'junior');
  assert.deepEqual(state.sessions[1], [userMessage(3)]);

  const expected = { ...state.sessionRevisions };
  const [clearResult, staleSave] = await Promise.all([
    profileStore.clearAllSessions(expected),
    sessionStore.saveSession(3, [userMessage(4)], expected[3]),
  ]);
  assert.equal(clearResult.ok, true);
  assert.equal(staleSave.reason, 'conflict');
  state = await profileStore.load();
  assert.deepEqual(state.sessions, { 0: [], 1: [], 3: [] });
  assert.equal(state.profile.grade, 'junior');
});

test('锁request抛错时返回lock-failed且storage字节完全不变', async () => {
  const original = JSON.stringify({ ...defaultState(), version: 3 });
  const storage = new MemoryStorage({ [V3_KEY]: original });
  const store = createLocalStateStore(storage, {
    lockManager: { request() { throw new Error('lock service down'); } },
  });

  const failed = { ok: false, reason: 'lock-failed' };
  const before = [...storage.data];
  assert.deepEqual(await store.saveProfile({ grade: 'senior' }), failed);
  assert.deepEqual(await store.saveSession(0, [userMessage(1)], 0), failed);
  assert.deepEqual(await store.clearSession(0, 0), failed);
  assert.deepEqual(await store.clearAllSessions({ 0: 0, 1: 0, 3: 0 }), failed);
  assert.deepEqual(await store.resetAfterExternalClear(), failed);
  assert.deepEqual([...storage.data], before);
});
