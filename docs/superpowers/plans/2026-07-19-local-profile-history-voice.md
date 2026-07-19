# 本地资料、历史与语音输入实施计划

状态：已实施；v3+Web Locks并发安全修订已确认并落地。下方早期TDD代码片段保留为实施过程记录，存储契约以本页开头的最终架构和当前测试为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不伪造学校账号和办理系统的前提下，实现本地学生资料、年级化生涯服务、非心理对话恢复和可降级的语音转文字。

**Architecture:** 新增三个原生JavaScript模块，分别处理带版本的本地存储、年级到生涯主题的映射、浏览器语音识别。最终存储模型为`aihesh.local.v3`+`sessionRevisions`，所有根状态mutation使用同源Web Locks exclusive锁完成原子读改写；优先一次迁移v2，无v2时再迁移v1。`ChatApp`全面等待异步mutation；无Web Locks时不写根状态，仅允许对话内存降级。心理模块永远不写入`localStorage`；成长模块请求仅在调用AI时携带已校验的年级、专业和目标。

**Tech Stack:** Node.js内置测试器、原生HTML/CSS/JavaScript、`localStorage`、Web Locks API、Web Speech API、现有Node.js HTTP服务和星火API。

---

## 文件结构

- `js/storage.js`：v3本地数据默认值、校验、裁剪、旧版迁移与Web Locks保护的异步存取/删除；同时支持Node.js注入lockManager测试和浏览器全局导出。
- `js/profile.js`：大一至大四的生涯版本、欢迎文案和快捷问题映射。
- `js/voice.js`：Web Speech API的能力检测、启停、转写和错误映射。
- `js/chat.js`：读取三个模块，完成资料表单、历史UI、对话持久化与语音状态组装。
- `server.js`：校验可选的本地资料字段，仅对成长场景传给Agent。
- `agent.js`：把已校验资料作为成长场景的临时上下文，不持久化。
- `index.html`与`css/styles.css`：资料、历史和语音状态的可访问界面。
- `test/local_storage.test.js`与`test/storage_locking.test.js`：本地数据边界、心理隔离、真并发锁排队、迁移与降级零写入测试。
- `test/profile.test.js`：年级映射测试。
- `test/voice.test.js`：语音支持、转写和错误降级测试。
- `test/server.test.js`与`test/agent_prefetch.test.js`：资料输入校验与Agent上下文测试。
- `test/frontend.test.js`：页面结构、隐私文案和模块集成测试。

### Task 1：实现带心理隔离的本地存储层

**Files:**
- Create: `test/local_storage.test.js`
- Create: `js/storage.js`

- [ ] **Step 1：编写存储层失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalStateStore, defaultState } = require('../js/storage');

