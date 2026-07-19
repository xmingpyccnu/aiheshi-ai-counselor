const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { agentLoop } = require('./agent');

const DEFAULT_PORT = 3001;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_HISTORY_ITEMS = 20;
const MAX_MESSAGE_CHARS = 8000;
const PUBLIC_ROOT = path.resolve(__dirname);
const PUBLIC_FILES = new Set(['index.html', 'manifest.json']);
const PUBLIC_DIRECTORIES = ['assets/', 'css/', 'js/'];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(statusCode, publicMessage) {
    super(publicMessage);
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
}

function getPathname(requestUrl) {
  try {
    return decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
}

function resolvePublicFile(requestUrl) {
  const pathname = getPathname(requestUrl);
  if (!pathname || pathname.includes('\0') || pathname.includes('\\')) return null;

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const isAllowed = PUBLIC_FILES.has(relativePath) ||
    PUBLIC_DIRECTORIES.some(directory => relativePath.startsWith(directory));

  if (!isAllowed || relativePath.split('/').some(part => part === '..' || part.startsWith('.'))) {
    return null;
  }

  const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
  if (absolutePath !== PUBLIC_ROOT && !absolutePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
    return null;
  }
  return absolutePath;
}

function validateChatPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, '请求参数格式错误');
  }

  const { scene, history } = payload;
  if (!Number.isInteger(scene) || scene < 0 || scene > 3) {
    throw new HttpError(400, 'scene必须是0至3之间的整数');
  }
  if (!Array.isArray(history) || history.length > MAX_HISTORY_ITEMS) {
    throw new HttpError(400, `history必须是最多${MAX_HISTORY_ITEMS}条的数组`);
  }

  const normalizedHistory = history.map((message, index) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new HttpError(400, `history[${index}]格式错误`);
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new HttpError(400, `history[${index}].role无效`);
    }
    if (typeof message.content !== 'string') {
      throw new HttpError(400, `history[${index}].content必须是字符串`);
    }

    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) {
      throw new HttpError(
        400,
        `history[${index}].content长度必须在1至${MAX_MESSAGE_CHARS}字符之间`
      );
    }
    return { role: message.role, content };
  });

  const { ok, profile } = validateProfile(payload.profile);
  if (!ok) {
    throw new HttpError(400, '请求参数格式错误');
  }

  return { scene, history: normalizedHistory, profile };
}

function validateProfile(value) {
  if (value === undefined) return { ok: true, profile: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, profile: null };
  }

  const grade = Object.hasOwn(value, 'grade') ? value.grade : '';
  const major = Object.hasOwn(value, 'major') ? value.major : '';
  const goal = Object.hasOwn(value, 'goal') ? value.goal : '';
  const allowedGrades = new Set(['', 'freshman', 'sophomore', 'junior', 'senior']);

  if (typeof grade !== 'string' || !allowedGrades.has(grade)) {
    return { ok: false, profile: null };
  }
  if (typeof major !== 'string' || typeof goal !== 'string') {
    return { ok: false, profile: null };
  }

  const trimmedMajor = major.trim();
  const trimmedGoal = goal.trim();
  if (trimmedMajor.length > 40 || trimmedGoal.length > 120) {
    return { ok: false, profile: null };
  }

  return {
    ok: true,
    profile: {
      grade,
      major: normalizeProfileText(trimmedMajor),
      goal: normalizeProfileText(trimmedGoal),
    },
  };
}

function normalizeProfileText(value) {
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\s+/gu, ' ')
    .trim();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;

    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        body = '';
        return;
      }
      if (!tooLarge) body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, '请求体过大'));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, '请求体不是有效的JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function serveStaticFile(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 404, '404 Not Found');
    return;
  }

  const filePath = resolvePublicFile(req.url);
  if (!filePath) {
    sendText(res, 404, '404 Not Found');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code !== 'ENOENT') console.error('[Static] 读取失败:', error.message);
      sendText(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? '404 Not Found' : 'Server Error');
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

function createAppServer({ agentLoop: runAgent = agentLoop } = {}) {
  return http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const pathname = getPathname(req.url);

    if (req.method === 'POST' && pathname === '/api/chat') {
      try {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
          throw new HttpError(415, '仅支持application/json请求');
        }

        const payload = await readJsonBody(req);
        const { scene, history, profile } = validateChatPayload(payload);
        console.log(`[API] 场景${scene} 收到${history.length}条历史`);
        const reply = await runAgent(scene, history, scene === 1 ? profile : null);
        if (typeof reply !== 'string' || !reply.trim()) {
          throw new Error('Agent返回了空回复');
        }
        console.log(`[API] 回复长度:${reply.length}字符`);
        sendJson(res, 200, { reply });
      } catch (error) {
        const statusCode = error instanceof HttpError ? error.statusCode : 500;
        if (statusCode >= 500) console.error(`[API] 内部错误:${error.name || 'Error'}`);
        const publicMessage = error instanceof HttpError
          ? error.publicMessage
          : '服务暂时不可用，请稍后重试';
        sendJson(res, statusCode, { error: publicMessage });
      }
      return;
    }

    serveStaticFile(req, res);
  });
}

if (require.main === module) {
  const configuredPort = Number.parseInt(process.env.PORT || '', 10);
  const port = Number.isInteger(configuredPort) && configuredPort > 0
    ? configuredPort
    : DEFAULT_PORT;
  const server = createAppServer();
  server.on('error', error => {
    console.error('[Server] 启动失败:', error.message);
    process.exitCode = 1;
  });
  server.listen(port, () => {
    console.log(`爱合师AI辅导员Agent运行在:http://localhost:${port}`);
    console.log(`Agent API:POST http://localhost:${port}/api/chat`);
    console.log('按Ctrl+C停止服务器');
  });
}

module.exports = {
  createAppServer,
  resolvePublicFile,
  validateChatPayload,
};
