// API配置文件
// 请在使用前配置您的API密钥

const API_CONFIG = {
  // 选择要使用的大模型API：'openai'、'claude'、'baidu'、'aliyun'、'spark'
  provider: 'spark',
  
  // OpenAI API配置
  openai: {
    apiKey: 'your-openai-api-key-here',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    maxTokens: 500,
    temperature: 0.7
  },
  
  // Claude API配置
  claude: {
    apiKey: 'your-claude-api-key-here',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-haiku-20240307',
    maxTokens: 500
  },
  
  // 百度文心一言API配置
  baidu: {
    apiKey: 'your-baidu-api-key-here',
    secretKey: 'your-baidu-secret-key-here',
    baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
    model: 'ernie-speed-128k'
  },
  
  // 阿里通义千问API配置
  aliyun: {
    apiKey: 'your-aliyun-api-key-here',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    model: 'qwen-turbo'
  },
  
  // 科大讯飞星火大模型API配置
  spark: {
    // 当前应用由服务端从.env读取配置；不要在浏览器代码中填写真实凭据。
    appId: '',
    apiKey: '',
    apiSecret: '',
    // 星火大模型API地址（根据版本选择）
    // v3.5: wss://spark-api.xf-yun.com/v3.5/chat
    // v4.0: wss://spark-api.xf-yun.com/v4.0/chat
    // lite: wss://spark-api.xf-yun.com/lite/v2/chat
    wsUrl: 'wss://spark-api.xf-yun.com/v4.0/chat',
    model: '4.0Ultra'
  }
};

// 默认系统提示词
const SYSTEM_PROMPTS = {
  0: '你是合肥师范学院的AI辅导员"爱·合师"，负责解答校园生活相关问题，包括图书馆、教室、食堂等。回答要简洁、准确、友好。',
  1: '你是合肥师范学院的AI辅导员"爱·合师"，负责帮助师范生提升教学技能，包括板书、表达、教资备考等。回答要专业、实用、鼓励。',
  2: '你是合肥师范学院的AI辅导员"爱·合师"，负责提供心理陪伴和支持。回答要温暖、理解、支持，避免说教。如果检测到危机关键词，立即建议寻求专业帮助。',
  3: '你是合肥师范学院的AI辅导员"爱·合师"，负责帮助办理校园事务，包括困难认定、请假证明、奖学金等。回答要清晰、实用、步骤明确。'
};