class MemoryStorage {
  constructor(seed = {}) { this.data = new Map(Object.entries(seed)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

test('损坏数据回退到空状态', () => {
  const store = createLocalStateStore(new MemoryStorage({ 'aihesh.local.v1': '{bad' }));
  assert.deepEqual(store.load(), defaultState());
});

test('只持久化校园、成长和事务模块', () => {
  const storage = new MemoryStorage();
  const store = createLocalStateStore(storage);
  assert.equal(store.saveSession(2, [{ who: 'user', text: '心理对话' }]), false);
  assert.equal(store.saveSession(1, [{ who: 'user', text: '生涯问题' }]), true);
  const state = store.load();
  assert.equal(Object.hasOwn(state.sessions, '2'), false);
  assert.equal(state.sessions[1][0].text, '生涯问题');
});

test('每个模块只保留最近40条合法消息', () => {
  const store = createLocalStateStore(new MemoryStorage());
  const messages = Array.from({ length: 45 }, (_, index) => ({
    who: 'user', id: `m${index}`, text: `问题${index}`, createdAt: index,
  }));
  store.saveSession(0, messages);
  const saved = store.load().sessions[0];
  assert.equal(saved.length, 40);
  assert.equal(saved[0].text, '问题5');
});

test('资料字段会被校验和截断', () => {
  const store = createLocalStateStore(new MemoryStorage());
  store.saveProfile({ grade: 'unknown', major: 'A'.repeat(60), goal: 'B'.repeat(150) });
  const profile = store.load().profile;
  assert.equal(profile.grade, '');
  assert.equal(profile.major.length, 40);
  assert.equal(profile.goal.length, 120);
});
```

- [ ] **Step 2：运行测试并确认因模块缺失而失败**

Run: `node --test test/local_storage.test.js`  
Expected: FAIL with `Cannot find module '../js/storage'`.

- [ ] **Step 3：实现最小存储模块**

`js/storage.js`实现并导出以下接口：

```js
const STORAGE_KEY = 'aihesh.local.v1';
const PERSISTED_SCENES = new Set([0, 1, 3]);
const GRADES = new Set(['freshman', 'sophomore', 'junior', 'senior']);

function defaultState() {
  return {
    version: 1,
    profile: { grade: '', major: '', goal: '' },
    sessions: { 0: [], 1: [], 3: [] },
  };
}

function cleanText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function cleanParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.slice(0, 12).map(part => ({
    type: ['text', 'source', 'card'].includes(part?.type) ? part.type : 'text',
    text: cleanText(part?.text, 8000),
    title: cleanText(part?.title, 200),
    body: cleanText(part?.body, 8000),
    coral: Boolean(part?.coral),
  })).filter(part => part.text || part.title || part.body);
}

function cleanMessage(message) {
  if (!message || !['user', 'ai'].includes(message.who)) return null;
  const base = {
    who: message.who,
    id: cleanText(message.id, 80),
    createdAt: Number.isFinite(message.createdAt) ? message.createdAt : Date.now(),
  };
  if (message.who === 'user') {
    const text = cleanText(message.text, 8000);
    return text ? { ...base, text } : null;
  }
  const parts = cleanParts(message.parts);
  return parts.length ? {
    ...base,
    parts,
    feedbackEligible: message.feedbackEligible !== false,
    feedbackStatus: ['resolved', 'unresolved'].includes(message.feedbackStatus)
      ? message.feedbackStatus : null,
    followupDepth: Number.isInteger(message.followupDepth) ? message.followupDepth : 0,
  } : null;
}

function normalizeState(input) {
  const state = defaultState();
  if (!input || input.version !== 1 || typeof input !== 'object') return state;
  state.profile = {
    grade: GRADES.has(input.profile?.grade) ? input.profile.grade : '',
    major: cleanText(input.profile?.major, 40),
    goal: cleanText(input.profile?.goal, 120),
  };
  for (const scene of PERSISTED_SCENES) {
    const messages = Array.isArray(input.sessions?.[scene]) ? input.sessions[scene] : [];
    state.sessions[scene] = messages.map(cleanMessage).filter(Boolean).slice(-40);
  }
  return state;
}

function createLocalStateStore(storage) {
  const load = () => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : defaultState();
    } catch { return defaultState(); }
  };
  const write = state => {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state))); return true; }
    catch { return false; }
  };
  return {
    load,
    saveProfile(profile) { const state = load(); state.profile = profile; return write(state); },
    saveSession(scene, messages) {
      if (!PERSISTED_SCENES.has(scene)) return false;
      const state = load(); state.sessions[scene] = messages; return write(state);
    },
    clearSession(scene) {
      if (!PERSISTED_SCENES.has(scene)) return false;
      const state = load(); state.sessions[scene] = []; return write(state);
    },
    clearAllSessions() { const state = load(); state.sessions = { 0: [], 1: [], 3: [] }; return write(state); },
  };
}
```

文件末尾同时支持`module.exports`与`globalThis`导出，但不把`STORAGE_KEY`挂到页面全局。

- [ ] **Step 4：运行存储测试并确认通过**

Run: `node --test test/local_storage.test.js`  
Expected: 4 tests PASS.

- [ ] **Step 5：提交存储层**

```bash
git add js/storage.js test/local_storage.test.js
git commit -m "feat: add privacy-aware local conversation storage"
```

### Task 2：实现年级化生涯服务映射

**Files:**
- Create: `test/profile.test.js`
- Create: `js/profile.js`

- [ ] **Step 1：编写四个年级的失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getCareerTrack } = require('../js/profile');

test('大一至大四对应四个生涯版本', () => {
  assert.equal(getCareerTrack('freshman').version, '探索版');
  assert.match(getCareerTrack('freshman').topics.join(''), /专业认知/);
  assert.equal(getCareerTrack('sophomore').version, '定位版');
  assert.match(getCareerTrack('sophomore').topics.join(''), /能力差距/);
  assert.equal(getCareerTrack('junior').version, '行动版');
  assert.match(getCareerTrack('junior').topics.join(''), /实习/);
  assert.equal(getCareerTrack('senior').version, '冲刺版');
  assert.match(getCareerTrack('senior').topics.join(''), /未就业学生重点帮扶/);
});

test('未设置年级时返回通用版且不推测年级', () => {
  const track = getCareerTrack('');
  assert.equal(track.version, '通用版');
  assert.deepEqual(track.tabs, ['课程学习', '升学备考', '竞赛科研', '实习就业']);
});
```

