class ChatApp {
  constructor() {
    this.currentScene = 0;
    this.currentView = 'home';
    this.localStore = createLocalStateStore(window.localStorage);
    const localState = this.localStore.load();
    this.profile = localState.profile;
    this.sessions = [localState.sessions[0], localState.sessions[1], [], localState.sessions[3]];
    this.sessionRevisions = localState.sessionRevisions;
    this.typingEl = null;
    this.lastFocusedElement = null;
    this.isProcessing = false;
    this.lastSendTime = 0;
    this.debounceDelay = 500;
    this.messageSequence = 0;
    this.roundSaveFailed = false;
    this.roundNetworkFailed = false;
    this.roundNetworkMessage = '';
    this.roundConflict = false;
    this.roundSequence = 0;
    this.currentRound = 0;
    this.activeRequest = null;
    this.pendingProfileRender = false;
    this.lastPersistenceResult = null;
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
    this.profileForm = document.getElementById('profileForm');
    this.gradeSelect = document.getElementById('gradeSelect');
    this.majorInput = document.getElementById('majorInput');
    this.goalInput = document.getElementById('goalInput');
    this.careerTrack = document.getElementById('careerTrack');
    this.historyList = document.getElementById('historyList');

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
    this.profileForm.addEventListener('submit', event => this.handleProfileSubmit(event));
    this.gradeSelect.addEventListener('change', () => this.renderCareerTrack(this.gradeSelect.value));
    document.getElementById('clearAllHistory').addEventListener('click', () => this.clearAllHistory());

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
    window.addEventListener('storage', event => this.handleStorageEvent(event));

    this.renderProfileForm();
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

    if (view === 'profile') {
      this.updateProfileStats();
      this.renderCareerTrack();
      this.renderHistoryList();
    }
    if (view === 'chat') {
      this.flushPendingProfileRender();
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
    const scene = this.getCurrentSceneConfig();
    this.navScene.textContent = scene.name;
    this.safetyBar.classList.toggle('hidden', this.currentScene !== 2);
    this.fabBtn.classList.toggle('hidden', this.currentScene !== 2);
    this.chatScreen.innerHTML = '';
    this.addWelcomeMessage(scene);
    this.addQuickButtons(scene.tabs);

    for (const message of this.sessions[this.currentScene]) {
      if (message.who === 'user') {
        this.addUserMessage(message.text, { save: false, message, scene: this.currentScene });
      }
      if (message.who === 'ai') {
        this.addAIMessage({ parts: message.parts }, { save: false, message, scene: this.currentScene });
      }
    }
    this.scrollBottom();
    if (this.currentScene === 1) this.pendingProfileRender = false;
  }

  addWelcomeMessage(scene) {
    const row = document.createElement('div');
    row.className = 'row ai welcome-row';
    row.appendChild(this.createAvatar());

    const stack = document.createElement('div');
    stack.className = 'stack left';
    const label = document.createElement('div');
    label.className = 'assistant-label';
    label.textContent = `${scene.name} · ${scene.version || '服务说明'}`;
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
    const targetScene = Number.isInteger(options.scene) ? options.scene : this.currentScene;
    let message = options.message || {
      who: 'user',
      id: this.nextMessageId('user'),
      text,
      createdAt: Date.now(),
    };

    let normalizationChanged = false;
    if (options.save !== false) {
      const unnormalized = [...this.sessions[targetScene], message];
      this.sessions[targetScene].push(message);
      this.sessions[targetScene] = this.localStore.normalizeSession(this.sessions[targetScene]);
      normalizationChanged = JSON.stringify(unnormalized) !== JSON.stringify(this.sessions[targetScene]);
      const persistenceResult = this.persistCurrentSession(targetScene);
      this.notePersistenceResult(persistenceResult);
      message = this.sessions[targetScene].find(candidate => candidate.id === message.id) || message;
    }

    const persistenceConflict = options.save !== false
      && this.getLastPersistenceResult()?.reason === 'conflict';
    if (targetScene === this.currentScene && normalizationChanged && !persistenceConflict) {
      this.renderCurrentSession();
    } else if (targetScene === this.currentScene && !persistenceConflict) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble user';
      bubble.textContent = message.text;
      const stack = document.createElement('div');
      stack.className = 'stack right';
      stack.append(bubble, this.addTimestamp(message.createdAt));
      const row = document.createElement('div');
      row.className = 'row user';
      row.dataset.messageId = message.id;
      row.appendChild(stack);
      this.chatScreen.appendChild(row);
    }

    if (targetScene === this.currentScene) this.scrollBottom();
    return message;
  }

