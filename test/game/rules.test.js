import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EFFECT_MS, ITEMS, activeEffects, addEffect, itemsOfType, speedMultipliers } from "../../js/game/items.js";
import { LEVELS, LEVEL_MS, levelAt } from "../../js/game/levels.js";
import { MAX_GAP_S, candidateSpots, fallbackSpawn, randomKind, reachableTiles, spawnBlocked } from "../../js/game/spawn-rules.js";

const MAZE = [
  "#########",
  "#.......#",
  "#.##.##.#",
  "#.......#",
  "#########",
];

test("there are responsibilities (buffs) and distractions (debuffs)", () => {
  assert.ok(itemsOfType("responsibility").includes("homework"));
  assert.ok(itemsOfType("distraction").includes("anime"));
  for (const kind of itemsOfType("responsibility")) assert.match(ITEMS[kind].effect, /pacmanFaster|ghostsSlower/);
  for (const kind of itemsOfType("distraction")) assert.match(ITEMS[kind].effect, /pacmanSlower|ghostsFaster/);
});

test("homework speeds Pac-Man up and anime slows Pac-Man down", () => {
  assert.ok(speedMultipliers(addEffect([], "homework", 0), 0).pacman > 1);
  assert.ok(speedMultipliers(addEffect([], "anime", 0), 0).pacman < 1);
});

test("chores slow the ghosts and gaming speeds them up", () => {
  assert.ok(speedMultipliers(addEffect([], "chores", 0), 0).ghosts < 1);
  assert.ok(speedMultipliers(addEffect([], "gaming", 0), 0).ghosts > 1);
});

test("effects wear off after EFFECT_MS", () => {
  const effects = addEffect([], "homework", 1000);
  assert.equal(activeEffects(effects, 1000 + EFFECT_MS - 1).length, 1);
  assert.equal(activeEffects(effects, 1000 + EFFECT_MS).length, 0);
  assert.deepEqual(speedMultipliers(effects, 1000 + EFFECT_MS), { pacman: 1, ghosts: 1 });
});

test("picking up the same effect again refreshes it instead of stacking", () => {
  let effects = addEffect([], "homework", 0);
  effects = addEffect(effects, "exercise", 4000); // same effect: pacmanFaster
  assert.equal(effects.length, 1);
  assert.equal(effects[0].expiresAt, 4000 + EFFECT_MS);
  assert.equal(effects[0].kind, "exercise");
});

test("a buff and a debuff on Pac-Man roughly cancel out", () => {
  const effects = addEffect(addEffect([], "homework", 0), "anime", 0);
  assert.ok(Math.abs(speedMultipliers(effects, 0).pacman - 1) < 0.1);
});

test("levels ramp up every LEVEL_MS and stop at the last one", () => {
  assert.equal(levelAt(0).number, 1);
  assert.equal(levelAt(0).msUntilNext, LEVEL_MS);
  assert.equal(levelAt(LEVEL_MS - 1).number, 1);
  assert.equal(levelAt(LEVEL_MS - 1).msUntilNext, 1);
  assert.equal(levelAt(LEVEL_MS).number, 2);
  assert.equal(levelAt(LEVEL_MS * 99).number, LEVELS.length);
  assert.equal(levelAt(LEVEL_MS * 99).msUntilNext, null);
});

test("each level is at least as hard as the one before", () => {
  const ai = ["easy", "normal", "hard"];
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(LEVELS[i].ghostStepMs <= LEVELS[i - 1].ghostStepMs, "ghosts get faster");
    assert.ok(LEVELS[i].distractionChance >= LEVELS[i - 1].distractionChance, "more distractions");
    assert.ok(ai.indexOf(LEVELS[i].ai) >= ai.indexOf(LEVELS[i - 1].ai), "ghosts get smarter");
  }
});

const game = (overrides = {}) => ({
  maze: MAZE,
  pacman: { x: 1, y: 1 },
  ghosts: [{ x: 7, y: 3 }],
  items: [],
  level: 1,
  secondsSinceSpawn: 5,
  ...overrides,
});

test("candidate spots are open tiles away from Pac-Man, ghosts and items", () => {
  const g = game({ items: [{ kind: "anime", x: 7, y: 1 }] });
  const spots = candidateSpots(g, () => 0);
  assert.ok(spots.length > 0);
  for (const s of spots) {
    assert.notEqual(MAZE[s.y][s.x], "#");
    assert.ok((s.x - 1) ** 2 + (s.y - 1) ** 2 >= 16, "at least 4 tiles from Pac-Man");
    assert.ok(!(s.x === 7 && s.y === 3) && !(s.x === 7 && s.y === 1), "not on a ghost or item");
  }
  assert.deepEqual(spots.map((s) => s.id).slice(0, 2), ["spot_a", "spot_b"]);
});

test("items only go where Pac-Man can walk: not outside the walls or in the ghost house", () => {
  const LAYOUT = [...readFileSync(new URL("../../js/board.js", import.meta.url), "utf8").matchAll(/^  "(.{28})",$/gm)].map(
    (m) => m[1],
  );
  const pacman = { x: 13, y: 23 };
  const reachable = reachableTiles(LAYOUT, pacman);

  // The blank blocks beside the ghost house and the house itself are open space, but unreachable.
  for (const [x, y] of [[2, 11], [25, 17], [13, 14], [11, 13]]) {
    assert.equal(LAYOUT[y][x], " ");
    assert.ok(!reachable.has(`${x},${y}`), `(${x}, ${y}) should be unreachable`);
  }
  // The side tunnel is reachable.
  assert.ok(reachable.has("3,14"));

  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    for (const spot of candidateSpots({ maze: LAYOUT, pacman, ghosts: [], items: [] }, random)) {
      assert.ok(reachable.has(`${spot.x},${spot.y}`), `spot (${spot.x}, ${spot.y}) is unreachable`);
    }
  }
});

test("spawns are blocked when the board is full or the last item was too recent", () => {
  assert.equal(spawnBlocked(game()), null);
  assert.equal(spawnBlocked(game({ secondsSinceSpawn: 1 })), "too soon");
  const full = [{ kind: "anime", x: 1, y: 3 }, { kind: "chores", x: 3, y: 3 }];
  assert.equal(spawnBlocked(game({ items: full })), "board full");
});

test("the fallback always spawns once MAX_GAP_S has passed", () => {
  const spawn = fallbackSpawn(game({ secondsSinceSpawn: MAX_GAP_S }), () => 0.99);
  assert.ok(spawn && Object.hasOwn(ITEMS, spawn.kind));
});

test("randomKind picks more distractions at higher levels", () => {
  const roll = 0.5; // distractionChance is 0.3 at level 1 and 0.7 at level 5
  assert.equal(ITEMS[randomKind(1, () => roll)].type, "responsibility");
  assert.equal(ITEMS[randomKind(5, () => roll)].type, "distraction");
});
