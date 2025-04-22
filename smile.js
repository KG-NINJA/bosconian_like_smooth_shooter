
async function setupCamera() {
  video = document.getElementById('webcam');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Webカメラが利用できません');
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function loadModel() {
  model = await faceLandmarksDetection.load(
    faceLandmarksDetection.SupportedPackages.mediapipeFacemesh
  );
}

function calculateSmileScore(landmarks) {
  // 口角の位置から簡易的に笑顔度を算出（例）
  // landmarks[61] = 口左端, landmarks[291] = 口右端, landmarks[0] = 顎先
  if (!landmarks || landmarks.length < 468) return 0;
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const chin = landmarks[152];
  const topLip = landmarks[13];
  const mouthWidth = Math.hypot(rightMouth.x - leftMouth.x, rightMouth.y - leftMouth.y);
  const mouthOpen = Math.hypot(topLip.x - chin.x, topLip.y - chin.y);
  // 笑顔度を0-100で返す（簡易モデル）
  let score = (mouthWidth / mouthOpen) * 50;
  score = Math.max(0, Math.min(100, score));
  return Math.round(score);
}

async function detectSmile() {
  if (!model || !video) return;
  const predictions = await model.estimateFaces({input: video, returnTensors: false, flipHorizontal: false});
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (predictions.length > 0) {
    const keypoints = predictions[0].scaledMesh;
    smileScore = calculateSmileScore(keypoints);
    // 顔ランドマーク描画（任意）
    ctx.strokeStyle = 'cyan';
    for (let i = 0; i < keypoints.length; i++) {
      const [x, y] = keypoints[i];
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  document.getElementById('smile-score').innerText = smileScore;
  requestAnimationFrame(detectSmile);
}

async function mainSmileApp() {
  await setupCamera();
  await loadModel();
  canvas = document.getElementById('overlay');
  ctx = canvas.getContext('2d');
  video.play();
  detectSmile();
}

document.addEventListener('DOMContentLoaded', mainSmileApp);
