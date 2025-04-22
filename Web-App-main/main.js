// なめらかボスコニアン風STG（最小構成）
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// マップ設定
const MAP_W = 2000;
const MAP_H = 2000;

// プレイヤー
const player = {
  x: MAP_W/2,
  y: MAP_H/2,
  vx: 0,
  vy: 0,
  speed: 3.2,
  dir: 0, // 角度（ラジアン）
  size: 18,
  alive: true
};

// キー状態
const keys = {};
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

// 弾
const bullets = [];
function shoot() {
  const angle = player.dir;
  // 前方ショット
  bullets.push({
    x: player.x + Math.cos(angle)*player.size,
    y: player.y + Math.sin(angle)*player.size,
    vx: Math.cos(angle)*7,
    vy: Math.sin(angle)*7,
    life: 60,
    from: 'player'
  });
  // 後方ショット
  const backAngle = angle + Math.PI;
  bullets.push({
    x: player.x + Math.cos(backAngle)*player.size,
    y: player.y + Math.sin(backAngle)*player.size,
    vx: Math.cos(backAngle)*7,
    vy: Math.sin(backAngle)*7,
    life: 60,
    from: 'player'
  });
}

// 敵基地
const bases = [];
for(let i=0; i<6; i++) {
  const angle = i * Math.PI*2/6;
  bases.push({
    x: MAP_W/2 + Math.cos(angle)*600,
    y: MAP_H/2 + Math.sin(angle)*600,
    r: 32,
    alive: true
  });
}

// 追尾型敵（速度遅め、数を減らす）
const enemies = [];
for(let i=0; i<3; i++) {
  enemies.push({
    type: 'chase',
    x: Math.random()*MAP_W,
    y: Math.random()*MAP_H,
    vx: 0,
    vy: 0,
    speed: 0.8 + Math.random()*0.4, // 0.8〜1.2
    size: 16,
    alive: true
  });
}

// ◇型三機編隊（編隊リーダー＋2機）
const formation = {
  cx: MAP_W/2 + 400, // 円運動の中心
  cy: MAP_H/2,
  r: 250,
  angle: 0,
  speed: 0.012, // 円周移動の速度
  ships: [
    {offset: 0, alive: true, laserTimer: 0}, // リーダー
    {offset: -0.18, alive: true, laserTimer: 0}, // 左
    {offset: +0.18, alive: true, laserTimer: 0}  // 右
  ]
};
// 編隊レーザー
const enemyLasers = []; // {x, y, vx, vy, life}


// カメラ
const camera = {x:0, y:0};

