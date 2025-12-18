/* Peg33 iPhone offline PWA
   - default: pure play, no checks running unless toggled
   - solver lives in WebWorker (no UI freezes)
*/
const $ = (id) => document.getElementById(id);

const canvas = $("board");
const ctx = canvas.getContext("2d");

const statusEl = $("status");
const logEl = $("log");
const toastEl = $("toast");

const btnUndo = $("btnUndo");
const btnReset = $("btnReset");
const btnSolve = $("btnSolve");
const btnHint = $("btnHint");
const btnMistake = $("btnMistake");
const btnLatest = $("btnLatest");
const timeline = $("timeline");

const chkAutoCheck = $("chkAutoCheck");
const chkTargets = $("chkTargets");
const chkTrainer = $("chkTrainer");
const chkChallenge = $("chkChallenge");
const livesEl = $("lives");
const winnableEl = $("winnable");
const checkBudgetEl = $("checkBudget");
const solveBudgetEl = $("solveBudget");

function say(msg){
  const t = new Date().toLocaleTimeString().slice(0,5);
  logEl.textContent = `${t}  ${msg}\n` + logEl.textContent;
}

let VALID_CELLS = [];
for (let y=0;y<7;y++) for (let x=0;x<7;x++){
  if ((2<=x && x<=4) || (2<=y && y<=4)) VALID_CELLS.push([x,y]);
}
const CELL2I = new Map(VALID_CELLS.map((c,i)=>[c.join(","), i]));
const I2CELL = VALID_CELLS;

const CENTER = [3,3];
const CENTER_I = CELL2I.get(CENTER.join(","));

const MOVES = [];
for (const [x,y] of VALID_CELLS){
  for (const [dx,dy] of [[2,0],[-2,0],[0,2],[0,-2]]){
    const A=[x,y], B=[x+dx/2,y+dy/2], C=[x+dx,y+dy];
    if (CELL2I.has(B.join(",")) && CELL2I.has(C.join(","))){
      MOVES.push([CELL2I.get(A.join(",")), CELL2I.get(B.join(",")), CELL2I.get(C.join(","))]);
    }
  }
}

// game state
function initialState(){
  // all pegs except center empty
  let s = 0n;
  for (let i=0;i<I2CELL.length;i++) s |= (1n<<BigInt(i));
  s &= ~(1n<<BigInt(CENTER_I));
  return s;
}

function popcountBig(x){
  x = BigInt(x);
  let c=0;
  while (x){ x &= (x-1n); c++; }
  return c;
}

function isGoal(s){
  s=BigInt(s);
  return popcountBig(s)===1 && ((s>>BigInt(CENTER_I)) & 1n)===1n;
}

function legalMid(board, A, C){
  // unused here; we use bitboard legality
}

let state = initialState();
let history = [];          // moves as [a,b,c]
let stateHistory = [state];

function setState(s){
  state = BigInt(s);
}

function applyMove(m){
  const [a,b,c] = m;
  const A = 1n<<BigInt(a), B = 1n<<BigInt(b), C = 1n<<BigInt(c);
  // require a,b present and c empty
  if (((state & A)===0n) || ((state & B)===0n) || ((state & C)!==0n)) return false;
  state = state ^ A ^ B ^ C;
  history.push(m);
  stateHistory.push(state);
  return true;
}

function undo(){
  if (!history.length) return false;
  const m = history.pop();
  stateHistory.pop();
  state = stateHistory[stateHistory.length-1];
  return true;
}

function truncateTo(k){
  k = Math.max(0, Math.min(k, history.length));
  history = history.slice(0,k);
  stateHistory = stateHistory.slice(0,k+1);
  state = stateHistory[k];
}

function updateTimelineBounds(){
  timeline.max = String(history.length);
  timeline.value = String(Math.min(Number(timeline.value), history.length));
}

let viewIndex = 0;
function jumpTo(i){
  viewIndex = i|0;
  setState(stateHistory[viewIndex]);
  render();
  updateStatus();
}

// UI interaction state
let selected = null;  // cell index
let dragging = false;
let dragFrom = null;  // cell index
let dragPos = {x:0,y:0};
let flash = null;     // {cells:Set, t0, dt}

