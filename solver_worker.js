// solver_worker.js (module)
// BigInt bitboard solver with timeboxing + pruning cache per job.

function popcountBig(x){
  x = BigInt(x);
  let c=0;
  while (x){ x &= (x-1n); c++; }
  return c;
}

function isGoal(s, centerI){
  s = BigInt(s);
  return popcountBig(s)===1 && ((s>>BigInt(centerI)) & 1n)===1n;
}

function buildMoves(){
  let VALID_CELLS = [];
  for (let y=0;y<7;y++) for (let x=0;x<7;x++){
    if ((2<=x && x<=4) || (2<=y && y<=4)) VALID_CELLS.push([x,y]);
  }
  const cell2i = new Map(VALID_CELLS.map((c,i)=>[c.join(","), i]));
  const centerI = cell2i.get("3,3");

  const moves = [];
  for (const [x,y] of VALID_CELLS){
    for (const [dx,dy] of [[2,0],[-2,0],[0,2],[0,-2]]){
      const A=[x,y], B=[x+dx/2,y+dy/2], C=[x+dx,y+dy];
      if (cell2i.has(B.join(",")) && cell2i.has(C.join(","))){
        moves.push([cell2i.get(A.join(",")), cell2i.get(B.join(",")), cell2i.get(C.join(","))]);
      }
    }
  }

  const HAVE = [], EMPTY = [], TOG = [];
  for (const [a,b,c] of moves){
    const A=1n<<BigInt(a), B=1n<<BigInt(b), C=1n<<BigInt(c);
    HAVE.push(A|B);
    EMPTY.push(C);
    TOG.push(A^B^C);
  }
  return {moves, HAVE, EMPTY, TOG, centerI};
}

const {moves, HAVE, EMPTY, TOG, centerI} = buildMoves();

function legalMoves(s){
  s = BigInt(s);
  const mids = [];
  for (let i=0;i<moves.length;i++){
    if ( (s & HAVE[i]) === HAVE[i] && (s & EMPTY[i]) === 0n ) mids.push(i);
  }
  return mids;
}

function dfsBestLine(start, budgetSec){
  const t0 = performance.now();
  const deadline = t0 + budgetSec*1000;
  const target = popcountBig(start) - 1;
  if (target < 0) return null;

  const path = new Array(target).fill(0);
  const seenMaxRem = new Map(); // BigInt -> max rem already failed

  let nodes = 0;

  function dfs(s, d){
    if (performance.now() > deadline) return null;
    nodes++;
    if ((nodes & 8191)===0){
      postMessage({kind: CURRENT_KIND, msg:"progress", data: `searching… nodes=${nodes.toLocaleString()} depth=${d}/${target}`});
    }

    s = BigInt(s);
    if (d === target){
      return isGoal(s, centerI);
    }
    const rem = target - d;
    const prev = seenMaxRem.get(s);
    if (prev !== undefined && prev >= rem) return false;
    seenMaxRem.set(s, rem);

    const mids = legalMoves(s);
    for (let k=0;k<mids.length;k++){
      const m = mids[k];
      path[d] = m;
      const ok = dfs(s ^ TOG[m], d+1);
      if (ok === true) return true;
      if (ok === null) return null;
    }
    return false;
  }

  const ok = dfs(BigInt(start), 0);
  if (ok === true){
    // convert to [a,b,c] triples for UI
    return path.map(mi => moves[mi]);
  }
  return null; // false or timeout
}

function isWinnable(start, budgetSec){
  const sol = dfsBestLine(start, budgetSec);
  if (sol === null) return null; // unknown (timeout) OR not found
  // If we found a line, it's winnable
  return true;
}

function checkWinnable(start, budgetSec){
  const t0 = performance.now();
  const deadline = t0 + budgetSec*1000;
  const target = popcountBig(start) - 1;
  if (target < 0) return false;
  const seenMaxRem = new Map();
  let nodes = 0;

  function dfs(s, d){
    if (performance.now() > deadline) return null;
    nodes++;
    if ((nodes & 8191)===0){
      postMessage({kind: CURRENT_KIND, msg:"progress", data: `checking… nodes=${nodes.toLocaleString()} depth=${d}/${target}`});
    }

    s = BigInt(s);
    if (d === target){
      return isGoal(s, centerI);
    }
    const rem = target - d;
    const prev = seenMaxRem.get(s);
    if (prev !== undefined && prev >= rem) return false;
    seenMaxRem.set(s, rem);

    const mids = legalMoves(s);
    for (let k=0;k<mids.length;k++){
      const m = mids[k];
      const ok = dfs(s ^ TOG[m], d+1);
      if (ok === true) return true;
      if (ok === null) return null;
    }
    return false;
  }

  const r = dfs(BigInt(start), 0);
  if (r === true) return true;
  if (r === false) return false;
  return null;
}

let CURRENT_KIND = "";

function firstMistakeIndex(states, budgetSec){
  // binary search for earliest unwinnable (timeboxed checks)
  const last = BigInt(states[states.length-1]);
  const rlast = checkWinnable(last, budgetSec);
  if (rlast === true) return null;
  if (states.length<=1) return 0;

  let lo=0, hi=states.length-1;
  while (lo < hi){
    const mid = (lo+hi)>>1;
    const s = BigInt(states[mid]);
    const ok = checkWinnable(s, budgetSec);
    if (ok === true){
      lo = mid+1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

self.onmessage = (ev)=>{
  const {kind, payload} = ev.data;
  CURRENT_KIND = kind;

  try{
    if (kind === "check"){
      const s = BigInt(payload.state);
      const budget = Number(payload.budget || 2.0);
      const r = checkWinnable(s, budget);
      postMessage({kind, msg:"done", data: r});
      return;
    }
    if (kind === "ai"){
      const s = BigInt(payload.state);
      const budget = Number(payload.budget || 2.0);
      const mids = legalMoves(s);
      // pick first move that is provably winnable within remaining budget
      const t0 = performance.now();
      const deadline = t0 + budget*1000;

      for (let i=0;i<mids.length;i++){
        if (performance.now() > deadline) break;
        const mi = mids[i];
        const child = s ^ TOG[mi];
        const r = checkWinnable(child, Math.max(0.2, (deadline-performance.now())/1000));
        if (r === true){
          postMessage({kind, msg:"done", data: moves[mi]});
          return;
        }
      }
      // fallback: any legal move
      postMessage({kind, msg:"done", data: mids.length ? moves[mids[0]] : null});
      return;
    }
    if (kind === "solve"){
      const s = BigInt(payload.state);
      const budget = Number(payload.budget || 10);
      const sol = dfsBestLine(s, budget);
      postMessage({kind, msg:"done", data: sol});
      return;
    }
    if (kind === "mistake"){
      const states = payload.states || [];
      const budget = Number(payload.budget || 2.0);
      const k = firstMistakeIndex(states, budget);
      postMessage({kind, msg:"done", data: k, truncate: !!payload.truncate});
      return;
    }
  }catch(e){
    postMessage({kind, msg:"done", data: null});
  }
};
