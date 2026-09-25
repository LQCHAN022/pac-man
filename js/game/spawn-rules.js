// Rules for placing items that don't need Jev: guard rails, candidate spots
// and the random fallback. Used by the server's item director and by the page
// when the server is unreachable.

import { itemsOfType } from "./items.js";
import { LEVELS } from "./levels.js";
import { DIRECTIONS, distanceSq, isWalkable, step } from "../ghost-ai/maze.js";

export const MAX_ITEMS = 2;
export const MIN_GAP_S = 3;  // never spawn sooner than this after the last item
export const MAX_GAP_S = 15; // always spawn by this long after the last item
const CANDIDATE_SPOTS = 5;
const MIN_PACMAN_DISTANCE = 4;

// The tunnel mouths are off limits: items there would sit on the wrap-around.
const offLimits = ({ x, row }) => x <= 0 || x >= row.length - 1;

// Tiles Pac-Man can walk to from `from`, as "x,y" keys. Blank space outside
// the maze walls and the ghost house (behind its door) aren't included.
export function reachableTiles(maze, from) {
  const key = ({ x, y }) => `${x},${y}`;
  const seen = new Set([key(from)]);
  const queue = [from];
  while (queue.length > 0) {
    const tile = queue.shift();
    for (const direction of Object.keys(DIRECTIONS)) {
      const next = step(maze, tile, direction);
      if (next.y < 0 || next.y >= maze.length || seen.has(key(next)) || !isWalkable(maze, next)) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }
  return seen;
}

// null if a spawn is allowed now, otherwise the reason it isn't.
export function spawnBlocked(game) {
  if (game.items.length >= MAX_ITEMS) return "board full";
  if (game.secondsSinceSpawn < MIN_GAP_S) return "too soon";
  return null;
}

export function mustSpawn(game) {
  return game.secondsSinceSpawn >= MAX_GAP_S;
}

// A handful of random open tiles away from Pac-Man, ghosts and other items,
// labelled spot_a, spot_b, ...
export function candidateSpots(game, random = Math.random) {
  const taken = [...game.ghosts, ...game.items];
  const reachable = reachableTiles(game.maze, game.pacman);
  const open = [];
  game.maze.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const tile = { x, y };
      if (!reachable.has(`${x},${y}`) || offLimits({ x, row })) continue;
      if (distanceSq(tile, game.pacman) < MIN_PACMAN_DISTANCE ** 2) continue;
      if (taken.some((t) => t.x === x && t.y === y)) continue;
      open.push(tile);
    }
  });
  const picked = [];
  while (picked.length < CANDIDATE_SPOTS && open.length > 0) {
    picked.push(open.splice(Math.floor(random() * open.length), 1)[0]);
  }
  return picked.map((tile, i) => ({ id: `spot_${String.fromCharCode(97 + i)}`, ...tile }));
}

// Random item, with distractions more likely at higher levels.
export function randomKind(level, random = Math.random) {
  const { distractionChance } = LEVELS[Math.min(Math.max(level, 1), LEVELS.length) - 1];
  const kinds = itemsOfType(random() < distractionChance ? "distraction" : "responsibility");
  return kinds[Math.floor(random() * kinds.length)];
}

// Spawn decision without Jev: roughly one item every 7 seconds.
export function fallbackSpawn(game, random = Math.random) {
  if (spawnBlocked(game)) return null;
  const spots = candidateSpots(game, random);
  if (spots.length === 0) return null;
  if (!mustSpawn(game) && random() > (game.secondsSinceSpawn - MIN_GAP_S) / 8) return null;
  const spot = spots[Math.floor(random() * spots.length)];
  return { kind: randomKind(game.level, random), x: spot.x, y: spot.y };
}

