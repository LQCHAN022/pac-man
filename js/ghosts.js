// Ghost movement on the page. Ghosts move on a fixed clock and never wait
// for the network: as soon as a ghost's next junction is known, that junction
// is sent to the server (POST /api/ghosts), which asks Jev which way to turn.
// The answer usually arrives while the ghost is still in the corridor; if it
// is late, the ghost takes the arcade move at that junction instead.
//
// Reads LAYOUT (board.js) and Pac-Man's `state` (pacman.js); loaded as a
// module so it runs after both. Speed and AI difficulty follow the current
// level and buffs/debuffs in globalThis.GAME (js/director.js).
//
// game.js drives the rules through the exports below (frighten, sendHome,
// resetGhosts, onGhostsMoved). Frightened ghosts run from Pac-Man at half
// speed and move locally without asking Jev.

import { BEHAVIOURS, resolveBehaviour } from "./ghost-ai/behaviours.js";
import { OPPOSITE, closestMove, legalMoves, step } from "./ghost-ai/maze.js";

const DEFAULT_STEP_MS = 200; // used until js/director.js sets a level
const HOUSE_EXIT = { x: 13, y: 11 }; // tile just above the ghost house door
const HOUSE_CENTRE = { x: 13, y: 14 }; // where eaten ghosts respawn
const RESPAWN_MS = 3000; // time an eaten ghost waits in the house
const FLASH_MS = 2000; // frightened ghosts flash for the last part of their time
const FRIGHTENED_SPRITE = "assets/ghost-frightened.svg";
const MAX_LOOKAHEAD = 40; // tiles to follow a corridor when looking for the next junction

// Arcade-style scatter/chase cycle, in milliseconds.
const MODE_SCHEDULE = [
  { mode: "scatter", ms: 7000 },
  { mode: "chase", ms: 20000 },
  { mode: "scatter", ms: 7000 },
  { mode: "chase", ms: Infinity },
];

const stepMs = () => (globalThis.GAME?.level?.ghostStepMs ?? DEFAULT_STEP_MS) / (globalThis.GAME?.ghostSpeed || 1);
const aiDifficulty = () => globalThis.GAME?.level?.ai ?? "normal";

export const ghosts = [
  { name: "blinky", behaviour: "chase",  x: 13, y: 11, direction: "left", home: { x: 26, y: 1 },  releaseMs: 0 },
  { name: "pinky",  behaviour: "ambush", x: 13, y: 14, direction: "up",   home: { x: 1, y: 1 },   releaseMs: 1000 },
  { name: "inky",   behaviour: "flank",  x: 11, y: 14, direction: "up",   home: { x: 26, y: 29 }, releaseMs: 4000 },
  { name: "clyde",  behaviour: "shy",    x: 15, y: 14, direction: "up",   home: { x: 1, y: 29 },  releaseMs: 7000 },
].map((ghost) => ({
  ...ghost,
  start: { x: ghost.x, y: ghost.y, direction: ghost.direction },
  released: ghost.releaseMs === 0,
  releaseAt: null,    // overrides the start-of-round schedule after being eaten
  frightenedUntil: 0, // Date.now() timestamp
  normalLook: null,   // { src, portrait } saved while showing the frightened sprite
  skipStep: false,    // frightened ghosts move every other tick
  askedFor: null, // key of the junction we last asked Jev about
  plan: null,     // Jev's answer: { key, move }
  el: document.querySelector(`.sprite--ghost[data-ghost="${ghost.name}"]`),
}));

let startedAt = null;
let serverDown = false;
const moveListeners = [];

// A junction is identified by its tile and the direction the ghost arrives in,
// since that decides which moves are legal there.
const keyOf = ({ x, y, direction }) => `${x},${y},${direction}`;

export function isFrightened(ghost) {
  return Date.now() < ghost.frightenedUntil;
}

function render(ghost, animate) {
  const ms = isFrightened(ghost) ? stepMs() * 2 : stepMs();
  ghost.el.style.gridArea = "1 / 1";
  ghost.el.style.transition = animate ? `transform ${ms}ms linear` : "none";
  ghost.el.style.transform = `translate(calc(var(--cell) * ${ghost.x}), calc(var(--cell) * ${ghost.y}))`;
}

function currentMode() {
  let elapsed = Date.now() - startedAt;
  for (const { mode, ms } of MODE_SCHEDULE) {
    if (elapsed < ms) return mode;
    elapsed -= ms;
  }
  return "chase";
}

function pacmanTile() {
  return { x: state.x, y: state.y, direction: state.dir };
}

// Follows the corridor ahead of a ghost to the first tile with a real choice.
function nextJunction(ghost) {
  let pos = { x: ghost.x, y: ghost.y, direction: ghost.direction };
  for (let i = 0; i < MAX_LOOKAHEAD; i++) {
    const moves = legalMoves(LAYOUT, pos, pos.direction);
    if (moves.length > 1) return pos;
    pos = { ...step(LAYOUT, pos, moves[0]), direction: moves[0] };
  }
  return null;
}

// Arcade move: head for the behaviour's target tile. Same rule the server
// falls back to when Jev can't answer.
function arcadeMove(ghost, moves) {
  const mode = isFrightened(ghost) ? "frightened" : currentMode();
  const behaviour = BEHAVIOURS[resolveBehaviour(ghost, mode)];
  const target = behaviour.target({ pacman: pacmanTile(), ghost, ghosts: activeGhosts() });
  return closestMove(LAYOUT, ghost, moves, target);
}

