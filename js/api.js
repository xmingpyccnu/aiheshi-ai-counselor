// 性能优化版API模块
class OptimizedAIProvider {
  constructor(config) {
    this.config = config;
    this.provider = config.provider;
    this.cache = new Map(); // 响应缓存
    this.wsConnection = null; // WebSocket连接复用
    this.authCache = null; // 鉴权缓存
    this.authCacheTime = 0;
    this.pendingRequests = new Map(); // 防止重复请求
  }

  // 生成缓存键
  getCacheKey(messages, scene) {
    const lastMsg = messages[messages.length - 1];
    return `${scene}:${lastMsg.content.substring(0, 50)}`;
  }

  // 检查缓存
  getFromCache(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.time < 300000) { // 5分钟缓存
      return cached.data;
    }
    this.cache.delete(cacheKey);
    return null;
  }

  // 设置缓存
  setCache(cacheKey, data) {
    this.cache.set(cacheKey, { data, time: Date.now() });
    // 限制缓存大小
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  // 检查是否有重复请求
  checkPending(cacheKey) {
    return this.pendingRequests.has(cacheKey);
  }

  // 添加待处理请求
  addPending(cacheKey) {
    this.pendingRequests.set(cacheKey, Date.now());
  }

  // 移除待处理请求
  removePending(cacheKey) {
    this.pendingRequests.delete(cacheKey);
  }

  // 调用AI API（带优化）
  async chat(messages, scene) {
    const cacheKey = this.getCacheKey(messages, scene);
    
    // 检查缓存
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log('使用缓存响应');
      return cached;
    }
    
    // 检查是否有重复请求
    if (this.checkPending(cacheKey)) {
      console.log('等待重复请求完成');
      await this.waitForPending(cacheKey);
      return this.getFromCache(cacheKey) || this.getAIReplyLocal(scene, messages[messages.length - 1].content);
    }
    
    this.addPending(cacheKey);
    
    try {
      let result;
      switch (this.provider) {
        case 'openai':
          result = await this.callOpenAI(messages, scene);
          break;
        case 'claude':
          result = await this.callClaude(messages, scene);
          break;
        case 'baidu':
          result = await this.callBaidu(messages, scene);
          break;
        case 'aliyun':
          result = await this.callAliyun(messages, scene);
          break;
        case 'spark':
          result = await this.callSpark(messages, scene);
          break;
        default:
          throw new Error('不支持的API提供商');
      }
      
      // 缓存结果
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('API调用失败:', error);
      return this.getAIReplyLocal(scene, messages[messages.length - 1].content);
    } finally {
      this.removePending(cacheKey);
    }
  }

  // 等待重复请求完成
  async waitForPending(cacheKey, maxWait = 10000) {
    const startTime = Date.now();
    while (this.checkPending(cacheKey) && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // 本地回复（快速响应）
  getAIReplyLocal(scene, text) {
    return getAIReply(scene, text);
  }

  // OpenAI API调用（优化版）
  async callOpenAI(messages, scene) {
    const systemMessage = {
      role: 'system',
      content: SYSTEM_PROMPTS[scene]
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

    try {
      const response = await fetch(`${this.config.openai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.openai.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.openai.model,
          messages: [systemMessage, ...messages.slice(-10)], // 限制历史长度
          max_tokens: this.config.openai.maxTokens,
          temperature: this.config.openai.temperature
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`OpenAI API错误: ${response.status}`);
      }

      const data = await response.json();
      return { parts: [{ type: 'text', text: data.choices[0].message.content }] };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Claude API调用（优化版）
  async callClaude(messages, scene) {
    const systemMessage = SYSTEM_PROMPTS[scene];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${this.config.claude.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.claude.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.config.claude.model,
          max_tokens: this.config.claude.maxTokens,
          system: systemMessage,
          messages: messages.slice(-10)
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Claude API错误: ${response.status}`);
      }

      const data = await response.json();
      return { parts: [{ type: 'text', text: data.content[0].text }] };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 百度文心一言API调用（优化版）
  async callBaidu(messages, scene) {
    // 获取access_token（带缓存）
    const tokenResponse = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.config.baidu.apiKey}&client_secret=${this.config.baidu.secretKey}`,
      { method: 'POST' }
    );
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const conversationHistory = messages.slice(-10).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(
        `${this.config.baidu.baseUrl}/${this.config.baidu.model}?access_token=${accessToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: SYSTEM_PROMPTS[scene] },
              ...conversationHistory
            ]
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error(`百度API错误: ${response.status}`);
      }

      const data = await response.json();
      return { parts: [{ type: 'text', text: data.result }] };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 阿里通义千问API调用（优化版）
  async callAliyun(messages, scene) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${this.config.aliyun.baseUrl}/services/aigc/text-generation/generation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.aliyun.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.aliyun.model,
          input: {
            messages: [
              { role: 'system', content: SYSTEM_PROMPTS[scene] },
              ...messages.slice(-10)
            ]
          },
          parameters: {
            max_tokens: 500,
            temperature: 0.7
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`阿里云API错误: ${response.status}`);
      }

      const data = await response.json();
      return { parts: [{ type: 'text', text: data.output.choices[0].message.content }] };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 科大讯飞星火大模型API调用（优化版）
  async callSpark(messages, scene) {
    return new Promise(async (resolve, reject) => {
      try {
        const authUrl = await this.getSparkAuthUrlOptimized();
        
        // 复用WebSocket连接
        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
          this.sendSparkRequest(this.wsConnection, messages, scene, resolve, reject);
          return;
        }
        
        const ws = new WebSocket(authUrl);
        this.wsConnection = ws;
        
        let fullResponse = '';
        let isComplete = false;
        
        ws.onopen = () => {
          console.log('星火大模型WebSocket连接已建立');
          this.sendSparkRequest(ws, messages, scene, resolve, reject);
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.header.code !== 0) {
              reject(new Error(`星火API错误: ${data.header.message}`));
              ws.close();
              this.wsConnection = null;
              return;
            }
            
            const content = data.payload.choices.text[0].content;
            fullResponse += content;
            
            if (data.payload.choices.status === 2) {
              isComplete = true;
              resolve({ parts: [{ type: 'text', text: fullResponse }] });
              // 保持连接用于下次请求
            }
          } catch (error) {
            reject(error);
            ws.close();
            this.wsConnection = null;
          }
        };
        
        ws.onerror = (error) => {
          reject(new Error(`星火WebSocket错误: ${error.message}`));
          this.wsConnection = null;
        };
        
        ws.onclose = () => {
          console.log('星火大模型WebSocket连接已关闭');
          this.wsConnection = null;
          if (!isComplete && fullResponse) {
            resolve({ parts: [{ type: 'text', text: fullResponse }] });
          }
        };
        
        // 超时处理
        setTimeout(() => {
          if (!isComplete) {
            reject(new Error('星火API请求超时'));
            ws.close();
            this.wsConnection = null;
          }
        }, 15000);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  // 发送星火请求
  sendSparkRequest(ws, messages, scene, resolve, reject) {
    const requestData = {
      header: {
        app_id: this.config.spark.appId
      },
      parameter: {
        chat: {
          domain: this.config.spark.model,
          temperature: 0.5,
          max_tokens: 512
        }
      },
      payload: {
        message: {
          text: [
            { role: 'system', content: SYSTEM_PROMPTS[scene] },
            ...messages.slice(-10).map(msg => ({
              role: msg.role === 'user' ? 'user' : 'assistant',
              content: msg.content
            }))
          ]
        }
      }
    };
    
    ws.send(JSON.stringify(requestData));
  }
  
  // 优化的鉴权URL生成（带缓存）
  async getSparkAuthUrlOptimized() {
    const now = Date.now();
    // 缓存5分钟
    if (this.authCache && now - this.authCacheTime < 300000) {
      return this.authCache;
    }
    
    const url = await this.getSparkAuthUrl();
    this.authCache = url;
    this.authCacheTime = now;
    return url;
  }
  
  // 生成星火大模型鉴权URL
  async getSparkAuthUrl() {
    const { appId, apiKey, apiSecret, wsUrl } = this.config.spark;
    
    const host = 'spark-api.xf-yun.com';
    const path = wsUrl.replace('wss://spark-api.xf-yun.com', '');
    
    const date = new Date().toUTCString();
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    const signatureArrayBuffer = await this.hmacSha256(signatureOrigin, apiSecret);
    const signatureBase64 = this.base64Encode(signatureArrayBuffer);
    
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureBase64}"`;
    const authorization = this.base64Encode(authorizationOrigin);
    
    return `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${host}`;
  }
  
  // HMAC-SHA256 哈希（用于星火API鉴权）
  async hmacSha256(message, secret) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);
    
    const key = await crypto.subtle.importKey(
      'raw', keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    
    return await crypto.subtle.sign('HMAC', key, messageData);
  }
  
  // Base64编码
  base64Encode(data) {
    if (typeof data === 'string') {
      return btoa(data);
    }
    const uint8Array = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }
}

// 创建全局API实例
let aiProvider = null;

function initAIProvider() {
  if (typeof API_CONFIG !== 'undefined') {
    aiProvider = new OptimizedAIProvider(API_CONFIG);
  }
}

// 获取AI回复（带API调用）
async function getAIReplyWithAPI(messages, scene) {
  if (aiProvider) {
    return await aiProvider.chat(messages, scene);
  }
  
  const lastUserMessage = messages[messages.length - 1].content;
  return getAIReply(scene, lastUserMessage);
}
