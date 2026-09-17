(function () {
  'use strict';

  const enabled = new URLSearchParams(window.location.search).get('jev') === '1';
  if (!enabled) return;

  const VERSION = '1.1.2';
  const allowBackground = new URLSearchParams(window.location.search).get('jev_background') === '1';
  const OBSERVATION_INTERVAL_MS = 100;
  const MIN_DURATION_MS = 50;
  const MAX_DURATION_MS = allowBackground ? 60000 : 3000;
  const FIRE_PERIOD_MS = 160;
  const FIRE_ON_MS = 70;
  const MOVEMENTS = Object.freeze({
    stay: [],
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    up_left: ['ArrowUp', 'ArrowLeft'],
    up_right: ['ArrowUp', 'ArrowRight'],
    down_left: ['ArrowDown', 'ArrowLeft'],
    down_right: ['ArrowDown', 'ArrowRight']
  });
  const CONTROL_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space'];

  let sequence = 0;
  let actionSequence = 0;
  let activeAction = null;
  let lastObservation = null;
  let panel = null;
  let observationField = null;
  let actionField = null;
  let statusField = null;
  let logCountField = null;
  let logSessionId = null;
  let logEventCount = 0;
  let lastLoggedState = null;
  let lastOutcomeSignature = null;
  const objectIds = new WeakMap();
  let nextObjectId = 1;

  function logEvent(kind, details) {
    if (!logSessionId || !window.KGAgentExecutionLog) return null;
    const event = window.KGAgentExecutionLog.record(logSessionId, {
      kind,
      actor: details && details.actor,
      task_phase: details && details.task_phase,
      correlation: details && details.correlation,
      data: details && details.data,
      evidence: details && details.evidence,
      outcome: details && details.outcome
    });
    logEventCount++;
    if (logCountField) logCountField.textContent = 'Log: ' + logEventCount + ' events';
    return event;
  }

  function startExecutionLog() {
    if (!window.KGAgentExecutionLog) return;
    const session = window.KGAgentExecutionLog.createSession({
      task: {
        domain: 'game',
        name: 'bosconian-stage-clear',
        objective: 'destroy every base while keeping the player alive',
        stage_at_start: stage
      },
      source: {
        application: 'bosconian_like_smooth_shooter',
        connector: 'JevBosconianConnector',
        connector_version: VERSION,
        url: window.location.href
      },
      labels: ['jev', 'browser-agent', 'reusable-execution-data']
    });
    logSessionId = session.session_id;
    logEvent('session_started', {
      actor: 'connector',
      task_phase: 'initialization',
      data: { stage, bases_remaining: bases.filter(base => base.alive).length },
      evidence: { query_enabled: true, background_control: allowBackground, persistence: 'browser_local_only' }
    });
  }

  function finiteNumber(value, name) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(name + ' must be a finite number');
    return number;
  }

  function integerInRange(value, name, min, max) {
    const number = finiteNumber(value, name);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new Error(name + ' must be an integer from ' + min + ' to ' + max);
    }
    return number;
  }

  function normalizeAction(input) {
    const raw = typeof input === 'string' ? JSON.parse(input) : input;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('action must be a JSON object');
    }
    const movement = raw.movement === undefined ? 'stay' : String(raw.movement);
    if (!Object.prototype.hasOwnProperty.call(MOVEMENTS, movement)) {
      throw new Error('movement must be one of: ' + Object.keys(MOVEMENTS).join(', '));
    }
    const durationMs = integerInRange(
      raw.duration_ms === undefined ? 150 : raw.duration_ms,
      'duration_ms',
      MIN_DURATION_MS,
      MAX_DURATION_MS
    );
    const moveMs = integerInRange(
      raw.move_ms === undefined ? durationMs : raw.move_ms,
      'move_ms',
      0,
      durationMs
    );
    return Object.freeze({
      request_id: raw.request_id === undefined ? null : String(raw.request_id).slice(0, 128),
      movement,
      fire: raw.fire === undefined ? true : raw.fire === true,
      duration_ms: durationMs,
      move_ms: moveMs
    });
  }

  function releaseControlKeys() {
    for (const key of CONTROL_KEYS) keys[key] = false;
  }

  function stop(reason) {
    releaseControlKeys();
    const stopped = activeAction;
    activeAction = null;
    if (statusField) {
      statusField.textContent = reason ? '停止: ' + reason : '停止';
      statusField.dataset.state = 'stopped';
    }
    if (stopped) {
      logEvent('action_result', {
        actor: 'connector',
        task_phase: 'control',
        correlation: { action_id: stopped.action_id, request_id: stopped.request_id },
        data: {
          movement: stopped.movement,
          fire: stopped.fire,
          planned_duration_ms: stopped.duration_ms,
          elapsed_ms: Math.max(0, Math.round(performance.now() - stopped.started_at_ms))
        },
        outcome: { status: reason === 'expired' ? 'completed' : 'stopped', reason: reason || 'requested' }
      });
    }
    return stopped ? {
      action_id: stopped.action_id,
      stopped: true,
      reason: reason || 'requested'
    } : { stopped: false, reason: reason || 'idle' };
  }

  function act(input) {
    let action;
    try {
      action = normalizeAction(input);
    } catch (error) {
      logEvent('error', {
        actor: 'connector',
        task_phase: 'validation',
        data: { input_type: typeof input },
        outcome: { code: 'INVALID_ACTION', message: error.message }
      });
      throw error;
    }
    stop('replaced');
    const now = performance.now();
    activeAction = {
      ...action,
      action_id: ++actionSequence,
      started_at_ms: now,
      expires_at_ms: now + action.duration_ms
    };
    if (statusField) {
      statusField.textContent = '実行中 #' + activeAction.action_id;
      statusField.dataset.state = 'active';
    }
    logEvent('action', {
      actor: 'jev',
      task_phase: 'control',
      correlation: { action_id: activeAction.action_id, request_id: activeAction.request_id, observation_seq: sequence },
      data: action,
      evidence: lastObservation ? {
        mode: lastObservation.status.mode,
        stage: lastObservation.status.stage,
        bases_remaining: lastObservation.status.bases_remaining,
        nearest_target_id: lastObservation.nearest_target && lastObservation.nearest_target.id
      } : {}
    });
    return {
      accepted: true,
      action_id: activeAction.action_id,
      request_id: activeAction.request_id,
      expires_in_ms: activeAction.duration_ms,
      action
    };
  }

  function applyActiveAction(now) {
    releaseControlKeys();
    if (!activeAction) return;
    if (!player.alive) {
      stop('game_over');
      return;
    }
    if (stageClearScene || showCM) {
      stop('stage_transition');
      return;
    }
    const elapsed = now - activeAction.started_at_ms;
    if (elapsed >= activeAction.duration_ms) {
      stop('expired');
      return;
    }
    if (elapsed < activeAction.move_ms) {
      for (const key of MOVEMENTS[activeAction.movement]) keys[key] = true;
    }
    if (activeAction.fire && elapsed % FIRE_PERIOD_MS < FIRE_ON_MS) {
      keys[' '] = true;
      keys.Space = true;
    }
  }

  function wrappedDelta(target, origin, size) {
    let delta = target - origin;
    if (delta > size / 2) delta -= size;
    if (delta < -size / 2) delta += size;
    return delta;
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function round(value, digits) {
    const scale = 10 ** (digits || 0);
    return Math.round(value * scale) / scale;
  }

  function stableId(entity, prefix) {
    if (!entity || (typeof entity !== 'object' && typeof entity !== 'function')) {
      return prefix + '-unknown';
    }
    if (!objectIds.has(entity)) objectIds.set(entity, nextObjectId++);
    return prefix + '-' + objectIds.get(entity);
  }

  function describeObject(entity, kind, radius, extra) {
    const dx = wrappedDelta(entity.x, player.x, MAP_W);
    const dy = wrappedDelta(entity.y, player.y, MAP_H);
    const distance = Math.hypot(dx, dy);
    const bearing = Math.atan2(dy, dx);
    const screenX = W / 2 + dx;
    const screenY = H / 2 + dy;
    const margin = radius || 0;
    return {
      id: stableId(entity, kind),
      kind,
      world: { x: round(entity.x, 1), y: round(entity.y, 1) },
      relative: {
        dx: round(dx, 1),
        dy: round(dy, 1),
        distance: round(distance, 1),
        bearing_rad: round(bearing, 4),
        heading_error_rad: round(normalizeAngle(bearing - player.dir), 4)
      },
      screen: {
        x: round(screenX, 1),
        y: round(screenY, 1),
        visible: screenX >= -margin && screenX <= W + margin && screenY >= -margin && screenY <= H + margin
      },
      radius: radius || 0,
      ...(extra || {})
    };
  }

  function currentMode(basesRemaining) {
    if (!player.alive) return 'game_over';
    if (stageClearScene || basesRemaining === 0) return 'stage_clear';
    if (showCM) return 'intermission';
    if (stageStartScene) return 'stage_start';
    return 'play';
  }

  function observe() {
    const basesRemaining = bases.filter(base => base.alive).length;
    const targets = bases
      .filter(base => base.alive)
      .map(base => describeObject(base, 'base', base.r, {
        missile_charge_frames: base.missileCharge || 0
      }))
      .sort((a, b) => a.relative.distance - b.relative.distance);

    const threats = [];
    for (const enemy of enemies) {
      if (enemy.alive) threats.push(describeObject(enemy, 'chaser', enemy.size, {
        velocity: { x: round(enemy.vx || 0, 2), y: round(enemy.vy || 0, 2) }
      }));
    }
    for (const ship of formation.ships) {
      if (ship.alive && Number.isFinite(ship.x) && Number.isFinite(ship.y)) {
        threats.push(describeObject(ship, 'formation_ship', 16));
      }
    }
    for (const missile of homingMissiles) {
      if (missile.alive) threats.push(describeObject(missile, 'homing_missile', 20, {
        velocity: { x: round(missile.vx || 0, 2), y: round(missile.vy || 0, 2) }
      }));
    }
    for (const laser of enemyLasers) {
      threats.push(describeObject(laser, 'enemy_laser', 6, {
        velocity: { x: round(laser.vx || 0, 2), y: round(laser.vy || 0, 2) },
        life_frames: laser.life
      }));
    }
    for (const bullet of bullets) {
      if (bullet.from === 'enemy') {
        threats.push(describeObject(bullet, 'enemy_projectile', 4, {
          velocity: { x: round(bullet.vx || 0, 2), y: round(bullet.vy || 0, 2) },
          life_frames: bullet.life
        }));
      }
    }
    threats.sort((a, b) => a.relative.distance - b.relative.distance);

    const action = activeAction ? {
      action_id: activeAction.action_id,
      request_id: activeAction.request_id,
      movement: activeAction.movement,
      fire: activeAction.fire,
      remaining_ms: Math.max(0, Math.round(activeAction.expires_at_ms - performance.now()))
    } : null;

    return {
      schema: 'kg-ninja/jev-bosconian-observation/1',
      connector_version: VERSION,
      seq: ++sequence,
      captured_at: new Date().toISOString(),
      source: 'current game state; no future spawn or random outcome data',
      coordinates: {
        world: 'toroidal 2000x2000; x right, y down',
        screen: '640x480 CSS-independent canvas pixels; player centered',
        angles: 'radians; 0 right, positive clockwise because y increases downward'
      },
      status: {
        mode: currentMode(basesRemaining),
        stage,
        bases_remaining: basesRemaining,
        alert: alertMode,
        alert_remaining_frames: alertMode ? alertTimer : 0
      },
      player: {
        alive: player.alive,
        world: { x: round(player.x, 1), y: round(player.y, 1) },
        screen: { x: W / 2, y: H / 2 },
        velocity: { x: round(player.vx || 0, 2), y: round(player.vy || 0, 2) },
        heading_rad: round(player.dir, 4),
        radius: player.size
      },
      nearest_target: targets[0] || null,
      targets,
      threats: threats.slice(0, 24),
      input: action,
      execution_log: {
        schema: 'kg-agent-execution-event/1',
        session_id: logSessionId,
        event_count: logEventCount,
        storage: 'browser_local_only'
      },
      controls: {
        movement: Object.keys(MOVEMENTS),
        duration_ms: { min: MIN_DURATION_MS, max: MAX_DURATION_MS },
        fire: 'boolean; true produces repeated key pulses during duration_ms',
        example: { movement: 'up_right', fire: true, duration_ms: 300, move_ms: 300 }
      }
    };
  }

  function publishObservation() {
    lastObservation = observe();
    if (observationField) observationField.value = JSON.stringify(lastObservation, null, 2);
    const state = {
      mode: lastObservation.status.mode,
      stage: lastObservation.status.stage,
      bases_remaining: lastObservation.status.bases_remaining,
      alert: lastObservation.status.alert,
      player_alive: lastObservation.player.alive
    };
    const stateSignature = JSON.stringify(state);
    if (stateSignature !== lastLoggedState) {
      logEvent('state_transition', {
        actor: 'environment',
        task_phase: 'play',
        data: { from: lastLoggedState ? JSON.parse(lastLoggedState) : null, to: state },
        evidence: { observation_seq: lastObservation.seq }
      });
      lastLoggedState = stateSignature;
    }
    if (lastObservation.seq % 10 === 0) {
      logEvent('observation_sample', {
        actor: 'environment',
        task_phase: 'play',
        correlation: { observation_seq: lastObservation.seq },
        data: {
          status: lastObservation.status,
          player: lastObservation.player,
          nearest_target: lastObservation.nearest_target,
          nearest_threats: lastObservation.threats.slice(0, 5),
          active_input: lastObservation.input
        },
        evidence: { sampling_hz: 1, source_hz: 10 }
      });
    }
    if (state.mode === 'stage_clear' || state.mode === 'game_over') {
      const outcomeSignature = state.mode + ':' + state.stage;
      if (outcomeSignature !== lastOutcomeSignature) {
        logEvent('outcome', {
          actor: 'environment',
          task_phase: 'result',
          data: state,
          evidence: { observation_seq: lastObservation.seq },
          outcome: { status: state.mode === 'stage_clear' ? 'success' : 'failure' }
        });
        lastOutcomeSignature = outcomeSignature;
      }
    }
    window.dispatchEvent(new CustomEvent('jev:observation', { detail: lastObservation }));
  }

  function setPanelStatus(message, state) {
    if (!statusField) return;
    statusField.textContent = message;
    statusField.dataset.state = state || 'info';
  }

  function mountPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #jev-connector-panel { box-sizing: border-box; width: min(960px, calc(100% - 24px)); margin: 16px auto; padding: 12px; color: #dff; background: #071018; border: 1px solid #35d6e8; border-radius: 8px; text-align: left; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      #jev-connector-panel * { box-sizing: border-box; }
      #jev-connector-panel h2 { margin: 0 0 8px; font: 700 16px/1.3 sans-serif; }
      #jev-connector-panel details { margin: 8px 0; }
      #jev-connector-panel textarea { width: 100%; min-height: 150px; resize: vertical; color: #dff; background: #02070b; border: 1px solid #276975; border-radius: 4px; padding: 8px; }
      #jev-connector-panel .jev-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
      #jev-connector-panel button { padding: 7px 12px; color: #031015; background: #65e6f2; border: 0; border-radius: 4px; cursor: pointer; }
      #jev-connector-panel button[data-kind="stop"] { background: #ffb36b; }
      #jev-connector-log-count { margin-left: 8px; color: #9bd7df; }
      #jev-connector-status[data-state="error"] { color: #ff7b7b; }
      #jev-connector-status[data-state="active"] { color: #7dff9a; }
    `;
    document.head.appendChild(style);

    panel = document.createElement('section');
    panel.id = 'jev-connector-panel';
    panel.setAttribute('aria-label', 'Jev connector');
    panel.innerHTML = `
      <h2>Jev Connector v${VERSION}</h2>
      <div><span id="jev-connector-status" role="status">待機中</span><span id="jev-connector-log-count">Log: 0 events</span></div>
      <details open>
        <summary>Action JSON</summary>
        <textarea id="jev-action-json" spellcheck="false" aria-label="Jev action JSON">{"movement":"up_right","fire":true,"duration_ms":300,"move_ms":300}</textarea>
        <div class="jev-actions">
          <button type="button" id="jev-apply-action">Apply action</button>
          <button type="button" id="jev-stop-action" data-kind="stop">Stop</button>
          <button type="button" id="jev-copy-observation">Copy observation</button>
          <button type="button" id="jev-copy-log">Copy log JSONL</button>
          <button type="button" id="jev-download-log">Download log JSONL</button>
        </div>
      </details>
      <details open>
        <summary>Current observation JSON (10 Hz)</summary>
        <textarea id="jev-observation-json" readonly aria-label="Jev observation JSON"></textarea>
      </details>
    `;
    document.body.appendChild(panel);
    observationField = panel.querySelector('#jev-observation-json');
    actionField = panel.querySelector('#jev-action-json');
    statusField = panel.querySelector('#jev-connector-status');
    logCountField = panel.querySelector('#jev-connector-log-count');
    logCountField.textContent = 'Log: ' + logEventCount + ' events';

    panel.querySelector('#jev-apply-action').addEventListener('click', () => {
      try {
        const result = act(actionField.value);
        setPanelStatus('受付 #' + result.action_id, 'active');
      } catch (error) {
        setPanelStatus(error.message, 'error');
      }
    });
    panel.querySelector('#jev-stop-action').addEventListener('click', () => stop('panel'));
    panel.querySelector('#jev-copy-observation').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(observationField.value);
        setPanelStatus('観測JSONをコピーしました', 'info');
      } catch (error) {
        setPanelStatus('コピー失敗: ' + error.message, 'error');
      }
    });
    panel.querySelector('#jev-copy-log').addEventListener('click', async () => {
      try {
        if (!logSessionId) throw new Error('log session unavailable');
        await navigator.clipboard.writeText(window.KGAgentExecutionLog.toJSONL(logSessionId));
        setPanelStatus('ログJSONLをコピーしました', 'info');
      } catch (error) {
        setPanelStatus('ログコピー失敗: ' + error.message, 'error');
      }
    });
    panel.querySelector('#jev-download-log').addEventListener('click', () => {
      try {
        if (!logSessionId) throw new Error('log session unavailable');
        window.KGAgentExecutionLog.download(logSessionId, 'jev-bosconian-' + logSessionId.split(':').pop() + '.jsonl');
        setPanelStatus('ログJSONLを保存しました', 'info');
      } catch (error) {
        setPanelStatus('ログ保存失敗: ' + error.message, 'error');
      }
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window || !event.data || event.data.type !== 'jev-bosconian-action') return;
    try {
      const result = act(event.data.action);
      window.postMessage({ type: 'jev-bosconian-action-result', ok: true, result }, window.location.origin);
    } catch (error) {
      window.postMessage({ type: 'jev-bosconian-action-result', ok: false, error: error.message }, window.location.origin);
    }
  });
  window.addEventListener('blur', () => {
    if (!allowBackground) stop('window_blur');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !allowBackground) stop('document_hidden');
  });
  window.addEventListener('pagehide', () => {
    if (logSessionId && window.KGAgentExecutionLog) {
      logEvent('session_ended', {
        actor: 'connector',
        task_phase: 'shutdown',
        data: lastObservation ? lastObservation.status : {},
        outcome: { reason: 'pagehide' }
      });
      window.KGAgentExecutionLog.endSession(logSessionId, {
        reason: 'pagehide',
        final_status: lastObservation ? lastObservation.status : null
      });
    }
  });

  startExecutionLog();
  mountPanel();
  publishObservation();
  window.setInterval(publishObservation, OBSERVATION_INTERVAL_MS);

  function connectorFrame(now) {
    applyActiveAction(now);
    window.requestAnimationFrame(connectorFrame);
  }
  window.requestAnimationFrame(connectorFrame);

  window.JevBosconianConnector = Object.freeze({
    version: VERSION,
    observe: () => lastObservation || observe(),
    act,
    stop: () => stop('api'),
    getLog: () => logSessionId && window.KGAgentExecutionLog
      ? window.KGAgentExecutionLog.getSession(logSessionId)
      : null,
    getLogJSONL: () => logSessionId && window.KGAgentExecutionLog
      ? window.KGAgentExecutionLog.toJSONL(logSessionId)
      : '',
    logSessionId: () => logSessionId,
    schema: Object.freeze({
      action: 'kg-ninja/jev-bosconian-action/1',
      observation: 'kg-ninja/jev-bosconian-observation/1',
      execution_session: 'kg-agent-execution-session/1',
      execution_event: 'kg-agent-execution-event/1'
    })
  });
})();