- [ ] **Step 2：运行测试并确认因模块缺失而失败**

Run: `node --test test/profile.test.js`  
Expected: FAIL with `Cannot find module '../js/profile'`.

- [ ] **Step 3：实现年级到生涯版本的纯函数映射**

`js/profile.js`定义`CAREER_TRACKS`，每个年级包含`version`、`welcome`、`topics`和4个`tabs`。其中：

```js
const CAREER_TRACKS = {
  freshman: {
    version: '探索版',
    topics: ['专业认知', '兴趣与优势探索', '大学目标制定', '校园资源推荐', '生涯人物访谈'],
    tabs: ['专业认知', '优势探索', '大学目标', '资源推荐'],
  },
  sophomore: {
    version: '定位版',
    topics: ['职业方向探索', '能力差距分析', '竞赛与项目建议', '考研考公就业初步比较', '学期能力提升计划'],
    tabs: ['职业方向', '能力差距', '竞赛项目', '路径比较'],
  },
  junior: {
    version: '行动版',
    topics: ['实习推荐与准备', '简历素材积累', '岗位能力训练', '考研院校与方向分析', '模拟面试'],
    tabs: ['实习准备', '简历素材', '院校方向', '模拟面试'],
  },
  senior: {
    version: '冲刺版',
    topics: ['招聘信息分析', '简历精准修改', '面试训练', '升学复试', 'Offer与就业选择', '未就业学生重点帮扶'],
    tabs: ['招聘分析', '简历修改', '升学复试', '就业选择'],
  },
};

function getCareerTrack(grade) {
  const selected = CAREER_TRACKS[grade];
  if (selected) return {
    ...selected,
    welcome: `你好，这里是${selected.version}学业与生涯服务。告诉我你的专业、目标和当前困难，我们从一个可执行的步骤开始。`,
  };
  return {
    version: '通用版',
    welcome: '你好！告诉我你的年级、专业和当前目标，我可以协助你规划学习、升学、竞赛、实习或就业。',
    topics: [],
    tabs: ['课程学习', '升学备考', '竞赛科研', '实习就业'],
  };
}
```

与Task 1相同，文件末尾同时支持Node.js与浏览器导出。

- [ ] **Step 4：运行测试并确认通过**

Run: `node --test test/profile.test.js`  
Expected: 2 tests PASS.

- [ ] **Step 5：提交年级映射**

```bash
git add js/profile.js test/profile.test.js
git commit -m "feat: add grade-specific career tracks"
```

### Task 3：把本地资料安全地传入成长场景

**Files:**
- Modify: `server.js`
- Modify: `agent.js`
- Modify: `test/server.test.js`
- Modify: `test/agent_prefetch.test.js`

- [ ] **Step 1：编写资料校验与Agent上下文失败测试**

在`test/server.test.js`增加：

```js
test('成长场景接受已校验的本地资料', async () => {
  let received;
  await withServer(async baseUrl => {
    const response = await postChat(baseUrl, {
      scene: 1,
      history: [{ role: 'user', content: '帮我制定计划' }],
      profile: { grade: 'junior', major: '应用心理学', goal: '寻找实习' },
    });
    assert.equal(response.status, 200);
  }, async (scene, history, profile) => { received = profile; return '测试回复'; });
  assert.deepEqual(received, { grade: 'junior', major: '应用心理学', goal: '寻找实习' });
});

test('拒绝非法年级和过长本地资料', async () => {
  await withServer(async baseUrl => {
    const response = await postChat(baseUrl, {
      scene: 1,
      history: [{ role: 'user', content: '测试' }],
      profile: { grade: 'teacher', major: 'A'.repeat(41), goal: '' },
    });
    assert.equal(response.status, 400);
  });
});
```

