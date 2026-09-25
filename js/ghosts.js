// Ghost movement on the page. Ghosts move on a fixed clock and never wait
// for the network: as soon as a ghost's next junction is known, that junction
// is sent to the server (POST /api/ghosts), which asks Jev which way to turn.
// The answer usually arrives while the ghost is still in the corridor; if it
// is late, the ghost takes the arcade move at that junction instead.
//
// Reads LAYOUT (board.js) and Pac-Man's `state` (pacman.js); loaded as a
// module so it runs after both. Difficulty comes from the page URL,
// e.g. index.html?difficulty=hard (easy | normal | hard).

import { BEHAVIOURS, resolveBehaviour } from "./ghost-ai/behaviours.js";
import { closestMove, legalMoves, step } from "./ghost-ai/maze.js";

const STEP_MS = 200; // a little slower than Pac-Man's 150ms
const HOUSE_EXIT = { x: 13, y: 11 }; // tile just above the ghost house door
const MAX_LOOKAHEAD = 40; // tiles to follow a corridor when looking for the next junction

// Arcade-style scatter/chase cycle, in milliseconds.
const MODE_SCHEDULE = [
  { mode: "scatter", ms: 7000 },
  { mode: "chase", ms: 20000 },
  { mode: "scatter", ms: 7000 },
  { mode: "chase", ms: Infinity },
];

const difficulty = new URLSearchParams(location.search).get("difficulty") || "normal";

const ghosts = [
  { name: "blinky", behaviour: "chase",  x: 13, y: 11, direction: "left", home: { x: 26, y: 1 },  releaseMs: 0 },
  { name: "pinky",  behaviour: "ambush", x: 13, y: 14, direction: "up",   home: { x: 1, y: 1 },   releaseMs: 1000 },
  { name: "inky",   behaviour: "flank",  x: 11, y: 14, direction: "up",   home: { x: 26, y: 29 }, releaseMs: 4000 },
  { name: "clyde",  behaviour: "shy",    x: 15, y: 14, direction: "up",   home: { x: 1, y: 29 },  releaseMs: 7000 },
].map((ghost) => ({
  ...ghost,
  released: ghost.releaseMs === 0,
  askedFor: null, // key of the junction we last asked Jev about
  plan: null,     // Jev's answer: { key, move }
  el: document.querySelector(`.sprite--ghost[data-ghost="${ghost.name}"]`),
}));

let startedAt = null;
let serverDown = false;

// A junction is identified by its tile and the direction the ghost arrives in,
// since that decides which moves are legal there.
const keyOf = ({ x, y, direction }) => `${x},${y},${direction}`;

function render(ghost, animate) {
  ghost.el.style.gridArea = "1 / 1";
  ghost.el.style.transition = animate ? `transform ${STEP_MS}ms linear` : "none";
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
  const behaviour = BEHAVIOURS[resolveBehaviour(ghost, currentMode())];
  const target = behaviour.target({ pacman: pacmanTile(), ghost, ghosts: activeGhosts() });
  return closestMove(LAYOUT, ghost, moves, target);
}

function chooseMove(ghost) {
  const moves = legalMoves(LAYOUT, ghost, ghost.direction);
  if (moves.length === 1) return moves[0];
  const { plan } = ghost;
  const planned = plan && plan.key === keyOf(ghost) && moves.includes(plan.move) ? plan.move : null;
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
        difficulty,
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
  const elapsed = Date.now() - startedAt;
  for (const ghost of ghosts) {
    if (ghost.released || elapsed < ghost.releaseMs) continue;
    ghost.released = true;
    Object.assign(ghost, HOUSE_EXIT, { direction: "left" });
    render(ghost, false);
  }
}

function tick() {
  releaseGhosts();
  for (const ghost of activeGhosts()) {
    const direction = chooseMove(ghost);
    const next = step(LAYOUT, ghost, direction);
    const wrapped = Math.abs(next.x - ghost.x) > 1;
    Object.assign(ghost, next, { direction });
    render(ghost, !wrapped); // jump instead of sliding across the board when wrapping
  }
  askAhead();
}

ghosts.forEach((ghost) => render(ghost, false));

// Ghosts start when Pac-Man does (pacman.js sets state.timer on the first move).
const waitForStart = setInterval(() => {
  if (!state.timer) return;
  clearInterval(waitForStart);
  startedAt = Date.now();
  tick();
  setInterval(tick, STEP_MS);
}, 50);
