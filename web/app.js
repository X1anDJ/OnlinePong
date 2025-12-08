// ====== config (defensive) ======
const ENV = window.ENV || {};
const HTTP = ENV.HTTP_API_BASE || "";
const WS_URL = ENV.WS_URL || "";

if (!HTTP)
  console.error("ENV.HTTP_API_BASE not set; check inline config block.");
if (!WS_URL)
  console.warn("ENV.WS_URL not set; WebSocket features will be disabled.");

// ====== tiny helpers ======
const $ = (id) => document.getElementById(id);
const log = (m) => {
  const L = $("log");
  if (!L) return;
  L.textContent += m + "\n";
  L.scrollTop = L.scrollHeight;
};
const show = (id, v = true) => {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !v);
};

// ====== session state ======
let token = null,
  userId = null,
  username = null;
let matchId = null,
  ws = null;
let opponentId = null;
let role = "host"; // 'host' or 'guest'
let pollTimer = null;

// ====== UI elements ======
const statusSpan = $("status");
const lbTable = $("lbTable"),
  lbTableBody = lbTable ? lbTable.querySelector("tbody") : null;
const historyTable = $("historyTable"),
  historyTableBody = historyTable ? historyTable.querySelector("tbody") : null;

// ====== helpers: JSON fetch configs ======
const jsonReq = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: body != null ? JSON.stringify(body) : undefined,
});

// ====== role helper ======
function setRole() {
  if (!opponentId) {
    role = "host";
  } else {
    // deterministic: lexicographically smaller userId becomes host
    role = userId < opponentId ? "host" : "guest";
  }
  log(`My role: ${role}`);

  const controlsText = $("controlsText");
  if (controlsText) {
    controlsText.textContent =
      role === "host"
        ? "Controls: Arrow Up/Down (RIGHT paddle)"
        : "Controls: Arrow Up/Down (LEFT paddle)";
  }
}

// ====== auth actions ======
$("guestBtn").onclick = async () => {
  try {
    if (!HTTP) {
      log("Guest: API base not configured.");
      return;
    }
    const name = $("username").value || undefined;
    const r = await fetch(
      `${HTTP}/auth/guest`,
      jsonReq("POST", { username: name })
    );
    const txt = await r.text();
    let j;
    try {
      j = JSON.parse(txt);
    } catch {
      j = { raw: txt };
    }
    if (!r.ok) {
      log("Guest error: " + JSON.stringify(j));
      return;
    }
    token = j.token;
    userId = j.userId;
    username = j.username || j.userId;
    log(`Guest login: ${userId}`);
    show("auth", false);
    show("menu", true);
  } catch (e) {
    log("Guest exception: " + (e && e.message ? e.message : String(e)));
  }
};

$("signupBtn").onclick = async () => {
  try {
    const u = $("suUser").value,
      p = $("suPass").value;
    const r = await fetch(
      `${HTTP}/auth/signup`,
      jsonReq("POST", { username: u, password: p })
    );
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      token = j.token;
      userId = j.userId;
      username = u;
      log(`Signed up: ${userId}`);
      show("auth", false);
      show("menu", true);
    } else {
      log("Signup failed: " + JSON.stringify(j));
    }
  } catch (e) {
    log("Signup exception: " + (e && e.message ? e.message : String(e)));
  }
};

$("loginBtn").onclick = async () => {
  try {
    const u = $("liUser").value,
      p = $("liPass").value;
    const r = await fetch(
      `${HTTP}/auth/login`,
      jsonReq("POST", { username: u, password: p })
    );
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      token = j.token;
      userId = j.userId;
      username = u;
      log(`Logged in: ${userId}`);
      show("auth", false);
      show("menu", true);
    } else {
      log("Login failed: " + JSON.stringify(j));
    }
  } catch (e) {
    log("Login exception: " + (e && e.message ? e.message : String(e)));
  }
};

// ====== leaderboard ======
$("lbBtn").onclick = async () => {
  try {
    const r = await fetch(`${HTTP}/leaderboard`);
    const j = await r.json().catch(() => ({ items: [] }));
    if (lbTableBody) {
      lbTableBody.innerHTML = "";
      (j.items || []).forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${row.username || row.userId}</td><td>${
          row.tier || ""
        }</td><td>${row.score || 0}</td>`;
        lbTableBody.appendChild(tr);
      });
    }
    show("lb", true);
  } catch (e) {
    log("Leaderboard error: " + (e && e.message ? e.message : String(e)));
  }
};

$("rankBtn").onclick = async () => {
  if (!userId) return log("Not logged in.");
  try {
    const r = await fetch(`${HTTP}/rank?userId=${encodeURIComponent(userId)}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok) log(`My Rank: #${j.rank} (score ${j.score})`);
    else log("Rank error: " + JSON.stringify(j));
  } catch (e) {
    log("Rank exception: " + (e && e.message ? e.message : String(e)));
  }
};

