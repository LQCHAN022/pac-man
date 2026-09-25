import { test } from "node:test";
import assert from "node:assert/strict";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { JEV_NUDGE, createItemDirector, pickKind } from "../../js/game/item-director.js";
import { LEVELS } from "../../js/game/levels.js";
import { ITEMS } from "../../js/game/items.js";

const MAZE = [
  "#########",
  "#.......#",
  "#.##.##.#",
  "#.......#",
  "#########",
];

const game = (overrides = {}) => ({
  maze: MAZE,
  pacman: { x: 1, y: 1, direction: "right" },
  ghosts: [{ x: 7, y: 3 }],
  items: [],
  level: 2,
  secondsSinceSpawn: 6,
  effects: ["homework"],
  ...overrides,
});

// Stub client: records requests and answers with `reply(request)`.
function stubClient(reply) {
  const requests = [];
  return {
    requests,
    async systemOne(request) {
      requests.push(request);
      if (reply instanceof Error) throw reply;
      return { answers: reply(request) };
    },
  };
}

// Answers "yes, spawn" with the given kind, and the first spot for both types.
function jevSays({ spawn = 0.9, kind = "homework", spot = (q) => Object.keys(q.criteria)[0] } = {}) {
  return ({ questions }) => ({
    spawn_now: { type: "noul", noul: spawn },
    kind: { type: "choice", choice: kind, confidence: 0.8 },
    spot_responsibility: { type: "choice", choice: spot(questions.spot_responsibility), confidence: 0.6 },
    spot_distraction: { type: "choice", choice: spot(questions.spot_distraction), confidence: 0.6 },
  });
}

const spotOf = (request, id) => {
  const text = request.questions.spot_responsibility.criteria[id];
  const [, x, y] = text.match(/\((\d+), (\d+)\)/);
  return { x: Number(x), y: Number(y) };
};

test("asks Jev when, what and where in a single request", async () => {
  const client = stubClient(jevSays());
  await createItemDirector({ client }).decide(game());

  assert.equal(client.requests.length, 1);
  const { questions, state } = client.requests[0];
  assert.deepEqual(Object.keys(questions), ["spawn_now", "kind", "spot_responsibility", "spot_distraction"]);
  assert.equal(questions.spawn_now.type, "noul");
  assert.deepEqual(Object.keys(questions.kind.criteria).sort(), Object.keys(ITEMS).sort());
  assert.match(questions.kind.criteria.homework, /responsibility.*faster/);
  assert.match(questions.kind.criteria.anime, /distraction.*slower/);
  assert.ok(Object.keys(questions.spot_distraction.criteria).every((id) => id.startsWith("spot_")));
  assert.equal(state.level, "2 of 5");
  assert.deepEqual(state.active_effects, ["Homework"]);
});

test("places Jev's chosen item at Jev's chosen spot for that item type", async () => {
  // Responsibility spot = first candidate, distraction spot = last candidate.
  const client = stubClient(({ questions }) => ({
    ...jevSays({ kind: "anime" })({ questions }),
    spot_distraction: { type: "choice", choice: Object.keys(questions.spot_distraction.criteria).at(-1) },
  }));
  const spawn = await createItemDirector({ client }).decide(game());

  const ids = Object.keys(client.requests[0].questions.spot_distraction.criteria);
  assert.deepEqual(spawn, { kind: "anime", ...spotOf(client.requests[0], ids.at(-1)) });
});

test("no item when Jev says not now", async () => {
  const client = stubClient(jevSays({ spawn: 0.2 }));
  assert.equal(await createItemDirector({ client }).decide(game()), null);
});

test("Jev's yes has to be confident: 0.75 is not enough", async () => {
  const client = stubClient(jevSays({ spawn: 0.75 }));
  assert.equal(await createItemDirector({ client }).decide(game()), null);
});

// pickKind gets a scripted roll sequence: first buff-vs-debuff, then which item.
const rolls = (...values) => () => values.shift() ?? 0;
const kindAnswer = (probabilities) => ({ type: "choice", choice: Object.keys(probabilities)[0], probabilities });

test("Jev can nudge toward buffs when Pac-Man is in danger", () => {
  // Level 1 share is 0.65. Jev leaning 90% buff moves it to 0.57; 90% debuff to 0.73.
  const buffLean = kindAnswer({ homework: 0.9, anime: 0.1 });
  const debuffLean = kindAnswer({ homework: 0.1, anime: 0.9 });
  assert.equal(pickKind(buffLean, 1, rolls(0.6, 0.3)), "homework");
  assert.equal(pickKind(debuffLean, 1, rolls(0.6, 0.3)), "anime");
});

