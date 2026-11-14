// Tower of Hanoi frontend
// every move goes through the prolog server (/api/move)

const NUM_PEGS = 3;

// animation times in ms at 1x speed
const LIFT_MS = 350;
const TRAVEL_MS = 320;   // per peg of distance
const DROP_MS = 350;

const pegEls = Array.from(document.querySelectorAll('.peg'));
const stackEls = pegEls.map(p => p.querySelector('.disks-stack'));
const flyLayer = document.getElementById('fly-layer');

const timeEl = document.getElementById('time');
const movesEl = document.getElementById('moves');
const invalidEl = document.getElementById('invalid');
const optimalEl = document.getElementById('optimal');
const errorBanner = document.getElementById('error-banner');
const newGameBtn = document.getElementById('new-game');
const autoBtn = document.getElementById('auto-solve');
const diskSelect = document.getElementById('disk-count');
const speedInput = document.getElementById('speed');
const speedLabel = document.getElementById('speed-label');
const modal = document.getElementById('modal');

let diskCount = parseInt(diskSelect.value, 10);
let state = [];
let moves = 0;
let invalid = 0;
let startTime = null;
let timerId = null;
let elapsedMs = 0;
let selected = null;
let busy = false;       // manual move in progress
let solving = false;    // auto-solve running
let finished = false;
let serverOnline = true;
let gameId = 0;         // goes up every new game so old animations stop

function getSpeed() {
  return parseInt(speedInput.value, 10) || 1;
}

function duration(baseMs) {
  return Math.max(12, baseMs / getSpeed());
}

