// Agent 工具模块 —— 提供搜索、时间、网页抓取能力

const cheerio = require('cheerio');

/**
 * 工具 1: search_web — 搜索互联网
 * 使用 Bing 搜索引擎抓取结果，返回标题+链接+摘要
 * @param {string} query - 搜索关键词
 * @returns {string} 格式化的搜索结果
 */
async function search_web(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn&cc=cn`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    return `搜索失败: HTTP ${resp.status}`;
  }

  const html = await resp.text();
  const $ = cheerio.load(html);
  const results = [];

  // Bing 结果结构: li.b_algo / div.b_algo
  $('li.b_algo, div.b_algo').each((i, el) => {
    if (i >= 8) return false; // 最多 8 条
    const $el = $(el);
    const title = $el.find('h2').text().trim();
    const link = $el.find('h2 a').attr('href') || '';
    const snippet = $el.find('.b_caption p, .b_lineclamp2, p').first().text().trim();
    if (title && link) {
      results.push(`${i + 1}. ${title}\n   链接: ${link}\n   摘要: ${snippet}`);
    }
  });

  if (results.length === 0) {
    return `未找到关于"${query}"的搜索结果。`;
  }

  return `搜索"${query}"的结果（共${results.length}条）:\n\n${results.join('\n\n')}`;
}

/**
 * 工具 2: get_current_time — 获取当前日期时间
 * @returns {string} 中文格式的当前时间
 */
function get_current_time() {
  const now = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const beijing = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  return `${beijing.getFullYear()}年${beijing.getMonth() + 1}月${beijing.getDate()}日 ` +
    `星期${weekday} ` +
    `${String(beijing.getHours()).padStart(2, '0')}:${String(beijing.getMinutes()).padStart(2, '0')} CST`;
}

/**
 * 工具 3: fetch_url — 抓取网页正文
 * @param {string} url - 目标网页地址
 * @returns {string} 提取的网页文本（截取前 3000 字）
 */
async function fetch_url(url) {
  if (!url.startsWith('http')) {
    return `错误: 无效的URL "${url}"`;
  }

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      return `抓取失败: HTTP ${resp.status}`;
    }

    const html = await resp.text();
    const $ = cheerio.load(html);

    // 移除无用标签
    $('script, style, nav, footer, header, .sidebar, .nav, .footer, .header').remove();

    // 提取正文
    let text = $('body').text()
      .replace(/\s{2,}/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length > 3000) {
      text = text.substring(0, 3000) + '...[已截断，全文请访问原链接]';
    }

    return `网页内容 (${url}):\n${text}`;
  } catch (err) {
    return `抓取失败: ${err.message}`;
  }
}

// ---- 工具调度器 ----
const TOOLS = {
  search_web,
  get_current_time,
  fetch_url,
};

/**
 * 解析模型输出的 <tool_call> 并执行
 * @param {string} text - 模型原始输出
 * @returns {object} { toolResults: [{name, result}], remainingText: string }
 */
function parseAndExecTools(text) {
  const toolResults = [];

  // 匹配所有 <tool_call>...</tool_call> 块
  const toolRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = toolRegex.exec(text)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<name>(.*?)<\/name>/);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    const tool = TOOLS[name];
    if (!tool) {
      toolResults.push({ name, result: `未知工具: ${name}` });
      continue;
    }

    // 根据工具名提取参数
    if (name === 'get_current_time') {
      toolResults.push({ name, result: get_current_time() });
    } else if (name === 'search_web') {
      const queryMatch = block.match(/<query>(.*?)<\/query>/);
      const query = queryMatch ? queryMatch[1].trim() : '';
      if (!query) {
        toolResults.push({ name, result: '错误: search_web 缺少 query 参数' });
      } else {
        toolResults.push({ name, result: '搜索中...', pending: true, promise: search_web(query) });
      }
    } else if (name === 'fetch_url') {
      const urlMatch = block.match(/<url>(.*?)<\/url>/);
      const url = urlMatch ? urlMatch[1].trim() : '';
      if (!url) {
        toolResults.push({ name, result: '错误: fetch_url 缺少 url 参数' });
      } else {
        toolResults.push({ name, result: '抓取中...', pending: true, promise: fetch_url(url) });
      }
    }
  }

  // 去除模型输出中的 tool_call 标签，保留其余文本
  const remainingText = text.replace(toolRegex, '').trim();

  return { toolResults, remainingText };
}

/**
 * 等待所有 pending 的工具执行完成
 */
async function resolvePending(toolResults) {
  for (const tr of toolResults) {
    if (tr.pending) {
      try {
        tr.result = await tr.promise;
      } catch (err) {
        tr.result = `工具执行失败: ${err.message}`;
      }
      delete tr.pending;
      delete tr.promise;
    }
  }
}

module.exports = { TOOLS, parseAndExecTools, resolvePending };
