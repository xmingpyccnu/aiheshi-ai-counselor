class ChatApp {
  constructor() {
    this.currentScene = 0;
    this.currentView = 'home';
    this.sessions = [[], [], [], []];
    this.typingEl = null;
    this.lastFocusedElement = null;
    this.isProcessing = false;
    this.lastSendTime = 0;
    this.debounceDelay = 500;
    this.messageSequence = 0;
    this.init();
  }

  init() {
    this.homeScreen = document.getElementById('homeScreen');
    this.chatView = document.getElementById('chatView');
    this.profileView = document.getElementById('profileView');
    this.chatScreen = document.getElementById('chatScreen');
    this.msgInput = document.getElementById('msgInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.navScene = document.getElementById('navScene');
    this.safetyBar = document.getElementById('safetyBar');
    this.fabBtn = document.getElementById('fabBtn');
    this.crisisModal = document.getElementById('crisisModal');
    this.handoffModal = document.getElementById('handoffModal');
    this.handoffSummary = document.getElementById('handoffSummary');
    this.toastElement = document.getElementById('toast');

    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.msgInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.handleSend();
      }
    });
    this.msgInput.addEventListener('input', () => this.updateComposer());

    document.querySelectorAll('.service-card').forEach(card => {
      card.addEventListener('click', () => this.switchScene(Number(card.dataset.scene)));
    });
    document.getElementById('profileBtn').addEventListener('click', () => this.navigateTo('profile'));
    document.getElementById('profileBackBtn').addEventListener('click', () => this.navigateTo('home'));
    document.getElementById('chatBackBtn').addEventListener('click', () => this.navigateTo('home'));

    document.querySelectorAll('.bottom-item').forEach(item => {
      item.addEventListener('click', () => {
        if (item.dataset.action === 'crisis') this.showCrisisModal();
        else this.navigateTo(item.dataset.view);
      });
    });

    this.fabBtn.addEventListener('click', () => this.showCrisisModal());
    this.safetyBar.querySelector('.s-btn').addEventListener('click', () => this.showCrisisModal());
    document.getElementById('crisisClose').addEventListener('click', () => this.closeCrisis());
    this.crisisModal.addEventListener('click', event => {
      if (event.target === this.crisisModal) this.closeCrisis();
    });

    document.getElementById('handoffClose').addEventListener('click', () => this.closeHandoff());
    document.getElementById('copyHandoff').addEventListener('click', () => this.copyHandoffSummary());
    this.handoffModal.addEventListener('click', event => {
      if (event.target === this.handoffModal) this.closeHandoff();
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!this.handoffModal.classList.contains('hidden')) this.closeHandoff();
      else if (!this.crisisModal.classList.contains('hidden')) this.closeCrisis();
    });

    this.renderCurrentSession();
    this.navigateTo('home');
    this.updateComposer();
  }

  navigateTo(view) {
    if (!['home', 'chat', 'profile'].includes(view)) return;
    this.currentView = view;
    this.homeScreen.classList.toggle('hidden', view !== 'home');
    this.chatView.classList.toggle('hidden', view !== 'chat');
    this.profileView.classList.toggle('hidden', view !== 'profile');

    document.querySelectorAll('.bottom-item[data-view]').forEach(item => {
      const active = item.dataset.view === view;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    if (view === 'profile') this.updateProfileStats();
    if (view === 'chat') {
      this.scrollBottom();
      requestAnimationFrame(() => this.msgInput.focus());
    }
  }

  switchScene(index) {
    if (!Number.isInteger(index) || !SCENES[index]) return;
    if (this.isProcessing) {
      this.toast('请等待当前回答完成后再切换服务');
      return;
    }

    this.currentScene = index;
    this.renderCurrentSession();
    this.navigateTo('chat');
  }

  renderCurrentSession() {
    const scene = SCENES[this.currentScene];
    this.navScene.textContent = scene.name;
    this.safetyBar.classList.toggle('hidden', this.currentScene !== 2);
    this.fabBtn.classList.toggle('hidden', this.currentScene !== 2);
    this.chatScreen.innerHTML = '';
    this.addWelcomeMessage(scene);
    this.addQuickButtons(scene.tabs);

    for (const message of this.sessions[this.currentScene]) {
      if (message.who === 'user') this.addUserMessage(message.text, { save: false, message });
      if (message.who === 'ai') this.addAIMessage({ parts: message.parts }, { save: false, message });
    }
    this.scrollBottom();
  }

  addWelcomeMessage(scene) {
    const row = document.createElement('div');
    row.className = 'row ai welcome-row';
    row.appendChild(this.createAvatar());

    const stack = document.createElement('div');
    stack.className = 'stack left';
    const label = document.createElement('div');
    label.className = 'assistant-label';
    label.textContent = `${scene.name} · 服务说明`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble ai';
    bubble.textContent = scene.welcome;
    stack.append(label, bubble);
    row.appendChild(stack);
    this.chatScreen.appendChild(row);
  }

  addQuickButtons(tabs) {
    const quickRow = document.createElement('div');
    quickRow.className = 'quick-row';
    tabs.forEach(tab => {
      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.textContent = tab;
      pill.addEventListener('click', () => {
        if (this.isProcessing) return;
        this.msgInput.value = tab;
        this.updateComposer();
        this.handleSend();
      });
      quickRow.appendChild(pill);
    });
    this.chatScreen.appendChild(quickRow);
  }

  createAvatar() {
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    const image = document.createElement('img');
    image.src = 'assets/A_cute_2D_cartoon_style_Chines_2026-07-10T15-22-43.png';
    image.alt = 'AI';
    avatar.appendChild(image);
    return avatar;
  }

  addUserMessage(text, options = {}) {
    const message = options.message || {
      who: 'user',
      id: this.nextMessageId('user'),
      text,
      createdAt: Date.now(),
    };

    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    bubble.textContent = text;
    const stack = document.createElement('div');
    stack.className = 'stack right';
    stack.append(bubble, this.addTimestamp(message.createdAt));
    const row = document.createElement('div');
    row.className = 'row user';
    row.dataset.messageId = message.id;
    row.appendChild(stack);
    this.chatScreen.appendChild(row);

    if (options.save !== false) this.sessions[this.currentScene].push(message);
    this.scrollBottom();
    return message;
  }

  addAIMessage(reply, options = {}) {
    const message = options.message || {
      who: 'ai',
      id: this.nextMessageId('ai'),
      parts: reply.parts,
      createdAt: Date.now(),
      feedbackEligible: options.feedbackEligible !== false,
      feedbackStatus: null,
      followupDepth: options.followupDepth || 0,
    };

    const stack = document.createElement('div');
    stack.className = 'stack left';
    for (const part of reply.parts) {
      if (part.type === 'text') {
        const bubble = document.createElement('div');
        bubble.className = `bubble ai${part.coral ? ' coral' : ''}`;
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
        const title = document.createElement('div');
        title.className = 'c-title';
        title.textContent = part.title;
        const body = document.createElement('div');
        body.className = 'c-body';
        body.textContent = part.body;
        card.append(title, body);
        stack.appendChild(card);
      }
    }
    stack.appendChild(this.addTimestamp(message.createdAt));
    if (message.feedbackEligible) this.addFeedbackActions(stack, message);

    const row = document.createElement('div');
    row.className = 'row ai';
    row.dataset.messageId = message.id;
    row.append(this.createAvatar(), stack);
    this.chatScreen.appendChild(row);

    if (options.save !== false) this.sessions[this.currentScene].push(message);
    this.scrollBottom();
    return message;
  }

  addFeedbackActions(stack, message) {
    const actions = document.createElement('div');
    actions.className = 'feedback-actions';

    if (message.feedbackStatus) {
      const state = document.createElement('span');
      state.className = 'feedback-state';
      state.textContent = message.feedbackStatus === 'resolved'
        ? '已标记为解决'
        : message.followupDepth >= 1
          ? '已提供人工转介建议'
          : '已请求补充回答';
      actions.appendChild(state);
      stack.appendChild(actions);
      return;
    }

    const label = document.createElement('span');
    label.textContent = '这个回答解决问题了吗？';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = '已解决';
    yes.addEventListener('click', () => {
      message.feedbackStatus = 'resolved';
      actions.innerHTML = '<span class="feedback-state">已标记为解决</span>';
    });
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = '未解决';
    no.addEventListener('click', () => {
      message.feedbackStatus = 'unresolved';
      actions.innerHTML = `<span class="feedback-state">${message.followupDepth >= 1 ? '转入人工协助' : '正在补充回答…'}</span>`;
      if (message.followupDepth >= 1) this.showHumanHandoff(message);
      else this.requestSecondAnswer(message);
    });
    actions.append(label, yes, no);
    stack.appendChild(actions);
  }

  requestSecondAnswer(message) {
    if (this.isProcessing) return;
    const prompt = '这个回答没有解决我的问题。请回到我原来的问题，补充明确的制度依据、适用条件、具体步骤和可行的替代方案；不确定的信息请直接说明。';
    this.beginProcessing();
    this.addUserMessage(prompt);
    this.showTyping();
    this.fetchAIReply(prompt, { followupDepth: (message.followupDepth || 0) + 1 });
  }

  showHumanHandoff() {
    const messages = this.sessions[this.currentScene].slice(-8).map(message => {
      const role = message.who === 'user' ? '学生' : '爱·合师';
      const text = message.who === 'user' ? message.text : this.replyToPlainText(message.parts);
      return `${role}：${text}`;
    });
    this.handoffSummary.textContent = [
      `服务模块：${SCENES[this.currentScene].name}`,
      '状态：连续两次AI回答未解决',
      '',
      ...messages,
      '',
      '说明：线上人工渠道尚未配置，请联系所在学院辅导员或对应业务部门。',
    ].join('\n');
    this.lastFocusedElement = document.activeElement;
    this.handoffModal.classList.remove('hidden');
    document.getElementById('handoffClose').focus();
  }

  closeHandoff() {
    this.handoffModal.classList.add('hidden');
    this.restoreFocus();
  }

  async copyHandoffSummary() {
    const text = this.handoffSummary.textContent;
    try {
      await navigator.clipboard.writeText(text);
      this.toast('问题摘要已复制');
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(this.handoffSummary);
      selection.removeAllRanges();
      selection.addRange(range);
      this.toast('请长按或按⌘C复制摘要');
    }
  }

  handleSend() {
    const now = Date.now();
    if (now - this.lastSendTime < this.debounceDelay) return;
    if (this.isProcessing) {
      this.toast('正在处理中，请稍候');
      return;
    }

    const text = this.msgInput.value.trim();
    if (!text) return;
    this.lastSendTime = now;
    this.beginProcessing();
    this.addUserMessage(text);
    this.msgInput.value = '';
    this.updateComposer();

    if (isCrisis(text)) {
      this.addCrisisSupportMessage();
      this.showCrisisModal();
      this.resetProcessingState();
      return;
    }

    this.showTyping();
    this.fetchAIReply(text);
  }

  beginProcessing() {
    this.isProcessing = true;
    this.sendBtn.disabled = true;
    this.msgInput.disabled = true;
  }

  async fetchAIReply(text, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75000);
    try {
      const history = this.sessions[this.currentScene]
        .filter(message => message.who === 'user' || message.who === 'ai')
        .slice(-20)
        .map(message => ({
          role: message.who === 'user' ? 'user' : 'assistant',
          content: message.who === 'user' ? message.text : this.replyToPlainText(message.parts),
        }))
        .filter(message => message.content.trim());

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: this.currentScene, history }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || `服务器错误:${response.status}`);

      this.removeTyping();
      this.addAIMessage(
        { parts: [{ type: 'text', text: data.reply }] },
        { followupDepth: options.followupDepth || 0 }
      );
    } catch (error) {
      console.error('获取AI回复失败:', error.name);
      this.removeTyping();
      this.toast(error.name === 'AbortError' ? '回答超时，请稍后重试' : '获取回复失败，请稍后重试');
      this.addAIMessage(getAIReply(this.currentScene, text), { feedbackEligible: false });
    } finally {
      clearTimeout(timeout);
      this.resetProcessingState();
    }
  }

  showTyping() {
    const bubble = document.createElement('div');
    bubble.className = 'bubble typing';
    bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    const stack = document.createElement('div');
    stack.className = 'stack left';
    stack.appendChild(bubble);
    const row = document.createElement('div');
    row.className = 'row ai';
    row.append(this.createAvatar(), stack);
    this.typingEl = row;
    this.chatScreen.appendChild(row);
    this.scrollBottom();
  }

  removeTyping() {
    if (!this.typingEl) return;
    this.typingEl.remove();
    this.typingEl = null;
  }

  resetProcessingState() {
    this.isProcessing = false;
    this.sendBtn.disabled = false;
    this.msgInput.disabled = false;
    this.updateComposer();
    if (this.currentView === 'chat') this.msgInput.focus();
  }

  updateComposer() {
    this.msgInput.style.height = 'auto';
    this.msgInput.style.height = `${Math.min(this.msgInput.scrollHeight, 120)}px`;
    const hasText = Boolean(this.msgInput.value.trim());
    this.sendBtn.classList.toggle('ready', hasText && !this.isProcessing);
  }

  addCrisisSupportMessage() {
    this.addAIMessage({ parts: [{
      type: 'text',
      coral: true,
      text: '我注意到你提到了自杀、自伤或活不下去，我很担心你现在的安全。请先不要独处，立即远离可能伤害自己的物品，并联系一位你信任的人陪着你。\n\n如果危险正在发生、你已经采取行动或已经受伤，请立即拨打110或120。你也可以拨打全国心理援助热线12356，或安徽精神卫生中心24小时心理援助热线0551-63666903。\n\n如果方便，请只告诉我：你现在是“安全”，还是“有危险”？'
    }] }, { feedbackEligible: false });
  }

  showCrisisModal() {
    this.lastFocusedElement = document.activeElement;
    this.crisisModal.classList.remove('hidden');
    document.getElementById('crisisClose').focus();
  }

  closeCrisis() {
    this.crisisModal.classList.add('hidden');
    this.restoreFocus();
  }

  restoreFocus() {
    if (this.lastFocusedElement?.focus) this.lastFocusedElement.focus();
    this.lastFocusedElement = null;
  }

  updateProfileStats() {
    this.sessions.forEach((session, index) => {
      const count = session.filter(message => message.who === 'user').length;
      document.getElementById(`profileStat${index}`).textContent = String(count);
    });
  }

  replyToPlainText(parts = []) {
    return parts.map(part => {
      if (part.type === 'text' || part.type === 'source') return part.text || '';
      if (part.type === 'card') return [part.title, part.body].filter(Boolean).join('\n');
      return '';
    }).filter(Boolean).join('\n\n');
  }

  addTimestamp(timestamp = Date.now()) {
    const time = document.createElement('div');
    time.className = 'msg-time';
    const date = new Date(timestamp);
    time.textContent = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return time;
  }

  nextMessageId(prefix) {
    this.messageSequence += 1;
    return `${prefix}-${Date.now()}-${this.messageSequence}`;
  }

  toast(message) {
    this.toastElement.textContent = message;
    this.toastElement.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastElement.classList.remove('show'), 3000);
  }

  scrollBottom() {
    requestAnimationFrame(() => {
      this.chatScreen.scrollTop = this.chatScreen.scrollHeight;
    });
  }
}
