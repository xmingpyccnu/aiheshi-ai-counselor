# 第二阶段首页、反馈闭环与学生手册检索实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前四标签聊天页升级为“服务首页+四个模块+我的入口”，为AI回答增加二次回应与人工转介提示，并让学生管理类问题可检索《2023合师学生手册》原文及页码。

**Architecture:** 前端继续使用原生HTML、CSS和JavaScript，以首页、对话、求助、我的四个视图组织移动端界面；四张服务卡负责选择业务场景。服务端新增只读学生手册索引和`search_handbook`工具，模型先检索本地制度再回答，并明确2023版手册的时效限制。

**Tech Stack:** Node.js 26、`node:test`、原生HTML/CSS/JavaScript、Poppler离线提取、星火4.0Ultra

---

## 文件结构

- `scripts/build_handbook_index.js`：从PDF提取分页文本并生成部署可用的JSON索引。
- `data/student_handbook.json`：学生手册分页正文和来源元数据，不通过静态服务公开。
- `handbook_search.js`：查询扩展、中文分词、相关页排序和引用片段生成。
- `agent_tools.js`：注册`search_handbook`并解析工具调用。
- `agent_prompts.js`：要求学生管理类问题先查手册，再核对最新通知。
- `index.html`：服务首页、四模块卡、我的面板、反馈和转介弹层的语义结构。
- `js/app.js`：启动页进入服务首页。
- `js/chat.js`：视图导航、场景切换、历史重绘、反馈状态和二次回应。
- `js/scenes.js`：四模块展示数据和年级化服务摘要。
- `css/styles.css`：校园服务台风格的响应式首页和反馈组件。
- `test/handbook_search.test.js`：验证转专业、奖助、宿舍和违纪检索及页码。
- `test/frontend.test.js`：验证首页、模块入口、我的入口和两级反馈流程。

### Task 1：生成学生手册分页索引

**Files:**
- Create: `scripts/build_handbook_index.js`
- Create: `data/student_handbook.json`
- Create: `handbook_search.js`
- Create: `test/handbook_search.test.js`

- [ ] **Step 1：编写失败测试**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchHandbook } = require('../handbook_search');

test('转专业问题命中校内转专业办法', () => {
  const result = searchHandbook('本科生转专业需要什么条件');
  assert.match(result, /普通本科学生转专业实施办法/);
  assert.match(result, /手册第55/);
});

