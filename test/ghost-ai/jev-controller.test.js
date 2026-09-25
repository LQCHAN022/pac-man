import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createGhostController } from "../../js/ghost-ai/index.js";

const MAZE = [
  "#########",
  "#.......#",
  "#.##.##.#",
  "#.......#",
  "#########",
];

// Blinky is at a junction (can go down or right). Pinky is in a corridor.
// Blinky's local fallback (closest to Pac-Man) is "right"; tests have Jev
// answer "down" so the two are easy to tell apart.
function makeGame(overrides = {}) {
  return {
    maze: MAZE,
    mode: "chase",
    pacman: { x: 7, y: 3, direction: "left" },
    ghosts: [
      { name: "blinky", x: 4, y: 1, direction: "right", behaviour: "chase", home: { x: 7, y: 1 } },
      { name: "pinky", x: 2, y: 1, direction: "right", behaviour: "ambush", home: { x: 1, y: 1 } },
    ],
    ...overrides,
  };
}

function answer(choice, confidence, probabilities) {
  return { type: "choice", choice, confidence, probabilities };
}

// Stub client: records requests and replies with the given answers (or throws).
function stubClient(reply) {
  const requests = [];
  return {
    requests,
    async systemOne(request) {
      requests.push(request);
      if (reply instanceof Error) throw reply;
      return { model: "jev-test", answers: typeof reply === "function" ? reply(request) : reply };
    },
  };
}

// Returns the given values in order, then repeats the last one.
function sequence(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test("sends one Choice question per ghost at a junction, and none for corridor ghosts", async () => {
  const client = stubClient({ blinky: answer("down", 1, { down: 1, right: 0 }) });
  const moves = await createGhostController({ client, difficulty: "hard" }).decide(makeGame());

  assert.equal(client.requests.length, 1);
  const { questions, state } = client.requests[0];
  assert.deepEqual(Object.keys(questions), ["blinky"]);
  assert.equal(questions.blinky.type, "choice");
  assert.deepEqual(Object.keys(questions.blinky.criteria), ["down", "right"]);
  assert.match(questions.blinky.instructions.role, /hunting Pac-Man/);
  assert.deepEqual(state.pacman, { x: 7, y: 3, heading: "left" });
  assert.equal(state.ghosts.length, 2);

  assert.deepEqual(moves, { blinky: "down", pinky: "right" });
});

test("skips the Jev request entirely when every ghost is in a corridor", async () => {
  const client = stubClient({});
  const game = makeGame();
  game.ghosts = [game.ghosts[1]];
  const moves = await createGhostController({ client }).decide(game);

  assert.equal(client.requests.length, 0);
  assert.deepEqual(moves, { pinky: "right" });
});

test("frightened mode switches the instructions to fleeing", async () => {
  const client = stubClient({ blinky: answer("down", 1) });
  await createGhostController({ client, difficulty: "hard" }).decide(makeGame({ mode: "frightened" }));
  assert.match(client.requests[0].questions.blinky.instructions.role, /frightened/);
});

test("passes a model override through to the request", async () => {
  const client = stubClient({ blinky: answer("down", 1) });
  await createGhostController({ client, model: "jev-1.13.0" }).decide(makeGame());
  assert.equal(client.requests[0].model, "jev-1.13.0");
});

test("hard: follows Jev's top choice without sampling", async () => {
  const client = stubClient({ blinky: answer("down", 0.8, { down: 0.9, right: 0.1 }) });
  const controller = createGhostController({ client, difficulty: "hard", random: () => 0.99 });
  assert.equal((await controller.decide(makeGame())).blinky, "down");
});

test("hard: falls back to target-seeking when Jev's confidence is low", async () => {
  const client = stubClient({ blinky: answer("down", 0.2, { down: 0.55, right: 0.45 }) });
  const controller = createGhostController({ client, difficulty: "hard" });
  assert.equal((await controller.decide(makeGame())).blinky, "right");
});

test("normal: samples a move weighted by Jev's probabilities", async () => {
  const client = stubClient({ blinky: answer("down", 0.4, { down: 0.7, right: 0.3 }) });
  // First roll (0.5) beats the 0.1 randomness check; second roll 0.8 lands in "right".
  const controller = createGhostController({ client, difficulty: "normal", random: sequence(0.5, 0.8) });
  assert.equal((await controller.decide(makeGame())).blinky, "right");

  const controller2 = createGhostController({ client, difficulty: "normal", random: sequence(0.5, 0.2) });
  assert.equal((await controller2.decide(makeGame())).blinky, "down");
});

test("easy: sometimes ignores Jev and wanders randomly", async () => {
  const client = stubClient({ blinky: answer("down", 1, { down: 1, right: 0 }) });
  // First roll (0.1) is under easy's 0.4 randomness; second roll 0.9 picks the last option.
  const controller = createGhostController({ client, difficulty: "easy", random: sequence(0.1, 0.9) });
  assert.equal((await controller.decide(makeGame())).blinky, "right");
});

test("ignores a choice that is not a legal move", async () => {
  const client = stubClient({ blinky: answer("up", 1, { up: 1 }) });
  const controller = createGhostController({ client, difficulty: "hard" });
  assert.equal((await controller.decide(makeGame())).blinky, "right");
});

test("falls back to target-seeking and reports the error when Jev fails", async () => {
  const failure = new Error("network down");
  const errors = [];
  const client = stubClient(failure);
  const controller = createGhostController({ client, difficulty: "normal", random: () => 0.5, onError: (e) => errors.push(e) });

  assert.deepEqual(await controller.decide(makeGame()), { blinky: "right", pinky: "right" });
  assert.deepEqual(errors, [failure]);
});

test("rejects unknown difficulties, behaviours and missing clients", async () => {
  assert.throws(() => createGhostController({ client: stubClient({}), difficulty: "insane" }), /Unknown difficulty/);
  assert.throws(() => createGhostController({}), /systemOne/);

  const game = makeGame();
  game.ghosts[0].behaviour = "teleport";
  await assert.rejects(createGhostController({ client: stubClient({}) }).decide(game), /Unknown behaviour/);
});

test("works end to end with the real TypeSafe SDK client (HTTP stubbed)", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: { blinky: answer("down", 0.9, { down: 0.95, right: 0.05 }) },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = new TypeSafeClient({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });
  const moves = await createGhostController({ client, difficulty: "hard" }).decide(makeGame());

  assert.deepEqual(moves, { blinky: "down", pinky: "right" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "jev-latest");
  assert.equal(body.questions.blinky.type, "choice");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer test-key");
});
