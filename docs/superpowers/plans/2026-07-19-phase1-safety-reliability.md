# 第一阶段安全与可靠性优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复当前项目的密钥暴露、服务端请求伪造、校园信息失真和心理危机处置缺口，并统一实际生效的前后端对话链路。

**Architecture:** 保留Node.js原生HTTP服务和星火WebSocket调用，不引入新的运行时框架。服务端采用公开文件白名单、结构化请求校验和受限网页抓取；前端只调用`/api/chat`，危机表达同时触发明确回应和紧急求助界面。

**Tech Stack:** Node.js 26、`node:test`、`ws`、`cheerio`、原生HTML/CSS/JavaScript

---

## 文件结构

- `server.js`：创建HTTP服务、校验聊天请求、限制公开静态文件并设置安全响应头。
- `agent.js`：接收带角色的结构化历史，调用星火并处理连接异常。
- `agent_tools.js`：提供受限网页搜索、时间查询和安全网页抓取。
- `agent_prompts.js`：约束事实来源和心理危机回应。
- `js/chat.js`：构造结构化会话历史，展示危机回应和错误状态。
- `js/scenes.js`：仅保留安全的本地兜底内容，删除未经核验的学校信息。
- `index.html`：更新紧急求助内容，加载唯一有效的前端脚本。
- `js/api.js`、`js/config.js`：删除未被页面加载的旧浏览器端模型调用代码。
- `test/server.test.js`：验证静态文件白名单、请求体限制和聊天参数校验。
- `test/agent_tools.test.js`：验证URL限制、时间格式和网页响应限制。
- `test/frontend.test.js`：验证页面不再加载旧调用代码，危机流程具备明确回应。

### Task 1：建立测试入口和服务端安全边界

**Files:**
- Modify: `package.json`
- Modify: `server.js`
- Create: `test/server.test.js`

- [x] **Step 1：添加失败测试**

在`test/server.test.js`中使用临时监听端口请求服务：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppServer } = require('../server');