$("historyBtn").onclick = async () => {
  if (!userId) return log("Not logged in.");
  try {
    const r = await fetch(
      `${HTTP}/history?userId=${encodeURIComponent(userId)}`
    );
    const j = await r.json().catch(() => ({ items: [] }));
    if (!r.ok) {
      log("History error: " + JSON.stringify(j));
      return;
    }
    if (historyTableBody) {
      historyTableBody.innerHTML = "";
      (j.items || []).forEach((row) => {
        const tr = document.createElement("tr");
        const ts = row.timestamp
          ? new Date(row.timestamp * 1000).toLocaleString()
          : "";
        const opponent = row.opponentId || "";
        const score = `${row.scoreFor ?? 0}-${row.scoreAgainst ?? 0}`;
        tr.innerHTML = `<td>${ts}</td><td>${opponent}</td><td>${score}</td><td>${
          row.result || ""
        }</td>`;
        historyTableBody.appendChild(tr);
      });
    }
    show("history", true);
  } catch (e) {
    log("History exception: " + (e && e.message ? e.message : String(e)));
  }
};

// ====== matchmaking polling helper ======
async function pollForMatch() {
  try {
    const r = await fetch(
      `${HTTP}/matchmaking/check`,
      jsonReq("POST", { userId })
    );
    const j = await r.json().catch(() => ({}));
    log(`Poll /matchmaking/check response: ${JSON.stringify(j)}`);
    if (r.ok && j.matchId) {
      matchId = j.matchId;
      opponentId = j.opponent;
      setRole();
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      statusSpan.textContent = `Matched! ${matchId}`;
      log(`Matched via poll: ${matchId} vs ${opponentId || "(unknown)"}`);
      startWebSocket();
    }
  } catch (e) {
    log("Poll exception: " + (e && e.message ? e.message : String(e)));
  }
}

// ====== matchmaking ======
$("startBtn").onclick = async () => {
  try {
    statusSpan.textContent = "Matching… (15s)";
    const r = await fetch(
      `${HTTP}/matchmaking/start`,
      jsonReq("POST", { userId })
    );
    const j = await r.json().catch(() => ({}));
    log(`Start response: ${JSON.stringify(j)}`);

    if (r.ok && j.matchId) {
      // immediate match (second player)
      matchId = j.matchId;
      opponentId = j.opponent;
      setRole();
      log(`Matched immediately: ${matchId} vs ${opponentId || "(waiting)"}`);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      startWebSocket();
    } else {
      // queued: start polling
      log("Queued; polling for opponent… open another tab and click Start.");
      let seconds = 0;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      pollTimer = setInterval(() => {
        seconds++;
        statusSpan.textContent = `Matching… (${Math.max(15 - seconds, 0)}s)`;
        pollForMatch();
        if (seconds >= 15) {
          clearInterval(pollTimer);
          pollTimer = null;
          statusSpan.textContent = "No match. Tap Start again to retry.";
        }
      }, 1000);
    }
  } catch (e) {
    log("Matchmaking exception: " + (e && e.message ? e.message : String(e)));
  }
};

// ====== websocket + game ======
function startWebSocket() {
  if (!WS_URL) {
    log("WS_URL not configured.");
    return;
  }
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "JOIN", userId, matchId }));
    statusSpan.textContent = `In match ${matchId}`;
    show("game", true);
    startGameLoop();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "STATE") onStateUpdate(msg);
      if (msg.type === "INPUT") onOpponentInput(msg);
      if (msg.type === "SCORE_UPDATE") onScoreUpdate(msg);
      if (msg.type === "GAME_OVER") onGameOver(msg);
      if (msg.type === "REPLAY_STATUS")
        log(`Replay: opponent agree=${msg.agree}`);
    } catch (e) {
      log("WS parse error: " + (e && e.message ? e.message : String(e)));
    }
  };
  ws.onclose = () => log("WS closed");
  ws.onerror = () => log("WS error");
}

// ====== minimal pong (client-authoritative host) ======
const canvas = $("canvas"),
  ctx = canvas.getContext("2d");
const W = canvas.width,
  H = canvas.height;
let ball = { x: W / 2, y: H / 2, vx: 3, vy: 2, r: 6 };
let paddleA = { x: 10, y: H / 2 - 30, w: 8, h: 60 }; // left
let paddleB = { x: W - 18, y: H / 2 - 30, w: 8, h: 60 }; // right
let scoreA = 0,
  scoreB = 0;
let keys = { up: false, down: false };

document.addEventListener("keydown", (e) => {
  if (playing) {
    e.preventDefault(); // ✅ stop page from scrolling
  }
  if (e.key === "ArrowUp") keys.up = true;
  if (e.key === "ArrowDown") keys.down = true;
});
document.addEventListener("keyup", (e) => {
  if (playing) {
    e.preventDefault();
  }
  if (e.key === "ArrowUp") keys.up = false;
  if (e.key === "ArrowDown") keys.down = false;
});

function sendInput(v) {
  if (ws && ws.readyState === 1)
    ws.send(
      JSON.stringify({
        type: "INPUT",
        userId,
        matchId,
        axis: "y",
        value: v,
        ts: Date.now(),
      })
    );
}