function boardGeom(){
  const w = canvas.width, h = canvas.height;
  const pad = 56;
  const step = Math.min((w-2*pad)/6, (h-2*pad)/6);
  const rad = step*0.28;
  return {pad, step, rad};
}
function cellCenter(x,y){
  const {pad,step} = boardGeom();
  return { x: pad + x*step, y: pad + (6-y)*step };
}
function nearestCell(px,py){
  const {rad} = boardGeom();
  let best=null, bestd=1e18;
  for (let i=0;i<I2CELL.length;i++){
    const [x,y]=I2CELL[i];
    const c = cellCenter(x,y);
    const d = (c.x-px)*(c.x-px) + (c.y-py)*(c.y-py);
    if (d<bestd){ bestd=d; best=i; }
  }
  if (bestd <= (rad*1.2)*(rad*1.2)) return best;
  return null;
}
function hasPeg(i){
  return ((state>>BigInt(i)) & 1n)===1n;
}
function targetsFrom(i){
  const [x,y] = I2CELL[i];
  const out=[];
  const dirs=[[2,0],[-2,0],[0,2],[0,-2]];
  for (const [dx,dy] of dirs){
    const C=[x+dx,y+dy], B=[x+dx/2,y+dy/2];
    const ci=CELL2I.get(C.join(",")); const bi=CELL2I.get(B.join(","));
    if (ci===undefined || bi===undefined) continue;
    const A=1n<<BigInt(i), Bm=1n<<BigInt(bi), Cm=1n<<BigInt(ci);
    if ((state&A)!==0n && (state&Bm)!==0n && (state&Cm)===0n) out.push(ci);
  }
  return out;
}

// rendering
function draw(){
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, 900);
  canvas.width = Math.floor(size*dpr);
  canvas.height = Math.floor(size*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  render();
}
window.addEventListener("resize", draw);