function update() {
  // ステージ開始点滅演出中は進行しない
  if(stageStartScene) return;
  // プレイヤー移動
  let dx = 0, dy = 0;
  if(keys['ArrowUp'] || keys['w']) dy -= 1;
  if(keys['ArrowDown'] || keys['s']) dy += 1;
  if(keys['ArrowLeft'] || keys['a']) dx -= 1;
  if(keys['ArrowRight'] || keys['d']) dx += 1;
  // どこか押していればその方向にずっと動く（慣性なし）
  if(dx!==0 || dy!==0) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    player.vx = dx * player.speed;
    player.vy = dy * player.speed;
    player.dir = Math.atan2(dy, dx);
    player.lastMove = {dx, dy};
  } else if (player.lastMove) {
    // 直前の方向で動き続ける
    player.vx = player.lastMove.dx * player.speed;
    player.vy = player.lastMove.dy * player.speed;
    // dirは維持
  }
  player.x += player.vx;
  player.y += player.vy;
  // マップ端制限
  player.x = Math.max(player.size, Math.min(MAP_W-player.size, player.x));
  player.y = Math.max(player.size, Math.min(MAP_H-player.size, player.y));

  // 弾発射
  if((keys[' '] || keys['Space']) && !player.shootLock) {
    shoot();
    player.shootLock = true;
  }
  if(!(keys[' '] || keys['Space'])) player.shootLock = false;

  // 弾更新
  for(const b of bullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    // 敵弾に当たったらゲームオーバー
    if(b.from==='enemy' && player.alive && Math.hypot(player.x-b.x, player.y-b.y) < player.size+4) {
      player.alive = false;
    }
  }
  // 弾削除
  for(let i=bullets.length-1; i>=0; i--) {
    if(bullets[i].life<=0) bullets.splice(i,1);
  }

  // 敵基地ヒット判定＆自機当たり判定＆誘導弾発射
  for(const base of bases) {
    if(!base.alive) continue;
    // 自機との当たり判定
    if(player.alive && Math.hypot(base.x-player.x, base.y-player.y) < base.r+player.size) {
      player.alive = false;
    }
    // 弾ヒット（弾が当たった時のみbase.alive=false）
    for(const b of bullets) {
      const dist = Math.hypot(base.x-b.x, base.y-b.y);
      if(dist < base.r && b.from==='player') {
        base.alive = false;
        b.life = 0;
        bingoTimer = 60; // BINGO!表示
      }
    }
    // ステージ2以降はたまに誘導弾発射（点滅演出→発射）
    if(stage >= 2 && !base.missileCharge && Math.random() < (alertMode ? 0.05 : 0.01)) {
      base.missileCharge = 24; // 0.4秒点滅
    }
    if(base.missileCharge) {
      base.missileCharge--;
      if(base.missileCharge === 0) {
        if(homingMissiles.filter(m=>m.alive).length < 3+stage) {
          const dx = player.x - base.x;
          const dy = player.y - base.y;
          const len = Math.hypot(dx, dy);
          // ミサイル感: 速度アップ、追尾性能は低く
          const speed = 2.2 + enemySpeedBonus + (alertMode ? 0.7 : 0);
          homingMissiles.push({
            x: base.x,
            y: base.y,
            vx: (dx/len)*speed,
            vy: (dy/len)*speed,
            speed: speed,
            alive: true,
            homing: 0.035 // 追尾性能を弱めに
          });
        }
      }
    }
    // Alert時は基地もプレイヤー狙い弾を撃つ
    if(alertMode && Math.random()<0.03) {
      const ang = Math.atan2(player.y-base.y, player.x-base.x);
      bullets.push({x: base.x, y: base.y, vx: Math.cos(ang)*6, vy: Math.sin(ang)*6, life: 60, from: 'enemy'});
    }
  }
  // 偵察機巡回＆発見判定＆破壊判定
  for(const scout of scouts) {
    scout.angle += scout.speed;
    scout.x = MAP_W/2 + Math.cos(scout.angle) * scout.r;
    scout.y = MAP_H/2 + Math.sin(scout.angle) * scout.r;
    // 発見判定
    if(!alertMode && Math.hypot(player.x-scout.x, player.y-scout.y) < 60) {
      alertMode = true;
      alertTimer = 1800; // 30秒間
    }
    // 弾で破壊
    for(const b of bullets) {
      if(b.from==='player' && Math.hypot(scout.x-b.x, scout.y-b.y) < 20) {
        scout.x = -9999; // 画面外に飛ばす（消滅）
        scout.y = -9999;
        b.life = 0;
      }
    }
  }
  // Alertタイマー
  if(alertMode) {
    alertTimer--;
    if(alertTimer <= 0) alertMode = false;
  }

  // 追尾型敵
  for(const e of enemies) {
    if(!e.alive) continue;
    if(e.type === 'chase') {
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const len = Math.hypot(dx, dy);
      let speed = e.speed + (alertMode ? 1.1 : 0);
      e.vx = (dx/len) * speed;
      e.vy = (dy/len) * speed;
      e.x += e.vx;
      e.y += e.vy;
      // プレイヤー接触
      if(Math.hypot(player.x-e.x, player.y-e.y) < player.size+e.size) {
        player.alive = false;
      }
      // 弾で敵を破壊
      for(const b of bullets) {
        if(b.from==='player' && Math.hypot(e.x-b.x, e.y-b.y) < e.size+4) {
          e.alive = false;
          b.life = 0;
        }
      }
      // Alert時は全追尾敵がプレイヤー狙い弾を撃つ
      if(alertMode && Math.random()<0.03) {
        const ang = Math.atan2(player.y-e.y, player.x-e.x);
        bullets.push({x: e.x, y: e.y, vx: Math.cos(ang)*6, vy: Math.sin(ang)*6, life: 60, from: 'enemy'});
      }
    }
  }
  // Alert中は編隊レーザーの発射頻度も上昇（formation.shipsの処理は既存のまま）
  // 誘導弾（大型ミサイル）
  for(const m of homingMissiles) {
    if(!m.alive) continue;
    // 方向を少しずつ自機に向けて補正
    const dx = player.x - m.x;
    const dy = player.y - m.y;
    const len = Math.hypot(dx, dy);
    const tx = (dx/len)*m.speed;
    const ty = (dy/len)*m.speed;
    // ミサイル感: 追尾性能を弱めに
    const homing = m.homing !== undefined ? m.homing : 0.06;
    m.vx = m.vx*(1-homing) + tx*homing;
    m.vy = m.vy*(1-homing) + ty*homing;
    m.x += m.vx;
    m.y += m.vy;
    // プレイヤー接触
    if(player.alive && Math.hypot(player.x-m.x, player.y-m.y) < player.size+20) {
      player.alive = false;
    }
    // 弾で破壊
    for(const b of bullets) {
      if(b.from==='player' && Math.hypot(m.x-b.x, m.y-b.y) < 20+4) {
        m.alive = false;
        b.life = 0;
      }
    }
  }
  // ミサイル消去
  for(let i=homingMissiles.length-1; i>=0; i--) {
    if(!homingMissiles[i].alive) homingMissiles.splice(i,1);
  }
  // ◇型三機編隊（円運動＆レーザー）
  formation.angle += formation.speed;
  for(let i=0; i<formation.ships.length; i++) {
    const ship = formation.ships[i];
    if(!ship.alive) continue;
    const ang = formation.angle + ship.offset;
    ship.x = formation.cx + Math.cos(ang) * formation.r;
    ship.y = formation.cy + Math.sin(ang) * formation.r;
    // プレイヤー接触
    if(Math.hypot(player.x-ship.x, player.y-ship.y) < player.size+16) {
      player.alive = false;
    }
    // 弾で敵を破壊
    for(const b of bullets) {
      if(b.from==='player' && Math.hypot(ship.x-b.x, ship.y-b.y) < 16+4) {
        ship.alive = false;
        b.life = 0;
      }
    }
    // たまにレーザー発射
    ship.laserTimer = (ship.laserTimer || 0) - 1;
    if(ship.laserTimer <= 0 && Math.random() < 0.02) {
      // 進行方向（円運動の接線方向）
      const tang = ang + Math.PI/2;
      enemyLasers.push({
        x: ship.x + Math.cos(tang)*18,
        y: ship.y + Math.sin(tang)*18,
        vx: Math.cos(tang)*8,
        vy: Math.sin(tang)*8,
        life: 60
      });
      ship.laserTimer = 90 + Math.floor(Math.random()*60); // 1.5秒〜
    }
    // Alert時は編隊機もプレイヤー狙い弾を撃つ
    if(alertMode && Math.random()<0.03) {
      const angToPlayer = Math.atan2(player.y-ship.y, player.x-ship.x);
      bullets.push({x: ship.x, y: ship.y, vx: Math.cos(angToPlayer)*6, vy: Math.sin(angToPlayer)*6, life: 60, from: 'enemy'});
    }
  }
  // レーザー更新
  for(const l of enemyLasers) {
    l.x += l.vx;
    l.y += l.vy;
    l.life--;
    // プレイヤーに当たるとゲームオーバー
    if(player.alive && Math.hypot(player.x-l.x, player.y-l.y) < player.size+6) {
      player.alive = false;
    }
  }
  // レーザー消去
  for(let i=enemyLasers.length-1; i>=0; i--) {
    if(enemyLasers[i].life<=0) enemyLasers.splice(i,1);
  }

  // カメラ追従
  camera.x = player.x - W/2;
  camera.y = player.y - H/2;
  camera.x = Math.max(0, Math.min(MAP_W-W, camera.x));
  camera.y = Math.max(0, Math.min(MAP_H-H, camera.y));
}

