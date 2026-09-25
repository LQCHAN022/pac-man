// Grid helpers for ghost movement. Uses the same text-map format as js/board.js:
// #  wall    -  ghost door    anything else is walkable.
// Positions are { x, y } tile coordinates, (0, 0) is the top-left tile.

export const DIRECTIONS = {
  up:    { x: 0,  y: -1 },
  left:  { x: -1, y: 0 },
  down:  { x: 0,  y: 1 },
  right: { x: 1,  y: 0 },
};

// Arcade tie-break order when two moves are equally good.
export const DIRECTION_PRIORITY = ["up", "left", "down", "right"];

export const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

const BLOCKING = new Set(["#", "-"]);

export function isWalkable(maze, { x, y }) {
  if (y < 0 || y >= maze.length) return false;
  const row = maze[y];
  // Off the side of the board counts as the wrap-around tunnel.
  if (x < 0 || x >= row.length) return true;
  return !BLOCKING.has(row[x]);
}

// Moves one tile in `direction`, wrapping horizontally through side tunnels.
export function step(maze, { x, y }, direction) {
  const d = DIRECTIONS[direction];
  const width = maze[0].length;
  return { x: (x + d.x + width) % width, y: y + d.y };
}

// Directions a ghost may take from `pos`. Ghosts cannot reverse, unless it is
// the only way out (a dead end).
export function legalMoves(maze, pos, currentDirection) {
  const open = DIRECTION_PRIORITY.filter((dir) => {
    const d = DIRECTIONS[dir];
    return isWalkable(maze, { x: pos.x + d.x, y: pos.y + d.y });
  });
  const forward = open.filter((dir) => dir !== OPPOSITE[currentDirection]);
  return forward.length > 0 ? forward : open;
}

// Squared straight-line distance, as used by the original arcade ghosts.
export function distanceSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

// Move from `moves` that lands closest to `target` (ties go to DIRECTION_PRIORITY).
export function closestMove(maze, pos, moves, target) {
  let best = moves[0];
  let bestDist = Infinity;
  for (const dir of moves) {
    const dist = distanceSq(step(maze, pos, dir), target);
    if (dist < bestDist) {
      best = dir;
      bestDist = dist;
    }
  }
  return best;
}