function ring(x,y,r, color, w=6, alpha=0.9){
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.arc(x,y,r,0,Math.PI*2);
  ctx.stroke();
  ctx.restore();
}
function hole(x,y,r){
  ctx.save();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--hole");
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = Math.max(2, r*0.14);
  ctx.beginPath(); ctx.arc(x,y,r*0.92,0,Math.PI*2); ctx.stroke();

  const g = ctx.createRadialGradient(x,y,r*0.15, x,y,r);
  g.addColorStop(0,"rgba(0,0,0,0)");
  g.addColorStop(1,"rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  ctx.restore();
}
function peg(x,y,r){
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.arc(x+2,y+2,r,0,Math.PI*2); ctx.fill();

  const g = ctx.createRadialGradient(x-r*0.3,y-r*0.3,r*0.2, x,y,r*1.25);
  g.addColorStop(0,"rgba(255,255,255,0.35)");
  g.addColorStop(0.35,getComputedStyle(document.documentElement).getPropertyValue("--peg"));
  g.addColorStop(1,"rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x,y,r*0.98,0,Math.PI*2); ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = Math.max(1.5, r*0.08);
  ctx.beginPath(); ctx.arc(x,y,r*0.98,0,Math.PI*2); ctx.stroke();
  ctx.restore();
}

function render(){
  const {rad} = boardGeom();
  const showTargets = chkTargets.checked;
  const tset = (selected!==null && hasPeg(selected)) ? new Set(targetsFrom(selected)) : new Set();

  // flash ring fade
  let flashAlpha = 0;
  let flashCells = null;
  if (flash){
    const dt = performance.now() - flash.t0;
    if (dt > flash.dt){
      flash = null;
    }
  else {

      flashAlpha = Math.max(0, 1 - dt/flash.dt);
      flashCells = flash.cells;
    }
  }

  for (let i=0;i<I2CELL.length;i++){
    const [x,y] = I2CELL[i];
    const c = cellCenter(x,y);
    hole(c.x,c.y,rad);
    if (hasPeg(i)) peg(c.x,c.y,rad);

    if (showTargets && tset.has(i) && !hasPeg(i)){
      ring(c.x,c.y,rad*1.12,"#55c271", Math.max(3,rad*0.16), 0.85);
    }
    if (selected===i && hasPeg(i)){
      ring(c.x,c.y,rad*1.20,"#d6b24e", Math.max(3,rad*0.18), 0.9);
    }
    if (flashCells && flashCells.has(i)){
      ring(c.x,c.y,rad*1.24,"#d6b24e", Math.max(3,rad*0.20), 0.85*flashAlpha);
    }
  }

  if (dragging && dragFrom!==null && hasPeg(dragFrom)){
    const {x,y} = dragPos;
    peg(x,y,boardGeom().rad*1.05);
  }
}

// input
function pointerPos(e){
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width/rect.width) / (window.devicePixelRatio||1);
  const y = (e.clientY - rect.top) * (canvas.height/rect.height) / (window.devicePixelRatio||1);
  return {x,y};
}

canvas.addEventListener("pointerdown", (e)=>{
  canvas.setPointerCapture(e.pointerId);
  const {x,y} = pointerPos(e);
  const c = nearestCell(x,y);
  if (c===null) return;

  if (Number(timeline.value) !== history.length){
    toast("Viewing the past — tap Latest or Resume by moving the slider.");
    return;
  }

  if (!hasPeg(c) && selected!==null){
    attemptMove(selected, c);
    return;
  }

  if (hasPeg(c)){
    dragging = true;
    dragFrom = c;
    dragPos = {x,y};
    selected = c;
    render();
  }
  else {

    selected = null;
    render();
  }
});

canvas.addEventListener("pointermove",(e)=>{
  if (!dragging) return;
  dragPos = pointerPos(e);
  render();
});

canvas.addEventListener("pointerup",(e)=>{
  if (!dragging){
    const {x,y} = pointerPos(e);
    const c = nearestCell(x,y);
    if (c===null) return;
    if (hasPeg(c)){
      selected = c;
      render();
    } else if (selected!==null){
      attemptMove(selected, c);
    }
    return;
  }
  const {x,y} = pointerPos(e);
  const c = nearestCell(x,y);
  const from = dragFrom;
  dragging = false; dragFrom=null;
  if (c===null || c===from){
    selected = from;
    render();
    return;
  }
  attemptMove(from, c);
});

function flashMove(a,b,c){
  flash = { cells: new Set([a,b,c]), t0: performance.now(), dt: 260 };
}

function updateStatus(){
  const p = popcountBig(state);
  const wtag = winnableEl.textContent;
  statusEl.textContent = `pegs=${p} · move=${history.length} · view=${timeline.value} · ${wtag}`;
  livesEl.textContent = chkChallenge.checked ? String(lives) : "—";
}

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 1200);
}

function winCelebrate(){
  toast("✅ SOLVED!");
  say("✅ SOLVED!");
  startConfetti(1200);
}

let lives = 3;
function resetGame(){
  state = initialState();
  history = [];
  stateHistory = [state];
  timeline.value = "0";
  updateTimelineBounds();
  selected = null;
  lives = 3;
  winnableEl.textContent = "—";
  updateStatus();
  render();
  say("Reset.");
  if (chkAutoCheck.checked) requestCheck();
}

function attemptMove(a, c){
  if (Number(timeline.value) !== history.length){
    toast("You are viewing the past. Go to Latest to play.");
    return;
  }
  // compute mid b by geometry: only allow manhattan 2
  const [ax,ay] = I2CELL[a];
  const [cx,cy] = I2CELL[c];
  if (Math.abs(ax-cx)+Math.abs(ay-cy) !== 2){
    if (hasPeg(c)) selected=c;
    render();
    return;
  }
  const bx = (ax+cx)/2, by = (ay+cy)/2;
  const bi = CELL2I.get([bx,by].join(","));
  if (bi===undefined){
    if (hasPeg(c)) selected=c;
    render();
    return;
  }
  const m = [a, bi, c];
  if (!applyMove(m)){
    if (hasPeg(c)) selected=c;
    render();
    return;
  }
  flashMove(a,bi,c);
  updateTimelineBounds();
  timeline.value = String(history.length);
  selected = null;
  render();
  updateStatus();

  if (isGoal(state)){
    say("✅ SOLVED!");
    winCelebrate();
    return;
  }

  // modes
  if (chkTrainer.checked){
    say("You moved. AI thinking…");
    requestAiMove();
    return;
  }
  if (chkAutoCheck.checked) requestCheck();
}

