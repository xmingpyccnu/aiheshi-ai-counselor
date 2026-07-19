function voiceErrorMessage(code) {
  const messages = {
    'not-allowed': '未获得麦克风权限，请在浏览器设置中允许后重试。',
    'service-not-allowed': '当前浏览器禁止语音识别，请改用文本输入。',
    'no-speech': '未检测到语音，请靠近麦克风后重试。',
    network: '语音识别网络异常，请改用文本输入。',
    aborted: '已停止语音输入。',
  };
  return messages[code] || '语音识别失败，请改用文本输入。';
}

function createVoiceController({
  root = globalThis,
  onTranscript = () => {},
  onState = () => {},
  onError = () => {},
} = {}) {
  const Recognition = root?.SpeechRecognition || root?.webkitSpeechRecognition;
  if (!Recognition) {
    return {
      supported: false,
      listening: false,
      start: () => false,
      stop: () => false,
      toggle: () => false,
      cancel: () => false,
    };
  }

  let generation = 0;
  let active = null;
  let state = 'idle';

  const emitState = (nextState, force = false) => {
    if (!force && state === nextState) return;
    state = nextState;
    onState(nextState);
  };

  const finish = token => {
    if (token !== generation) return;
    active = null;
    emitState('idle');
  };

  const start = () => {
    if (active) return false;
    const token = generation + 1;
    generation = token;
    let recognition;
    try {
      recognition = new Recognition();
      recognition.lang = 'zh-CN';
      recognition.interimResults = false;
      recognition.continuous = false;
      active = { token, recognition, stopRequested: false };

      recognition.onstart = () => {
        if (token !== generation || active?.token !== token) return;
        emitState('listening');
      };
      recognition.onresult = event => {
        if (token !== generation || active?.token !== token) return;
        const transcript = Array.from(event?.results || [])
          .map(result => result?.[0]?.transcript || '')
          .join('')
          .trim();
        if (transcript) onTranscript(transcript);
      };
      recognition.onerror = event => {
        if (token !== generation || active?.token !== token) return;
        onError(voiceErrorMessage(event?.error));
        finish(token);
      };
      recognition.onend = () => finish(token);
      recognition.start();
      return true;
    } catch {
      generation += 1;
      active = null;
      onError(voiceErrorMessage('start-failed'));
      emitState('idle', true);
      return false;
    }
  };

  const stop = () => {
    if (!active || active.stopRequested) return false;
    const { token, recognition } = active;
    active.stopRequested = true;
    try {
      recognition.stop();
      return true;
    } catch {
      if (token === generation) {
        generation += 1;
        active = null;
        onError(voiceErrorMessage('aborted'));
        emitState('idle');
      }
      return false;
    }
  };

  const cancel = () => {
    if (!active) return false;
    const recognition = active.recognition;
    generation += 1;
    active = null;
    emitState('idle');
    try {
      if (typeof recognition.abort === 'function') recognition.abort();
      else recognition.stop();
    } catch {
      // The session is already invalidated, so a browser stop error is harmless.
    }
    return true;
  };

  return {
    supported: true,
    get listening() { return state === 'listening'; },
    start,
    stop,
    toggle: () => active ? stop() : start(),
    cancel,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createVoiceController, voiceErrorMessage };
}

if (typeof globalThis !== 'undefined') {
  globalThis.createVoiceController = createVoiceController;
  globalThis.voiceErrorMessage = voiceErrorMessage;
}
