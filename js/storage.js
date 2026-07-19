(function initLocalStorageModule(root) {
  'use strict';

  const STORAGE_KEY = 'aihesh.local.v2';
  const LEGACY_STORAGE_KEY = 'aihesh.local.v1';
  const ALLOWED_SCENES = new Set([0, 1, 3]);
  const ALLOWED_GRADES = new Set(['', 'freshman', 'sophomore', 'junior', 'senior']);
  const ALLOWED_PART_TYPES = new Set(['text', 'source', 'card']);
  const ALLOWED_FEEDBACK_STATUSES = new Set(['resolved', 'unresolved']);
  const MAX_RAW_JSON_LENGTH = 1024 * 1024;
  const MAX_SESSION_SCAN = 200;
  const MAX_PART_SCAN = 48;

  function defaultState() {
    return {
      version: 2,
      profile: { grade: '', major: '', goal: '' },
      sessions: { 0: [], 1: [], 3: [] },
      sessionRevisions: { 0: 0, 1: 0, 3: 0 },
    };
  }

  function cleanText(value, limit) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, limit);
  }

  function cleanProfile(profile) {
    const candidate = profile && typeof profile === 'object' && !Array.isArray(profile)
      ? profile
      : {};
    const grade = typeof candidate.grade === 'string' && ALLOWED_GRADES.has(candidate.grade)
      ? candidate.grade
      : '';
    return {
      grade,
      major: cleanText(candidate.major, 40),
      goal: cleanText(candidate.goal, 120),
    };
  }

  function cleanId(value) {
    return typeof value === 'string' ? value.slice(0, 80) : undefined;
  }

  function cleanCreatedAt(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
  }

  function cleanPart(part) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return null;
    if (!ALLOWED_PART_TYPES.has(part.type)) return null;

    const cleaned = { type: part.type };
    const text = cleanText(part.text, 8_000);
    const title = cleanText(part.title, 200);
    const body = cleanText(part.body, 8_000);

    if (part.type === 'text' || part.type === 'source') {
      if (!text) return null;
      cleaned.text = text;
    } else {
      if (!title && !body) return null;
      if (title) cleaned.title = title;
      if (body) cleaned.body = body;
    }

    if (Object.hasOwn(part, 'coral')) cleaned.coral = Boolean(part.coral);
    return cleaned;
  }

  function withCommonMessageFields(cleaned, message) {
    const id = cleanId(message.id);
    if (id !== undefined) cleaned.id = id;
    cleaned.createdAt = cleanCreatedAt(message.createdAt);
    return cleaned;
  }

  function cleanMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;

    if (message.who === 'user') {
      const text = cleanText(message.text, 8_000);
      if (!text) return null;
      return withCommonMessageFields({ who: 'user', text }, message);
    }

    if (message.who === 'ai') {
      if (!Array.isArray(message.parts)) return null;
      const parts = [];
      const scanLimit = Math.min(message.parts.length, MAX_PART_SCAN);
      for (let index = 0; index < scanLimit && parts.length < 12; index += 1) {
        const part = cleanPart(message.parts[index]);
        if (part) parts.push(part);
      }
      if (parts.length === 0) return null;

      const cleaned = withCommonMessageFields({ who: 'ai', parts }, message);
      if (Object.hasOwn(message, 'feedbackEligible')) {
        cleaned.feedbackEligible = Boolean(message.feedbackEligible);
      }
      cleaned.feedbackStatus = ALLOWED_FEEDBACK_STATUSES.has(message.feedbackStatus)
        ? message.feedbackStatus
        : null;
      if (Number.isFinite(message.followupDepth)) {
        cleaned.followupDepth = Math.trunc(message.followupDepth);
      }
      return cleaned;
    }

    return null;
  }

  function cleanMessages(messages) {
    if (!Array.isArray(messages)) return [];
    const cleaned = [];
    const start = Math.max(0, messages.length - MAX_SESSION_SCAN);
    for (let index = start; index < messages.length; index += 1) {
      const message = cleanMessage(messages[index]);
      if (message) cleaned.push(message);
    }
    return cleaned.slice(-40);
  }

  function cleanRevision(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function cleanState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 2) {
      return defaultState();
    }

    const sessions = value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)
      ? value.sessions
      : {};
    const revisions = value.sessionRevisions
      && typeof value.sessionRevisions === 'object'
      && !Array.isArray(value.sessionRevisions)
      ? value.sessionRevisions
      : {};
    return {
      version: 2,
      profile: cleanProfile(value.profile),
      sessions: {
        0: cleanMessages(sessions[0]),
        1: cleanMessages(sessions[1]),
        3: cleanMessages(sessions[3]),
      },
      sessionRevisions: {
        0: cleanRevision(revisions[0]),
        1: cleanRevision(revisions[1]),
        3: cleanRevision(revisions[3]),
      },
    };
  }

  function migrateLegacyState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
      return defaultState();
    }
    const legacySessions = value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)
      ? value.sessions
      : {};
    const legacyGenerations = value.sessionGenerations
      && typeof value.sessionGenerations === 'object'
      && !Array.isArray(value.sessionGenerations)
      ? value.sessionGenerations
      : {};
    return {
      version: 2,
      profile: cleanProfile(value.profile),
      sessions: {
        0: cleanMessages(legacySessions[0]),
        1: cleanMessages(legacySessions[1]),
        3: cleanMessages(legacySessions[3]),
      },
      sessionRevisions: {
        0: cleanRevision(legacyGenerations[0]),
        1: cleanRevision(legacyGenerations[1]),
        3: cleanRevision(legacyGenerations[3]),
      },
    };
  }

  function createLocalStateStore(storage) {
    function normalizeSession(messages) {
      return cleanMessages(messages);
    }

    function readRaw(key) {
      let raw;
      try {
        raw = storage.getItem(key);
      } catch (_error) {
        return { status: 'unavailable' };
      }

      if (raw === null) return { status: 'missing' };
      if (typeof raw !== 'string' || raw.length > MAX_RAW_JSON_LENGTH) {
        return { status: 'invalid' };
      }

      try {
        return { status: 'valid', value: JSON.parse(raw) };
      } catch (_error) {
        return { status: 'invalid' };
      }
    }

    function write(state) {
      try {
        const raw = JSON.stringify(state);
        if (raw.length > MAX_RAW_JSON_LENGTH) return false;
        storage.setItem(STORAGE_KEY, raw);
        return true;
      } catch (_error) {
        return false;
      }
    }

    function readState() {
      const current = readRaw(STORAGE_KEY);
      if (current.status === 'unavailable') {
        return { canWrite: false, state: defaultState() };
      }
      if (current.status === 'valid') {
        if (!current.value || current.value.version !== 2) {
          return { canWrite: false, state: defaultState() };
        }
        return { canWrite: true, state: cleanState(current.value) };
      }
      if (current.status === 'invalid') {
        return { canWrite: false, state: defaultState() };
      }

      const legacy = readRaw(LEGACY_STORAGE_KEY);
      if (legacy.status === 'unavailable') {
        return { canWrite: false, state: defaultState() };
      }
      const state = legacy.status === 'valid'
        ? migrateLegacyState(legacy.value)
        : defaultState();
      return { canWrite: write(state), state };
    }

    function load() {
      return readState().state;
    }

    function failure(reason, extras = {}) {
      return { ok: false, reason, ...extras };
    }

    function saveProfile(profile) {
      const result = readState();
      if (!result.canWrite) return false;
      const state = result.state;
      state.profile = cleanProfile(profile);
      return write(state);
    }

    function saveSession(scene, messages, expectedRevision) {
      if (!ALLOWED_SCENES.has(scene) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return failure('invalid');
      }
      const result = readState();
      if (!result.canWrite) return failure('unavailable');
      const state = result.state;
      const currentRevision = state.sessionRevisions[scene];
      if (expectedRevision !== currentRevision) {
        return failure('conflict', { revision: currentRevision, state });
      }
      if (currentRevision >= Number.MAX_SAFE_INTEGER) return failure('unavailable');
      state.sessions[scene] = normalizeSession(messages);
      state.sessionRevisions[scene] = currentRevision + 1;
      const saved = write(state);
      return saved
        ? { ok: true, revision: state.sessionRevisions[scene] }
        : failure('unavailable');
    }

    function clearSession(scene, expectedRevision) {
      if (!ALLOWED_SCENES.has(scene) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return failure('invalid');
      }
      const result = readState();
      if (!result.canWrite) return failure('unavailable');
      const state = result.state;
      const currentRevision = state.sessionRevisions[scene];
      if (expectedRevision !== currentRevision) {
        return failure('conflict', { revision: currentRevision, state });
      }
      if (currentRevision >= Number.MAX_SAFE_INTEGER) return failure('unavailable');
      state.sessions[scene] = [];
      state.sessionRevisions[scene] = currentRevision + 1;
      return write(state)
        ? { ok: true, revision: state.sessionRevisions[scene] }
        : failure('unavailable');
    }

    function clearAllSessions(expectedRevisions) {
      if (!expectedRevisions || typeof expectedRevisions !== 'object') return failure('invalid');
      const result = readState();
      if (!result.canWrite) return failure('unavailable');
      const state = result.state;
      const hasConflict = [0, 1, 3].some(scene => (
        expectedRevisions[scene] !== state.sessionRevisions[scene]
      ));
      if (hasConflict) {
        return failure('conflict', { revisions: { ...state.sessionRevisions }, state });
      }
      if ([0, 1, 3].some(scene => state.sessionRevisions[scene] >= Number.MAX_SAFE_INTEGER)) {
        return failure('unavailable');
      }
      state.sessions = { 0: [], 1: [], 3: [] };
      for (const scene of ALLOWED_SCENES) {
        state.sessionRevisions[scene] += 1;
      }
      return write(state)
        ? { ok: true, revisions: { ...state.sessionRevisions } }
        : failure('unavailable');
    }

    return {
      storageKey: STORAGE_KEY,
      load,
      normalizeSession,
      saveProfile,
      saveSession,
      clearSession,
      clearAllSessions,
    };
  }

  const publicApi = { defaultState, createLocalStateStore };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  } else if (root) {
    root.defaultState = defaultState;
    root.createLocalStateStore = createLocalStateStore;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