// timeline
timeline.addEventListener("input", ()=>{
  const v = Number(timeline.value);
  if (v < 0 || v >= stateHistory.length) return;
  setState(stateHistory[v]);
  selected = null;
  render();
  updateStatus();
});

btnLatest.addEventListener("click", ()=>{
  timeline.value = String(history.length);
  setState(stateHistory[stateHistory.length-1]);
  render();
  updateStatus();
  if (chkAutoCheck.checked) requestCheck();
});

btnUndo.addEventListener("click", ()=>{
  if (Number(timeline.value) !== history.length){
    toast("Undo disabled while viewing the past.");
    return;
  }
  if (!undo()){
    toast("Nothing to undo.");
    return;
  }
  updateTimelineBounds();
  timeline.value = String(history.length);
  selected = null;
  setState(stateHistory[stateHistory.length-1]);
  render();
  updateStatus();
  say("Undo.");
  if (chkAutoCheck.checked) requestCheck();
});

btnReset.addEventListener("click", resetGame);

// worker
const worker = new Worker("solver_worker.js", { type: "module" });
let pending = null;

function workerCall(kind, payload){
  if (pending) return false;
  pending = kind;
  worker.postMessage({ kind, payload });
  return true;
}

worker.onmessage = (ev)=>{
  const {kind, msg, data} = ev.data;
  if (msg === "progress"){
    statusEl.textContent = data;
    return;
  }
  if (msg === "done"){
    pending = null;
    if (kind === "check"){
      if (data === true) winnableEl.textContent = "winnable✅";
      else if (data === false) winnableEl.textContent = "winnable✗";
      else winnableEl.textContent = "winnable?";
      updateStatus();

      if (chkChallenge.checked && data === false){
        lives -= 1;
        say(`Challenge: unwinnable. Lives left: ${lives}.`);
        if (lives <= 0){
          toast("GAME OVER — Reset.");
          return;
        }
        say("Rewinding to last winnable…");
        requestFirstMistake(true);
      }
      return;
    }

    if (kind === "mistake"){
      const k = data;
      if (k === null){
        say("No mistake found (still winnable quickly).");
        if (chkAutoCheck.checked) requestCheck();
        return;
      }
      const lastOk = Math.max(0, k-1);
      say(`First mistake at move ${k}. Jumping to ${lastOk}.`);
      timeline.value = String(lastOk);
      setState(stateHistory[lastOk]);
      render();
      updateStatus();
      if (ev.data.truncate){
        truncateTo(lastOk);
        updateTimelineBounds();
        timeline.value = String(history.length);
        setState(stateHistory[stateHistory.length-1]);
        say("History truncated (Challenge). Continue.");
      }
      if (chkAutoCheck.checked) requestCheck();
      return;
    }

    if (kind === "ai"){
      const m = data;
      if (m === null){
        say("AI: no quick good move found.");
        if (chkAutoCheck.checked) requestCheck();
        return;
      }
      // m is [a,b,c]
      const [a,b,c] = m;
      applyMove([a,b,c]);
      flashMove(a,b,c);
      updateTimelineBounds();
      timeline.value = String(history.length);
      setState(stateHistory[stateHistory.length-1]);
      render();
      updateStatus();
      say(`AI: ${I2CELL[a]} → ${I2CELL[c]}`);
      if (isGoal(state)){
        say("✅ SOLVED!");
        winCelebrate();
        return;
      }
      if (chkAutoCheck.checked) requestCheck();
      return;
    }

    if (kind === "solve"){
      const sol = data;
      if (!sol || sol.length===0){
        say("No solution found within budget.");
        return;
      }
      say("Animating solution…");
      animateSolution(sol.slice());
      return;
    }
  }
};

