// ===== 可調整的設定 =====
const CONFIG = {
  ink: "#6c6c73", // 內建備用蓮花的顏色（沒有圖片時才用）
  stampSize: 95, // 印章半徑（畫布像素；圖片寬度 = 半徑 × 2）
  stampImage: "img/lotus.png", // 蓮花圖：圖片路徑（相對於 index.html）或 data URI；留空則用內建線條蓮花
  glow: true, // 種成功的蓮花會發光（呼吸光暈）
  modelComplexity: 1, // 手部辨識模型：1 較準、0 較快（電腦很卡時改成 0）
  stampRing: false, // 蓋章時是否加一圈擴散圈
  offsetY: 0, // 落點上下補償（像素，正數往下）
  waterMode: "light", // 'light' 省效能（預設）／'full' 水波扭動（較吃效能）
  horizon: 0.32, // 水平線位置（0–1，由上往下）：以上是霧氣、以下是水面波紋
  waveStrength: 1.3, // 水面橫向波紋的明顯程度（0 = 靜止；1 = 輕；2 = 很明顯）
  waveBands: 46, // 波紋條紋的密度（數字越大條紋越多）
  rippleStrength: 1.2, // 蓋章漣漪扭曲背景的力道
  waterFps: 20, // 水面效果的更新頻率（每秒幾次）：越低越省效能，20 看起來仍然流暢
  camRes: 140, // light 模式下鏡頭畫面的解析度（高度）：越小越糊越省效能，像素感也越明顯；建議 160–270
  maxStamps: 40, // 畫面上最多保留幾個
  diffThreshold: 28, // 像素變化門檻 (0-255)
  minMass: 0.012, // 動作面積下限（佔整張畫面比例）
  downSpeed: 0.012, // 每幀往下移動多少才算「下壓」（相對畫面高度）
  minTravel: 0.09, // 累積下壓距離達到多少才算一次蓋章
  gripRatio: 0.95, // 握拳判定（指尖到掌心距離 ÷ 手掌大小）：越大越寬鬆，張開手約 1.5，握拳約 0.5
  handDownSpeed: 0.005, // 手掌每幀往下移動多少才算下壓
  handMinTravel: 0.05, // 手掌累積下壓距離
  hitTolerance: 1.6, // 判定範圍 = 靶心半徑 × 這個數字；越大越容易命中（判定範圍本來就看不見）
  snap: true, // 命中時印章自動吸附到那一格的位置，花會排得整齊
  maxMiss: 0, // 每關最多可失誤幾次；0 = 不限制，不會被打斷重來
  cooldown: 700, // 兩次蓋章最短間隔 (ms)
};

const $ = (id) => document.getElementById(id);
let stampImg = null;
if (CONFIG.stampImage) {
  const im = new Image();
  im.onload = () => {
    stampImg = im;
  };
  im.src = CONFIG.stampImage;
}
const video = $("v"),
  cv = $("c"),
  ctx = cv.getContext("2d");
const stageEl = $("stage");
const camCv = $("cam"),
  camCtx = camCv.getContext("2d");
if (CONFIG.waterMode === "full") stageEl.classList.add("full");
let W = 960,
  H = 720;
function fit() {
  W = cv.width = stageEl.clientWidth || 960;
  H = cv.height = stageEl.clientHeight || 720;
}
fit();
const stamps = [],
  ripples = [];
const RY = 0.5; // 漣漪的橫向壓扁比例（越小越扁，像從斜上方看水面）
let cur = null;
let showDebug = false,
  dbg = null,
  lastStamp = 0;