function chooseMove(ghost) {
  const moves = legalMoves(LAYOUT, ghost, ghost.direction);
  if (moves.length === 1) return moves[0];
  const { plan } = ghost;
  const planned =
    plan && !isFrightened(ghost) && plan.key === keyOf(ghost) && moves.includes(plan.move) ? plan.move : null;
  // This junction is done; the next visit gets a fresh answer.
  ghost.plan = null;
  ghost.askedFor = null;
  return planned ?? arcadeMove(ghost, moves);
}

// Asks Jev about each ghost's upcoming junction, once per junction. Runs in
// the background; the ghosts keep moving while it's in flight.
async function askAhead() {
  if (serverDown) return;
  const asks = [];
  for (const ghost of activeGhosts()) {
    if (isFrightened(ghost)) continue;
    const junction = nextJunction(ghost);
    if (!junction || keyOf(junction) === ghost.askedFor) continue;
    ghost.askedFor = keyOf(junction);
    asks.push({ ghost, junction });
  }
  if (asks.length === 0) return;

  try {
    const response = await fetch("/api/ghosts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        difficulty: aiDifficulty(),
        mode: currentMode(),
        maze: LAYOUT,
        pacman: pacmanTile(),
        ghosts: asks.map(({ ghost, junction }) => ({
          name: ghost.name,
          behaviour: ghost.behaviour,
          home: ghost.home,
          ...junction,
        })),
      }),
    });
    if (!response.ok) throw new Error(`Server replied ${response.status}`);
    const { moves } = await response.json();
    for (const { ghost, junction } of asks) {
      // Drop answers that arrive after the ghost already passed the junction.
      if (moves[ghost.name] && ghost.askedFor === keyOf(junction)) {
        ghost.plan = { key: keyOf(junction), move: moves[ghost.name] };
      }
    }
  } catch (error) {
    console.warn("Ghost server unavailable, using arcade ghost AI. Start it with `npm start`.", error);
    serverDown = true;
  }
}

function activeGhosts() {
  return ghosts.filter((g) => g.released);
}

function releaseGhosts() {
  const now = Date.now();
  for (const ghost of ghosts) {
    if (ghost.released || now < (ghost.releaseAt ?? startedAt + ghost.releaseMs)) continue;
    ghost.released = true;
    Object.assign(ghost, HOUSE_EXIT, { direction: "left" });
    render(ghost, false);
  }
}

// Swaps between the ghost's own sprite and the frightened one, flashing
// near the end of its frightened time.
function updateLook(ghost) {
  const { el } = ghost;
  const frightened = isFrightened(ghost);
  if (frightened && !ghost.normalLook) {
    ghost.normalLook = { src: el.getAttribute("src"), portrait: el.classList.contains("sprite--portrait") };
    el.classList.remove("sprite--portrait");
    el.src = FRIGHTENED_SPRITE;
  } else if (!frightened && ghost.normalLook) {
    el.src = ghost.normalLook.src;
    el.classList.toggle("sprite--portrait", ghost.normalLook.portrait);
    ghost.normalLook = null;
  }
  el.classList.toggle("sprite--flashing", frightened && ghost.frightenedUntil - Date.now() < FLASH_MS);
}

function tick() {
  if (!state.paused) moveGhosts();
  setTimeout(tick, stepMs()); // re-read every step, so level and buffs apply at once
}

function moveGhosts() {
  releaseGhosts();
  for (const ghost of activeGhosts()) {
    if (ghost.normalLook) updateLook(ghost);
    if (isFrightened(ghost) && (ghost.skipStep = !ghost.skipStep)) continue;
    const direction = chooseMove(ghost);
    const next = step(LAYOUT, ghost, direction);
    const wrapped = Math.abs(next.x - ghost.x) > 1;
    Object.assign(ghost, next, { direction });
    render(ghost, !wrapped); // jump instead of sliding across the board when wrapping
  }
  moveListeners.forEach((listener) => listener());
  askAhead();
  // Let js/director.js keep items away from ghosts.
  if (globalThis.GAME) globalThis.GAME.ghosts = activeGhosts().map(({ name, x, y }) => ({ name, x, y }));
}

// Called after every ghost tick, so game.js can check for collisions.
export function onGhostsMoved(listener) {
  moveListeners.push(listener);
}

// Power pellet: released ghosts turn blue, reverse and run for `ms`.
export function frighten(ms) {
  const until = Date.now() + ms;
  for (const ghost of activeGhosts()) {
    Object.assign(ghost, { frightenedUntil: until, direction: OPPOSITE[ghost.direction], plan: null, askedFor: null });
    updateLook(ghost);
  }
}

// Eaten ghost: back into the house, out again after RESPAWN_MS.
export function sendHome(ghost) {
  Object.assign(ghost, HOUSE_CENTRE, {
    direction: "up",
    released: false,
    releaseAt: Date.now() + RESPAWN_MS,
    frightenedUntil: 0,
    plan: null,
    askedFor: null,
  });
  updateLook(ghost);
  render(ghost, false);
}

// New life or level: every ghost back to its starting tile, and the release
// and scatter/chase clocks start again.
export function resetGhosts() {
  startedAt = Date.now();
  for (const ghost of ghosts) {
    Object.assign(ghost, ghost.start, {
      released: ghost.releaseMs === 0,
      releaseAt: null,
      frightenedUntil: 0,
      plan: null,
      askedFor: null,
    });
    updateLook(ghost);
    render(ghost, false);
  }
}

ghosts.forEach((ghost) => render(ghost, false));

// Ghosts start when Pac-Man does (pacman.js sets state.timer on the first move).
const waitForStart = setInterval(() => {
  if (!state.timer) return;
  clearInterval(waitForStart);
  startedAt = Date.now();
  tick();
}, 50);