function requestCheck(){
  if (pending) return;
  if (Number(timeline.value) !== history.length) return;
  const budget = Number(checkBudgetEl.value || "2.0");
  winnableEl.textContent = "winnable?";
  updateStatus();
  workerCall("check", { state: state.toString(), budget });
}

function requestFirstMistake(truncate){
  if (pending) return;
  const budget = Number(checkBudgetEl.value || "2.0");
  worker.postMessage({ kind:"mistake", payload: { states: stateHistory.map(s=>s.toString()), budget, truncate: !!truncate }});
  pending = "mistake";
}

function requestAiMove(){
  if (pending) return;
  const budget = Number(checkBudgetEl.value || "2.0");
  workerCall("ai", { state: state.toString(), budget });
}

function requestSolve(){
  if (pending) return;
  if (Number(timeline.value) !== history.length){
    toast("Go to Latest to solve from this position.");
    return;
  }
  const budget = Number(solveBudgetEl.value || "10");
  say("Searching…");
  workerCall("solve", { state: state.toString(), budget });
}

btnSolve.addEventListener("click", requestSolve);
btnHint.addEventListener("click", requestAiMove);
btnMistake.addEventListener("click", ()=>requestFirstMistake(false));

chkAutoCheck.addEventListener("change", ()=>{
  if (chkAutoCheck.checked) requestCheck();
  else { winnableEl.textContent="—"; updateStatus(); }
});
chkTrainer.addEventListener("change", ()=>{
  if (chkTrainer.checked){
    say("Trainer ON: AI replies after your move.");
  } else say("Trainer OFF.");
});
chkChallenge.addEventListener("change", ()=>{
  if (chkChallenge.checked){
    lives = 3;
    say("Challenge ON: 3 lives, rewinds on proven unwinnable.");
  }
  else {

    say("Challenge OFF.");
  }
  updateStatus();
});

function animateSolution(sol){
  if (!sol.length) { say("✅ Done."); return; }
  const m = sol.shift();
  const [a,b,c] = m;
  applyMove([a,b,c]);
  flashMove(a,b,c);
  updateTimelineBounds();
  timeline.value = String(history.length);
  setState(stateHistory[stateHistory.length-1]);
  render();
  updateStatus();
  if (isGoal(state)){
    say("✅ SOLVED!");
    winCelebrate();
    return;
  }
  setTimeout(()=>animateSolution(sol), 70);
}

// confetti (cheap, no modal; creates a temporary overlay canvas)
let confetti = [];
function startConfetti(durationMs=1200){
  const overlay = document.createElement("canvas");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9999";
  document.body.appendChild(overlay);

  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.floor(window.innerWidth*dpr);
  overlay.height = Math.floor(window.innerHeight*dpr);
  const cctx = overlay.getContext("2d");
  cctx.setTransform(dpr,0,0,dpr,0,0);

  confetti = [];
  const colors = ["#d6b24e","#55c271","#5b86b5","#ff5a5f","#ffffff"];
  for (let i=0;i<160;i++){
    confetti.push({
      x: window.innerWidth/2,
      y: window.innerHeight/2,
      vx: (Math.random()*2-1)*6,
      vy: (Math.random()*2-1)*6 - 3,
      g: 0.18 + Math.random()*0.12,
      r: 2 + Math.random()*3,
      a: 1,
      c: colors[(Math.random()*colors.length)|0]
    });
  }

  const tEnd = performance.now() + durationMs;
  function step(){
    cctx.clearRect(0,0,window.innerWidth,window.innerHeight);
    for (const p of confetti){
      p.x += p.vx; p.y += p.vy; p.vy += p.g;
      p.a *= 0.992;
      cctx.globalAlpha = Math.max(0, p.a);
      cctx.fillStyle = p.c;
      cctx.beginPath();
      cctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      cctx.fill();
    }
    if (performance.now() < tEnd){
      requestAnimationFrame(step);
    }
  else {

      overlay.remove();
    }
  }
  requestAnimationFrame(step);
}

draw();
updateTimelineBounds();
updateStatus();
say("Ready. (Modes are OFF by default — enable in Settings.)");
