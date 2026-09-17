(function () {
  'use strict';

  const VERSION = '1.0.0';
  const STORAGE_KEY = 'kg-agent-execution-log/v1';
  const MAX_SESSIONS = 12;
  const MAX_EVENTS_PER_SESSION = 1500;
  let memoryStore = { sessions: [] };

  function clone(value) {
    if (value === undefined) return null;
    return JSON.parse(JSON.stringify(value));
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + ':' + window.crypto.randomUUID();
    }
    return prefix + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 10);
  }

  function loadStore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return memoryStore;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.sessions)) memoryStore = parsed;
    } catch (error) {
      console.warn('KGAgentExecutionLog: local storage unavailable', error);
    }
    return memoryStore;
  }

  function saveStore() {
    memoryStore.sessions = memoryStore.sessions
      .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
      .slice(0, MAX_SESSIONS);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
    } catch (error) {
      console.warn('KGAgentExecutionLog: failed to persist log', error);
    }
  }

  function findSession(sessionId) {
    loadStore();
    return memoryStore.sessions.find(session => session.session_id === sessionId) || null;
  }

  function createSession(input) {
    const options = input && typeof input === 'object' ? input : {};
    const session = {
      schema: 'kg-agent-execution-session/1',
      logger_version: VERSION,
      session_id: makeId('session'),
      started_at: new Date().toISOString(),
      ended_at: null,
      task: clone(options.task || {}),
      source: clone(options.source || {}),
      policy: {
        storage: 'browser_local_only',
        external_transmission: false,
        sampling: options.sampling || 'state changes, actions, outcomes, errors, and bounded observation samples'
      },
      labels: clone(options.labels || []),
      events: []
    };
    loadStore();
    memoryStore.sessions.unshift(session);
    saveStore();
    return clone({ ...session, events: undefined });
  }

  function record(sessionId, input) {
    const session = findSession(sessionId);
    if (!session) throw new Error('unknown session_id');
    const event = input && typeof input === 'object' ? input : {};
    if (!event.kind) throw new Error('event.kind is required');
    const entry = {
      schema: 'kg-agent-execution-event/1',
      event_id: makeId('event'),
      session_id: sessionId,
      sequence: session.events.length + 1,
      occurred_at: new Date().toISOString(),
      kind: String(event.kind),
      actor: String(event.actor || 'system'),
      task_phase: event.task_phase === undefined ? null : String(event.task_phase),
      correlation: clone(event.correlation || {}),
      data: clone(event.data || {}),
      evidence: clone(event.evidence || {}),
      outcome: clone(event.outcome || {})
    };
    session.events.push(entry);
    if (session.events.length > MAX_EVENTS_PER_SESSION) {
      session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
      session.events.forEach((item, index) => { item.sequence = index + 1; });
    }
    saveStore();
    window.dispatchEvent(new CustomEvent('kg-agent-log:event', { detail: clone(entry) }));
    return clone(entry);
  }

  function endSession(sessionId, outcome) {
    const session = findSession(sessionId);
    if (!session) throw new Error('unknown session_id');
    if (!session.ended_at) session.ended_at = new Date().toISOString();
    session.final_outcome = clone(outcome || {});
    saveStore();
    return clone({ ...session, events: undefined });
  }

  function getSession(sessionId) {
    const session = findSession(sessionId);
    return session ? clone(session) : null;
  }

  function listSessions() {
    loadStore();
    return memoryStore.sessions.map(session => clone({
      schema: session.schema,
      session_id: session.session_id,
      started_at: session.started_at,
      ended_at: session.ended_at,
      task: session.task,
      source: session.source,
      labels: session.labels,
      event_count: session.events.length,
      final_outcome: session.final_outcome || null
    }));
  }

  function toJSONL(sessionId) {
    const session = findSession(sessionId);
    if (!session) throw new Error('unknown session_id');
    const header = clone({ ...session, events: undefined });
    return [header, ...session.events].map(item => JSON.stringify(item)).join('\n') + '\n';
  }

  function download(sessionId, filename) {
    const jsonl = toJSONL(sessionId);
    const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'kg-agent-execution-' + sessionId.split(':').pop() + '.jsonl';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return { downloaded: true, filename: link.download, bytes: new Blob([jsonl]).size };
  }

  function clearSession(sessionId) {
    loadStore();
    const before = memoryStore.sessions.length;
    memoryStore.sessions = memoryStore.sessions.filter(session => session.session_id !== sessionId);
    saveStore();
    return { cleared: memoryStore.sessions.length < before, session_id: sessionId };
  }

  loadStore();
  window.KGAgentExecutionLog = Object.freeze({
    version: VERSION,
    createSession,
    record,
    endSession,
    getSession,
    listSessions,
    toJSONL,
    download,
    clearSession,
    schemas: Object.freeze({
      session: 'kg-agent-execution-session/1',
      event: 'kg-agent-execution-event/1'
    })
  });
})();
