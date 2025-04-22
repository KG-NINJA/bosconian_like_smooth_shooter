// タッチ操作用仮想パッドUIとイベント処理
(function() {
  const canvas = document.getElementById('game-canvas');
  const ui = document.getElementById('ui');
  // 仮想パッドUIを追加
  const pad = document.createElement('div');
  pad.id = 'touch-pad';
  pad.style.position = 'absolute';
  pad.style.left = '0';
  pad.style.bottom = '0';
  pad.style.width = '50vw';
  pad.style.height = '40vh';
  pad.style.zIndex = '10';
  pad.style.touchAction = 'none';
  // スティックもvw/vh基準で配置
  pad.innerHTML = '<div id="stick" style="position:absolute;left:40%;bottom:20%;width:13vw;height:13vw;max-width:90px;max-height:90px;min-width:48px;min-height:48px;border-radius:50%;background:rgba(0,128,255,0.2);border:2px solid #0af;transform:translate(-50%,-50%);"></div>';
  document.body.appendChild(pad);

  // ショットボタン
  const shotBtn = document.createElement('button');
  shotBtn.textContent = 'SHOT';
  shotBtn.id = 'touch-shot';
  shotBtn.style.position = 'absolute';
  // GAME OVER時は画面中央やや上、普段は非表示
  // 端末種別ごとにショットボタンの配置を最適化
  let shotBtnSize = 60; // px
  let shotBtnOffsetX = 8, shotBtnOffsetY = 8; // デフォルト（右下）
  // 画面サイズ・向き・端末種別で配置を決定
  function getDeviceType() {
    const ua = navigator.userAgent;
    if (/Mobile|Android|iP(hone|od)/.test(ua)) return 'mobile';
    if (/iPad|Tablet/.test(ua) || (navigator.maxTouchPoints && window.innerWidth > 700)) return 'tablet';
    return 'pc';
  }
  const updateShotBtnPos = () => {
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    const device = getDeviceType();
    if (device === 'mobile') {
      shotBtnSize = Math.max(wh, ww) < 700 ? 48 : 60;
      shotBtnOffsetX = 4;
      shotBtnOffsetY = 10;
    } else if (device === 'tablet') {
      shotBtnSize = 64;
      shotBtnOffsetX = 18;
      shotBtnOffsetY = 18;
    } else {
      shotBtnSize = 60;
      shotBtnOffsetX = 8;
      shotBtnOffsetY = 8;
    }
    // 配置
    shotBtn.style.left = (ww - shotBtnSize - ww * shotBtnOffsetX / 100) + 'px';
    shotBtn.style.top = (wh - shotBtnSize - wh * shotBtnOffsetY / 100) + 'px';
    shotBtn.style.width = shotBtnSize + 'px';
    shotBtn.style.height = shotBtnSize + 'px';
    shotBtn.style.fontSize = (shotBtnSize * 0.35) + 'px';
  };


  // ドラッグによる移動を無効化（固定配置）
  // shotBtn.addEventListener('mousedown', ...);
  // window.addEventListener('mousemove', ...);
  // window.addEventListener('mouseup', ...);




  window.addEventListener('resize', updateShotBtnPos);
  window.addEventListener('orientationchange', updateShotBtnPos);
  setTimeout(updateShotBtnPos, 100); // 初期配置
  updateShotBtnPos();
  shotBtn.style.width = '80px';
  shotBtn.style.height = '80px';
  shotBtn.style.borderRadius = '50%';
  shotBtn.style.background = 'linear-gradient(135deg,#f44,#faa)';
  shotBtn.style.color = '#fff';
  shotBtn.style.fontSize = '1.5em';
  shotBtn.style.border = '2px solid #f44';
  shotBtn.style.zIndex = '10';
  shotBtn.style.opacity = '0.85';
  shotBtn.style.pointerEvents = 'auto';
  shotBtn.style.touchAction = 'none';
  shotBtn.style.position = 'absolute';
  document.body.appendChild(shotBtn);

  // 常に表示
  shotBtn.style.display = '';
  updateShotBtnPos();

  // タッチパッドの動作
  let touchId = null, startX = 0, startY = 0, moveX = 0, moveY = 0;
  let stick = document.getElementById('stick');

  // タッチ操作
  pad.addEventListener('touchstart', function(e) {
    if(touchId!==null) return;
    const t = e.changedTouches[0];
    touchId = t.identifier;
    startX = t.clientX;
    startY = t.clientY;
    stick.style.left = (startX/window.innerWidth*100)+'vw';
    stick.style.bottom = (40-(startY/window.innerHeight*40))+'vh';
    stick.style.background = 'rgba(0,128,255,0.4)';
    moveX = moveY = 0;
    e.preventDefault();
  }, {passive:false});
  pad.addEventListener('touchmove', function(e) {
    if(touchId===null) return;
    for(const t of e.changedTouches) {
      if(t.identifier===touchId) {
        moveX = t.clientX - startX;
        moveY = t.clientY - startY;
        stick.style.left = (t.clientX/window.innerWidth*100)+'vw';
        stick.style.bottom = (40-(t.clientY/window.innerHeight*40))+'vh';
        break;
      }
    }
    e.preventDefault();
  }, {passive:false});
  pad.addEventListener('touchend', function(e) {
    for(const t of e.changedTouches) {
      if(t.identifier===touchId) {
        touchId = null;
        stick.style.left = '40vw';
        stick.style.bottom = '20vh';
        stick.style.background = 'rgba(0,128,255,0.2)';
        moveX = moveY = 0;
        break;
      }
    }
    e.preventDefault();
  }, {passive:false});

  // マウス操作（デバッグ用）
  let mouseDown = false;
  pad.addEventListener('mousedown', function(e) {
    mouseDown = true;
    startX = e.clientX;
    startY = e.clientY;
    stick.style.left = (startX/window.innerWidth*100)+'vw';
    stick.style.bottom = (40-(startY/window.innerHeight*40))+'vh';
    stick.style.background = 'rgba(0,128,255,0.4)';
    moveX = moveY = 0;
    e.preventDefault();
  });
  pad.addEventListener('mousemove', function(e) {
    if(!mouseDown) return;
    moveX = e.clientX - startX;
    moveY = e.clientY - startY;
    stick.style.left = (e.clientX/window.innerWidth*100)+'vw';
    stick.style.bottom = (40-(e.clientY/window.innerHeight*40))+'vh';
    e.preventDefault();
  });
  pad.addEventListener('mouseup', function(e) {
    mouseDown = false;
    stick.style.left = '40vw';
    stick.style.bottom = '20vh';
    stick.style.background = 'rgba(0,128,255,0.2)';
    moveX = moveY = 0;
    e.preventDefault();
  });
  pad.addEventListener('mouseleave', function(e) {
    if(mouseDown) {
      mouseDown = false;
      stick.style.left = '40vw';
      stick.style.bottom = '20vh';
      stick.style.background = 'rgba(0,128,255,0.2)';
      moveX = moveY = 0;
    }
  });

  // ゲーム本体のキー状態に反映
  function updateTouchKeys() {
    // 方向
    if(touchId!==null || mouseDown) {
      const dx = moveX, dy = moveY;
      const dist = Math.sqrt(dx*dx+dy*dy);
      if(dist>16) {
        // 八方向判定
        const angle = Math.atan2(dy, dx) * 180 / Math.PI; // -180～180度（左右正しく）
        keys['ArrowUp'] = keys['ArrowDown'] = keys['ArrowLeft'] = keys['ArrowRight'] = false;
        if(angle >= -22.5 && angle < 22.5) {
          keys['ArrowRight'] = true;
        } else if(angle >= 22.5 && angle < 67.5) {
          keys['ArrowRight'] = true; keys['ArrowDown'] = true;
        } else if(angle >= 67.5 && angle < 112.5) {
          keys['ArrowDown'] = true;
        } else if(angle >= 112.5 && angle < 157.5) {
          keys['ArrowDown'] = true; keys['ArrowLeft'] = true;
        } else if(angle >= 157.5 || angle < -157.5) {
          keys['ArrowLeft'] = true;
        } else if(angle >= -157.5 && angle < -112.5) {
          keys['ArrowLeft'] = true; keys['ArrowUp'] = true;
        } else if(angle >= -112.5 && angle < -67.5) {
          keys['ArrowUp'] = true;
        } else if(angle >= -67.5 && angle < -22.5) {
          keys['ArrowUp'] = true; keys['ArrowRight'] = true;
        }
      } else {
        keys['ArrowUp']=keys['ArrowDown']=keys['ArrowLeft']=keys['ArrowRight']=false;
      }
    } else {
      keys['ArrowUp']=keys['ArrowDown']=keys['ArrowLeft']=keys['ArrowRight']=false;
    }
    requestAnimationFrame(updateTouchKeys);
  }
  updateTouchKeys();

  // ショットボタン
  // タッチ
  shotBtn.addEventListener('touchstart', function(e){
    keys[' ']=true;
    e.preventDefault();
  },{passive:false});
  shotBtn.addEventListener('touchend', function(e){
    keys[' ']=false;
    e.preventDefault();
  },{passive:false});
  // マウス
  shotBtn.addEventListener('mousedown', function(e){
    keys[' ']=true;
    e.preventDefault();
  });
  shotBtn.addEventListener('mouseup', function(e){
    keys[' ']=false;
    e.preventDefault();
  });
})();
