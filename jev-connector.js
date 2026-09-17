(function () {
  'use strict';

  const enabled = new URLSearchParams(window.location.search).get('jev') === '1';
  if (!enabled) return;

  const VERSION = '1.0.0';
  const OBSERVATION_INTERVAL_MS = 100;
  const MIN_DURATION_MS = 50;
  const MAX_DURATION_MS = 3000;
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
  const objectIds = new WeakMap();
  let nextObjectId = 1;

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
    return stopped ? {
      action_id: stopped.action_id,
      stopped: true,
      reason: reason || 'requested'
    } : { stopped: false, reason: reason || 'idle' };
  }

  function act(input) {
    const action = normalizeAction(input);
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
      #jev-connector-status[data-state="error"] { color: #ff7b7b; }
      #jev-connector-status[data-state="active"] { color: #7dff9a; }
    `;
    document.head.appendChild(style);

    panel = document.createElement('section');
    panel.id = 'jev-connector-panel';
    panel.setAttribute('aria-label', 'Jev connector');
    panel.innerHTML = `
      <h2>Jev Connector v${VERSION}</h2>
      <div id="jev-connector-status" role="status">待機中</div>
      <details open>
        <summary>Action JSON</summary>
        <textarea id="jev-action-json" spellcheck="false" aria-label="Jev action JSON">{"movement":"up_right","fire":true,"duration_ms":300,"move_ms":300}</textarea>
        <div class="jev-actions">
          <button type="button" id="jev-apply-action">Apply action</button>
          <button type="button" id="jev-stop-action" data-kind="stop">Stop</button>
          <button type="button" id="jev-copy-observation">Copy observation</button>
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
  window.addEventListener('blur', () => stop('window_blur'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('document_hidden');
  });

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
    schema: Object.freeze({
      action: 'kg-ninja/jev-bosconian-action/1',
      observation: 'kg-ninja/jev-bosconian-observation/1'
    })
  });
})();
