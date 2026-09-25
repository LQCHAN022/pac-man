// Runs js/ghosts.js against a fake page, clock and server.
import { beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { legalMoves } from "../js/ghost-ai/maze.js";

const LAYOUT = [...readFileSync(new URL("../js/board.js", import.meta.url), "utf8").matchAll(/^  "(.{28})",$/gm)].map(
  (m) => m[1],
);
const NAMES = ["Blinky", "Pinky", "Inky", "Clyde"];
const STEP_MS = 200;

let elements;
let run = 0;

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
  elements = Object.fromEntries(NAMES.map((n) => [n.toLowerCase(), fakeSprite(`assets/${n.toLowerCase()}.jfif`)]));
  globalThis.LAYOUT = LAYOUT;
  globalThis.state = { x: 13, y: 23, dir: "left", timer: 1 }; // Pac-Man already started
  globalThis.location = { search: "" };
  globalThis.document = {
    querySelector: (selector) => elements[selector.match(/data-ghost="(\w+)"/)[1]],
  };
});

function fakeSprite(src) {
  const classes = new Set(["sprite", "sprite--ghost", "sprite--portrait"]);
  return {
    style: {},
    src,
    getAttribute: (name) => (name === "src" ? src : null),
    classList: {
      contains: (c) => classes.has(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
  };
}

// Fresh copy of the module per test (it starts running on import).
async function startGhosts() {
  return import(`../js/ghosts.js?run=${++run}`);
}

function position(name) {
  const [x, y] = [...elements[name].style.transform.matchAll(/\* (-?\d+)/g)].map((m) => Number(m[1]));
  return { x, y };
}

async function advance(ms) {
  for (let t = 0; t < ms; t += 10) {
    mock.timers.tick(10);
    for (let i = 0; i < 5; i++) await Promise.resolve(); // let fetch promises settle
  }
}

// Fake /api/ghosts: answers after `delayMs` with the last legal move at each junction.
function fakeServer(delayMs) {
  const answers = new Map();
  let requests = 0;
  globalThis.fetch = (url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    const moves = {};
    for (const g of body.ghosts) {
      const options = legalMoves(body.maze, g, g.direction);
      moves[g.name] = options.at(-1);
      answers.set(`${g.name}@${g.x},${g.y},${g.direction}`, moves[g.name]);
    }
    return new Promise((resolve) =>
      setTimeout(() => resolve({ ok: true, json: async () => ({ moves }) }), delayMs),
    );
  };
  return { answers, requests: () => requests };
}

function directionBetween(a, b) {
  if (b.y < a.y) return "up";
  if (b.y > a.y) return "down";
  if (b.x < a.x || b.x - a.x > 1) return "left"; // a big jump right is a wrap going left
  return "right";
}

test("ghosts step every tick even when the server is slower than a step", async () => {
  fakeServer(350);
  await startGhosts();
  await advance(60); // start-up poll

  for (let i = 0; i < 40; i++) {
    const before = position("blinky");
    await advance(STEP_MS);
    assert.notDeepEqual(position("blinky"), before, `blinky stalled on step ${i}`);
  }
});

test("ghosts take Jev's answer at junctions when it arrives in time", async () => {
  const server = fakeServer(20);
  await startGhosts();
  await advance(60);

  let direction = "left";
  let followed = 0;
  for (let i = 0; i < 60; i++) {
    const before = position("blinky");
    await advance(STEP_MS);
    const now = position("blinky");
    const moved = directionBetween(before, now);
    const planned = server.answers.get(`blinky@${before.x},${before.y},${direction}`);
    if (planned) {
      assert.equal(moved, planned, `ignored Jev at (${before.x}, ${before.y})`);
      followed++;
    }
    direction = moved;
  }
  assert.ok(followed >= 3, `expected several junctions, saw ${followed}`);
  assert.ok(server.requests() < 60, "should ask once per junction, not every step");
});

test("ghosts keep moving when the server is down", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("connection refused");
  };
  const warn = mock.method(console, "warn", () => {});
  await startGhosts();
  await advance(60);

  for (let i = 0; i < 20; i++) {
    const before = position("blinky");
    await advance(STEP_MS);
    assert.notDeepEqual(position("blinky"), before);
  }
  assert.equal(requests, 1, "stops asking after the first failure");
  assert.equal(warn.mock.callCount(), 1);
  warn.mock.restore();
});

test("index.html has an image for every ghost", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const name of NAMES) {
    assert.match(html, new RegExp(`class="[^"]*sprite--ghost[^"]*"[^>]*data-ghost="${name.toLowerCase()}"`), name);
  }
});

test("ghosts leave the house on their release schedule", async () => {
  fakeServer(20);
  await startGhosts();
  const start = position("clyde");
  await advance(6000);
  assert.deepEqual(position("clyde"), start, "clyde is still home at 6s");
  await advance(1600);
  assert.notDeepEqual(position("clyde"), start, "clyde is out after 7s");
});

test("paused ghosts stand still", async () => {
  fakeServer(20);
  await startGhosts();
  await advance(60);
  globalThis.state.paused = true;
  const before = position("blinky");
  await advance(STEP_MS * 5);
  assert.deepEqual(position("blinky"), before);
});

test("frightened ghosts turn blue, reverse, move at half speed and recover", async () => {
  fakeServer(20);
  const { frighten, isFrightened, ghosts } = await startGhosts();
  await advance(60 + STEP_MS * 3);
  const blinky = ghosts.find((g) => g.name === "blinky");
  const heading = blinky.direction;

  frighten(3000);
  assert.ok(isFrightened(blinky));
  assert.equal(elements.blinky.src, "assets/ghost-frightened.svg");
  assert.equal(elements.blinky.classList.contains("sprite--portrait"), false);
  assert.notEqual(blinky.direction, heading, "reverses when frightened");

  let moves = 0;
  for (let i = 0; i < 10; i++) {
    const before = position("blinky");
    await advance(STEP_MS);
    if (JSON.stringify(position("blinky")) !== JSON.stringify(before)) moves++;
  }
  assert.equal(moves, 5, "moves every other tick");
  assert.ok(elements.blinky.classList.contains("sprite--flashing"), "flashes near the end");

  await advance(1200);
  assert.equal(isFrightened(blinky), false);
  assert.equal(elements.blinky.src, "assets/blinky.jfif", "portrait is back");
  assert.ok(elements.blinky.classList.contains("sprite--portrait"));
});

test("eaten ghosts respawn in the house and come back out", async () => {
  fakeServer(20);
  const { sendHome, ghosts } = await startGhosts();
  await advance(60 + STEP_MS * 3);
  const blinky = ghosts.find((g) => g.name === "blinky");

  sendHome(blinky);
  assert.deepEqual(position("blinky"), { x: 13, y: 14 });
  await advance(2800);
  assert.deepEqual(position("blinky"), { x: 13, y: 14 }, "waits in the house");
  await advance(600);
  assert.notDeepEqual(position("blinky"), { x: 13, y: 14 }, "out again after 3s");
});

test("move listeners run after every ghost tick", async () => {
  fakeServer(20);
  const { onGhostsMoved } = await startGhosts();
  let calls = 0;
  onGhostsMoved(() => calls++);
  await advance(60 + STEP_MS * 4);
  assert.ok(calls >= 4, `expected a call per tick, saw ${calls}`);
});