在`test/agent_prefetch.test.js`增加：

```js
test('成长场景注入本地资料但其他场景不注入', () => {
  const profile = { grade: 'junior', major: '应用心理学', goal: '寻找实习' };
  const growth = prepareMessages(1, [{ role: 'user', content: '帮我规划' }], profile);
  assert.match(growth[0].content, /大三/);
  assert.match(growth[0].content, /应用心理学/);
  const mind = prepareMessages(2, [{ role: 'user', content: '我压力很大' }], profile);
  assert.doesNotMatch(mind[0].content, /应用心理学/);
});
```

- [ ] **Step 2：运行针对性测试并确认因资料未处理而失败**

Run: `node --test test/server.test.js test/agent_prefetch.test.js`  
Expected: FAIL，服务端未传递`profile`，Agent系统上下文不包含年级和专业。

- [ ] **Step 3：增加服务端资料校验**

在`server.js`增加：

```js
const PROFILE_GRADES = new Set(['', 'freshman', 'sophomore', 'junior', 'senior']);

function validateProfile(value) {
  if (value === undefined) return { ok: true, profile: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  const profile = {
    grade: typeof value.grade === 'string' ? value.grade : '',
    major: typeof value.major === 'string' ? value.major.trim() : '',
    goal: typeof value.goal === 'string' ? value.goal.trim() : '',
  };
  if (!PROFILE_GRADES.has(profile.grade) || profile.major.length > 40 || profile.goal.length > 120) {
    return { ok: false };
  }
  return { ok: true, profile };
}
```

在`POST /api/chat`的现有场景和历史校验后调用`validateProfile(body.profile)`，非法时返回400；调用Agent时使用`agentLoop(scene, history, scene === 1 ? profile : null)`。

- [ ] **Step 4：把资料作为成长场景的临时系统上下文**

将`agent.js`中函数签名改为：

```js
function formatProfileContext(scene, profile) {
  if (scene !== 1 || !profile) return '';
  const gradeLabels = {
    freshman: '大一', sophomore: '大二', junior: '大三', senior: '大四',
  };
  return `\n\n## 学生主动设置的当前资料\n` +
    `年级:${gradeLabels[profile.grade] || '未设置'}\n` +
    `专业:${profile.major || '未设置'}\n` +
    `当前目标:${profile.goal || '未设置'}\n` +
    '这些资料只用于当次学业与生涯建议；资料不完整时应先询问，不得猜测。';
}

function prepareMessages(scene, history, profile = null) {
  const basePrompt = SCENE_PROMPTS[scene];
  if (!basePrompt) throw new Error(`未知场景:${scene}`);

  const messages = [
    { role: 'system', content: basePrompt + formatProfileContext(scene, profile) },
    ...history.map(message => ({
      role: message.role,
      content: message.content,
    })),
  ];
  const latestUserMessage = [...history].reverse().find(message => message.role === 'user');

  if (latestUserMessage && shouldPrefetchHandbook(scene, latestUserMessage.content)) {
    const handbookContext = searchHandbook(latestUserMessage.content, 2);
    messages.push({
      role: 'user',
      content: `[系统强制预检索的校内制度依据]\n${handbookContext}\n\n` +
        '[回答约束]\n' +
        '1. 只能根据上述原文片段陈述校内制度，不得凭印象补全条件、流程或材料。\n' +
        '2. 使用手册信息时，必须标注制度全称、手册页码和PDF页码。\n' +
        '3. 不得声称无法获取已在上方提供的页码或制度。\n' +
        '4. 这是2023年7月版本，当年时间、名额、入口和联系方式仍须核验最新通知。\n' +
        '5. 先直接回答学生的核心问题，不得用通用办事模板取代所问的条件、标准或结论。\n\n' +
        `[待回答的原始问题]\n${latestUserMessage.content}`,
    });
  }

  return messages;
}
```

同时将`agentLoop`签名精确改为`async function agentLoop(scene, history, profile = null)`，并将其首行精确改为`const messages = prepareMessages(scene, history, profile);`；从`for (let round = 0; round < MAX_ROUNDS; round += 1)`开始的循环不改动。保留`formatProfileContext`为内部函数，只导出现有公开接口。

- [ ] **Step 5：运行服务端和Agent测试并确认通过**

Run: `node --test test/server.test.js test/agent_prefetch.test.js`  
Expected: 全部PASS，旧的两参数Agent测试仍可运行。

- [ ] **Step 6：提交资料输入边界**

```bash
git add server.js agent.js test/server.test.js test/agent_prefetch.test.js
git commit -m "feat: pass validated career context to the agent"
```

### Task 4：接入本地资料、历史恢复和年级化入口

**Files:**
- Modify: `test/frontend.test.js`
- Modify: `index.html`
- Modify: `js/chat.js`
- Modify: `css/styles.css`

- [ ] **Step 1：编写前端结构与持久化失败测试**

在`test/frontend.test.js`增加：

```js
test('我的页提供本地资料和历史管理', () => {
  const html = read('index.html');
  assert.match(html, /id="profileForm"/);
  assert.match(html, /id="gradeSelect"/);
  assert.match(html, /id="majorInput"/);
  assert.match(html, /id="goalInput"/);
  assert.match(html, /id="historyList"/);
  assert.match(html, /id="clearAllHistory"/);
  assert.match(html, /不等于学校账号/);
  assert.match(html, /心理对话不保存到本地历史/);
});

