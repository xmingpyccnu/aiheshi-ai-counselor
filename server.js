  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const { agentLoop } = require('./agent');
  
  const PORT = 3001;
  
  const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mjs': 'application/javascript',
  };
  
  const server = http.createServer((req, res) => {
    // POST /api/chat —— Agent 对话接口
    if (req.method === 'POST' && req.url === '/api/chat') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { scene, history } = JSON.parse(body);
          if (typeof scene !== 'number' || !Array.isArray(history)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '缺少 scene 或 history 参数' }));
            return;
          }
          console.log(`[API] 场景${scene} 收到 ${history.length} 条历史`);
          const reply = await agentLoop(scene, history);
          console.log(`[API] 回复长度: ${reply.length} 字符`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reply }));
        } catch (err) {
          console.error('[API] 错误:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // 静态文件服务
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // 去掉查询参数
    filePath = filePath.split('?')[0];
    filePath = path.join(__dirname, filePath);
    
    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('404 Not Found: ' + filePath);
        } else {
          res.writeHead(500);
          res.end('Server Error: ' + err.code);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        // 图片等二进制文件不转 utf-8
        const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.ico'].includes(extname);
        res.end(content, isBinary ? undefined : 'utf-8');
      }
    });
  });
  
  server.listen(PORT, () => {
    console.log(`爱合师AI辅导员 Agent 运行在: http://localhost:${PORT}`);
    console.log(`Agent API: POST http://localhost:${PORT}/api/chat`);
    console.log('按 Ctrl+C 停止服务器');
  });