function formatTime(ms) {
  const tenths = Math.floor(ms / 100) % 10;
  const totalSeconds = Math.floor(ms / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + tenths;
}

function optimalMoves() {
  return Math.pow(2, diskCount) - 1;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function clearError() {
  errorBanner.textContent = '';
  errorBanner.classList.add('hidden');
}

function markOffline() {
  serverOnline = false;
  showError('Cannot reach the Prolog server. Run "swipl hanoi.pl", open http://localhost:8080/ and press New Game.');
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// asks the server if the move is valid, returns null if server is down
async function askMove(from, to) {
  try {
    const data = await postJSON('/api/move', { state: state, from: from, to: to });
    if (!serverOnline) {
      serverOnline = true;
      clearError();
    }
    return data;
  } catch (err) {
    markOffline();
    return null;
  }
}

// just checks if the server is up (from == to is always invalid, not counted)
async function checkServer() {
  try {
    await postJSON('/api/move', { state: [[1], [], []], from: 0, to: 0 });
    serverOnline = true;
    clearError();
  } catch (err) {
    markOffline();
  }
}

function makeDisk(size) {
  const d = document.createElement('div');
  d.className = 'disk disk-' + size;
  const percent = 34 + (size - 1) * (62 / Math.max(1, diskCount - 1));
  d.style.width = percent + '%';
  d.innerHTML = '<span>' + size + '</span>';
  return d;
}

function render() {
  stackEls.forEach((stack, i) => {
    stack.innerHTML = '';
    state[i].forEach(size => stack.appendChild(makeDisk(size)));
  });
}

function updateHud() {
  movesEl.textContent = moves;
  invalidEl.textContent = invalid;
  optimalEl.textContent = optimalMoves();
}

function selectPeg(index) {
  selected = index;
  pegEls.forEach((p, i) => p.classList.toggle('selected', i === index));
}

function shakePeg(index) {
  const peg = pegEls[index];
  peg.classList.remove('shake');
  void peg.offsetWidth;   // restart the css animation
  peg.classList.add('shake');
}

function startTimer() {
  startTime = performance.now();
  timerId = setInterval(() => {
    elapsedMs = performance.now() - startTime;
    timeEl.textContent = formatTime(elapsedMs);
  }, 100);
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
  if (startTime !== null) {
    elapsedMs = performance.now() - startTime;
    timeEl.textContent = formatTime(elapsedMs);
  }
}

// moves the top disk: up, then sideways, then down
// returns false if a new game was started in the middle
async function animateMove(from, to, id) {
  const topEl = stackEls[from].lastElementChild;
  if (!topEl) return true;

  const layerRect = flyLayer.getBoundingClientRect();
  const diskRect = topEl.getBoundingClientRect();
  const srcRect = stackEls[from].getBoundingClientRect();
  const dstRect = stackEls[to].getBoundingClientRect();

  const diskH = diskRect.height;
  const startLeft = diskRect.left - layerRect.left;
  const startTop = diskRect.top - layerRect.top;

  const srcCenterX = startLeft + diskRect.width / 2;
  const dstCenterX = dstRect.left + dstRect.width / 2 - layerRect.left;
  const dstCount = state[to].length;
  const destTop = dstRect.bottom - (dstCount + 1) * diskH - layerRect.top;
  const laneTop = srcRect.top - diskH - 14 - layerRect.top;   // above all the pegs

  const up = laneTop - startTop;
  const dx = dstCenterX - srcCenterX;
  const down = destTop - startTop;

  // copy of the disk that does the flying, the real one is hidden
  const fly = topEl.cloneNode(true);
  fly.classList.add('flying');
  fly.style.width = diskRect.width + 'px';
  fly.style.height = diskRect.height + 'px';
  fly.style.left = startLeft + 'px';
  fly.style.top = startTop + 'px';
  flyLayer.appendChild(fly);
  topEl.style.visibility = 'hidden';

  function phase(a, b, ms) {
    return fly.animate(
      [
        { transform: 'translate(' + a[0] + 'px, ' + a[1] + 'px)' },
        { transform: 'translate(' + b[0] + 'px, ' + b[1] + 'px)' }
      ],
      { duration: ms, easing: 'linear', fill: 'forwards' }
    ).finished;
  }

  try {
    await phase([0, 0], [0, up], duration(LIFT_MS));
    if (id !== gameId) { fly.remove(); return false; }

    await phase([0, up], [dx, up], duration(TRAVEL_MS * Math.abs(to - from)));
    if (id !== gameId) { fly.remove(); return false; }

    await phase([dx, up], [dx, down], duration(DROP_MS));
    if (id !== gameId) { fly.remove(); return false; }
  } catch (err) {
    fly.remove();
    return false;
  }

  fly.remove();
  return true;
}

async function attemptMove(from, to, auto) {
  const id = gameId;
  const res = await askMove(from, to);
  if (id !== gameId || res === null) return false;

  if (!res.valid) {
    invalid++;
    updateHud();
    shakePeg(from);
    return false;
  }

  // doing a manual move turns off auto-solve
  if (!auto) autoBtn.disabled = true;
  if (startTime === null) startTimer();

  const done = await animateMove(from, to, id);
  if (!done || id !== gameId) return false;

  state = res.newState;
  moves++;
  render();
  updateHud();

  if (state[NUM_PEGS - 1].length === diskCount) {
    showVictory();
  }
  return true;
}

function showVictory() {
  finished = true;
  stopTimer();
  document.getElementById('result-time').textContent = formatTime(elapsedMs);
  document.getElementById('result-moves').textContent = moves;
  document.getElementById('result-optimal').textContent = optimalMoves();
  modal.classList.remove('hidden');
}

async function onPegClick(index) {
  if (busy || solving || finished) return;

  if (!serverOnline) {
    showError('The Prolog server is offline, so moves are blocked. Start it again and press New Game.');
    return;
  }

  if (selected === null) {
    if (state[index].length === 0) return;
    selectPeg(index);
    return;
  }

  if (selected === index) {
    selectPeg(null);
    return;
  }

  const from = selected;
  selectPeg(null);
  const id = gameId;
  busy = true;
  await attemptMove(from, index, false);
  if (id === gameId) busy = false;
}

async function autoSolve() {
  if (solving || autoBtn.disabled || finished || !serverOnline) return;

  const id = gameId;
  solving = true;
  autoBtn.disabled = true;
  selectPeg(null);

  let data;
  try {
    data = await postJSON('/api/solve', { disks: diskCount, pegs: NUM_PEGS });
  } catch (err) {
    markOffline();
    if (id === gameId) solving = false;
    return;
  }
  if (id !== gameId) return;

  for (const m of data.moves) {
    if (id !== gameId) return;
    const ok = await attemptMove(m.from, m.to, true);
    if (!ok) break;
  }
  if (id === gameId) solving = false;
}

async function newGame() {
  gameId++;
  stopTimer();
  flyLayer.innerHTML = '';
  modal.classList.add('hidden');

  diskCount = parseInt(diskSelect.value, 10);
  const firstPeg = [];
  for (let size = diskCount; size >= 1; size--) {
    firstPeg.push(size);   // biggest at the bottom
  }
  state = [firstPeg, [], []];

  moves = 0;
  invalid = 0;
  startTime = null;
  elapsedMs = 0;
  busy = false;
  solving = false;
  finished = false;
  selectPeg(null);

  timeEl.textContent = formatTime(0);
  render();
  updateHud();
  autoBtn.disabled = false;

  await checkServer();
}

pegEls.forEach((peg, i) => {
  peg.addEventListener('click', () => onPegClick(i));
});
newGameBtn.addEventListener('click', newGame);
diskSelect.addEventListener('change', newGame);
autoBtn.addEventListener('click', autoSolve);
speedInput.addEventListener('input', () => {
  speedLabel.textContent = getSpeed() + 'x';
});
document.getElementById('modal-new').addEventListener('click', newGame);
document.getElementById('modal-close').addEventListener('click', () => {
  modal.classList.add('hidden');
});

speedLabel.textContent = getSpeed() + 'x';
newGame();
