const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('前端发送带角色的结构化历史', () => {
  const source = read('js/chat.js');
  assert.match(source, /role:\s*(?:msg|message)\.who === 'user' \? 'user' : 'assistant'/);
  assert.match(source, /content:\s*(?:msg|message)\.who === 'user'/);
  assert.doesNotMatch(source, /\.map\(msg =>\s*msg\.who === 'user'\s*\? msg\.text/);
});

test('心理提示词要求直接回应风险和立即转介', () => {
  const source = read('agent_prompts.js');
  assert.match(source, /直接回应风险/);
  assert.match(source, /立即转介/);
  assert.match(source, /不得编造热线/);
});

test('Agent不再根据数组奇偶推断角色', () => {
  const source = read('agent.js');
  assert.doesNotMatch(source, /i\s*%\s*2\s*===\s*0/);
  assert.match(source, /role:\s*message\.role/);
  assert.match(source, /content:\s*message\.content/);
});

test('页面不加载旧浏览器端模型配置', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /js\/(api|config)\.js/);
});

test('本地兜底不包含未经核验的校园时间和流程', () => {
  const source = read('js/scenes.js');
  assert.doesNotMatch(source, /8:00|22:30|3个学生食堂|今日校园/);
  assert.match(source, /暂时无法核验/);
});

test('危机表达会生成明确支持信息', () => {
  const source = read('js/chat.js');
  assert.match(source, /addCrisisSupportMessage/);
  assert.match(source, /请先不要独处/);
});

test('紧急求助界面提供可拨打且有来源的资源', () => {
  const html = read('index.html');
  assert.match(html, /href="tel:12356"/);
  assert.match(html, /href="tel:055163666903"/);
  assert.match(html, /nhc\.gov\.cn/);
  assert.match(html, /hfnu\.edu\.cn/);
});

test('危机识别覆盖中英文高风险表达且避免普通负面评价', () => {
  const { isCrisis } = require('../js/scenes');
  assert.equal(isCrisis('我真的不想活了'), true);
  assert.equal(isCrisis('I want to kill myself'), true);
  assert.equal(isCrisis('我准备跳桥'), true);
  assert.equal(isCrisis('这门课没意思'), false);
  assert.equal(isCrisis('这个程序死机了'), false);
});

test('页面提供服务首页、四模块和我的入口', () => {
  const html = read('index.html');
  assert.match(html, /id="homeScreen"/);
  assert.equal((html.match(/class="service-card/g) || []).length, 4);
  assert.match(html, /id="profileBtn"/);
  assert.match(html, /id="profileView"/);
  assert.match(html, /id="bottomNav"/);
});

test('底部导航不再堆叠四个业务场景', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /class="tabbar"/);
  assert.match(html, />首页</);
  assert.match(html, />对话</);
  assert.match(html, />求助</);
  assert.match(html, />我的</);
});

test('回答提供解决反馈、二次回应和人工转介', () => {
  const source = read('js/chat.js');
  assert.match(source, /addFeedbackActions/);
  assert.match(source, /requestSecondAnswer/);
  assert.match(source, /showHumanHandoff/);
  assert.match(source, /线上人工渠道尚未配置/);
});

test('场景切换会恢复各模块已有对话', () => {
  const source = read('js/chat.js');
  assert.match(source, /renderCurrentSession/);
  assert.match(source, /save:\s*false/);
});