test("higher levels bring more distractions", () => {
  const flat = kindAnswer(Object.fromEntries(Object.keys(ITEMS).map((k) => [k, 1 / 8])));
  // A neutral Jev leaves the level's share as is: 0.65 at level 1, 0.9 at level 5.
  assert.equal(ITEMS[pickKind(flat, 1, rolls(0.75, 0))].type, "responsibility");
  assert.equal(ITEMS[pickKind(flat, 5, rolls(0.75, 0))].type, "distraction");
});

test("debuffs outnumber buffs at every level, even when Jev leans fully toward buffs", () => {
  const allBuffs = kindAnswer({ homework: 1 });
  let previous = 0;
  for (let level = 1; level <= LEVELS.length; level++) {
    let debuffs = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      // Evenly spaced rolls give the exact share without randomness in the test.
      if (ITEMS[pickKind(allBuffs, level, rolls((i + 0.5) / n, 0))].type === "distraction") debuffs++;
    }
    const share = debuffs / n;
    assert.ok(share > 0.5, `level ${level}: ${share} debuffs`);
    assert.ok(share > previous, `level ${level} has more debuffs than level ${level - 1}`);
    assert.ok(Math.abs(share - (LEVELS[level - 1].distractionChance - JEV_NUDGE)) < 0.01);
    previous = share;
  }
});

test("samples items instead of always taking Jev's top pick", () => {
  const answer = kindAnswer({ social_media: 0.3, anime: 0.25, gaming: 0.25, junk_food: 0.2 });
  // First roll 0 -> distraction; second roll samples by Jev's probabilities.
  const picks = [0.1, 0.4, 0.7, 0.95].map((roll) => pickKind(answer, 1, rolls(0, roll)));
  assert.deepEqual(picks, ["anime", "social_media", "gaming", "junk_food"]);
});

test("uses Jev's plain choice when there are no probabilities, and ignores made-up items", () => {
  assert.equal(pickKind({ choice: "chores" }, 1), "chores");
  assert.ok(Object.hasOwn(ITEMS, pickKind({ choice: "tiktok" }, 1)));
});

test("spawns anyway once the maximum gap has passed", async () => {
  const client = stubClient(jevSays({ spawn: 0.1, kind: "chores" }));
  const spawn = await createItemDirector({ client }).decide(game({ secondsSinceSpawn: 20 }));
  assert.equal(spawn.kind, "chores");
});

test("does not ask Jev when the board is full or the last item was too recent", async () => {
  const client = stubClient(jevSays());
  const director = createItemDirector({ client });
  const full = [{ kind: "anime", x: 1, y: 3 }, { kind: "chores", x: 3, y: 3 }];
  assert.equal(await director.decide(game({ items: full })), null);
  assert.equal(await director.decide(game({ secondsSinceSpawn: 1 })), null);
  assert.equal(client.requests.length, 0);
});

test("ignores made-up items and spots", async () => {
  const client = stubClient(jevSays({ kind: "tiktok", spot: () => "spot_z" }));
  const spawn = await createItemDirector({ client, random: () => 0 }).decide(game());
  assert.ok(Object.hasOwn(ITEMS, spawn.kind));
  assert.notEqual(MAZE[spawn.y][spawn.x], "#");
});

test("falls back to local rules and reports the error when Jev fails", async () => {
  const errors = [];
  const client = stubClient(new Error("network down"));
  const director = createItemDirector({ client, random: () => 0, onError: (e) => errors.push(e) });
  const spawn = await director.decide(game({ secondsSinceSpawn: 20 }));
  assert.ok(spawn && Object.hasOwn(ITEMS, spawn.kind));
  assert.equal(errors.length, 1);
});

test("sends a valid request through the real TypeSafe SDK (HTTP stubbed)", async () => {
  let body;
  const fetch = async (url, init) => {
    body = JSON.parse(init.body);
    const answers = jevSays({ kind: "gaming" })({ questions: body.questions });
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 1, output_tokens: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new TypeSafeClient({ apiKey: "test-key", fetch, retry: { maxRetries: 0 } });
  const spawn = await createItemDirector({ client }).decide(game());

  assert.equal(spawn.kind, "gaming");
  assert.equal(body.questions.spawn_now.type, "noul");
  assert.equal(body.questions.kind.type, "choice");
});
