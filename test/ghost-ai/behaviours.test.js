import { test } from "node:test";
import assert from "node:assert/strict";
import { BEHAVIOURS, resolveBehaviour } from "../../js/ghost-ai/behaviours.js";

const pacman = { x: 10, y: 10, direction: "left" };
const home = { x: 0, y: 0 };

test("chase targets Pac-Man directly", () => {
  const ghost = { name: "blinky", x: 1, y: 1, home };
  assert.deepEqual(BEHAVIOURS.chase.target({ pacman, ghost, ghosts: [ghost] }), { x: 10, y: 10 });
});

test("ambush targets four tiles ahead of Pac-Man", () => {
  const ghost = { name: "pinky", x: 1, y: 1, home };
  assert.deepEqual(BEHAVIOURS.ambush.target({ pacman, ghost, ghosts: [ghost] }), { x: 6, y: 10 });
});

test("flank mirrors a partner ghost through the tile two ahead of Pac-Man", () => {
  const inky = { name: "inky", x: 1, y: 1, home };
  const blinky = { name: "blinky", x: 8, y: 12, home };
  // Pivot is (8, 10); mirrored from blinky (8, 12) gives (8, 8).
  assert.deepEqual(BEHAVIOURS.flank.target({ pacman, ghost: inky, ghosts: [inky, blinky] }), { x: 8, y: 8 });
});

test("shy chases from far away but retreats home up close", () => {
  const far = { name: "clyde", x: 0, y: 20, home };
  const near = { name: "clyde", x: 12, y: 10, home };
  assert.deepEqual(BEHAVIOURS.shy.target({ pacman, ghost: far, ghosts: [far] }), { x: 10, y: 10 });
  assert.deepEqual(BEHAVIOURS.shy.target({ pacman, ghost: near, ghosts: [near] }), home);
});

test("frightened targets directly away from Pac-Man", () => {
  const ghost = { name: "inky", x: 12, y: 10, home };
  assert.deepEqual(BEHAVIOURS.frightened.target({ pacman, ghost, ghosts: [ghost] }), { x: 14, y: 10 });
});

test("scatter and frightened modes override a ghost's own behaviour", () => {
  const ghost = { behaviour: "ambush" };
  assert.equal(resolveBehaviour(ghost, "chase"), "ambush");
  assert.equal(resolveBehaviour(ghost, undefined), "ambush");
  assert.equal(resolveBehaviour(ghost, "scatter"), "scatter");
  assert.equal(resolveBehaviour(ghost, "frightened"), "frightened");
});
