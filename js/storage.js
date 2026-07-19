(function initLocalStorageModule(root) {
  'use strict';

  const STORAGE_KEY = 'aihesh.local.v3';
  const LOCK_NAME = 'aihesh.local.v3.root';
  const V2_STORAGE_KEY = 'aihesh.local.v2';
  const V1_STORAGE_KEY = 'aihesh.local.v1';
  const ALLOWED_SCENES = new Set([0, 1, 3]);
  const ALLOWED_GRADES = new Set(['', 'freshman', 'sophomore', 'junior', 'senior']);
  const ALLOWED_PART_TYPES = new Set(['text', 'source', 'card']);
  const ALLOWED_FEEDBACK_STATUSES = new Set(['resolved', 'unresolved']);
  const MAX_RAW_JSON_LENGTH = 1024 * 1024;
  const MAX_SESSION_SCAN = 200;
  const MAX_PART_SCAN = 48;

  function defaultState() {
    return {
      version: 3,
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

  function stateFromVersion(value, version) {
    const sessions = value?.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)
      ? value.sessions
      : {};
    const revisionsSource = version === 1 ? value?.sessionGenerations : value?.sessionRevisions;
    const revisions = revisionsSource && typeof revisionsSource === 'object' && !Array.isArray(revisionsSource)
      ? revisionsSource
      : {};
    return {
      version: 3,
      profile: cleanProfile(value?.profile),
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

  function cleanState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 3) {
      return defaultState();
    }
    return stateFromVersion(value, 3);
  }

  function migrateVersion(value, version) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== version) {
      return defaultState();
    }
    return stateFromVersion(value, version);
  }

  function createLocalStateStore(storage, options = {}) {
    const isCommonJs = typeof module !== 'undefined' && module.exports;
    const inheritedLockManager = isCommonJs ? null : root?.navigator?.locks;
    const lockManager = Object.hasOwn(options, 'lockManager')
      ? options.lockManager
      : inheritedLockManager;
    const lockingSupported = Boolean(lockManager && typeof lockManager.request === 'function');
    const capability = lockingSupported
      ? { safePersistence: true, reason: null }
      : { safePersistence: false, reason: 'locking-unsupported' };

    function normalizeSession(messages) {
      return cleanMessages(messages);
    }

    function failure(reason, extras = {}) {
      return { ok: false, reason, ...extras };
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

    function readV3() {
      const current = readRaw(STORAGE_KEY);
      if (current.status !== 'valid') return current;
      if (!current.value || current.value.version !== 3) return { status: 'invalid' };
      return { status: 'valid', state: cleanState(current.value) };
    }

    function initializeMissingV3Locked({ allowLegacy = true } = {}) {
      const current = readV3();
      if (current.status === 'valid') return { ok: true, state: current.state };
      if (current.status !== 'missing') return failure('unavailable');

      let state = defaultState();
      if (allowLegacy) {
        const v2 = readRaw(V2_STORAGE_KEY);
        if (v2.status === 'unavailable') return failure('unavailable');
        if (v2.status === 'valid') {
          state = migrateVersion(v2.value, 2);
        } else if (v2.status === 'missing') {
          const v1 = readRaw(V1_STORAGE_KEY);
          if (v1.status === 'unavailable') return failure('unavailable');
          if (v1.status === 'valid') state = migrateVersion(v1.value, 1);
        }
      }
      return write(state) ? { ok: true, state } : failure('unavailable');
    }

    async function withExclusiveLock(operation) {
      if (!lockingSupported) return failure('locking-unsupported');
      try {
        return await lockManager.request(
          LOCK_NAME,
          { mode: 'exclusive' },
          async lock => {
            if (!lock) return failure('lock-failed');
            return operation();
          }
        );
      } catch (_error) {
        return failure('lock-failed');
      }
    }

    async function load() {
      const current = readV3();
      if (current.status === 'valid') return current.state;
      if (current.status !== 'missing') return defaultState();
      const initialized = await withExclusiveLock(() => initializeMissingV3Locked());
      return initialized.ok ? initialized.state : defaultState();
    }

    async function resetAfterExternalClear() {
      return withExclusiveLock(() => initializeMissingV3Locked({ allowLegacy: false }));
    }

    async function mutate(operation) {
      return withExclusiveLock(() => {
        const initialized = initializeMissingV3Locked();
        if (!initialized.ok) return initialized;
        return operation(initialized.state);
      });
    }

    async function saveProfile(profile) {
      const cleanedProfile = cleanProfile(profile);
      return mutate(state => {
        state.profile = cleanedProfile;
        return write(state)
          ? { ok: true, profile: cleanedProfile }
          : failure('unavailable');
      });
    }

    async function saveSession(scene, messages, expectedRevision) {
      if (!ALLOWED_SCENES.has(scene) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return failure('invalid');
      }
      const normalized = normalizeSession(messages);
      return mutate(state => {
        const currentRevision = state.sessionRevisions[scene];
        if (expectedRevision !== currentRevision) {
          return failure('conflict', { revision: currentRevision, state });
        }
        if (currentRevision >= Number.MAX_SAFE_INTEGER) return failure('unavailable');
        state.sessions[scene] = normalized;
        state.sessionRevisions[scene] = currentRevision + 1;
        return write(state)
          ? { ok: true, revision: state.sessionRevisions[scene] }
          : failure('unavailable');
      });
    }

    async function clearSession(scene, expectedRevision) {
      if (!ALLOWED_SCENES.has(scene) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return failure('invalid');
      }
      return mutate(state => {
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
      });
    }

    async function clearAllSessions(expectedRevisions) {
      if (!expectedRevisions || typeof expectedRevisions !== 'object') return failure('invalid');
      return mutate(state => {
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
        for (const scene of ALLOWED_SCENES) state.sessionRevisions[scene] += 1;
        return write(state)
          ? { ok: true, revisions: { ...state.sessionRevisions } }
          : failure('unavailable');
      });
    }

    return {
      storageKey: STORAGE_KEY,
      lockName: LOCK_NAME,
      capability,
      load,
      resetAfterExternalClear,
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
