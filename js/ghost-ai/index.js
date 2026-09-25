// Public entry point for the ghost AI. Not wired into the frontend yet.
//
// Usage (server-side / Node — the TypeSafe SDK refuses to run in a browser
// because it would expose the API key):
//
//   import { TypeSafeClient } from "@typesafe-ai/sdk";
//   import { createGhostController } from "./js/ghost-ai/index.js";
//
//   const ghosts = createGhostController({ client: new TypeSafeClient(), difficulty: "hard" });
//   const moves = await ghosts.decide({ maze, pacman, ghosts: [...], mode: "chase" });
//   // -> { blinky: "left", pinky: "up", ... }

export { createGhostController } from "./jev-controller.js";
export { BEHAVIOURS } from "./behaviours.js";
export { DIFFICULTIES } from "./difficulty.js";
export { DIRECTIONS, legalMoves } from "./maze.js";
