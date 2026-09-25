import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const game = {
  difficulty: "hard",
  mode: "chase",
  maze: ["#########", "#.......#", "#.##.##.#", "#.......#", "#########"],
  pacman: { x: 7, y: 3, direction: "left" },
  ghosts: [{ name: "blinky", behaviour: "chase", x: 4, y: 1, direction: "right", home: { x: 7, y: 1 } }],
};

// Stub controllers record what they were asked and always answer "down".
const created = [];
const decided = [];
function createController(difficulty) {
  created.push(difficulty);
  return {
    async decide(g) {
      decided.push(g);
      return Object.fromEntries(g.ghosts.map((ghost) => [ghost.name, "down"]));
    },
  };
}

let server;
let base;
before(async () => {
  server = createServer(createApp({ root, createController }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function post(body) {
  return fetch(`${base}/api/ghosts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("POST /api/ghosts returns the controller's moves", async () => {
  const res = await post(game);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { moves: { blinky: "down" } });

  const seen = decided.at(-1);
  assert.deepEqual(seen.pacman, game.pacman);
  assert.equal(seen.mode, "chase");
});

test("reuses one controller per difficulty, defaulting to normal", async () => {
  await post(game);
  await post({ ...game, difficulty: undefined });
  await post({ ...game, difficulty: undefined });
  assert.equal(created.filter((d) => d === "hard").length, 1);
  assert.equal(created.filter((d) => d === "normal").length, 1);
});

test("rejects bad requests with 400", async () => {
  const cases = [
    "not json",
    { ...game, difficulty: "insane" },
    { ...game, maze: "#####" },
    { ...game, pacman: { x: "7" } },
    { ...game, ghosts: [{ name: "blinky", x: 1, y: 1 }] },
    { ...game, ghosts: [{ ...game.ghosts[0], behaviour: "teleport" }] },
  ];
  for (const body of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.ok((await res.json()).error);
  }
});

test("rejects oversized bodies with 413", async () => {
  const res = await post({ ...game, padding: "x".repeat(70 * 1024) });
  assert.equal(res.status, 413);
});

test("only POST is allowed on /api/ghosts", async () => {
  assert.equal((await fetch(`${base}/api/ghosts`)).status, 405);
});

test("serves the frontend files", async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type"), /text\/html/);
  assert.match(await index.text(), /js\/ghosts\.js/);

  const script = await fetch(`${base}/js/ghost-ai/maze.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);

  const svg = await fetch(`${base}/assets/pacman.svg`);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
});

test("never serves secrets or server code", async () => {
  for (const p of ["/.env", "/example.env", "/package.json", "/server/app.js", "/node_modules/@typesafe-ai/sdk/package.json",
    "/css/..%2f.env", "/js/%2e%2e/.env", "/%E0%A4%A", "/js"]) {
    const res = await fetch(base + p);
    assert.ok([400, 404].includes(res.status), `${p} returned ${res.status}`);
  }
});
