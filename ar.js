// 마커 기반 AR 공용 코드 (MindAR + three.js).
// 페이지가 열리면 바로 카메라를 켜고, 카드를 찾으면 위아래 알파 영상(위=색상, 아래=알파)을 카드 위에 띄운다.
// 사용: startAR({ video, mind, foot, floor, top, shadowFrom })
//   카드 폭 = 1 단위, 카드 중심 = 원점. 값은 카드 생성 스크립트와 맞춰야 한다.
//   foot  : 영상 아래에서 캐릭터 발까지 (영상 높이 대비)
//   floor : 카드 아래에서 무대 바닥선까지
//   top   : 카드 아래에서 영상 위 끝까지 (카드 높이 1.5보다 작게 → 영상이 카드 밖으로 안 나감)
//   shadowFrom : 영상 아래에서 이 높이(0~1) 위쪽 글씨에 진한 그림자를 깐다. 없으면 그림자 없음.
import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

const CARD_ASPECT = 900 / 600;   // 카드 세로/가로 (card.mind 컴파일 이미지와 같아야 함)

const CSS = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #111; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  #ar { position: fixed; inset: 0; }
  .bar { position: fixed; left: 0; right: 0; z-index: 10; text-align: center; pointer-events: none; display: none; }
  .bar span { display: inline-block; padding: 10px 18px; border-radius: 22px; font-size: 16px; }
  #hint { bottom: max(24px, env(safe-area-inset-bottom)); }
  #hint span { background: rgba(0,0,0,.55); }
  #sound { top: max(16px, env(safe-area-inset-top)); }
  #sound span { background: #fff; color: #e23c6e; font-weight: 700; font-size: 17px; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
  #fail { position: fixed; inset: 0; z-index: 20; display: none; flex-direction: column; align-items: center;
    justify-content: center; gap: 18px; padding: 24px; text-align: center; background: linear-gradient(#ffe3f0, #dff0ff); color: #333; }
  #fail p { margin: 0; font-size: 17px; line-height: 1.5; }
  #retry { font: inherit; font-size: 20px; font-weight: 700; padding: 14px 44px; border: 0; border-radius: 30px; background: #e23c6e; color: #fff; }
  #clip { position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
`;

const HTML = `
  <div id="ar"></div>
  <div id="hint" class="bar"><span>카드 전체가 보이게 비춰 주세요</span></div>
  <div id="sound" class="bar"><span>🔊 화면을 누르면 소리가 나요</span></div>
  <div id="fail">
    <p>카메라를 켜지 못했어요.<br>카메라 권한을 허용한 뒤 다시 눌러 주세요.</p>
    <button id="retry">다시 시도</button>
  </div>
  <video id="clip" muted playsinline webkit-playsinline preload="auto" loop></video>
`;

export function startAR({ video: videoSrc = 'cake.mp4', mind = 'card.mind', foot, floor, top, shadowFrom = null }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend', HTML);

  const video = document.getElementById('clip');
  video.src = videoSrc;
  const hint = document.getElementById('hint');
  const soundBar = document.getElementById('sound');
  const fail = document.getElementById('fail');

  const PLANE_H = (top - floor) / (1 - foot);
  const PLANE_W = PLANE_H * 9 / 16;

  let found = false;
  let soundOn = false;
  let started = false;

  const show = (el, on) => { el.style.display = on ? 'block' : 'none'; };

  function playVideo() {
    video.play().catch(() => {
      // 소리 있는 재생이 막히면 음소거로라도 재생
      if (!video.muted) { video.muted = true; soundOn = false; show(soundBar, true); video.play().catch(() => {}); }
    });
  }

  // 첫 터치에서 소리를 켜고 영상을 처음부터 다시 튼다 (휴대폰은 터치 전에는 소리 재생을 막음)
  function enableSound() {
    if (soundOn || !started) return;
    soundOn = true;
    show(soundBar, false);
    video.muted = false;
    video.currentTime = 0;
    video.play().then(() => { if (!found) video.pause(); }).catch(() => {
      soundOn = false;
      video.muted = true;
      show(soundBar, true);
      if (found) video.play().catch(() => {});
    });
  }
  window.addEventListener('pointerup', enableSound);
  window.addEventListener('touchend', enableSound);

  const mindar = new MindARThree({
    container: document.getElementById('ar'),
    imageTargetSrc: mind,
    uiScanning: 'no',
    uiLoading: 'yes',
    missTolerance: 10,   // 잠깐 인식이 끊겨도 바로 사라지지 않게
  });
  const { renderer, scene, camera } = mindar;

  const tex = new THREE.VideoTexture(video);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  // 위 절반 = 색상, 아래 절반 = 흑백 알파. flipY 때문에 텍스처 좌표에서는 색상이 v 0.5~1 쪽이다.
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, shadowFrom: { value: shadowFrom ?? 2.0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float shadowFrom;
      varying vec2 vUv;
      float alphaAt(vec2 uv) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 0.998) return 0.0;
        return clamp((texture2D(map, vec2(uv.x, uv.y * 0.5)).r - 0.04) / 0.92, 0.0, 1.0);
      }
      void main() {
        vec3 color = texture2D(map, vec2(vUv.x, 0.5 + vUv.y * 0.5)).rgb;
        float a = alphaAt(vUv);
        // 위쪽 글씨 구간에만 부드러운 진한 그림자를 깐다.
        // 주변 알파의 평균을 쓰므로 굵은 글씨에는 진하게, 작은 색종이에는 거의 안 생긴다.
        float textZone = smoothstep(shadowFrom, shadowFrom + 0.04, vUv.y);
        float sum = 0.0;
        if (textZone > 0.0) {
          for (int i = 0; i < 16; i++) {
            float ang = float(i) * 0.3927;
            vec2 dir = vec2(cos(ang), sin(ang)) * vec2(1.0 / 540.0, 1.0 / 960.0);
            sum += alphaAt(vUv + dir * 5.0) + alphaAt(vUv + dir * 10.0) + alphaAt(vUv + dir * 16.0);
          }
        }
        float back = textZone * smoothstep(0.05, 0.26, sum / 48.0) * 0.9;
        float outA = a + (1.0 - a) * back;
        if (outA < 0.01) discard;
        vec3 backColor = vec3(0.16, 0.08, 0.30);
        gl_FragColor = vec4(mix(backColor, color, a / max(outA, 0.001)), outA);
      }`,
  });

  // 캐릭터 발이 카드의 무대 바닥선에 오도록 놓는다
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), material);
  const bottom = -CARD_ASPECT / 2 + floor - foot * PLANE_H;
  plane.position.set(0, bottom + PLANE_H / 2, 0.01);

  const anchor = mindar.addAnchor(0);

  // 영상은 앵커에 직접 붙이지 않고 따로 둔 뒤 매 프레임 앵커 위치를 부드럽게 따라가게 한다.
  // 작은 변화(인식 떨림)는 강하게 눌러 주고, 큰 변화(카드를 실제로 움직임)는 바로 따라간다.
  const holder = new THREE.Group();
  holder.visible = false;
  holder.add(plane);
  scene.add(holder);
  const tPos = new THREE.Vector3(), tQuat = new THREE.Quaternion(), tScale = new THREE.Vector3();
  let snap = true;
  function follow() {
    if (!found) { holder.visible = false; snap = true; return; }
    anchor.group.updateWorldMatrix(true, false);
    anchor.group.matrixWorld.decompose(tPos, tQuat, tScale);
    if (snap) {
      holder.position.copy(tPos); holder.quaternion.copy(tQuat); holder.scale.copy(tScale);
      snap = false;
    } else {
      const move = holder.position.distanceTo(tPos) / tScale.x;   // 카드 폭 대비 이동량
      const turn = holder.quaternion.angleTo(tQuat);              // 라디안
      const k = THREE.MathUtils.clamp(Math.max(move / 0.08, turn / 0.15), 0.05, 0.8);
      holder.position.lerp(tPos, k);
      holder.quaternion.slerp(tQuat, k);
      holder.scale.lerp(tScale, k);
    }
    holder.visible = true;
  }

  anchor.onTargetFound = () => {
    found = true;
    show(hint, false);
    playVideo();
  };
  anchor.onTargetLost = () => {
    found = false;
    show(hint, true);
    video.pause();
  };

  async function start() {
    show(fail, false);
    try {
      await mindar.start();
    } catch (e) {
      console.error(e);
      fail.style.display = 'flex';
      return;
    }
    started = true;
    show(hint, !found);
    show(soundBar, !soundOn);
    renderer.setAnimationLoop(() => { follow(); renderer.render(scene, camera); });
  }

  document.getElementById('retry').addEventListener('click', () => location.reload());
  start();
}
