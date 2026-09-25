// Ghost behaviour types. Each one picks a target tile (used for the local
// fallback and to describe moves to Jev) and has instructions for Jev.

import { DIRECTIONS, distanceSq } from "./maze.js";

function ahead(pacman, tiles) {
  const d = DIRECTIONS[pacman.direction] || { x: 0, y: 0 };
  return { x: pacman.x + d.x * tiles, y: pacman.y + d.y * tiles };
}

export const BEHAVIOURS = {
  chase: {
    instructions: "You are a ghost hunting Pac-Man. Pick the move that gets you to Pac-Man fastest.",
    target: ({ pacman }) => ({ x: pacman.x, y: pacman.y }),
  },

  ambush: {
    instructions:
      "You are a ghost setting an ambush. Pick the move that cuts Pac-Man off by reaching the tiles in front of where Pac-Man is heading.",
    target: ({ pacman }) => ahead(pacman, 4),
  },

  flank: {
    instructions:
      "You are a ghost working with the other ghosts. Pick the move that traps Pac-Man from the side opposite the nearest other ghost.",
    target: ({ pacman, ghost, ghosts }) => {
      const partner = ghosts.find((g) => g.name !== ghost.name) || ghost;
      const pivot = ahead(pacman, 2);
      return { x: pivot.x * 2 - partner.x, y: pivot.y * 2 - partner.y };
    },
  },

  shy: {
    instructions:
      "You are a cautious ghost. Chase Pac-Man while you are far away, but head back to your home corner once you get close.",
    target: ({ pacman, ghost }) =>
      distanceSq(ghost, pacman) > 64 ? { x: pacman.x, y: pacman.y } : ghost.home,
  },

  scatter: {
    instructions: "You are a ghost taking a break. Pick the move that heads back toward your home corner.",
    target: ({ ghost }) => ghost.home,
  },

  frightened: {
    instructions: "You are a frightened ghost and Pac-Man can eat you. Pick the move that gets you away from Pac-Man.",
    // Target the tile mirrored through the ghost, i.e. directly away from Pac-Man.
    target: ({ pacman, ghost }) => ({ x: ghost.x * 2 - pacman.x, y: ghost.y * 2 - pacman.y }),
  },
};

// Game-wide modes override a ghost's own behaviour.
export function resolveBehaviour(ghost, mode) {
  if (mode === "frightened" || mode === "scatter") return mode;
  return ghost.behaviour;
}
