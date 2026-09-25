import { test } from "node:test";
import assert from "node:assert/strict";
import { closestMove, isWalkable, legalMoves, step } from "../../js/ghost-ai/maze.js";

const MAZE = [
  "#########",
  "#.......#",
  "#.##.##.#",
  "#.......#",
  "#########",
];

test("walls and the ghost door are not walkable", () => {
  assert.equal(isWalkable(MAZE, { x: 0, y: 0 }), false);
  assert.equal(isWalkable(MAZE, { x: 1, y: 1 }), true);
  assert.equal(isWalkable(["#-#"], { x: 1, y: 0 }), false);
});

test("ghosts may not reverse at a junction", () => {
  // (4,1) opens left, right and down. Heading right, reversing (left) is not allowed.
  assert.deepEqual(legalMoves(MAZE, { x: 4, y: 1 }, "right"), ["down", "right"]);
});

test("only one move in a corridor", () => {
  assert.deepEqual(legalMoves(MAZE, { x: 2, y: 1 }, "right"), ["right"]);
});

test("ghosts reverse out of a dead end", () => {
  const deadEnd = ["####", "#..#", "####"];
  assert.deepEqual(legalMoves(deadEnd, { x: 1, y: 1 }, "left"), ["right"]);
});

test("step wraps through side tunnels", () => {
  const tunnel = ["#####", ".....", "#####"];
  assert.deepEqual(step(tunnel, { x: 0, y: 1 }, "left"), { x: 4, y: 1 });
  assert.deepEqual(step(tunnel, { x: 4, y: 1 }, "right"), { x: 0, y: 1 });
  assert.deepEqual(legalMoves(tunnel, { x: 0, y: 1 }, "left"), ["left"]);
});

test("closestMove picks the move nearest the target, ties by arcade priority", () => {
  assert.equal(closestMove(MAZE, { x: 4, y: 1 }, ["down", "right"], { x: 7, y: 3 }), "right");
  // (4,2) and (5,1) are equally close to (5,2): down wins over right.
  assert.equal(closestMove(MAZE, { x: 4, y: 1 }, ["down", "right"], { x: 5, y: 2 }), "down");
});
