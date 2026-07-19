// 聊天功能模块（优化版）
class ChatApp {
  constructor() {
    this.currentScene = 0;
    this.sessions = [[], [], [], []];
    this.typingEl = null;
    this.isProcessing = false; // 防止重复提交
    this.lastSendTime = 0; // 防抖
    this.debounceDelay = 500; // 防抖延迟
    this.init();
  }

  init() {
    this.chatScreen = document.getElementById('chatScreen');
    this.msgInput = document.getElementById('msgInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.navScene = document.getElementById('navScene');
    this.safetyBar = document.getElementById('safetyBar');
    this.fabBtn = document.getElementById('fabBtn');
    this.crisisModal = document.getElementById('crisisModal');
    this.toastElement = document.getElementById('toast');
    
    // 绑定事件（带防抖）
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
    
    // 输入时更新发送按钮状态
    this.msgInput.addEventListener('input', () => {
      // 自动调整输入框高度
      this.msgInput.style.height = 'auto';
      this.msgInput.style.height = Math.min(this.msgInput.scrollHeight, 120) + 'px';
      
      const hasText = this.msgInput.value.trim().length > 0;
      this.sendBtn.style.opacity = hasText ? '1' : '0.5';
      this.sendBtn.style.transform = hasText ? 'scale(1)' : 'scale(0.9)';
    });
    
    // Tab切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const index = parseInt(tab.dataset.index);
        this.switchScene(index);
      });
    });
    
    // 紧急求助按钮
    this.fabBtn.addEventListener('click', () => this.showCrisisModal());
    this.safetyBar.querySelector('.s-btn').addEventListener('click', () => this.showCrisisModal());
    
    // 关闭危机弹层
    document.getElementById('crisisClose').addEventListener('click', () => this.closeCrisis());
    document.getElementById('crisisCall').addEventListener('click', () => {
      this.closeCrisis();
      this.toast('正在拨打心理援助热线...');
    });
    
    // 初始化第一个场景
    this.switchScene(0);
    
    // 初始化发送按钮状态
    this.sendBtn.style.opacity = '0.5';
    this.sendBtn.style.transform = 'scale(0.9)';
    this.sendBtn.style.transition = 'all 0.2s ease';
  }

  switchScene(index) {
    if (this.isProcessing) return; // 处理中不允许切换
    
    this.currentScene = index;
    const scene = SCENES[index];
    
    // 更新Tab状态
    document.querySelectorAll('.tab').forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
      tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    
    // 更新导航栏
    this.navScene.textContent = scene.name;
    
    // 显示/隐藏心理场景相关UI
    this.safetyBar.classList.toggle('hidden', index !== 2);
    this.fabBtn.classList.toggle('hidden', index !== 2);
    
    // 清空聊天区并显示欢迎消息
    this.chatScreen.innerHTML = '';
    this.addWelcomeMessage(scene);
    
    // 显示快捷按钮
    this.addQuickButtons(scene.tabs);
  }

  addWelcomeMessage(scene) {
    const avatar = this.createAvatar();
    const bubble = document.createElement('div');
    bubble.className = 'bubble ai';
    bubble.textContent = scene.welcome;
    
    const stack = document.createElement('div');
    stack.className = 'stack left';
    stack.appendChild(bubble);
    
    const row = document.createElement('div');
    row.className = 'row ai';
    row.appendChild(avatar);
    row.appendChild(stack);
    
    this.chatScreen.appendChild(row);
    this.scrollBottom();
  }

  addQuickButtons(tabs) {
    const quickRow = document.createElement('div');
    quickRow.className = 'quick-row';
    quickRow.style.cssText = 'margin-left: 48px; margin-bottom: 12px;';
    
    tabs.forEach(tab => {
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.textContent = tab;
      pill.addEventListener('click', () => {
        if (!this.isProcessing) {
          this.msgInput.value = tab;
          this.handleSend();
        }
      });
      quickRow.appendChild(pill);
    });
    
    this.chatScreen.appendChild(quickRow);
    this.scrollBottom();
  }

  createAvatar() {
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.innerHTML = `<img src="assets/A_cute_2D_cartoon_style_Chines_2026-07-10T15-22-43.png" alt="AI">`;
    return avatar;
  }

  addUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    bubble.textContent = text;
    
    const stack = document.createElement('div');
    stack.className = 'stack right';
    stack.appendChild(bubble);
    stack.appendChild(this.addTimestamp());
    
    const row = document.createElement('div');
    row.className = 'row user';
    row.appendChild(stack);
    
    this.chatScreen.appendChild(row);
    this.scrollBottom();
    
    // 保存到会话历史
    this.sessions[this.currentScene].push({ who: 'user', text });
  }

  addAIMessage(reply) {
    const avatar = this.createAvatar();
    const stack = document.createElement('div');
    stack.className = 'stack left';
    
    reply.parts.forEach(part => {
      if (part.type === 'text') {
        const bubble = document.createElement('div');
        bubble.className = 'bubble ai' + (part.coral ? ' coral' : '');
        bubble.textContent = part.text;
        stack.appendChild(bubble);
      } else if (part.type === 'source') {
        const source = document.createElement('div');
        source.className = 'source';
        source.textContent = part.text;
        stack.appendChild(source);
      } else if (part.type === 'card') {
        const card = document.createElement('div');
        card.className = 'ai-card';
        card.innerHTML = `
          <div class="c-title">${part.title}</div>
          <div class="c-body">${part.body}</div>
        `;
        stack.appendChild(card);
      } else if (part.type === 'form') {
        const formContainer = document.createElement('div');
        formContainer.className = 'ai-card';
        formContainer.innerHTML = part.html;
        stack.appendChild(formContainer);
      }
    });
    
    const row = document.createElement('div');
    row.className = 'row ai';
    row.appendChild(avatar);
    row.appendChild(stack);
    row.querySelector('.stack').appendChild(this.addTimestamp());
    
    this.chatScreen.appendChild(row);
    this.scrollBottom();
    
    // 保存到会话历史
    this.sessions[this.currentScene].push({ who: 'ai', parts: reply.parts });
  }

  showTyping() {
    const avatar = this.createAvatar();
    const bubble = document.createElement('div');
    bubble.className = 'bubble typing';
    bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    
    const stack = document.createElement('div');
    stack.className = 'stack left';
    stack.appendChild(bubble);
    
    const row = document.createElement('div');
    row.className = 'row ai';
    row.appendChild(avatar);
    row.appendChild(stack);
    
    this.typingEl = row;
    this.chatScreen.appendChild(row);
    this.scrollBottom();
  }

  removeTyping() {
    if (this.typingEl) {
      this.typingEl.remove();
      this.typingEl = null;
    }
  }

  handleSend() {
    const now = Date.now();
    if (now - this.lastSendTime < this.debounceDelay) {
      return; // 防抖
    }
    
    if (this.isProcessing) {
      this.toast('正在处理中，请稍候...');
      return;
    }
    
    const text = this.msgInput.value.trim();
    if (!text) return;
    
    this.lastSendTime = now;
    this.isProcessing = true;
    
    // 更新UI状态
    this.sendBtn.style.opacity = '0.5';
    this.sendBtn.style.pointerEvents = 'none';
    this.msgInput.disabled = true;
    
    // 添加用户消息
    this.addUserMessage(text);
    this.msgInput.value = '';
    
    // 检测危机关键词
    if (isCrisis(text)) {
      this.showCrisisModal();
      this.resetProcessingState();
      return;
    }
    
    // 显示打字指示器
    this.showTyping();
    
    // 异步获取回复
    this.fetchAIReply(text);
  }

  async fetchAIReply(text) {
    try {
      // 准备对话历史（用户/AI 交替的纯文本数组）
      const history = this.sessions[this.currentScene]
        .filter(msg => msg.who === 'user' || msg.who === 'ai')
        .slice(-20)
        .map(msg =>
          msg.who === 'user'
            ? msg.text
            : (msg.parts ? msg.parts[0].text : '')
        );
      
      // 调用 Agent API
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: this.currentScene, history })
      });
      
      if (!resp.ok) {
        throw new Error(`服务器错误: ${resp.status}`);
      }
      
      const data = await resp.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      this.removeTyping();
      // 将回复包装为 parts 格式以兼容 addAIMessage
      this.addAIMessage({ parts: [{ type: 'text', text: data.reply }] });
    } catch (error) {
      console.error('获取AI回复失败:', error);
      this.removeTyping();
      
      // 显示错误提示
      this.toast('获取回复失败，请稍后重试');
      
      // 本地规则引擎作为后备
      const fallbackReply = getAIReply(this.currentScene, text);
      this.addAIMessage(fallbackReply);
    } finally {
      this.resetProcessingState();
    }
  }

  resetProcessingState() {
    this.isProcessing = false;
    this.sendBtn.style.opacity = this.msgInput.value.trim() ? '1' : '0.5';
    this.sendBtn.style.pointerEvents = 'auto';
    this.msgInput.disabled = false;
    this.msgInput.focus();
  }

  showCrisisModal() {
    this.crisisModal.classList.remove('hidden');
  }

  closeCrisis() {
    this.crisisModal.classList.add('hidden');
  }

  toast(msg) {
    this.toastElement.textContent = msg;
    this.toastElement.classList.add('show');
    setTimeout(() => {
      this.toastElement.classList.remove('show');
    }, 3000);
  }

  scrollBottom() {
    requestAnimationFrame(() => {
      this.chatScreen.scrollTop = this.chatScreen.scrollHeight;
    });
  }

  addTimestamp() {
    const time = document.createElement('div');
    time.className = 'msg-time';
    const now = new Date();
    time.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    return time;
  }

  addErrorState(text) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble ai';
    bubble.style.cssText = 'border-color: var(--pastel-red); background: var(--pastel-red);';
    bubble.textContent = '消息发送失败，请检查网络后重试';

    const retry = document.createElement('button');
    retry.className = 'retry-btn';
    retry.textContent = '↻ 重试';
    retry.addEventListener('click', () => {
      const lastRow = this.chatScreen.lastElementChild;
      if (lastRow?.classList.contains('row')) {
        lastRow.remove();
      }
      this.sessions[this.currentScene].pop();
      this.handleSend();
    });

    const stack = document.createElement('div');
    stack.className = 'stack left';
    stack.appendChild(bubble);
    stack.appendChild(retry);

    const row = document.createElement('div');
    row.className = 'row ai';
    row.appendChild(this.createAvatar());
    row.appendChild(stack);

    this.chatScreen.appendChild(row);
    this.scrollBottom();
  }
}