// ===== 蓮花圖案（要改造型就改這個函式）=====
function drawLotus(c, x, y, r, alpha, ink) {
  if (stampImg) {
    // 使用自訂圖片（ink 有值代表失誤，顯示淡一點）
    const ar = stampImg.width / stampImg.height,
      w = ar >= 1 ? r * 2 : r * 2 * ar,
      h = ar >= 1 ? (r * 2) / ar : r * 2;
    c.save();
    c.globalAlpha = alpha * (ink ? 0.35 : 1);
    c.drawImage(stampImg, x - w / 2, y - h / 2, w, h);
    c.restore();
    return;
  }
  c.save();
  c.translate(x, y);
  c.globalAlpha = alpha;
  c.strokeStyle = c.fillStyle = ink || CONFIG.ink;
  c.lineWidth = r * 0.05;
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.stroke();
  const petal = (len, wid) => {
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(-wid, -len * 0.35, -wid * 0.6, -len, 0, -len);
    c.bezierCurveTo(wid * 0.6, -len, wid, -len * 0.35, 0, 0);
  };
  for (let i = 0; i < 8; i++) {
    // 外層花瓣（實心）
    c.save();
    c.rotate((i * Math.PI) / 4);
    petal(r * 0.8, r * 0.3);
    c.globalAlpha = alpha * 0.85;
    c.fill();
    c.restore();
  }
  for (let i = 0; i < 8; i++) {
    // 內層花瓣（線條）
    c.save();
    c.rotate(Math.PI / 8 + (i * Math.PI) / 4);
    petal(r * 0.52, r * 0.17);
    c.save();
    c.globalCompositeOperation = "destination-out";
    c.globalAlpha = 1;
    c.fill();
    c.restore();
    c.stroke();
    c.restore();
  }
  c.beginPath();
  c.arc(0, 0, r * 0.08, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function addStamp(x, y) {
  const now = performance.now();
  if (now - lastStamp < CONFIG.cooldown) return;
  lastStamp = now;
  const playing = game.state === "playing",
    slot = { x: target.x, y: target.y0 };
  const hit = judge(x, y);
  if (CONFIG.snap && playing && hit) {
    x = slot.x;
    y = slot.y;
  } // 命中就蓋在那一格的正中央
  stamps.push({ x, y, t0: now, hit });
  ripples.push({ x, y, t0: now, hit });
  if (stamps.length > CONFIG.maxStamps) stamps.shift();
}

// 發光用的光暈圖：只在蓮花圖載入後建一次
let glowSprite = null,
  glowFor = null;
function buildGlow() {
  const c = document.createElement("canvas");
  c.width = c.height = CONFIG.stampSize * 3;
  const o = c.getContext("2d");
  o.shadowColor = "rgba(255,255,244,1)";
  o.shadowBlur = 38;
  drawLotus(o, c.width / 2, c.height / 2, CONFIG.stampSize, 1, null);
  glowSprite = c;
  glowFor = stampImg;
}

// ===== 繪製 =====
const ease = (k) => 1 - Math.pow(1 - k, 3);
function render() {
  ctx.clearRect(0, 0, W, H);
  drawTarget();
  for (let i = stamps.length - 1; i >= 0; i--)
    if (stamps[i].hit === false && performance.now() - stamps[i].t0 > 1500)
      stamps.splice(i, 1); // 失誤的印章 1.5 秒後消失
  const now = performance.now();
  for (const s of stamps) {
    const a = (now - s.t0) / 1000,
      k = Math.min(a / 0.22, 1);
    const sc = 1.35 - 0.35 * ease(k);
    // 每個印章畫在暫存層，才能讓內層花瓣「挖空」而不影響其他印章
    const off = render.off || (render.off = document.createElement("canvas"));
    const sz = CONFIG.stampSize * 3;
    if (off.width !== sz) off.width = off.height = sz;
    else off.getContext("2d").clearRect(0, 0, sz, sz);
    const o = off.getContext("2d");
    drawLotus(
      o,
      off.width / 2,
      off.height / 2,
      CONFIG.stampSize * sc,
      ease(k),
      s.hit === false ? "#b3b3b3" : null,
    );
    if (CONFIG.glow && s.hit !== false) {
      // 種成功：像參考圖的「聖光」——白色暖光暈 + 向上的光柱 + 緩緩飄升的光點。
      // 蓋下的瞬間最亮，之後退成柔和的呼吸光；整關完成時全部一起亮起
      const g = Math.max(0, 1 - a / 1.8),
        done =
          game.state === "wait" && game.hits >= LEVELS[game.lv].need ? 1 : 0;
      const pulse = 0.5 + 0.5 * Math.sin(now / 650 + s.x * 0.01);
      const R = CONFIG.stampSize,
        br = R * (2.1 + 0.4 * pulse + 1 * g + 0.6 * done),
        al = Math.min(1, 0.38 + 0.45 * g + 0.14 * pulse + 0.25 * done);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      let gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, br); // 圓形光暈
      gr.addColorStop(0, `rgba(255,255,250,${Math.min(1, al + 0.3)})`);
      gr.addColorStop(0.3, `rgba(255,251,232,${al * 0.7})`);
      gr.addColorStop(1, "rgba(255,248,220,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(s.x - br, s.y - br, br * 2, br * 2);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(0.5, 1); // 向上的橢圓光柱
      const ch = br * 2.3;
      gr = ctx.createRadialGradient(0, -ch * 0.3, 0, 0, -ch * 0.3, ch * 0.7);
      gr.addColorStop(0, `rgba(255,252,236,${al * 0.6})`);
      gr.addColorStop(1, "rgba(255,250,228,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(-ch, -ch * 1.1, ch * 2, ch * 1.8);
      ctx.restore();
      for (let i = 0; i < 7; i++) {
        // 飄升的光點
        const sp = 16 + i * 6,
          life = br * 1.5,
          yy = ((now / 1000) * sp + i * 53 + s.x) % life;
        const px =
            s.x +
            Math.sin((now / 1400) * (0.6 + i * 0.11) + i * 2 + s.x) * br * 0.55,
          py = s.y - R * 0.2 - yy;
        const tw =
          (0.5 + 0.5 * Math.sin(now / 300 + i * 1.7)) *
          (1 - yy / life) *
          Math.min(1, al + 0.2);
        ctx.fillStyle = `rgba(255,255,245,${tw})`;
        ctx.beginPath();
        ctx.arc(px, py, 1.4 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (!glowSprite || glowFor !== stampImg) buildGlow(); // 花本身的白色外光（預先畫好的光暈圖，不用每幀重算模糊）
      const ga = Math.min(1, 0.45 + 0.4 * g + 0.12 * pulse + 0.25 * done),
        gs = sc * (1 + 0.05 * pulse + 0.08 * g);
      ctx.save();
      ctx.globalAlpha = ga;
      ctx.drawImage(
        glowSprite,
        s.x - (glowSprite.width * gs) / 2,
        s.y - (glowSprite.height * gs) / 2,
        glowSprite.width * gs,
        glowSprite.height * gs,
      );
      ctx.restore();
      ctx.drawImage(off, s.x - off.width / 2, s.y - off.height / 2);
    } else ctx.drawImage(off, s.x - off.width / 2, s.y - off.height / 2);
    if (CONFIG.stampRing && a < 0.5) {
      // 壓下時的擴散圈
      ctx.save();
      ctx.globalAlpha = (1 - a / 0.5) * 0.4;
      ctx.strokeStyle = CONFIG.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, CONFIG.stampSize * (1 + a * 1.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  // 水波：命中時三圈、較大較久；失誤時一圈、較淡
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i],
      a = (now - rp.t0) / 1000,
      life = rp.hit ? 2.2 : 1.4;
    if (a > life + 0.5) {
      ripples.splice(i, 1);
      continue;
    }
    for (let j = 0; j < (rp.hit ? 3 : 1); j++) {
      const t = a - j * 0.25;
      if (t < 0 || t > life) continue;
      const k = t / life,
        rad = (rp.hit ? 150 : 90) * ease(k) + 6,
        al = (1 - k) * (rp.hit ? 0.85 : 0.4);
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.strokeStyle = "rgba(60,60,68," + al * 0.35 + ")";
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y + 2, rad, rad * RY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255," + al + ")";
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rad, rad * RY, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (dbg) {
    // 拳頭位置游標：讓你知道印章會落在哪裡
    cur = cur
      ? { x: cur.x + (dbg.x - cur.x) * 0.4, y: cur.y + (dbg.y - cur.y) * 0.4 }
      : { x: dbg.x, y: dbg.y };
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(60,60,68,.5)";
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#e8a9bd";
    ctx.beginPath();
    ctx.arc(cur.x, cur.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else cur = null;
  if (showDebug && dbg) {
    ctx.save();
    ctx.fillStyle = "#e8a9bd";
    ctx.beginPath();
    ctx.arc(dbg.x, dbg.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ===== 動作偵測（縮小畫面做逐幀差異）=====
const PW = 64,
  PH = 48;
const pc = document.createElement("canvas");
pc.width = PW;
pc.height = PH;
const pctx = pc.getContext("2d", { willReadFrequently: true });
let prev = null,
  prevCy = null,
  down = 0,
  last = null,
  running = false;

function detect() {
  pctx.drawImage(video, 0, 0, PW, PH);
  const d = pctx.getImageData(0, 0, PW, PH).data;
  const cur = new Uint8Array(PW * PH);
  for (let i = 0; i < cur.length; i++)
    cur[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  if (prev) {
    let n = 0,
      sx = 0,
      sy = 0;
    for (let i = 0; i < cur.length; i++) {
      if (Math.abs(cur[i] - prev[i]) > CONFIG.diffThreshold) {
        n++;
        sx += i % PW;
        sy += (i / PW) | 0;
      }
    }
    const mass = n / cur.length;
    if (mass > CONFIG.minMass) {
      const cx = sx / n / PW,
        cy = sy / n / PH;
      last = toScreen(cx, cy); // 鏡像 x
      dbg = last;
      if (prevCy !== null) {
        const vy = cy - prevCy;
        if (vy > CONFIG.downSpeed) down += vy;
        else {
          if (down > CONFIG.minTravel) addStamp(last.x, last.y);
          down = 0;
        }
      }
      prevCy = cy;
    } else {
      // 沒有動作：若剛下壓過就視為停住
      if (down > CONFIG.minTravel && last) addStamp(last.x, last.y);
      down = 0;
      prevCy = null;
      dbg = null;
    }
  }
  prev = cur;
}

// ===== 靶心闖關（改關卡只要改 LEVELS）=====
const LEVELS = [
  { r: 115, need: 3, speed: 0, jump: false }, // r 靶心半徑, need 需命中次數, speed 移動速度, jump 命中後換位置
  { r: 100, need: 4, speed: 0, jump: true },
  { r: 85, need: 4, speed: 70, jump: false },
];
let game = null,
  target = null,
  tLast = performance.now(),
  fbText = "";

// 靶心只出現在畫面下半部、中間偏窄的區域，手不用大幅揮動
function area(r) {
  const x0 = W * 0.22 + r,
    x1 = W * 0.78 - r,
    y0 = H * 0.52 + r,
    y1 = H * 0.95 - r;
  return { x0, x1: Math.max(x0, x1), y0, y1: Math.max(y0, y1) };
}
// 靶心由左到右一格一格出現，像在「種花」；第 n 次命中後，下一格靶心出現在右邊
function placeTarget() {
  const L = LEVELS[game.lv],
    k = Math.min(W, H) / 720,
    r = L.r * k,
    A = area(r),
    n = L.need;
  const x =
    n > 1 ? A.x0 + ((A.x1 - A.x0) * game.hits) / (n - 1) : (A.x0 + A.x1) / 2;
  const y = (A.y0 + A.y1) / 2;
  target = { r, x, y, y0: y, amp: L.speed ? (A.y1 - A.y0) / 2 : 0 }; // speed > 0 時靶心會上下緩緩漂動
}
function say(t) {
  const m = $("msg");
  m.textContent = t;
  m.style.display = t ? "flex" : "none";
}
function hud() {
  const L = LEVELS[game.lv];
  $("hud").innerHTML =
    `<span>第 ${game.lv + 1} / ${LEVELS.length} 關</span><span>${fbText}</span><span>命中 ${game.hits}/${L.need}　${CONFIG.maxMiss ? `　失誤 ${game.miss}/${CONFIG.maxMiss}` : ""}</span>`;
}
function startLevel(lv) {
  game.lv = lv;
  game.hits = 0;
  game.miss = 0;
  game.state = "playing";
  stamps.length = 0;
  placeTarget(lv === 0);
  say("");
  fbText = "";
  hud();
}
function startGame() {
  game = { lv: 0, state: "playing", total: 0, hitTotal: 0 };
  startLevel(0);
}

function judge(x, y) {
  if (game.state !== "playing") return true;
  const g = game,
    L = LEVELS[g.lv],
    d = Math.hypot(x - target.x, y - target.y),
    hit = d <= target.r * CONFIG.hitTolerance;
  g.total++;
  if (hit) {
    g.hitTotal++;
    g.hits++;
    fbText = d <= target.r * 0.3 ? "完美" : "命中";
    if (g.hits >= L.need) {
      g.state = "wait";
      if (g.lv === LEVELS.length - 1)
        say(
          "休行完成\n命中率 " + Math.round((g.hitTotal / g.total) * 100) + "%",
        );
      else {
        say("第 " + (g.lv + 1) + " 關完成");
        setTimeout(() => {
          if (game === g) startLevel(g.lv + 1);
        }, 1600);
      }
    } else placeTarget();
  } else {
    g.miss++;
    fbText = "再近一點";
    if (CONFIG.maxMiss && g.miss >= CONFIG.maxMiss) {
      g.state = "wait";
      say("再試一次");
      setTimeout(() => {
        if (game === g) startLevel(g.lv);
      }, 1600);
    }
  }
  setTimeout(() => {
    fbText = "";
    if (game === g) hud();
  }, 700);
  hud();
  return hit;
}

function drawTarget() {
  const now = performance.now(),
    dt = Math.min((now - tLast) / 1000, 0.05);
  tLast = now;
  if (game.state === "playing" && target.amp)
    target.y =
      target.y0 +
      Math.sin(((now / 1000) * LEVELS[game.lv].speed) / 58) * target.amp;
  const { x, y, r } = target,
    ring = (k) => {
      ctx.beginPath();
      ctx.arc(x, y, r * k, 0, Math.PI * 2);
    };
  ctx.save();
  ctx.lineWidth = 2;
  const p = (now % 2400) / 2400; // 中心點的緩慢呼吸光圈（不想要就刪掉這兩行）
  ctx.globalAlpha = (1 - p) * 0.8;
  ctx.strokeStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x, y, 8 + p * 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#e8a9bd";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
startGame();

addEventListener("resize", () => {
  fit();
  if (game) placeTarget(game.lv === 0);
});

// 影像座標 → 螢幕座標（配合 object-fit:cover 的裁切與鏡像）
function toScreen(nx, ny) {
  const vw = video.videoWidth || 640,
    vh = video.videoHeight || 480,
    s = Math.max(W / vw, H / vh);
  return {
    x: W / 2 + (0.5 - nx) * vw * s,
    y: H / 2 + (ny - 0.5) * vh * s + CONFIG.offsetY,
  };
}
const hXs = []; // 最近幾幀的 x，取平均讓落點更穩
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// ===== MediaPipe 手部追蹤（握拳 + 下壓）=====
let hands = null,
  useHands = false,
  hBusy = false,
  hPrevY = null,
  hDown = 0,
  gripT = 0,
  hLast = null;
const dist = (a, b) =>
  Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

function onHands(r) {
  const lm = r.multiHandLandmarks && r.multiHandLandmarks[0];
  if (!lm) {
    if (
      hDown > CONFIG.handMinTravel &&
      hLast &&
      performance.now() - gripT < 400
    )
      addStamp(hLast.x, hLast.y);
    hPrevY = null;
    hDown = 0;
    dbg = null;
    return;
  }
  const palm = [0, 5, 9, 13, 17].reduce(
    (p, i) => ({ x: p.x + lm[i].x / 5, y: p.y + lm[i].y / 5 }),
    { x: 0, y: 0 },
  );
  // 以 3D 距離判斷，側面的拳頭也能辨識；手指只要大致彎向掌心就算握住
  const size =
    (dist(lm[0], lm[5]) + dist(lm[0], lm[17]) + dist(lm[5], lm[17])) / 3;
  const center = {
    x: palm.x,
    y: palm.y,
    z: [0, 5, 9, 13, 17].reduce((s, i) => s + lm[i].z / 5, 0),
  };
  const tips = [8, 12, 16, 20].reduce((s, i) => s + dist(lm[i], center), 0) / 4;
  if (tips / size < CONFIG.gripRatio) gripT = performance.now();
  const grip = performance.now() - gripT < 250;
  const pos = toScreen(palm.x, palm.y);
  dbg = pos;
  hLast = pos;
  hXs.push(pos.x);
  if (hXs.length > 8) hXs.shift();
  if (hPrevY !== null) {
    const vy = palm.y - hPrevY;
    if (grip && vy > CONFIG.handDownSpeed) hDown += vy;
    else {
      if (grip && hDown > CONFIG.handMinTravel) addStamp(avg(hXs), pos.y);
      hDown = 0;
    }
  }
  hPrevY = palm.y;
}

async function startHands() {
  const mode = $("mode");
  mode.textContent = "正在載入手部辨識模型…";
  try {
    if (!window.Hands) throw new Error("script blocked");
    hands = new Hands({
      locateFile: (f) =>
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/" + f,
    });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: CONFIG.modelComplexity,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    hands.onResults(onHands);
    await Promise.race([
      hands.initialize(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 10000),
      ),
    ]);
    useHands = true;
    mode.textContent = "目前模式：手部追蹤（握拳 + 下壓）";
  } catch (e) {
    useHands = false;
    mode.textContent =
      "手部模型無法載入（" + e.message + "），已改用動作偵測。";
  }
}

// light 模式：鏡頭畫在小畫布上，逐像素做成「灰色調的水面倒影」：
//   水平線以上是霧氣，以下是一條一條橫向的水波紋（越靠近畫面下方越寬、越大），
//   再疊上蓋章漣漪的扭曲。為了省效能：只以 waterFps 的頻率更新、陣列重複使用、漣漪只計算有影響的範圍
const camSrc = document.createElement("canvas"),
  srcCtx = camSrc.getContext("2d", { willReadFrequently: true });
const TINT_DARK = [120, 120, 126],
  TINT_LIGHT = [234, 234, 237]; // 畫面最暗／最亮處的顏色（灰色調；想更重就把兩個數字調低）
const KLUT = new Float32Array(256); // 亮度 → 明暗，事先算好
for (let i = 0; i < 256; i++) KLUT[i] = 0.4 + 0.55 * Math.pow(i / 255, 0.9); // .4 是整體亮度底線（想更暗就調低）
let camOut = null,
  camBuf = null,
  lastCam = 0;
function drawCam() {
  if (CONFIG.waterMode === "full" || video.readyState < 2) return;
  const nowMs = performance.now();
  if (nowMs - lastCam < 1000 / CONFIG.waterFps) return;
  lastCam = nowMs;
  const h = CONFIG.camRes,
    w = Math.round((h * video.videoWidth) / video.videoHeight);
  if (camCv.width !== w || camCv.height !== h) {
    camCv.width = camSrc.width = w;
    camCv.height = camSrc.height = h;
    camOut = null;
    camBuf = null;
  }
  srcCtx.save();
  srcCtx.scale(-1, 1);
  srcCtx.drawImage(video, -w, 0, w, h);
  srcCtx.restore(); // 同時做左右鏡像
  const src = srcCtx.getImageData(0, 0, w, h);
  if (!camOut) camOut = camCtx.createImageData(w, h);
  if (!camBuf)
    camBuf = {
      rowDx: new Float32Array(h),
      rowAmp: new Float32Array(h),
      rowShade: new Float32Array(h),
      ax: new Float32Array(w),
      dx: new Float32Array(w * h),
      dy: new Float32Array(w * h),
      sh: new Float32Array(w * h),
    };
  const { rowDx, rowAmp, rowShade, ax, dx: rdx, dy: rdy, sh: rsh } = camBuf;
  const sd = src.data,
    od = camOut.data,
    t = nowMs / 1000,
    A = CONFIG.waveStrength,
    hz = CONFIG.horizon;

  // 每一行的橫向位移與明暗帶（整行只算一次）
  for (let y = 0; y < h; y++) {
    const d = Math.max(0, (y / h - hz) / (1 - hz)); // 0 = 水平線，1 = 畫面最下方
    const phase = Math.sqrt(d) * CONFIG.waveBands - t * 1.5; // 水平線附近條紋細而密，往下變寬
    const amp = A * (0.2 + 3.4 * d);
    rowAmp[y] = amp;
    rowDx[y] = amp * (Math.sin(phase) + 0.45 * Math.sin(phase * 2.3 - t * 0.9));
    rowShade[y] = Math.sin(phase) * 15 * Math.min(1, d * 3);
  }
  for (let x = 0; x < w; x++) ax[x] = Math.sin(x * 0.045 + t * 0.6);

  // 蓋章漣漪：只在每個圈的外框範圍內計算，結果先累加到陣列
  const s = Math.max(W / w, H / h);
  let hasR = false;
  for (const rp of ripples) {
    const a = (nowMs - rp.t0) / 1000,
      life = rp.hit ? 2.2 : 1.4;
    for (let j = 0; j < (rp.hit ? 3 : 1); j++) {
      const tt = a - j * 0.25;
      if (tt < 0 || tt > life) continue;
      if (!hasR) {
        rdx.fill(0);
        rdy.fill(0);
        rsh.fill(0);
        hasR = true;
      }
      const k = tt / life,
        wid = (18 + 26 * k) / s,
        rad = ((rp.hit ? 150 : 90) * ease(k) + 6) / s;
      const cx = (rp.x - W / 2) / s + w / 2,
        cy = (rp.y - H / 2) / s + h / 2,
        out = rad + wid * 3;
      const amp =
          (((1 - k) * (rp.hit ? 1 : 0.5) * CONFIG.rippleStrength * 10) / s) *
          1.6,
        shK = (38 * amp) / ((CONFIG.rippleStrength * 16) / s + 1e-6);
      const x0 = Math.max(0, Math.floor(cx - out)),
        x1 = Math.min(w - 1, Math.ceil(cx + out));
      const y0 = Math.max(0, Math.floor(cy - out * RY)),
        y1 = Math.min(h - 1, Math.ceil(cy + out * RY)),
        out2 = out * out;
      for (let y = y0; y <= y1; y++) {
        const ey = (y - cy) / RY;
        for (let x = x0; x <= x1; x++) {
          const ex = x - cx,
            d2 = ex * ex + ey * ey;
          if (d2 > out2 || d2 < 1) continue;
          const d = Math.sqrt(d2),
            u = (d - rad) / wid;
          if (u > 2.5 || u < -2.5) continue;
          const f = Math.exp(-u * u) * Math.sin(u * 3),
            i = y * w + x,
            q = (amp * f) / d;
          rdx[i] += ex * q;
          rdy[i] += ey * q * RY;
          rsh[i] += f * shK;
        }
      }
    }
  }

  const [r0, g0, b0] = TINT_DARK,
    [r1, g1, b1] = TINT_LIGHT,
    dr = r1 - r0,
    dg = g1 - g0,
    db = b1 - b0;
  for (let y = 0, i = 0; y < h; y++) {
    const rdxY = rowDx[y],
      ampY = rowAmp[y] * 0.5,
      shY = rowShade[y],
      ampS = rowAmp[y] * 1.2;
    for (let x = 0; x < w; x++, i++) {
      let dx = rdxY + ampY * ax[x],
        dy = 0,
        shade = shY + ax[x] * ampS;
      if (hasR) {
        dx += rdx[i];
        dy = rdy[i];
        shade += rsh[i];
      }
      let sx = Math.round(x + dx),
        sy = Math.round(y + dy);
      sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx;
      sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
      const si = (sy * w + sx) << 2,
        oi = i << 2;
      let k =
        KLUT[(sd[si] * 77 + sd[si + 1] * 151 + sd[si + 2] * 28) >> 8] +
        shade / 255;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      od[oi] = r0 + dr * k;
      od[oi + 1] = g0 + dg * k;
      od[oi + 2] = b0 + db * k;
      od[oi + 3] = 255;
    }
  }
  camCtx.putImageData(camOut, 0, 0);
}

function loop() {
  if (running && video.readyState >= 2) {
    if (useHands) {
      if (!hBusy) {
        hBusy = true;
        hands
          .send({ image: video })
          .catch(() => {})
          .then(() => {
            hBusy = false;
          });
      }
    } else detect();
  }
  drawCam();
  render();
  requestAnimationFrame(loop);
}

// ===== 控制 =====
$("start").onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 },
        height: { ideal: 540 },
        facingMode: "user",
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    running = true;
    $("hint").style.display = "none";
    startHands();
    $("start").textContent = "鏡頭已開啟";
  } catch (e) {
    $("hint").style.display = "flex";
    $("hint").textContent =
      "無法開啟鏡頭（" +
      e.name +
      "：" +
      (e.message || "") +
      "）。若權限已開啟，可能是內嵌預覽限制，請在新分頁直接開啟此連結；也可先用「測試蓋章」。";
  }
};
$("test").onclick = () => {
  $("hint").style.display = "none";
  addStamp(W * (0.25 + Math.random() * 0.5), H * (0.25 + Math.random() * 0.5));
};
$("debug").onclick = () => {
  showDebug = !showDebug;
  $("debug").textContent = showDebug ? "隱藏偵測點" : "顯示偵測點";
};
$("clear").onclick = () => {
  startGame();
};
$("stage").addEventListener("click", (e) => {
  const r = cv.getBoundingClientRect();
  addStamp(
    ((e.clientX - r.left) / r.width) * W,
    ((e.clientY - r.top) / r.height) * H,
  );
});
addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    $("test").click();
  }
});

loop();