// host: apply opponent input; guest: ignore
function onOpponentInput(msg) {
  if (role !== "host") return;
  const v = Number(msg.value || 0);
  paddleA.y += v * 6;
  clampPaddles();
}

function clampPaddles() {
  paddleA.y = Math.max(0, Math.min(H - paddleA.h, paddleA.y));
  paddleB.y = Math.max(0, Math.min(H - paddleB.h, paddleB.y));
}

function notifyScore(scorer) {
  if (ws && ws.readyState === 1) {
    ws.send(
      JSON.stringify({
        type: "SCORE",
        userId,
        matchId,
        scorer: scorer === "A" ? "A" : "B",
      })
    );
  }
}

function resetBall(dir) {
  ball.x = W / 2;
  ball.y = H / 2;
  ball.vx = 3 * dir;
  ball.vy = Math.random() > 0.5 ? 2 : -2;
}

// host sends STATE periodically
function broadcastState() {
  if (!ws || ws.readyState !== 1) return;
  ws.send(
    JSON.stringify({
      type: "STATE",
      userId,
      matchId,
      ball: { x: ball.x, y: ball.y },
      paddleA: { y: paddleA.y },
      paddleB: { y: paddleB.y },
      scoreA,
      scoreB,
    })
  );
}

// guests apply STATE, host can ignore
function onStateUpdate(msg) {
  if (role === "host") return; // we're the source of truth
  if (!msg.ball || !msg.paddleA || !msg.paddleB) return;
  ball.x = msg.ball.x;
  ball.y = msg.ball.y;
  scoreA = msg.scoreA | 0;
  scoreB = msg.scoreB | 0;
  paddleA.y = msg.paddleA.y;
  paddleB.y = msg.paddleB.y;
}

// ====== game loop ======
let frame = 0,
  playing = false,
  rafId = null;

function tick() {
  // everyone reads input
  let v = 0;
  if (keys.up) v = -1;
  else if (keys.down) v = 1;

  if (role === "host") {
    // host: apply input to right paddle, simulate full physics
    if (v !== 0) {
      paddleB.y += v * 6;
      clampPaddles();
    }

    // ball movement
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.y < ball.r || ball.y > H - ball.r) ball.vy *= -1;

    // collisions
    if (
      ball.x - ball.r < paddleA.x + paddleA.w &&
      ball.y > paddleA.y &&
      ball.y < paddleA.y + paddleA.h
    ) {
      ball.vx = Math.abs(ball.vx);
    }
    if (
      ball.x + ball.r > paddleB.x &&
      ball.y > paddleB.y &&
      ball.y < paddleB.y + paddleB.h
    ) {
      ball.vx = -Math.abs(ball.vx);
    }

    // scoring
    if (ball.x < -10) {
      scoreB++;
      notifyScore("B");
      resetBall(-1);
    }
    if (ball.x > W + 10) {
      scoreA++;
      notifyScore("A");
      resetBall(1);
    }
  } else {
    // guest: only send input to host, don't move paddles locally
    if (v !== 0 && frame % 3 === 0) {
      sendInput(v);
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  // middle line
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);
  // paddles & ball
  ctx.fillRect(paddleA.x, paddleA.y, paddleA.w, paddleA.h);
  ctx.fillRect(paddleB.x, paddleB.y, paddleB.w, paddleB.h);
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
  ctx.fill();
  // score
  ctx.font = "20px monospace";
  ctx.fillText(`${scoreA}`, W / 2 - 40, 30);
  ctx.fillText(`${scoreB}`, W / 2 + 24, 30);
}

function loop() {
  frame++;
  tick();
  if (role === "host" && frame % 2 === 0) {
    broadcastState(); // ~30fps/2 = ~15Hz state updates
  }
  draw();
  if (playing) rafId = requestAnimationFrame(loop);
}

function startGameLoop() {
  scoreA = scoreB = 0;
  resetBall(1);
  playing = true;

  // Focus the canvas to capture arrow keys
  if (canvas && canvas.focus) {
    canvas.focus();
  }

  loop();
}

function stopGameLoop() {
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
}

function onScoreUpdate(msg) {
  scoreA = msg.scoreA | 0;
  scoreB = msg.scoreB | 0;
}

function onGameOver(msg) {
  stopGameLoop();
  log(`Game Over. Winner: ${msg.winner}`);
  show("playAgainBtn", true);
  show("exitBtn", true);
}

$("playAgainBtn").onclick = () => {
  show("playAgainBtn", false);
  show("exitBtn", false);
  if (ws && ws.readyState === 1)
    ws.send(
      JSON.stringify({ type: "PLAY_AGAIN", userId, matchId, agree: true })
    );
  $("startBtn").click(); // simplest demo flow
};

$("exitBtn").onclick = () => {
  show("playAgainBtn", false);
  show("exitBtn", false);
  if (ws) ws.close();
  show("game", false);
};