test('宿舍问题命中公寓住宿管理办法', () => {
  const result = searchHandbook('学生宿舍住宿管理规定');
  assert.match(result, /学生公寓住宿管理办法/);
  assert.match(result, /手册第187/);
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `node --test test/handbook_search.test.js`  
Expected: FAIL，提示`handbook_search`不存在。

- [ ] **Step 3：生成索引并实现查询**

生成脚本调用`pdftotext -layout`，按换页符拆分274个PDF页面；正文PDF第7页对应手册第1页。JSON保存`pdfPage`、`printedPage`、`section`、`documentTitle`和清洗后的`text`。

`searchHandbook(query, limit = 4)`使用`Intl.Segmenter`和同义词扩展进行排序，返回制度名称、手册页码、PDF页码和不超过700字的原文片段。无结果时返回“未在《2023合师学生手册》中找到直接依据”。

- [ ] **Step 4：运行检索测试**

Run: `node --test test/handbook_search.test.js`  
Expected: PASS。

### Task 2：把学生手册注册为Agent工具

**Files:**
- Modify: `agent_tools.js`
- Modify: `agent_prompts.js`
- Modify: `test/agent_tools.test.js`

- [ ] **Step 1：添加工具解析测试**

```js
test('解析并执行学生手册检索工具', async () => {
  const { toolResults } = parseAndExecTools(
    '<tool_call><name>search_handbook</name><query>转专业条件</query></tool_call>'
  );
  await resolvePending(toolResults);
  assert.match(toolResults[0].result, /转专业/);
  assert.match(toolResults[0].result, /2023合师学生手册/);
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `node --test test/agent_tools.test.js`  
Expected: FAIL，工具尚未注册。

- [ ] **Step 3：注册工具并约束引用**

在`TOOLS`中加入`search_handbook`。提示词要求学生管理、学籍教学、奖助评优、违纪、宿舍安全、团务、党员发展和其他校规问题先调用该工具；回答必须写出制度名称和页码，并提示手册为2023版。涉及当前申请时间、金额、系统入口和联系方式时继续查最新官方通知。

- [ ] **Step 4：运行全部服务端测试**

Run: `npm test`  
Expected: PASS。

### Task 3：实现服务首页和四模块导航

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `js/chat.js`
- Modify: `js/scenes.js`
- Modify: `css/styles.css`
- Modify: `test/frontend.test.js`

- [ ] **Step 1：添加首页结构失败测试**

```js
test('页面提供服务首页、四模块和我的入口', () => {
  const html = read('index.html');
  assert.match(html, /id="homeScreen"/);
  assert.equal((html.match(/class="service-card/g) || []).length, 4);
  assert.match(html, /id="profileBtn"/);
  assert.match(html, /id="bottomNav"/);
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `node --test test/frontend.test.js`  
Expected: FAIL，当前页面只有聊天视图。

- [ ] **Step 3：实现首页和视图导航**

首页采用“校园事务服务台”视觉方向：暖白纸张背景、合师青绿主色、赭黄色强调、宋体标题和清晰编号。四张卡分别为校园生活、学业与生涯成长、心理陪伴、事务办理；点击后打开对应场景并保留各场景历史。

底部导航仅保留首页、对话、求助、我的。我的视图显示访客状态、四模块对话数量和“登录功能将在账户阶段接入”，不伪造已完成的注册能力。

- [ ] **Step 4：运行前端静态测试**

Run: `node --test test/frontend.test.js`  
Expected: PASS。

### Task 4：实现回答反馈、二次回应和转介提示

**Files:**
- Modify: `js/chat.js`
- Modify: `index.html`
- Modify: `css/styles.css`
- Modify: `test/frontend.test.js`

- [ ] **Step 1：添加反馈状态测试**

```js
test('回答提供已解决和未解决反馈', () => {
  const source = read('js/chat.js');
  assert.match(source, /addFeedbackActions/);
  assert.match(source, /requestSecondAnswer/);
  assert.match(source, /showHumanHandoff/);
});
```

- [ ] **Step 2：运行测试确认失败**

Run: `node --test test/frontend.test.js`  
Expected: FAIL，当前回答没有反馈操作。

- [ ] **Step 3：实现两级反馈**

每条正常AI回答显示“已解决”和“未解决”。首次未解决时，系统把原问题、原回答和“请补充依据、步骤或替代方案”的要求作为新一轮请求；第二次回答仍未解决时显示人工转介面板。

学校尚未提供真实线上转介渠道，因此面板明确说明“线上人工渠道尚未配置”，提供复制问题摘要和联系所在学院辅导员的操作建议，不展示虚构电话、在线值班或工单状态。

- [ ] **Step 4：运行前端测试**

Run: `npm test`  
Expected: PASS。

### Task 5：视觉、运行和真实问答验证

**Files:**
- Modify: `README.md`
- Modify: `progress/2026-07-19_产品优化需求梳理.md`

- [ ] **Step 1：运行代码检查**

Run: `npm test && node --check server.js && node --check handbook_search.js && node --check js/chat.js`  
Expected: 全部通过。

- [ ] **Step 2：浏览器视觉检查**

在375×812和桌面视口检查首页、四张卡、聊天、紧急求助、我的面板和反馈按钮。确认无文字裁切、遮挡、不可滚动或低对比度问题。

- [ ] **Step 3：真实对话验证**

向事务场景提问“本科生转专业需要什么条件”，确认星火回复中包含《2023合师学生手册》制度名称和页码，并提醒核对最新通知。

- [ ] **Step 4：更新文档和进度**

README说明手册索引重建命令、版本边界和反馈转介限制；进度文档记录测试数量、视觉结果和真实问答结果。

## 计划自检

- 本计划覆盖已确认的服务首页、四模块、我的入口、二次回应、人工转介提示和学生手册引用。
- 登录认证、语音输入和真实人工工单依赖外部系统，继续留在第三阶段。
- 本地手册工具固定返回制度名称、手册页码和PDF页码，提示词不得把2023版描述为现行最新政策。
- 无TBD、TODO或未定义的实施步骤。
