// Agent工具模块：提供受限搜索、北京时间和安全网页抓取能力。

const dns = require('node:dns').promises;
const net = require('node:net');
const cheerio = require('cheerio');
const { searchHandbook } = require('./handbook_search');

const SEARCH_TIMEOUT_MS = 10000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SEARCH_QUERY_CHARS = 200;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_EXTRACTED_CHARS = 3000;

function isBlockedIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  // 只允许2000::/3范围内的全局单播地址。
  const firstGroup = Number.parseInt(normalized.split(':')[0], 16);
  return !Number.isInteger(firstGroup) || (firstGroup & 0xe000) !== 0x2000;
}

function isBlockedAddress(address) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isBlockedIpv4(address);
  if (ipVersion === 6) return isBlockedIpv6(address);
  return true;
}

async function validateExternalUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('无效的URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只允许访问HTTP或HTTPS地址');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL中不允许包含凭据');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('不允许访问本机或内部网络地址');
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error('不允许访问本机或内部网络地址');
    return parsed;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('无法解析目标主机');
  }
  if (!addresses.length || addresses.some(item => isBlockedAddress(item.address))) {
    throw new Error('不允许访问本机或内部网络地址');
  }

  return parsed;
}

async function readResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('网页内容超过大小限制');
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('网页内容超过大小限制');
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function search_web(query) {
  const normalizedQuery = typeof query === 'string' ? query.trim() : '';
  if (!normalizedQuery) return '搜索失败:搜索关键词不能为空';
  if (normalizedQuery.length > MAX_SEARCH_QUERY_CHARS) {
    return `搜索失败:搜索关键词不能超过${MAX_SEARCH_QUERY_CHARS}字符`;
  }

  const url = `https://www.bing.com/search?q=${encodeURIComponent(normalizedQuery)}&setlang=zh-cn&cc=cn`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) return `搜索失败:HTTP ${response.status}`;
    const html = await readResponseText(response);
    const $ = cheerio.load(html);
    const results = [];

    $('li.b_algo, div.b_algo').each((index, element) => {
      if (index >= 8) return false;
      const item = $(element);
      const title = item.find('h2').text().trim();
      const link = item.find('h2 a').attr('href') || '';
      const snippet = item.find('.b_caption p, .b_lineclamp2, p').first().text().trim();
      if (title && link) {
        results.push(`${index + 1}. ${title}\n   链接:${link}\n   摘要:${snippet}`);
      }
      return undefined;
    });

    if (results.length === 0) return `未找到关于“${normalizedQuery}”的搜索结果。`;
    return `搜索“${normalizedQuery}”的结果（共${results.length}条）:\n\n${results.join('\n\n')}`;
  } catch (error) {
    return `搜索失败:${error.name === 'TimeoutError' ? '请求超时' : error.message}`;
  }
}

function get_current_time(now = new Date()) {
  const timeZone = 'Asia/Shanghai';
  const dateParts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(now).map(part => [part.type, part.value])
  );
  const weekday = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    weekday: 'long',
  }).format(now);
  const timeParts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value])
  );

  return `${dateParts.year}年${dateParts.month}月${dateParts.day}日 ${weekday} ${timeParts.hour}:${timeParts.minute} CST`;
}

async function fetch_url(rawUrl) {
  try {
    const url = await validateExternalUrl(rawUrl);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html,text/plain;q=0.9',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return `抓取失败:HTTP ${response.status}`;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return '抓取失败:目标不是HTML或纯文本网页';
    }

    const html = await readResponseText(response);
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, iframe, object, .sidebar, .nav, .footer, .header').remove();

    let text = $('body').text()
      .replace(/\s{2,}/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.length > MAX_EXTRACTED_CHARS) {
      text = `${text.substring(0, MAX_EXTRACTED_CHARS)}...[已截断，全文请访问原链接]`;
    }
    return `网页内容(${url.toString()}):\n${text}`;
  } catch (error) {
    const message = error.name === 'TimeoutError'
      ? '请求超时'
      : error.message.includes('redirect')
        ? '目标网页发生重定向，出于安全原因未自动访问'
        : error.message;
    return `抓取失败:${message}`;
  }
}

function search_handbook(query) {
  return searchHandbook(query);
}

const TOOLS = { search_web, search_handbook, get_current_time, fetch_url };

function parseAndExecTools(text) {
  const toolResults = [];
  const toolRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = toolRegex.exec(text)) !== null) {
    const block = match[1];
    const nameMatch = block.match(/<name>([\s\S]*?)<\/name>/);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    const tool = TOOLS[name];
    if (!tool) {
      toolResults.push({ name, result: `未知工具:${name}` });
      continue;
    }

    if (name === 'get_current_time') {
      toolResults.push({ name, result: get_current_time() });
      continue;
    }

    const parameterName = name === 'search_web' || name === 'search_handbook'
      ? 'query'
      : 'url';
    const parameterMatch = block.match(
      new RegExp(`<${parameterName}>([\\s\\S]*?)</${parameterName}>`)
    );
    const value = parameterMatch ? parameterMatch[1].trim() : '';
    if (!value) {
      toolResults.push({ name, result: `错误:${name}缺少${parameterName}参数` });
      continue;
    }

    toolResults.push({
      name,
      result: name === 'fetch_url' ? '抓取中...' : '检索中...',
      pending: true,
      promise: tool(value),
    });
  }

  return { toolResults, remainingText: text.replace(toolRegex, '').trim() };
}

async function resolvePending(toolResults) {
  await Promise.all(toolResults.map(async result => {
    if (!result.pending) return;
    try {
      result.result = await result.promise;
    } catch (error) {
      result.result = `工具执行失败:${error.message}`;
    }
    delete result.pending;
    delete result.promise;
  }));
}

module.exports = {
  TOOLS,
  fetch_url,
  get_current_time,
  isBlockedAddress,
  parseAndExecTools,
  readResponseText,
  resolvePending,
  search_handbook,
  search_web,
  validateExternalUrl,
};