function draw() {
  // ステージ開始点滅演出
  if(stageStartScene) {
    ctx.clearRect(0,0,W,H);
    stageStartTimer++;
    if(stageStartTimer % 20 === 0) stageStartFlash++;
    if(stageStartFlash < 6) {
      if(stageStartFlash % 2 === 0) {
        ctx.save();
        ctx.font = 'bold 64px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 1;
        ctx.fillText('STAGE ' + stage, W/2, H/2);
        ctx.restore();
      }
    } else {
      stageStartScene = false;
    }
    return;
  }
  ctx.clearRect(0,0,W,H);
  // マップ背景
  ctx.fillStyle = '#222';
  ctx.fillRect(0,0,W,H);
  // グリッド
  ctx.strokeStyle = '#333';
  for(let x=0; x<MAP_W; x+=64) {
    ctx.beginPath();
    ctx.moveTo(x-camera.x, 0-camera.y);
    ctx.lineTo(x-camera.x, MAP_H-camera.y);
    ctx.stroke();
  }
  for(let y=0; y<MAP_H; y+=64) {
    ctx.beginPath();
    ctx.moveTo(0-camera.x, y-camera.y);
    ctx.lineTo(MAP_W-camera.x, y-camera.y);
    ctx.stroke();
  }
  // 基地
  for(const base of bases) {
    if(!base.alive) continue;
    ctx.save();
    ctx.translate(base.x-camera.x, base.y-camera.y);
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0,0,base.r,0,Math.PI*2);
    ctx.stroke();
    // ミサイル発射点滅演出
    if(base.missileCharge && base.missileCharge > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0,0,base.r+10*Math.sin(base.missileCharge*0.6), 0, Math.PI*2);
      ctx.strokeStyle = '#f0f';
      ctx.lineWidth = 5;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  // 弾
  for(const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x-camera.x, b.y-camera.y, 4, 0, Math.PI*2);
    ctx.fillStyle = (b.from==='enemy') ? '#f00' : '#ff0';
    ctx.fill();
  }
  // 追尾型敵
  for(const e of enemies) {
    if(!e.alive) continue;
    ctx.save();
    ctx.translate(e.x-camera.x, e.y-camera.y);
    ctx.fillStyle = '#f44';
    ctx.beginPath();
    ctx.arc(0,0,e.size,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  // ◇型三機編隊
  for(let i=0; i<formation.ships.length; i++) {
    const ship = formation.ships[i];
    if(!ship.alive) continue;
    ctx.save();
    ctx.translate(ship.x-camera.x, ship.y-camera.y);
    ctx.rotate(formation.angle + ship.offset + Math.PI/2); // 進行方向に向ける
    ctx.fillStyle = '#0ff';
    ctx.beginPath();
    ctx.moveTo(0,-16); ctx.lineTo(12,0); ctx.lineTo(0,16); ctx.lineTo(-12,0); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // 編隊レーザー
  for(const l of enemyLasers) {
    ctx.save();
    ctx.translate(l.x-camera.x, l.y-camera.y);
    ctx.fillStyle = '#ff8';
    ctx.beginPath();
    ctx.arc(0,0,6,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
  // 誘導弾
  for(const m of homingMissiles) {
    if(!m.alive) continue;
    ctx.save();
    ctx.translate(m.x-camera.x, m.y-camera.y);
    ctx.fillStyle = '#f0f';
    ctx.beginPath();
    ctx.arc(0,0,20,0,Math.PI*2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
  // プレイヤー
  if(player.alive) {
    ctx.save();
    ctx.translate(player.x-camera.x, player.y-camera.y);
    ctx.rotate(player.dir);
    ctx.fillStyle = '#3af';
    ctx.beginPath();
    ctx.moveTo(20,0);
    ctx.lineTo(-12,10);
    ctx.lineTo(-8,0);
    ctx.lineTo(-12,-10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // 偵察機（☆）
  for(const scout of scouts) {
    ctx.save();
    ctx.translate(scout.x-camera.x, scout.y-camera.y);
    ctx.rotate(scout.angle);
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for(let i=0; i<5; i++) {
      const a = Math.PI*2*i/5 - Math.PI/2;
      const r = (i%2===0) ? 18 : 8;
      ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // BINGO!表示
  if(bingoTimer > 0) {
    ctx.save();
    ctx.font = 'bold 64px sans-serif';
    ctx.fillStyle = '#ff0';
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, bingoTimer/30);
    ctx.fillText('BINGO!', W/2, H/2-80);
    ctx.restore();
    bingoTimer--;
  }

  // Alert!点滅表示
  if(alertMode && Math.floor(Date.now()/200)%2===0) {
    ctx.save();
    ctx.font = 'bold 72px sans-serif';
    ctx.fillStyle = '#f00';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.8;
    ctx.fillText('Alert!', W/2, H/2-120);
    ctx.restore();
  }

  // --- 右下ミニマップ基地インジケータ ---
  const miniW = 120, miniH = 120;
  const miniX = W - miniW - 14, miniY = H - miniH - 14;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#111';
  ctx.fillRect(miniX, miniY, miniW, miniH);
  ctx.strokeStyle = '#666';
  ctx.strokeRect(miniX, miniY, miniW, miniH);
  // 基地を小さな光点で描画
  for(const base of bases) {
    if(!base.alive) continue;
    const bx = miniX + (base.x/MAP_W)*miniW;
    const by = miniY + (base.y/MAP_H)*miniH;
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI*2);
    ctx.fillStyle = '#0f0';
    ctx.shadowColor = '#0f0';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  // プレイヤー位置
  const px = miniX + (player.x/MAP_W)*miniW;
  const py = miniY + (player.y/MAP_H)*miniH;
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI*2);
  ctx.fillStyle = '#3af';
  ctx.fill();
  ctx.restore();
}

let stage = 1;
let stageClearScene = false;
let baseExplosions = [];
let enemySpeedBonus = 0;
let stageStartScene = false;
let stageStartFlash = 0;
let stageStartTimer = 0;
let bingoTimer = 0;

// 誘導弾
const homingMissiles = []; // {x, y, vx, vy, speed, alive}

// 偵察機
const scouts = [
  {angle: 0, r: 500, speed: 0.012, found: false, x: 0, y: 0},
];
let alertMode = false;
let alertTimer = 0;

function startStage() {
  // 難易度アップ: 基地増加、敵増加、速度アップ
  // 基地リセット
  bases.length = 0;
  for(let i=0; i<6+stage; i++) {
    const angle = i * Math.PI*2/(6+stage);
    bases.push({
      x: MAP_W/2 + Math.cos(angle)*600,
      y: MAP_H/2 + Math.sin(angle)*600,
      r: 32,
      alive: true
    });
  }
  // 追尾敵リセット
  enemies.length = 0;
  for(let i=0; i<3+Math.floor(stage/2); i++) {
    enemies.push({
      type: 'chase',
      x: Math.random()*MAP_W,
      y: Math.random()*MAP_H,
      vx: 0,
      vy: 0,
      speed: 0.8 + Math.random()*0.4 + enemySpeedBonus,
      size: 16,
      alive: true
    });
  }
  // 編隊リセット
  formation.angle = 0;
  for(let i=0; i<formation.ships.length; i++) {
    formation.ships[i].alive = true;
    formation.ships[i].laserTimer = 0;
  }
  // プレイヤー初期化
  player.x = MAP_W/2;
  player.y = MAP_H/2;
  player.vx = 0;
  player.vy = 0;
  player.alive = true;
  // 弾・レーザー・誘導弾消去
  bullets.length = 0;
  enemyLasers.length = 0;
  homingMissiles.length = 0;
  baseExplosions = [];
  stageClearScene = false;
  // ステージ開始演出
  stageStartScene = true;
  stageStartFlash = 0;
  stageStartTimer = 0;
}

function nextStage() {
  stage++;
  enemySpeedBonus += 0.14; // 1ステージごとに敵の速度を累積加算
  startStage();
}

let showCM = false;
let cmTimer = 0;

function triggerStageClear() {
  // 全基地爆発演出
  stageClearScene = true;
  baseExplosions = bases.map(b => ({x: b.x, y: b.y, r: 32, timer: 0, done: false}));
  setTimeout(() => {
    stageClearScene = false;
    // ステージ3クリア→4開始前のみCM
    if(stage === 3) {
      showCM = true;
      cmTimer = 420; // 7秒（60fps換算）
    } else {
      nextStage();
    }
  }, 2200);
}

function drawBaseExplosions() {
  // ゆっくり爆発アニメーション
  for(const ex of baseExplosions) {
    if(ex.done) continue;
    ex.timer++;
    const t = ex.timer;
    const maxR = 64;
    let r = ex.r + t*2;
    if(r > maxR) r = maxR;
    ctx.save();
    ctx.globalAlpha = 1 - t/40;
    ctx.beginPath();
    ctx.arc(ex.x-camera.x, ex.y-camera.y, r, 0, Math.PI*2);
    ctx.fillStyle = t%2===0 ? '#ff0' : '#f80';
    ctx.shadowColor = '#ff0';
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    if(t > 40) ex.done = true;
  }
}

function gameLoop() {
  if(showCM) {
    cmTimer--;
    const ui = document.getElementById('ui');
    ui.innerHTML = `<div style="font-size:2em;color:#0af;padding:1em;background:#fff;border-radius:16px;box-shadow:0 0 16px #0af;">
<a href="https://buymeacoffee.com/kgninja" target="_blank" rel="noopener noreferrer" style="display:inline-block;font-size:1em;padding:0.5em 1em;color:#fff;background:#0af;border-radius:8px;text-decoration:none;margin-bottom:8px;"><b>気に入ったらこちらにご支援をお願いします</b></a><br><span style="font-size:1.2em;">7秒後に次のステージ開始</span>
</div>`;

    if(cmTimer <= 0) {
      showCM = false;
      nextStage();
    }
    requestAnimationFrame(gameLoop);
    return;
  }
  if(!stageClearScene && player.alive) update();
  draw();
  if(stageClearScene) drawBaseExplosions();
  // UI
  const ui = document.getElementById('ui');
  const left = bases.filter(b=>b.alive).length;
  if(stageClearScene) {
    ui.innerHTML = '<span style="color:#0f0;font-size:2em;">STAGE CLEAR!</span>';
  } else if(!player.alive) {
    ui.innerHTML = '<span style="color:#ff0;font-size:2em;">GAME OVER</span>';
  } else {
    ui.innerHTML = '基地残り: ' + left + '　STAGE: ' + stage;
    if(left === 0) {
      ui.innerHTML += ' <span style="color:#0f0">ALL BASES DESTROYED!</span>';
      triggerStageClear();
    }
  }
  requestAnimationFrame(gameLoop);
}

// 最初のステージ開始
startStage();



gameLoop();
