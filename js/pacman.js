// Pac-Man movement. Arrow keys / WASD on keyboard, swipe on touch screens.
// Reads LAYOUT and TILES from board.js, so this script must load after it.
// Game rules live in game.js, which listens for the events fired here:
//   pacman:moved  after every step        pacman:power  on eating a power pellet
const pacman = document.querySelector(".sprite--pacman");
const ready = document.querySelector(".ready");
const scoreEl = document.getElementById("score");
const highScoreEl = document.getElementById("high-score");

const STEP_MS = 150; // time to cross one tile at normal speed
// Buffs/debuffs (js/director.js) set window.GAME.pacmanSpeed: 2 = twice as fast.
const stepMs = () => STEP_MS / (window.GAME?.pacmanSpeed || 1);
const SWIPE_MIN_PX = 20;

// Arcade point values.
const PELLET_POINTS = {
  "tile--pellet": 10,
  "tile--power": 50,
};

let score = 0;
let highScore = Number(highScoreEl.textContent);
let pelletsLeft = countPellets();

const DIRECTIONS = {
  up:    { dx: 0,  dy: -1, angle: -90 },
  down:  { dx: 0,  dy: 1,  angle: 90 },
  left:  { dx: -1, dy: 0,  angle: 180 },
  right: { dx: 1,  dy: 0,  angle: 0 },
};

const KEY_TO_DIRECTION = {
  ArrowUp: "up",    w: "up",
  ArrowDown: "down", s: "down",
  ArrowLeft: "left", a: "left",
  ArrowRight: "right", d: "right",
};

const START = { x: 13, y: 23 };

const state = {
  ...START,
  dir: null,    // direction Pac-Man is currently moving
  queued: null, // last requested direction, taken as soon as the path opens
  angle: 0,
  timer: null,
  paused: false, // set by game.js while dying, clearing a level or on game over
};

// Columns wrap so the side tunnel on row 14 leads to the other edge.
function wrapX(x) {
  const cols = LAYOUT[0].length;
  return (x + cols) % cols;
}

function canMove(dir) {
  const { dx, dy } = DIRECTIONS[dir];
  const row = LAYOUT[state.y + dy];
  if (!row) return false;
  const char = row[wrapX(state.x + dx)];
  return char !== "#" && char !== "-";
}

function render(animate) {
  pacman.style.transition = animate ? `transform ${stepMs()}ms linear` : "none";
  pacman.style.transform =
    `translate(calc(var(--cell) * ${state.x}), calc(var(--cell) * ${state.y})) rotate(${state.angle}deg)`;
}

function eatPellet() {
  const tile = TILES[state.y][state.x];
  for (const [pelletClass, points] of Object.entries(PELLET_POINTS)) {
    if (!tile.classList.contains(pelletClass)) continue;
    tile.classList.replace(pelletClass, "tile--empty");
    pelletsLeft--;
    addScore(points);
    if (pelletClass === "tile--power") document.dispatchEvent(new CustomEvent("pacman:power"));
    return;
  }
}

function countPellets() {
  return TILES.flat().filter((tile) =>
    Object.keys(PELLET_POINTS).some((pelletClass) => tile.classList.contains(pelletClass))
  ).length;
}

function resetPellets() {
  paintTiles();
  pelletsLeft = countPellets();
}

function resetPacman() {
  Object.assign(state, START, { dir: null, queued: null, angle: 0 });
  render(false);
}

function resetScore() {
  score = 0;
  scoreEl.textContent = "00";
}

function addScore(points) {
  score += points;
  scoreEl.textContent = String(score).padStart(2, "0");
  if (score > highScore) {
    highScore = score;
    highScoreEl.textContent = highScore;
  }
}

function step() {
  if (state.paused) return;
  if (state.queued && canMove(state.queued)) {
    state.dir = state.queued;
    state.queued = null;
  }
  if (!state.dir || !canMove(state.dir)) return;

  const { dx, dy, angle } = DIRECTIONS[state.dir];
  const nextX = state.x + dx;
  const wrapped = nextX !== wrapX(nextX);
  state.x = wrapX(nextX);
  state.y += dy;
  state.angle = angle;
  render(!wrapped); // jump instead of sliding across the board when wrapping
  eatPellet();
  document.dispatchEvent(new CustomEvent("pacman:moved", { detail: { x: state.x, y: state.y } }));
}

// Re-reads the speed every step, so buffs take effect straight away.
function loop() {
  step();
  state.timer = setTimeout(loop, stepMs());
}

function requestDirection(dir) {
  state.queued = dir;
  if (!state.timer) {
    ready.hidden = true;
    document.dispatchEvent(new Event("game:start"));
    loop();
  }
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const dir = KEY_TO_DIRECTION[key];
  if (!dir) return;
  event.preventDefault(); // keep arrow keys from scrolling the page
  requestDirection(dir);
});

let touchStart = null;
board.addEventListener("touchstart", (event) => {
  const touch = event.changedTouches[0];
  touchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

board.addEventListener("touchend", (event) => {
  if (!touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
  if (Math.abs(dx) > Math.abs(dy)) requestDirection(dx > 0 ? "right" : "left");
  else requestDirection(dy > 0 ? "down" : "up");
});

render(false);