test('页面按依赖顺序加载本地模块', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('js/storage.js') < html.indexOf('js/chat.js'));
  assert.ok(html.indexOf('js/profile.js') < html.indexOf('js/chat.js'));
});

test('对话只持久化非心理模块并向成长请求附加资料', () => {
  const source = read('js/chat.js');
  assert.match(source, /persistCurrentSession/);
  assert.match(source, /this\.currentScene === 2/);
  assert.match(source, /profile:\s*this\.currentScene === 1/);
  assert.match(source, /renderHistoryList/);
  assert.match(source, /getCareerTrack/);
});
```

- [ ] **Step 2：运行前端测试并确认因页面和集成未实现而失败**

Run: `node --test test/frontend.test.js`  
Expected: FAIL，缺少资料表单、历史管理和脚本引用。

- [ ] **Step 3：更新我的页和脚本加载顺序**

在`index.html`的访客卡片后加入：

```html
<section class="profile-block local-profile-card">
  <div class="section-heading compact"><div><span>02 / LOCAL PROFILE</span><h2>本地资料</h2></div></div>
  <form id="profileForm" class="profile-form">
    <label for="gradeSelect">年级</label>
    <select id="gradeSelect" name="grade">
      <option value="">未设置</option><option value="freshman">大一</option>
      <option value="sophomore">大二</option><option value="junior">大三</option>
      <option value="senior">大四</option>
    </select>
    <label for="majorInput">专业</label>
    <input id="majorInput" name="major" maxlength="40" placeholder="例如：应用心理学">
    <label for="goalInput">当前目标</label>
    <textarea id="goalInput" name="goal" maxlength="120" rows="3" placeholder="例如：本学期找到对口实习"></textarea>
    <div id="careerTrack" class="career-track" aria-live="polite"></div>
    <button class="profile-save" type="submit">保存到当前设备</button>
  </form>
  <p class="local-only-note">资料仅保存在当前设备，不等于学校账号。在成长模块提问时，这些资料会随当次请求发送给AI。</p>
</section>

<section class="profile-block local-history-card">
  <div class="section-heading compact"><div><span>03 / HISTORY</span><h2>本地历史</h2></div></div>
  <div id="historyList" class="history-list"></div>
  <button id="clearAllHistory" class="clear-history" type="button">清除全部非心理历史</button>
  <p class="local-only-note">心理对话不保存到本地历史，刷新或关闭页面后不恢复。</p>