  addAIMessage(reply, options = {}) {
    const targetScene = Number.isInteger(options.scene) ? options.scene : this.currentScene;
    let message = options.message || {
      who: 'ai',
      id: this.nextMessageId('ai'),
      parts: reply.parts,
      createdAt: Date.now(),
      feedbackEligible: options.feedbackEligible !== false,
      feedbackStatus: null,
      followupDepth: options.followupDepth || 0,
    };

    let normalizationChanged = false;
    if (options.save !== false) {
      const unnormalized = [...this.sessions[targetScene], message];
      this.sessions[targetScene].push(message);
      this.sessions[targetScene] = this.localStore.normalizeSession(this.sessions[targetScene]);
      normalizationChanged = JSON.stringify(unnormalized) !== JSON.stringify(this.sessions[targetScene]);
      const persistenceResult = this.persistCurrentSession(targetScene);
      this.notePersistenceResult(persistenceResult);
      message = this.sessions[targetScene].find(candidate => candidate.id === message.id) || message;
    }

    const persistenceConflict = options.save !== false
      && this.getLastPersistenceResult()?.reason === 'conflict';
    if (targetScene === this.currentScene && normalizationChanged && !persistenceConflict) {
      this.renderCurrentSession();
    } else if (targetScene === this.currentScene && !persistenceConflict) {
      const stack = document.createElement('div');
      stack.className = 'stack left';
      for (const part of message.parts) {
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
      if (message.feedbackEligible) this.addFeedbackActions(stack, message, targetScene);

      const row = document.createElement('div');
      row.className = 'row ai';
      row.dataset.messageId = message.id;
      row.append(this.createAvatar(), stack);
      this.chatScreen.appendChild(row);
    }

    if (targetScene === this.currentScene) this.scrollBottom();
    return message;
  }

  addFeedbackActions(stack, message, targetScene) {
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
      this.syncFeedbackStatus(targetScene, message);
      const result = this.handleStandalonePersistenceResult(
        this.persistCurrentSession(targetScene),
        targetScene
      );
      if (result.reason === 'conflict') return;
      this.replaceFeedbackState(actions, '已标记为解决');
    });
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = '未解决';
    no.addEventListener('click', () => {
      message.feedbackStatus = 'unresolved';
      this.syncFeedbackStatus(targetScene, message);
      this.replaceFeedbackState(actions, message.followupDepth >= 1 ? '转入人工协助' : '正在补充回答…');
      if (message.followupDepth >= 1) {
        const result = this.handleStandalonePersistenceResult(
          this.persistCurrentSession(targetScene),
          targetScene
        );
        if (result.reason === 'conflict') return;
        this.showHumanHandoff(message);
      } else {
        this.requestSecondAnswer(message, targetScene);
      }
    });
    actions.append(label, yes, no);
    stack.appendChild(actions);
  }

  syncFeedbackStatus(targetScene, message) {
    const storedMessage = this.sessions[targetScene]
      .find(candidate => candidate.id === message.id);
    if (storedMessage) storedMessage.feedbackStatus = message.feedbackStatus;
  }

  replaceFeedbackState(actions, text) {
    const state = document.createElement('span');
    state.className = 'feedback-state';
    state.textContent = text;
    actions.replaceChildren(state);
  }

  requestSecondAnswer(message, requestScene = this.currentScene) {
    if (this.isProcessing) return;
    const prompt = '这个回答没有解决我的问题。请回到我原来的问题，补充明确的制度依据、适用条件、具体步骤和可行的替代方案；不确定的信息请直接说明。';
    this.beginProcessing();
    this.notePersistenceResult(this.persistCurrentSession(requestScene));
    if (this.getLastPersistenceResult()?.reason === 'conflict') {
      this.cancelRoundForConflict();
      return;
    }
    this.addUserMessage(prompt, { scene: requestScene });
    if (this.getLastPersistenceResult()?.reason === 'conflict') {
      this.cancelRoundForConflict();
      return;
    }
    const requestRevision = this.getSceneRevision(requestScene);
    if (requestScene === this.currentScene) this.showTyping();
    this.fetchAIReply(prompt, {
      followupDepth: (message.followupDepth || 0) + 1,
      scene: requestScene,
      revision: requestRevision,
    });
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
    const requestScene = this.currentScene;
    this.lastSendTime = now;
    this.beginProcessing();
    this.addUserMessage(text, { scene: requestScene });
    if (this.getLastPersistenceResult()?.reason === 'conflict') {
      this.cancelRoundForConflict();
      return;
    }
    const requestRevision = this.getSceneRevision(requestScene);
    this.msgInput.value = '';
    this.updateComposer();

    if (isCrisis(text)) {
      this.addCrisisSupportMessage(requestScene);
      this.showCrisisModal();
      this.finishProcessingRound();
      this.resetProcessingState();
      return;
    }

    this.showTyping();
    this.fetchAIReply(text, { scene: requestScene, revision: requestRevision });
  }

  beginProcessing() {
    this.isProcessing = true;
    this.roundSequence = (Number.isSafeInteger(this.roundSequence) ? this.roundSequence : 0) + 1;
    this.currentRound = this.roundSequence;
    this.roundSaveFailed = false;
    this.roundNetworkFailed = false;
    this.roundNetworkMessage = '';
    this.roundConflict = false;
    this.activeRequest = null;
    this.lastPersistenceResult = null;
    this.sendBtn.disabled = true;
    this.msgInput.disabled = true;
  }

  async fetchAIReply(text, options = {}) {
    const requestScene = Number.isInteger(options.scene) ? options.scene : this.currentScene;
    const requestRevision = Number.isSafeInteger(options.revision)
      ? options.revision
      : this.getSceneRevision(requestScene);
    this.activeRequest = {
      scene: requestScene,
      revision: requestRevision,
      round: this.currentRound,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 75000);
    try {
      const beforeNormalization = JSON.stringify(this.sessions[requestScene]);
      this.sessions[requestScene] = this.localStore.normalizeSession(this.sessions[requestScene]);
      if (
        requestScene === this.currentScene
        && beforeNormalization !== JSON.stringify(this.sessions[requestScene])
      ) {
        this.renderCurrentSession();
        this.typingEl = null;
        if (this.isProcessing) this.showTyping();
      }
      const history = this.sessions[requestScene]
        .filter(message => message.who === 'user' || message.who === 'ai')
        .slice(-20)
        .map(message => ({
          role: message.who === 'user' ? 'user' : 'assistant',
          content: (message.who === 'user'
            ? message.text
            : this.replyToPlainText(message.parts)).slice(0, 8_000),
        }))
        .filter(message => message.content.trim());

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene: requestScene,
          history,
          profile: requestScene === 1 ? this.profile : undefined,
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.error || `服务器错误:${response.status}`);
      if (!this.isRequestRevisionCurrent(requestScene, requestRevision)) {
        this.removeTyping();
        return;
      }

      this.removeTyping();
      this.addAIMessage(
        { parts: [{ type: 'text', text: data.reply }] },
        { followupDepth: options.followupDepth || 0, scene: requestScene }
      );
      this.resolveReplyPersistenceConflict(requestScene);
    } catch (error) {
      console.error('获取AI回复失败:', error.name);
      this.removeTyping();
      if (!this.isRequestRevisionCurrent(requestScene, requestRevision)) return;
      this.roundNetworkFailed = true;
      this.roundNetworkMessage = error.name === 'AbortError'
        ? '获取回复失败（回答超时），请稍后重试'
        : '获取回复失败，请稍后重试';
      this.addAIMessage(getAIReply(requestScene, text), {
        feedbackEligible: false,
        scene: requestScene,
      });
      this.resolveReplyPersistenceConflict(requestScene);
    } finally {
      clearTimeout(timeout);
      this.finishProcessingRound();
      this.resetProcessingState();
      this.activeRequest = null;
      this.flushPendingProfileRender();
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

  notePersistenceResult(result) {
    const persistenceResult = this.normalizePersistenceResult(result);
    this.lastPersistenceResult = persistenceResult;
    this.roundSaveFailed = persistenceResult.ok === false && persistenceResult.reason !== 'conflict';
  }

  normalizePersistenceResult(result) {
    if (result && typeof result === 'object' && typeof result.ok === 'boolean') return result;
    if (result === true) return { ok: true, revision: null };
    return { ok: false, reason: 'unavailable' };
  }

  getLastPersistenceResult() {
    return this.normalizePersistenceResult(this.lastPersistenceResult);
  }

  cancelRoundForConflict() {
    const conflict = this.getLastPersistenceResult();
    this.applyLocalState(conflict.state || this.localStore.load());
    if (this.currentScene !== 2) this.renderCurrentSession();
    this.roundSaveFailed = false;
    this.roundNetworkFailed = false;
    this.roundNetworkMessage = '';
    this.roundConflict = false;
    this.activeRequest = null;
    this.toast('对话已在其他页面更新，请重试');
    this.resetProcessingState();
  }

  resolveReplyPersistenceConflict(requestScene) {
    const conflict = this.getLastPersistenceResult();
    if (conflict.reason !== 'conflict') return false;
    this.applyLocalState(conflict.state || this.localStore.load());
    if (requestScene === this.currentScene && requestScene !== 2) this.renderCurrentSession();
    this.roundSaveFailed = false;
    this.roundNetworkFailed = false;
    this.roundNetworkMessage = '';
    this.roundConflict = true;
    return true;
  }

  handleStandalonePersistenceResult(result, targetScene) {
    const persistenceResult = this.normalizePersistenceResult(result);
    if (persistenceResult.ok) return persistenceResult;
    if (persistenceResult.reason === 'conflict') {
      this.applyLocalState(persistenceResult.state || this.localStore.load());
      if (targetScene === this.currentScene && targetScene !== 2) this.renderCurrentSession();
      this.toast('对话已在其他页面更新，请重试');
      return persistenceResult;
    }
    this.toast('对话未能保存');
    return persistenceResult;
  }

  finishProcessingRound() {
    let message = '';
    if (this.roundConflict) {
      message = '对话已在其他页面更新，请重试';
    } else if (this.roundNetworkFailed) {
      message = this.roundNetworkMessage;
      if (this.roundSaveFailed) message += '；当前对话未保存';
    } else if (this.roundSaveFailed) {
      message = '对话未能保存';
    }
    if (message) this.toast(message);
    this.roundSaveFailed = false;
    this.roundNetworkFailed = false;
    this.roundNetworkMessage = '';
    this.roundConflict = false;
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

  addCrisisSupportMessage(requestScene = this.currentScene) {
    this.addAIMessage({ parts: [{
      type: 'text',
      coral: true,
      text: '我注意到你提到了自杀、自伤或活不下去，我很担心你现在的安全。请先不要独处，立即远离可能伤害自己的物品，并联系一位你信任的人陪着你。\n\n如果危险正在发生、你已经采取行动或已经受伤，请立即拨打110或120。你也可以拨打全国心理援助热线12356，或安徽精神卫生中心24小时心理援助热线0551-63666903。\n\n如果方便，请只告诉我：你现在是“安全”，还是“有危险”？'
    }] }, { feedbackEligible: false, scene: requestScene });
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

  getCurrentSceneConfig() {
    const scene = SCENES[this.currentScene];
    if (this.currentScene !== 1) return scene;
    const career = getCareerTrack(this.profile.grade);
    return {
      ...scene,
      welcome: career.welcome,
      tabs: career.tabs,
      version: career.version,
    };
  }

  renderProfileForm() {
    this.gradeSelect.value = this.profile.grade;
    this.majorInput.value = this.profile.major;
    this.goalInput.value = this.profile.goal;
    this.renderCareerTrack();
  }

  handleProfileSubmit(event) {
    event.preventDefault();
    if (this.isProcessing) {
      this.toast('请等待当前回答完成后再保存资料');
      return;
    }
    const nextProfile = {
      grade: this.gradeSelect.value,
      major: this.majorInput.value.trim().slice(0, 40),
      goal: this.goalInput.value.trim().slice(0, 120),
    };

    if (!this.localStore.saveProfile(nextProfile)) {
      this.toast('本地资料保存失败，请检查浏览器存储设置');
      return;
    }

    this.profile = nextProfile;
    this.renderProfileForm();
    if (this.currentScene === 1) this.renderCurrentSession();
    this.toast('本地资料已保存');
  }

  renderCareerTrack(grade = this.profile.grade) {
    const track = getCareerTrack(grade);
    const heading = document.createElement('strong');
    heading.textContent = `学业与生涯成长 · ${track.version}`;
    const description = document.createElement('p');
    description.textContent = track.topics.length
      ? `当前建议重点：${track.topics.join('、')}`
      : '未选择年级，将使用通用版学业与生涯建议。';
    this.careerTrack.replaceChildren(heading, description);
  }

  persistCurrentSession(targetScene = this.currentScene) {
    if (targetScene === 2) {
      const result = { ok: true, revision: null };
      this.lastPersistenceResult = result;
      return true;
    }
    const normalized = this.localStore.normalizeSession(this.sessions[targetScene]);
    const saved = this.localStore.saveSession(
      targetScene,
      normalized,
      this.getSceneRevision(targetScene)
    );
    const result = this.normalizePersistenceResult(saved);
    this.lastPersistenceResult = result;
    if (!result.ok) return saved;

    this.sessions[targetScene] = normalized;
    if (Number.isSafeInteger(result.revision)) {
      this.sessionRevisions[targetScene] = result.revision;
    }
    return saved;
  }

  getSceneRevision(sceneIndex) {
    if (sceneIndex === 2) return null;
    const revision = this.sessionRevisions?.[sceneIndex];
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
  }

  isRequestRevisionCurrent(sceneIndex, requestRevision) {
    if (sceneIndex === 2) return true;
    return requestRevision === this.getSceneRevision(sceneIndex);
  }

  applyLocalState(localState) {
    this.profile = localState.profile;
    this.sessions[0] = localState.sessions[0];
    this.sessions[1] = localState.sessions[1];
    this.sessions[3] = localState.sessions[3];
    this.sessionRevisions = localState.sessionRevisions;
  }

  handleStorageEvent(event) {
    const isExternalClear = event.key === null;
    if (!isExternalClear && event.key !== this.localStore.storageKey) return;

    const previousProfile = JSON.stringify(this.profile);
    const previousSessions = {
      0: JSON.stringify(this.sessions[0]),
      1: JSON.stringify(this.sessions[1]),
      3: JSON.stringify(this.sessions[3]),
    };
    const previousRevisions = { ...this.sessionRevisions };
    // load() also recreates an empty v2 record after another page calls
    // localStorage.clear(); this document will not receive an event for its own write.
    const localState = this.localStore.load();
    const profileChanged = previousProfile !== JSON.stringify(localState.profile);
    const changedScenes = [0, 1, 3].filter(sceneIndex => (
      previousSessions[sceneIndex] !== JSON.stringify(localState.sessions[sceneIndex])
      || previousRevisions[sceneIndex] !== localState.sessionRevisions[sceneIndex]
    ));

    if (
      this.isProcessing
      && this.activeRequest
      && this.activeRequest.round === this.currentRound
      && this.activeRequest.scene !== 2
      && this.activeRequest.revision !== localState.sessionRevisions[this.activeRequest.scene]
    ) {
      this.roundConflict = true;
      this.roundSaveFailed = false;
      this.roundNetworkFailed = false;
      this.roundNetworkMessage = '';
    }

    this.applyLocalState(localState);

    let renderedCurrentSession = false;
    const shouldDeferGrowthRender = profileChanged
      && this.isProcessing
      && this.currentScene === 1
      && this.currentView === 'chat';
    if (
      this.currentScene !== 2
      && changedScenes.includes(this.currentScene)
      && !shouldDeferGrowthRender
    ) {
      this.renderCurrentSession();
      renderedCurrentSession = true;
    }
    if (profileChanged && this.currentScene === 1 && this.currentView === 'chat') {
      if (this.isProcessing && !renderedCurrentSession) {
        this.pendingProfileRender = true;
      } else if (!renderedCurrentSession) {
        this.renderCurrentSession();
        renderedCurrentSession = true;
      }
    }
    if (profileChanged) this.renderProfileForm();
    if (this.currentView === 'profile') {
      this.updateProfileStats();
      this.renderHistoryList();
    } else if (isExternalClear) {
      this.renderHistoryList();
    }
  }

  flushPendingProfileRender() {
    if (!this.pendingProfileRender) return;
    if (this.currentScene !== 1 || this.currentView !== 'chat') return;
    this.renderCurrentSession();
  }

  renderHistoryList() {
    const sceneIndexes = [0, 1, 3];
    this.historyList.replaceChildren();

    sceneIndexes.forEach(sceneIndex => {
      const session = this.sessions[sceneIndex];
      const sceneName = SCENES[sceneIndex].name;
      const item = document.createElement('article');
      item.className = 'history-item';

      const summary = document.createElement('div');
      summary.className = 'history-summary';
      const title = document.createElement('strong');
      title.textContent = sceneName;
      const count = document.createElement('span');
      count.textContent = `${session.length}条消息`;
      const recent = [...session].reverse().find(message => message.who === 'user');
      const excerpt = document.createElement('p');
      excerpt.textContent = recent
        ? this.summarizeHistoryQuestion(recent.text)
        : '暂无本地记录';
      summary.append(title, count, excerpt);

      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = '恢复对话';
      restore.setAttribute('aria-label', `恢复${sceneName}对话`);
      restore.disabled = session.length === 0;
      restore.addEventListener('click', () => this.restoreHistory(sceneIndex));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'history-delete';
      remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除${sceneName}本地历史`);
      remove.disabled = session.length === 0;
      remove.addEventListener('click', () => this.deleteHistory(sceneIndex));
      actions.append(restore, remove);

      item.append(summary, actions);
      this.historyList.appendChild(item);
    });
  }

  summarizeHistoryQuestion(text) {
    const compact = text.trim().replace(/\s+/g, ' ');
    return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
  }

  restoreHistory(sceneIndex) {
    if (this.isProcessing) {
      this.toast('请等待当前回答完成后再恢复对话');
      return;
    }
    this.currentScene = sceneIndex;
    this.renderCurrentSession();
    this.navigateTo('chat');
  }

  deleteHistory(sceneIndex) {
    if (this.isProcessing) {
      this.toast('请等待当前回答完成后再删除历史');
      return;
    }
    if (!window.confirm('只删除当前设备上的该模块历史，是否继续？')) return;
    const result = this.normalizePersistenceResult(
      this.localStore.clearSession(sceneIndex, this.getSceneRevision(sceneIndex))
    );
    if (!result.ok) {
      if (result.reason === 'conflict') {
        this.applyLocalState(result.state || this.localStore.load());
        if (this.currentScene === sceneIndex) this.renderCurrentSession();
        this.updateProfileStats();
        this.renderHistoryList();
        this.toast('对话已在其他页面更新，请重试');
        return;
      }
      this.toast('本地历史删除失败');
      return;
    }

    this.sessions[sceneIndex] = [];
    this.sessionRevisions[sceneIndex] = result.revision;
    if (this.currentScene === sceneIndex) this.renderCurrentSession();
    this.updateProfileStats();
    this.renderHistoryList();
    this.historyList.tabIndex = -1;
    this.historyList.focus();
    this.toast('该模块本地历史已删除');
  }

  clearAllHistory() {
    if (this.isProcessing) {
      this.toast('请等待当前回答完成后再清空历史');
      return;
    }
    if (!window.confirm('将清除当前设备上的校园、成长和事务历史，是否继续？')) return;
    const result = this.normalizePersistenceResult(
      this.localStore.clearAllSessions({ ...this.sessionRevisions })
    );
    if (!result.ok) {
      if (result.reason === 'conflict') {
        this.applyLocalState(result.state || this.localStore.load());
        if (this.currentScene !== 2) this.renderCurrentSession();
        this.updateProfileStats();
        this.renderHistoryList();
        this.toast('对话已在其他页面更新，请重试');
        return;
      }
      this.toast('本地历史清空失败');
      return;
    }

    this.sessions[0] = [];
    this.sessions[1] = [];
    this.sessions[3] = [];
    this.sessionRevisions = result.revisions;
    if (this.currentScene !== 2) this.renderCurrentSession();
    this.updateProfileStats();
    this.renderHistoryList();
    this.historyList.tabIndex = -1;
    this.historyList.focus();
    this.toast('本地历史已清空');
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
