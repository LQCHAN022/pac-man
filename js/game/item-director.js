// Decides when, what and where to place items, using Jev. Server-side only
// (it uses the TypeSafe SDK).
//
// Each call sends four questions in one request (Jev answers them in
// parallel against the same state):
//   spawn_now             Noul    should an item appear right now?
//   kind                  Choice  which item?
//   spot_responsibility   Choice  best spot if it is a responsibility
//   spot_distraction      Choice  best spot if it is a distraction
// The two spot questions exist because questions are answered in isolation,
// so "where" can't depend on the "kind" answer.
//
// Jev's answers are blended with the level rather than taken verbatim:
// its item probabilities are fairly flat, so always taking the top one
// repeats the same item, and it doesn't reliably ramp distractions up with
// the level. Guard rails in spawn-rules.js keep the game playable whatever
// Jev says, and the random fallback takes over if Jev is unreachable.

import { choice, noul } from "@typesafe-ai/sdk";
import { ITEMS, itemsOfType } from "./items.js";
import { LEVELS } from "./levels.js";
import { candidateSpots, fallbackSpawn, mustSpawn, randomKind, spawnBlocked } from "./spawn-rules.js";
import { distanceSq } from "../ghost-ai/maze.js";

// Jev's spawn_now score must reach this. It answers ~0.9 once a few seconds
// have passed and ~0.7 just after an item appeared, so this spaces items out.
export const SPAWN_THRESHOLD = 0.8;

/**
 * @param {object}   options
 * @param {{ systemOne: Function }} options.client  TypeSafeClient or a stub.
 * @param {Function} [options.random=Math.random]
 * @param {Function} [options.onError]
 */
export function createItemDirector({ client, random = Math.random, onError } = {}) {
  if (!client || typeof client.systemOne !== "function") {
    throw new Error("createItemDirector needs a client with a systemOne() method");
  }

  /**
   * @param {object} game
   * @param {string[]} game.maze
   * @param {object}   game.pacman            { x, y, direction }
   * @param {object[]} game.ghosts            [{ x, y }]
   * @param {object[]} game.items             items on the board: [{ kind, x, y }]
   * @param {number}   game.level             1-based difficulty level
   * @param {number}   game.secondsSinceSpawn seconds since the last item appeared
   * @param {string[]} [game.effects]         kinds of item whose effect is active
   * @returns {Promise<{ kind: string, x: number, y: number } | null>}
   */
  async function decide(game) {
    if (spawnBlocked(game)) return null;
    const spots = candidateSpots(game, random);
    if (spots.length === 0) return null;

    let answers;
    try {
      const response = await client.systemOne({ state: buildState(game), questions: buildQuestions(game, spots) });
      answers = response.answers || {};
    } catch (error) {
      onError?.(error);
      return fallbackSpawn(game, random);
    }

    const spawn = answers.spawn_now?.noul;
    if (typeof spawn !== "number") return fallbackSpawn(game, random);
    if (spawn < SPAWN_THRESHOLD && !mustSpawn(game)) return null;

    const kind = pickKind(answers.kind, game.level, random);
    const spotId = answers[`spot_${ITEMS[kind].type}`]?.choice;
    const spot = spots.find((s) => s.id === spotId) || spots[Math.floor(random() * spots.length)];
    return { kind, x: spot.x, y: spot.y };
  }

  return { decide };
}

// Chooses buff vs debuff from Jev's lean and the level's distraction rate
// (the level counts twice, so the ramp holds even when Jev leans toward
// buffs), then samples an item of that type by Jev's probabilities.
export function pickKind(answer, level, random = Math.random) {
  const probabilities = answer?.probabilities;
  if (!probabilities) return Object.hasOwn(ITEMS, answer?.choice) ? answer.choice : randomKind(level, random);

  const weight = (kind) => Math.max(0, probabilities[kind] || 0);
  const total = (type) => itemsOfType(type).reduce((sum, kind) => sum + weight(kind), 0);
  const jevLean = total("distraction") + total("responsibility") > 0
    ? total("distraction") / (total("distraction") + total("responsibility"))
    : 0.5;
  const { distractionChance } = LEVELS[Math.min(Math.max(level, 1), LEVELS.length) - 1];
  const type = random() < (jevLean + 2 * distractionChance) / 3 ? "distraction" : "responsibility";

  const kinds = itemsOfType(type);
  const weights = kinds.map(weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return kinds[Math.floor(random() * kinds.length)];
  let roll = random() * sum;
  for (let i = 0; i < kinds.length; i++) {
    roll -= weights[i];
    if (roll < 0) return kinds[i];
  }
  return kinds.at(-1);
}

const tiles = (a, b) => Math.round(Math.sqrt(distanceSq(a, b)));
const nearestGhost = (game, tile) => Math.min(...game.ghosts.map((g) => tiles(g, tile)), 99);

function buildState(game) {
  return {
    level: `${game.level} of ${LEVELS.length}`,
    seconds_since_last_item: Math.round(game.secondsSinceSpawn),
    items_on_board: game.items.map((i) => ITEMS[i.kind].name),
    active_effects: (game.effects || []).map((k) => ITEMS[k].name),
    pacman: { x: game.pacman.x, y: game.pacman.y, heading: game.pacman.direction },
    nearest_ghost_tiles: nearestGhost(game, game.pacman),
  };
}

const EFFECT_TEXT = {
  pacmanFaster: "Pac-Man moves faster",
  pacmanSlower: "Pac-Man moves slower",
  ghostsSlower: "the ghosts move slower",
  ghostsFaster: "the ghosts move faster",
};

function buildQuestions(game, spots) {
  const kinds = Object.fromEntries(
    Object.entries(ITEMS).map(([kind, item]) => [
      kind,
      `${item.name}: a ${item.type} (${item.type === "responsibility" ? "buff" : "debuff"}): ${EFFECT_TEXT[item.effect]}.`,
    ]),
  );
  const spotCriteria = () =>
    Object.fromEntries(
      spots.map((s) => [
        s.id,
        `Tile (${s.x}, ${s.y}): ${tiles(s, game.pacman)} tiles from Pac-Man, ${nearestGhost(game, s)} tiles from the nearest ghost.`,
      ]),
    );

  return {
    spawn_now: noul(
      "In a Pac-Man game about chasing responsibilities and avoiding distractions, should a new item appear on the board right now? " +
        "Items should appear every 4 to 10 seconds, sooner when the board has no items.",
    ),
    kind: choice(
      "Which item should appear next to keep the game interesting? " +
        "Distractions should become more common as the level goes up. " +
        "If a ghost is close to Pac-Man, a responsibility gives the player a way out; if the player is safe, tempt them with a distraction.",
      kinds,
    ),
    spot_responsibility: choice(
      "Where should a responsibility (a buff) appear? It should be worth the risk: reachable, but not free. Avoid spots right next to Pac-Man.",
      spotCriteria(),
    ),
    spot_distraction: choice(
      "Where should a distraction (a debuff) appear? It should be tempting and easy to walk into, close to where Pac-Man is heading.",
      spotCriteria(),
    ),
  };
}
