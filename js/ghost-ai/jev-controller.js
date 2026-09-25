// Ghost controller backed by Jev (TypeSafe AI's System One model).
//
// On each call to decide(), every ghost standing at a junction becomes one
// Choice question ("which way now?"). All questions go to Jev in a single
// request, since Jev evaluates them in parallel against the same state.
// The difficulty level then decides how closely each ghost follows the answer.
//
// If Jev is unreachable or unsure, ghosts fall back to classic arcade
// target-seeking so the game never stalls.

import { choice } from "@typesafe-ai/sdk";
import { BEHAVIOURS, resolveBehaviour } from "./behaviours.js";
import { getDifficulty } from "./difficulty.js";
import { closestMove, distanceSq, legalMoves, step } from "./maze.js";

/**
 * @param {object}   options
 * @param {{ systemOne: Function }} options.client  A TypeSafeClient (or a stub in tests).
 * @param {string}   [options.difficulty="normal"]  "easy" | "normal" | "hard"
 * @param {string}   [options.model]                Jev model, defaults to the client's.
 * @param {Function} [options.random=Math.random]   Injected so tests are deterministic.
 * @param {Function} [options.onError]              Called when a Jev request fails.
 */
export function createGhostController({ client, difficulty = "normal", model, random = Math.random, onError } = {}) {
  if (!client || typeof client.systemOne !== "function") {
    throw new Error("createGhostController needs a client with a systemOne() method");
  }
  const level = getDifficulty(difficulty);

  /**
   * @param {object} game
   * @param {string[]} game.maze     Text map, same format as js/board.js.
   * @param {object}   game.pacman   { x, y, direction }
   * @param {object[]} game.ghosts   [{ name, x, y, direction, behaviour, home: { x, y } }]
   * @param {string}   [game.mode]   "chase" | "scatter" | "frightened"
   * @returns {Promise<Record<string, string>>} ghost name -> direction
   */
  async function decide(game) {
    const plans = game.ghosts.map((ghost) => planFor(game, ghost));
    const moves = {};
    const questions = {};

    for (const plan of plans) {
      if (plan.options.length === 1) {
        // Corridor: only one way to go, no need to ask.
        moves[plan.ghost.name] = plan.options[0];
      } else {
        questions[plan.ghost.name] = buildQuestion(game, plan);
      }
    }

    if (Object.keys(questions).length === 0) return moves;

    let answers = {};
    try {
      const response = await client.systemOne({
        state: buildState(game),
        questions,
        ...(model && { model }),
      });
      answers = response.answers || {};
    } catch (error) {
      onError?.(error);
    }

    for (const plan of plans) {
      if (moves[plan.ghost.name]) continue;
      moves[plan.ghost.name] = pickMove(plan, answers[plan.ghost.name]);
    }
    return moves;
  }

  function pickMove(plan, answer) {
    if (random() < level.randomness) {
      return plan.options[Math.floor(random() * plan.options.length)];
    }
    if (!isUsable(answer, plan.options) || answer.confidence < level.minConfidence) {
      return plan.fallback;
    }
    if (level.sample && answer.probabilities) {
      return sample(answer.probabilities, plan.options, random) ?? answer.choice;
    }
    return answer.choice;
  }

  return { decide, difficulty };
}

function planFor(game, ghost) {
  const behaviourName = resolveBehaviour(ghost, game.mode);
  const behaviour = BEHAVIOURS[behaviourName];
  if (!behaviour) throw new Error(`Unknown behaviour "${behaviourName}" for ghost ${ghost.name}`);

  const target = behaviour.target({ pacman: game.pacman, ghost, ghosts: game.ghosts });
  const options = legalMoves(game.maze, ghost, ghost.direction);
  return {
    ghost,
    behaviour,
    target,
    options,
    fallback: closestMove(game.maze, ghost, options, target),
  };
}

function buildQuestion(game, { ghost, behaviour, target, options }) {
  const criteria = {};
  for (const dir of options) {
    const next = step(game.maze, ghost, dir);
    criteria[dir] =
      `Move ${dir} to tile (${next.x}, ${next.y}). ` +
      `Afterwards Pac-Man is ${tiles(next, game.pacman)} tiles away ` +
      `and your target is ${tiles(next, target)} tiles away.`;
  }
  return choice(
    {
      question: `Which way should ${ghost.name} move next?`,
      role: behaviour.instructions,
      you_are_at: { x: ghost.x, y: ghost.y },
      your_target: target,
    },
    criteria,
  );
}

// Compact description of the board for Jev. The full maze is not sent:
// each move's criteria already describe what it leads to.
function buildState(game) {
  return {
    mode: game.mode || "chase",
    pacman: { x: game.pacman.x, y: game.pacman.y, heading: game.pacman.direction },
    ghosts: game.ghosts.map((g) => ({ name: g.name, x: g.x, y: g.y, heading: g.direction })),
  };
}

function isUsable(answer, options) {
  return answer && typeof answer.choice === "string" && options.includes(answer.choice);
}

// Weighted pick over legal options only (ignores any labels Jev invented).
function sample(probabilities, options, random) {
  const weights = options.map((dir) => Math.max(0, probabilities[dir] || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let roll = random() * total;
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i];
    if (roll < 0) return options[i];
  }
  return options[options.length - 1];
}

function tiles(a, b) {
  return Math.round(Math.sqrt(distanceSq(a, b)));
}