</section>
```

删除原`future-list`中已被新功能替代的“历史记录”和“年级与专业”占位项，保留“办理进度待学校系统接入”。在`js/chat.js`前按顺序加载`js/storage.js`和`js/profile.js`。

- [ ] **Step 4：在ChatApp中恢复本地状态并持久化允许的会话**

在构造函数中先读取本地状态：

```js
this.localStore = createLocalStateStore(window.localStorage);
const localState = this.localStore.load();
this.profile = localState.profile;
this.sessions = [localState.sessions[0], localState.sessions[1], [], localState.sessions[3]];
```

新增：

```js
persistCurrentSession() {
  if (this.currentScene === 2) return;
  if (!this.localStore.saveSession(this.currentScene, this.sessions[this.currentScene])) {
    this.toast('对话未能保存到当前设备');
  }
}
```

`addUserMessage`和`addAIMessage`在`options.save !== false`时，先推入内存数组，再调用`persistCurrentSession()`。回答反馈状态改变后也调用该方法。

- [ ] **Step 5：实现资料表单、生涯主题和历史操作**

`ChatApp.init()`缓存资料与历史DOM，填充现有资料，并绑定：

```js
saveLocalProfile(event) {
  event.preventDefault();
  const profile = {
    grade: this.gradeSelect.value,
    major: this.majorInput.value.trim().slice(0, 40),
    goal: this.goalInput.value.trim().slice(0, 120),
  };
  if (!this.localStore.saveProfile(profile)) {
    this.toast('资料未能保存到当前设备'); return;
  }
  this.profile = this.localStore.load().profile;
  this.renderCareerTrack();
  this.toast('本地资料已保存');
}

renderCareerTrack() {
  const track = getCareerTrack(this.profile.grade);
  this.careerTrack.textContent = `${track.version}·${track.topics.join('、') || '请先选择年级'}`;
}

getCurrentSceneConfig() {
  if (this.currentScene !== 1) return SCENES[this.currentScene];
  const track = getCareerTrack(this.profile.grade);
  return { ...SCENES[1], welcome: track.welcome, tabs: track.tabs, version: track.version };
}
```

`renderCurrentSession()`使用`getCurrentSceneConfig()`，且成长模块欢迎标签显示版本。`renderHistoryList()`为场景0、1、3各渲染恢复与删除按钮；删除前使用`window.confirm('只删除当前设备上的该模块历史，是否继续？')`。“清除全部”使用`window.confirm('将清除当前设备上的校园、成长和事务历史，是否继续？')`。

- [ ] **Step 6：仅在成长场景附加资料**

将`fetchAIReply`的请求体改为：

```js
body: JSON.stringify({
  scene: this.currentScene,
  history,
  profile: this.currentScene === 1 ? this.profile : undefined,
}),
```

- [ ] **Step 7：为资料和历史补充“校园事务服务台”样式**

在`css/styles.css`末尾增加`profile-form`、`career-track`、`history-list`、`history-item`、`profile-save`、`clear-history`和`local-only-note`样式。约束：

- 表单控件最小高度44px，正文对比度不低于现有界面。
- 生涯版本使用合师青绿色左边线，删除操作使用现有暗红色，不新增紫色渐变或通用仪表盘样式。
- 历史列表使用紧凑的档案条目而不是大卡片，在375px宽度下不产生横向滚动。

- [ ] **Step 8：运行前端和存储测试并确认通过**

Run: `node --test test/frontend.test.js test/local_storage.test.js test/profile.test.js`  
Expected: 全部PASS。

- [ ] **Step 9：提交本地资料与历史UI**

```bash
git add index.html js/chat.js css/styles.css test/frontend.test.js
git commit -m "feat: add local profile and recoverable history"
```

### Task 5：实现可降级的语音转文字

**Files:**
- Create: `test/voice.test.js`
- Create: `js/voice.js`
- Modify: `test/frontend.test.js`
- Modify: `index.html`
- Modify: `js/chat.js`
- Modify: `css/styles.css`

- [ ] **Step 1：编写语音控制器失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceController, voiceErrorMessage } = require('../js/voice');

test('浏览器无语音API时返回不支持状态', () => {
  const controller = createVoiceController({ root: {}, onTranscript() {}, onState() {}, onError() {} });
  assert.equal(controller.supported, false);
  assert.equal(controller.start(), false);
});

test('识别文字只交给输入框回调', () => {
  let instance;
  class FakeRecognition {
    constructor() { instance = this; }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  const transcripts = [];
  const controller = createVoiceController({
    root: { SpeechRecognition: FakeRecognition },
    onTranscript: text => transcripts.push(text), onState() {}, onError() {},
  });
  controller.start();
  instance.onresult({ results: [[{ transcript: '我想咨询转专业' }]] });
  assert.deepEqual(transcripts, ['我想咨询转专业']);
});

test('语音错误返回可操作的中文提示', () => {
  assert.match(voiceErrorMessage('not-allowed'), /麦克风权限/);
  assert.match(voiceErrorMessage('no-speech'), /未检测到语音/);
  assert.match(voiceErrorMessage('network'), /网络/);
});
```