async function withServer(run) {
  const server = createAppServer({ agentLoop: async () => '测试回复' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('只公开前端资源，不公开环境变量和服务端源码', async () => {
  await withServer(async baseUrl => {
    assert.equal((await fetch(`${baseUrl}/`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/css/styles.css`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/.env`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/server.js`)).status, 404);
  });
});

test('拒绝非法聊天参数', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene: 8, history: [] })
    });
    assert.equal(response.status, 400);
  });
});
```

- [x] **Step 2：运行测试并确认失败**

Run: `node --test test/server.test.js`  
Expected: FAIL，提示`createAppServer`未导出或`/.env`返回200。

- [x] **Step 3：实现公开文件白名单和请求校验**

在`server.js`中导出`createAppServer`，仅允许`index.html`、`manifest.json`及`assets/`、`css/`、`js/`目录；拒绝点文件、源码和路径穿越。聊天接口要求`scene`为0至3的整数，`history`最多20条，每条为`{role, content}`，其中`role`只能是`user`或`assistant`，`content`为非空且不超过8000字符的字符串。请求体上限设为256KB，错误响应不返回内部异常详情。

核心接口：

```js
function createAppServer({ agentLoop: runAgent = agentLoop } = {}) { /* ... */ }
function resolvePublicFile(requestUrl) { /* 返回绝对路径或null */ }
function validateChatPayload(payload) { /* 返回规范化参数或抛出400错误 */ }
module.exports = { createAppServer, resolvePublicFile, validateChatPayload };
```

所有响应设置`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`和仅允许本站资源的CSP。

- [x] **Step 4：补充测试脚本并运行测试**

在`package.json`中增加：

```json
"test": "node --test"
```

Run: `npm test`  
Expected: PASS。

### Task 2：限制网页抓取并修正北京时间

**Files:**
- Modify: `agent_tools.js`
- Create: `test/agent_tools.test.js`

- [x] **Step 1：添加失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExternalUrl, get_current_time } = require('../agent_tools');

test('网页抓取拒绝本机和内网地址', async () => {
  await assert.rejects(() => validateExternalUrl('http://127.0.0.1:3001'));
  await assert.rejects(() => validateExternalUrl('http://localhost'));
  await assert.rejects(() => validateExternalUrl('http://169.254.169.254'));
});

test('网页抓取只接受HTTP和HTTPS', async () => {
  await assert.rejects(() => validateExternalUrl('file:///etc/passwd'));
});

test('北京时间中的日期和星期来自同一时区', () => {
  const result = get_current_time(new Date('2026-07-20T06:30:00Z'));
  assert.match(result, /^2026年7月20日 星期一 14:30 CST$/);
});
```

- [x] **Step 2：运行测试并确认失败**

Run: `node --test test/agent_tools.test.js`  
Expected: FAIL，提示辅助函数未导出或星期计算不一致。

- [x] **Step 3：实现URL验证和响应限制**

`validateExternalUrl`应拒绝非HTTP协议、URL凭据、`localhost`、`.local`、`.internal`、回环、私网、链路本地和未指定地址；通过`dns.promises.lookup(hostname, { all: true })`检查域名解析结果。`fetch_url`禁用自动重定向，只接受HTML或纯文本，限制响应正文为1MB、最终提取文本为3000字。`search_web`限制查询长度为200字符。

时间函数改为：

```js
function get_current_time(now = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  // 从同一组parts生成日期、星期和时间
}
```

- [x] **Step 4：运行测试**

Run: `npm test`  
Expected: PASS。

### Task 3：统一结构化对话历史并加固星火连接

**Files:**
- Modify: `agent.js`
- Modify: `js/chat.js`
- Modify: `agent_prompts.js`
- Create: `test/frontend.test.js`

- [x] **Step 1：添加失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('前端发送带角色的结构化历史', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/chat.js'), 'utf8');
  assert.match(source, /role:\s*msg\.who === 'user' \? 'user' : 'assistant'/);
  assert.doesNotMatch(source, /map\(msg =>\s*msg\.who === 'user'\s*\? msg\.text/);
});

test('心理提示词要求明确回应和立即转介', () => {
  const source = fs.readFileSync(path.join(__dirname, '../agent_prompts.js'), 'utf8');
  assert.match(source, /直接回应风险/);
  assert.match(source, /立即转介/);
});
```

- [x] **Step 2：运行测试并确认失败**

Run: `node --test test/frontend.test.js`  
Expected: FAIL，当前前端仍发送纯文本数组。

- [x] **Step 3：统一历史格式**

`js/chat.js`发送：

```js
const history = this.sessions[this.currentScene].slice(-20).map(msg => ({
  role: msg.who === 'user' ? 'user' : 'assistant',
  content: msg.who === 'user' ? msg.text : this.replyToPlainText(msg.parts)
}));
```

`agent.js`直接保留经过服务端验证的`role`和`content`，不再根据数组奇偶推断角色。WebSocket在未产生完整内容时提前关闭应立即拒绝，而不是等待60秒超时。

心理提示词要求：识别高风险表达后直接回应风险，建议用户不要独处并立即联系现实支持；在官方资源未核验时不得编造热线。

- [x] **Step 4：运行测试**

Run: `npm test`  
Expected: PASS。

### Task 4：替换不实兜底信息并完善前端危机流程

**Files:**
- Modify: `js/scenes.js`
- Modify: `js/chat.js`
- Modify: `index.html`
- Delete: `js/api.js`
- Delete: `js/config.js`

- [x] **Step 1：扩展前端失败测试**

```js
test('页面不加载旧浏览器端模型配置', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /js\/(api|config)\.js/);
});

test('本地兜底不包含未经核验的校园时间和流程', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/scenes.js'), 'utf8');
  assert.doesNotMatch(source, /8:00|22:30|三个学生食堂|今日校园/);
  assert.match(source, /暂时无法核验/);
});

test('危机表达会生成明确支持信息', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/chat.js'), 'utf8');
  assert.match(source, /addCrisisSupportMessage/);
});
```

- [x] **Step 2：运行测试并确认失败**

Run: `node --test test/frontend.test.js`  
Expected: FAIL，兜底规则仍含固定开放时间，危机分支仅弹窗。

- [x] **Step 3：实现安全兜底和明确危机回应**

校园与事务兜底统一说明“当前暂时无法核验学校最新信息，请稍后重试或联系对应部门”，不得显示推测的时间、地点和流程。危机表达触发时，先在对话中展示明确支持信息，再打开紧急求助界面；紧急界面只展示经核验的资源，未核验的安徽省及学校号码不写入页面。

保留`110`和`120`等依法通用的紧急服务入口，并在联网核验后补充安徽省和学校资源。拨打按钮使用实际`tel:`链接，不再只显示Toast。

删除未被`index.html`加载的`js/api.js`和`js/config.js`，浏览器端不保存模型密钥。

- [x] **Step 4：运行测试**

Run: `npm test`  
Expected: PASS。

### Task 5：端到端验证和文档更新

**Files:**
- Modify: `.env.example`
- Create: `README.md`
- Modify: `progress/2026-07-19_产品优化需求梳理.md`

- [x] **Step 1：补充运行说明**

README写明Node.js版本、环境变量、启动命令、测试命令、公开路径、安全限制和心理危机资源维护要求；不得写入真实密钥。

- [x] **Step 2：执行自动化检查**

Run: `npm test`  
Expected: 所有测试PASS。

Run: `node --check server.js && node --check agent.js && node --check agent_tools.js && node --check js/chat.js && node --check js/scenes.js`  
Expected: 无输出，退出码0。

- [x] **Step 3：执行服务端冒烟验证**

启动服务后验证：

```text
GET /                  -> 200
GET /.env              -> 404
GET /server.js         -> 404
GET /js/chat.js        -> 200
POST /api/chat非法参数 -> 400
```

- [x] **Step 4：更新进度记录**

在需求文档末尾增加“第一阶段实施记录”，列出完成项、测试结果和仍需学校确认的人工转介及心理资源。

## 计划自检

- 需求覆盖：包含第一阶段的静态文件安全、请求校验、网页抓取、事实来源、危机处置和调用链统一。
- 范围限制：注册登录、服务首页重构、语音输入和学生交流区不在本计划内，留待后续独立计划。
- 一致性：前端和服务端统一使用`{role, content}`历史格式；所有测试使用Node.js内置测试运行器。
- 占位扫描：无TBD、TODO或未定义的实施步骤。
