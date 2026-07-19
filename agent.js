// Agent 循环 —— 模型与工具的桥接层，最多7轮

const crypto = require('crypto');
const WebSocket = require('ws');
const { SCENE_PROMPTS } = require('./agent_prompts');
const { parseAndExecTools, resolvePending } = require('./agent_tools');

// ---- 星火 API 配置 ----
const SPARK_CONFIG = {
  appId: process.env.SPARK_APP_ID,
  apiKey: process.env.SPARK_API_KEY,
  apiSecret: process.env.SPARK_API_SECRET,
  host: 'spark-api.xf-yun.com',
  path: '/v4.0/chat',
  domain: '4.0Ultra',
};

const MAX_ROUNDS = 7;

// ---- 星火鉴权 ----
function generateAuthUrl() {
  const missing = ['SPARK_APP_ID', 'SPARK_API_KEY', 'SPARK_API_SECRET']
    .filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`缺少星火API配置: ${missing.join(', ')}`);
  }
  const date = new Date().toUTCString();
  const sigOrigin = `host: ${SPARK_CONFIG.host}\ndate: ${date}\nGET ${SPARK_CONFIG.path} HTTP/1.1`;
  const hmac = crypto.createHmac('sha256', SPARK_CONFIG.apiSecret);
  hmac.update(sigOrigin);
  const sig = hmac.digest('base64');
  const authOrigin = `api_key="${SPARK_CONFIG.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${sig}"`;
  const auth = Buffer.from(authOrigin).toString('base64');
  return `wss://${SPARK_CONFIG.host}${SPARK_CONFIG.path}?authorization=${encodeURIComponent(auth)}&date=${encodeURIComponent(date)}&host=${SPARK_CONFIG.host}`;
}

// ---- 调用星火 API ----
function callSpark(messages) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(generateAuthUrl());
    let full = '';
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error('星火API超时(60s)')); }
    }, 60000);

    ws.on('open', () => {
      const request = {
        header: { app_id: SPARK_CONFIG.appId },
        parameter: { chat: { domain: SPARK_CONFIG.domain, temperature: 0.5, max_tokens: 1024 } },
        payload: { message: { text: messages } }
      };
      ws.send(JSON.stringify(request));
    });

    ws.on('message', (data) => {
      try {
        const p = JSON.parse(data.toString());
        if (p.header.code !== 0) {
          if (!done) { done = true; clearTimeout(t); ws.close(); reject(new Error(`API ${p.header.code}: ${p.header.message}`)); }
          return;
        }
        const txt = p.payload?.choices?.text;
        if (txt) full += txt.map(c => c.content).join('');
        if (p.payload?.choices?.status === 2 && !done) { done = true; clearTimeout(t); resolve(full); }
      } catch (_) {}
    });

    ws.on('error', (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } });
    ws.on('close', () => { if (!done && full) { done = true; clearTimeout(t); resolve(full + '\n[连接提前关闭]'); } });
  });
}

// ---- 格式化工具结果注入对话 ----
function formatToolResults(results) {
  if (results.length === 0) return '';
  return '\n\n[工具执行结果]\n' + results.map(r =>
    `工具 ${r.name} 返回:\n${r.result}`
  ).join('\n\n') + '\n[工具结果结束]';
}

// ---- Agent 主循环 ----
async function agentLoop(scene, history) {
  const systemPrompt = SCENE_PROMPTS[scene];
  if (!systemPrompt) throw new Error(`未知场景: ${scene}`);

  const messages = [
    { role: 'system', content: systemPrompt },
    // 将对话历史转为 API 格式
    ...history.map((h, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: h
    }))
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    console.log(`[Agent] 第 ${round + 1}/${MAX_ROUNDS} 轮，消息数: ${messages.length}`);

    const rawResponse = await callSpark(messages);
    console.log(`[Agent] 模型原始输出长度: ${rawResponse.length} 字符`);

    // 解析工具调用
    const { toolResults, remainingText } = parseAndExecTools(rawResponse);

    if (toolResults.length === 0) {
      // 没有工具调用 → 这就是最终回答
      return remainingText || rawResponse;
    }

    // 等待异步工具执行完成
    await resolvePending(toolResults);

    // 打印工具调用日志
    for (const tr of toolResults) {
      console.log(`[Agent] 工具 ${tr.name}: ${tr.result.substring(0, 100)}...`);
    }

    // 将模型输出（去掉工具标签）+ 工具结果注入对话
    const toolResultText = formatToolResults(toolResults);
    messages.push({ role: 'assistant', content: remainingText || '正在查询信息...' });
    messages.push({ role: 'user', content: toolResultText });

    // 最后一轮强制要求给出最终答案
    if (round >= MAX_ROUNDS - 2) {
      messages.push({
        role: 'user',
        content: '请基于以上所有信息，直接给出最终回答。不要再调用工具。'
      });
    }
  }

  // 超过最大轮数，做最后一次无工具调用
  messages.push({
    role: 'user',
    content: '请直接给出最终回答，不要再调用工具。'
  });
  return await callSpark(messages);
}

module.exports = { agentLoop };