- [ ] **Step 2：运行测试并确认因模块缺失而失败**

Run: `node --test test/voice.test.js`  
Expected: FAIL with `Cannot find module '../js/voice'`.

- [ ] **Step 3：实现语音控制器**

`js/voice.js`实现：

```js
function voiceErrorMessage(code) {
  const messages = {
    'not-allowed': '未获得麦克风权限，请在浏览器设置中允许后重试。',
    'service-not-allowed': '当前浏览器禁止语音识别，请改用文本输入。',
    'no-speech': '未检测到语音，请靠近麦克风后重试。',
    network: '语音识别网络异常，请改用文本输入。',
    aborted: '已停止语音输入。',
  };
  return messages[code] || '语音识别失败，请改用文本输入。';
}

function createVoiceController({ root = globalThis, onTranscript, onState, onError }) {
  const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  if (!Recognition) return { supported: false, start: () => false, stop: () => false, toggle: () => false };
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.continuous = false;
  let listening = false;
  recognition.onstart = () => { listening = true; onState('listening'); };
  recognition.onend = () => { listening = false; onState('idle'); };
  recognition.onresult = event => {
    const text = Array.from(event.results || [])
      .map(result => result?.[0]?.transcript || '').join('').trim();
    if (text) onTranscript(text);
  };
  recognition.onerror = event => { listening = false; onError(voiceErrorMessage(event.error)); };
  const start = () => { if (listening) return false; recognition.start(); return true; };
  const stop = () => { if (!listening) return false; recognition.stop(); return true; };
  return { supported: true, start, stop, toggle: () => listening ? stop() : start() };
}
```

文件末尾支持Node.js和浏览器导出。

- [ ] **Step 4：运行语音单元测试并确认通过**

Run: `node --test test/voice.test.js`  
Expected: 3 tests PASS.

- [ ] **Step 5：编写语音页面集成失败测试**

在`test/frontend.test.js`增加：

```js
test('输入区提供可降级的语音转文字', () => {
  const html = read('index.html');
  const source = read('js/chat.js');
  assert.match(html, /id="voiceBtn"/);
  assert.match(html, /id="voiceStatus"/);
  assert.ok(html.indexOf('js/voice.js') < html.indexOf('js/chat.js'));
  assert.match(source, /createVoiceController/);
  assert.match(source, /this\.msgInput\.value/);
  assert.doesNotMatch(source, /onTranscript:[^}]*handleSend\(/s);
});
```

- [ ] **Step 6：运行前端测试并确认因语音UI未接入而失败**

Run: `node --test test/frontend.test.js`  
Expected: FAIL，缺少`voiceBtn`、`voiceStatus`和控制器初始化。

- [ ] **Step 7：接入语音按钮与状态**

在输入框前增加：

```html
<button id="voiceBtn" class="voice-input" type="button" aria-label="开始语音输入" aria-pressed="false">
  <span aria-hidden="true">话</span>
</button>
<span id="voiceStatus" class="voice-status sr-only" role="status" aria-live="polite"></span>
```

在`js/chat.js`初始化：

```js
this.voiceBtn = document.getElementById('voiceBtn');
this.voiceStatus = document.getElementById('voiceStatus');
this.voiceController = createVoiceController({
  onTranscript: text => {
    const prefix = this.msgInput.value.trim();
    this.msgInput.value = [prefix, text].filter(Boolean).join('，');
    this.updateComposer();
    this.msgInput.focus();
    this.toast('语音已转为文字，请确认后发送');
  },
  onState: state => this.updateVoiceState(state),
  onError: message => { this.updateVoiceState('idle'); this.toast(message); },
});
if (!this.voiceController.supported) {
  this.voiceBtn.disabled = true;
  this.voiceBtn.title = '当前浏览器不支持语音转文字';
  this.voiceStatus.textContent = '当前浏览器不支持语音转文字，可继续使用文本输入。';
}
this.voiceBtn.addEventListener('click', () => this.voiceController.toggle());
```

