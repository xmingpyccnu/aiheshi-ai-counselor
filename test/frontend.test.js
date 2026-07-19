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
  assert.match(source, /content:\s*\((?:msg|message)\.who === 'user'/);
  assert.doesNotMatch(source, /\.map\(msg =>\s*msg\.who === 'user'\s*\? msg\.text/);
});

test('聊天接口使用相对路径以支持部署在子目录', () => {
  const source = read('js/chat.js');
  assert.match(source, /fetch\('api\/chat'/);
  assert.doesNotMatch(source, /fetch\('\/api\/chat'/);
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
  const source = read('js/chat.js');
  assert.match(html, /href="tel:12356"/);
  assert.match(html, /href="tel:055163666903"/);
  assert.match(html, /nhc\.gov\.cn/);
  assert.match(html, /hfnu\.edu\.cn/);
  assert.doesNotMatch(html, /id="fabBtn"/);
  assert.doesNotMatch(source, /fabBtn/);
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

test('我的页提供本地资料和可恢复历史入口', () => {
  const html = read('index.html');
  assert.match(html, /<form[^>]+id="profileForm"/);
  assert.match(html, /<select[^>]+id="gradeSelect"/);
  assert.match(html, /value="freshman"[^>]*>大一/);
  assert.match(html, /value="sophomore"[^>]*>大二/);
  assert.match(html, /value="junior"[^>]*>大三/);
  assert.match(html, /value="senior"[^>]*>大四/);
  assert.match(html, /<input[^>]+id="majorInput"[^>]+maxlength="40"/);
  assert.match(html, /<textarea[^>]+id="goalInput"[^>]+maxlength="120"/);
  assert.match(html, /id="careerTrack"[^>]+aria-live="polite"/);
  assert.match(html, />保存到当前设备</);
  assert.match(html, /id="historyList"/);
  assert.match(html, /id="clearAllHistory"/);
  assert.match(html, /id="msgInput"[^>]+maxlength="8000"/);
  assert.match(html, /资料仅保存在当前设备，不等于学校账号。/);
  assert.match(html, /在成长模块提问时，这些资料会随当次请求发送给AI。/);
  assert.match(html, /心理对话不保存到本地历史，刷新或关闭页面后不恢复。/);
  assert.doesNotMatch(html, /<span>历史记录<\/span>/);
  assert.doesNotMatch(html, /<span>年级与专业<\/span>/);
  assert.match(html, /<span>办理进度<\/span><small>待学校系统接入<\/small>/);
});

test('本地存储和年级资料模块在对话脚本前按顺序加载', () => {
  const html = read('index.html');
  const storageIndex = html.indexOf('<script src="js/storage.js"></script>');
  const profileIndex = html.indexOf('<script src="js/profile.js"></script>');
  const chatIndex = html.indexOf('<script src="js/chat.js"></script>');
  assert.ok(storageIndex >= 0);
  assert.ok(profileIndex > storageIndex);
  assert.ok(chatIndex > profileIndex);
});

test('对话初始化恢复非心理历史并接入年级化欢迎语', () => {
  const source = read('js/chat.js');
  assert.match(source, /this\.localStore\s*=\s*createLocalStateStore\(window\.localStorage\)/);
  assert.match(source, /const localState\s*=\s*await this\.localStore\.load\(\)/);
  assert.match(source, /this\.profile\s*=\s*localState\.profile/);
  assert.match(source, /this\.sessions\s*=\s*\[\s*localState\.sessions\[0\],\s*localState\.sessions\[1\],\s*\[\],\s*localState\.sessions\[3\]\s*\]/s);
  assert.match(source, /getCurrentSceneConfig\(\)/);
  assert.match(source, /getCareerTrack\(this\.profile\.grade\)/);
  assert.match(source, /version/);
  assert.match(source, /renderCareerTrack\(\)/);
});

test('对话仅持久化非心理模块且反馈状态会同步', () => {
  const source = read('js/chat.js');
  assert.match(source, /persistCurrentSession\(targetScene\s*=\s*this\.currentScene\)/);
  assert.match(source, /if\s*\(targetScene\s*===\s*2\)\s*\{[\s\S]*revision:\s*null[\s\S]*return result;[\s\S]*\}/);
  assert.match(source, /this\.localStore\.saveSession\([\s\S]*targetScene,[\s\S]*normalized,[\s\S]*this\.getSceneRevision\(targetScene\)/);
  assert.match(source, /this\.sessions\[targetScene\]\.push\(message\);\s*this\.sessions\[targetScene\]\s*=\s*this\.localStore\.normalizeSession\([\s\S]*const persistenceResult\s*=\s*await this\.persistCurrentSession\(targetScene\);\s*this\.notePersistenceResult\(persistenceResult\)/s);
  assert.match(source, /message\.feedbackStatus\s*=\s*'resolved';[\s\S]*this\.persistCurrentSession\(targetScene\)/);
  assert.match(source, /message\.feedbackStatus\s*=\s*'unresolved';[\s\S]*this\.persistCurrentSession\(targetScene\)/);
});

test('仅成长请求带本地资料并提供历史管理', () => {
  const source = read('js/chat.js');
  assert.match(source, /profile:\s*requestScene\s*===\s*1\s*\?\s*this\.profile\s*:\s*undefined/);
  assert.match(source, /renderHistoryList\(\)/);
  assert.match(source, /clearSession\(sceneIndex,\s*this\.getSceneRevision\(sceneIndex\)\)/);
  assert.match(source, /clearAllSessions\(\{\s*\.\.\.this\.sessionRevisions\s*\}\)/);
  assert.match(source, /只删除当前设备上的该模块历史，是否继续？/);
  assert.match(source, /将清除当前设备上的校园、成长和事务历史，是否继续？/);
  assert.doesNotMatch(source, /(?:profile|major|goal|grade)[^\n]{0,80}\.innerHTML\s*=/i);
});

test('删除本地历史后会同步当前对话界面', () => {
  const source = read('js/chat.js');
  assert.match(source, /this\.sessions\[sceneIndex\]\s*=\s*\[\];\s*this\.sessionRevisions\[sceneIndex\]\s*=\s*result\.revision;[\s\S]*if\s*\(this\.currentScene\s*===\s*sceneIndex\)\s*this\.renderCurrentSession\(\)/s);
  assert.match(source, /this\.sessions\[3\]\s*=\s*\[\];\s*this\.sessionRevisions\s*=\s*result\.revisions;[\s\S]*if\s*\(this\.currentScene\s*!==\s*2\)\s*this\.renderCurrentSession\(\)/s);
});

test('本地历史动态按钮标明模块且删除后转移焦点', () => {
  const source = read('js/chat.js');
  assert.match(source, /restore\.setAttribute\('aria-label',\s*`恢复\$\{sceneName\}对话`\)/);
  assert.match(source, /remove\.setAttribute\('aria-label',\s*`删除\$\{sceneName\}本地历史`\)/);
  assert.match(source, /this\.historyList\.focus\(\)/);
});

test('前端监听跨标签存储变化并按请求revision作废迟到回复', () => {
  const source = read('js/chat.js');
  assert.match(source, /window\.addEventListener\('storage',\s*event\s*=>\s*\{\s*void this\.handleStorageEvent\(event\);\s*\}\)/);
  assert.match(source, /sessionRevisions/);
  assert.match(source, /requestRevision/);
  assert.match(source, /handleStorageEvent\(event\)/);
});

test('本地资料和历史控件有暖纸风格与可见焦点', () => {
  const css = read('css/styles.css');
  for (const className of [
    'profile-form', 'career-track', 'history-list', 'history-item',
    'profile-save', 'clear-history', 'local-only-note',
  ]) {
    assert.match(css, new RegExp(`\\.${className}\\b`));
  }
  assert.match(css, /\.profile-form[\s\S]*min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /linear-gradient\([^)]*(?:#?8b5cf6|#?7c3aed|purple)/i);
});

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

test('语音按钮具备听写状态、禁用态和减少动效适配', () => {
  const html = read('index.html');
  const css = read('css/styles.css');
  const source = read('js/chat.js');
  const listeningRule = css.match(/\.voice-input\.listening\s*\{([^}]+)\}/);
  assert.match(html, /id="voiceBtn"[\s\S]*?<span[^>]*>语音<\/span>/);
  assert.match(css, /\.voice-input\b/);
  assert.match(css, /\.voice-input\.listening\b/);
  assert.match(css, /\.voice-input:disabled\b/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /正在听/);
  assert.match(source, /listening\s*\?\s*'停止'\s*:\s*'语音'/);
  assert.match(source, /this\.voiceBtn\.disabled\s*=\s*this\.isProcessing/);
  assert.ok(listeningRule);
  assert.match(listeningRule[1], /animation:/);
  assert.doesNotMatch(listeningRule[1], /infinite/);
});

test('语音输入附近用简短文案明示处理方、联网与音频保存边界', () => {
  const html = read('index.html');
  const notice = html.match(/<p[^>]+id="voiceNotice"[^>]*>([^<]+)<\/p>/);
  assert.ok(notice, '缺少可见的语音隐私和兼容性说明');
  assert.match(notice[0], /class="voice-privacy-note"/);
  assert.doesNotMatch(notice[0], /sr-only|hidden/);
  assert.match(notice[1], /浏览器或系统服务处理/);
  assert.match(notice[1], /可能联网/);
  assert.match(notice[1], /本应用不保存音频/);
  assert.ok(notice[1].length <= 30, '语音说明应保持单行简短');
  assert.match(html, /id="voiceBtn"[^>]+aria-describedby="[^"]*voiceNotice[^"]*"/);
});

test('语音说明在移动输入区低干扰换行且保持可读', () => {
  const css = read('css/styles.css');
  assert.match(css, /\.voice-privacy-note\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.voice-privacy-note\s*\{[\s\S]*?max-width:\s*100%/);
  assert.match(css, /\.voice-privacy-note\s*\{[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.voice-privacy-note\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
});

test('语音不支持提示精简且不参与输入行布局', () => {
  const html = read('index.html');
  const css = read('css/styles.css');
  const source = read('js/chat.js');
  const status = html.match(/<span[^>]+id="voiceStatus"[^>]*>/)?.[0] || '';
  const button = html.match(/<button[^>]+id="voiceBtn"[^>]*>/)?.[0] || '';

  assert.doesNotMatch(status, /sr-only|hidden/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.match(button, /aria-describedby="[^"]*voiceStatus[^"]*"/);
  assert.match(css, /\.voice-status:empty\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.input-bar\s*\{[\s\S]*?display:\s*grid/);
  assert.match(css, /\.input-bar\s*\{[\s\S]*?grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)\s+44px/);
  assert.match(css, /\.input-bar textarea\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.voice-status\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(css, /\.voice-status\s*\{[\s\S]*?top:\s*10px/);
  assert.match(css, /\.voice-status\s*\{[\s\S]*?bottom:\s*auto/);
  assert.match(source, /不支持语音，请使用文字输入/);
  assert.doesNotMatch(source, /当前浏览器不支持语音转文字，可继续使用文本输入。/);
});