`updateVoiceState('listening')`设置`aria-pressed="true"`、按钮文案“停”和状态“正在听……再次点击停止”；`idle`恢复“话”和“语音输入已停止”。开始发送AI请求时禁用语音按钮，请求结束后仅在支持语音时恢复。

- [ ] **Step 8：补充语音状态样式**

`voice-input`使用与首页服务印章一致的青绿线框，听写时改为暗红色实心并使用单次呼吸动画。在`prefers-reduced-motion: reduce`下沿用现有全局动画关闭规则。禁用态需保持可读，不完全隐藏语音能力信息。

- [ ] **Step 9：运行语音和前端测试并确认通过**

Run: `node --test test/voice.test.js test/frontend.test.js`  
Expected: 全部PASS。

- [ ] **Step 10：提交语音输入**

```bash
git add js/voice.js test/voice.test.js index.html js/chat.js css/styles.css test/frontend.test.js
git commit -m "feat: add editable voice-to-text input"
```

### Task 6：更新文档并完成系统验证

**Files:**
- Modify: `README.md`
- Modify: `progress/2026-07-19_产品优化需求梳理.md`

- [ ] **Step 1：运行完整自动化测试和语法检查**

Run:

```bash
npm test
node --check server.js
node --check agent.js
node --check js/storage.js
node --check js/profile.js
node --check js/voice.js
node --check js/chat.js
git diff --check
```

Expected: 所有测试0失败，所有语法检查退出码为0，`git diff --check`无输出。

- [ ] **Step 2：启动本地服务并验证静态安全边界**

Run: `npm start`  
Then verify:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3001/js/storage.js
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:3001/data/student_handbook.json
```

Expected: `js/storage.js`返回200，`data/student_handbook.json`返回404。

- [ ] **Step 3：在375×812真实浏览器视口验收主流程**

验收顺序：

1. 进入“我的”，保存大三、专业和目标，确认显示“行动版”。
2. 进入成长模块，确认快捷问题更新为实习、简历、院校方向和模拟面试。
3. 在校园、成长和事务各写入一条对话，刷新后确认仍可恢复。
4. 在心理模块写入一条对话，刷新后确认未恢复。
5. 用浏览器能力或可控测试替身验证语音文字只进入输入框，不自动发送。
6. 验证恢复、删除、全部清除、语音禁用态和底部导航不遮挡内容。

- [ ] **Step 4：使用真实星火API验证成长资料上下文**

发送场景1请求，`profile`为大三、应用心理学、寻找实习，问题为“我这学期先做什么？”。确认回答基于大三实习阶段，不猜测未提供的成绩、经历或就业意向。

- [ ] **Step 5：更新运行说明和第三阶段记录**

`README.md`补充：

- 本地资料的字段、保存位置与清除方法。
- 心理对话不持久化的边界。
- 浏览器语音识别的兼容性、音频不保存和文本确认流程。
- 真实账号、跨设备历史和办理进度仍未接入。

`progress/2026-07-19_产品优化需求梳理.md`增加“第三阶段本地体验版实施记录”，如实填写测试数量、视觉规格、真实API结果和仍未接入的外部系统。

- [ ] **Step 6：重新运行完整验证**

Run: `npm test && git diff --check`  
Expected: 所有测试0失败，无空白错误。

- [ ] **Step 7：提交文档与最终验收记录**

```bash
git add README.md progress/2026-07-19_产品优化需求梳理.md
git commit -m "docs: record local experience phase verification"
```

## 计划自检

- 规格中的本地资料、四年级生涯主题、非心理历史恢复、心理数据隔离、语音降级和完整验收均有对应任务。
- 数据字段、年级枚举、场景编号、存储键和方法名在各任务中保持一致。
- 计划不含待定参数、未定义方法或空白实现步骤。学校账号、办理进度和服务端音频处理被明确排除，不属于未完成项。
