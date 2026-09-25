// Runs the "responsibilities vs distractions" layer of the game:
//   - intro card, dismissed when Pac-Man starts moving
//   - difficulty level that ramps up over time, with a countdown in the panel
//   - items (buffs/debuffs) that Jev places via POST /api/items
//   - speed effects, shared with pacman.js and ghosts.js through window.GAME
//
// Reads LAYOUT (board.js) and Pac-Man's `state` (pacman.js).

import { EFFECTS, ITEMS, ITEM_LIFETIME_MS, activeEffects, addEffect, itemsOfType, speedMultipliers } from "./game/items.js";
import { LEVELS, LEVEL_MS, levelAt } from "./game/levels.js";
import { fallbackSpawn } from "./game/spawn-rules.js";

const ASK_EVERY_MS = 2000; // how often to ask Jev whether to place an item
const UI_EVERY_MS = 200;
const BLINK_BEFORE_MS = 3000; // items blink when they're about to vanish

const board = document.getElementById("board");
const $ = (id) => document.getElementById(id);

// Shared with pacman.js (pacmanSpeed) and ghosts.js (level, ghostSpeed, ghosts).
window.GAME = { level: levelAt(0), pacmanSpeed: 1, ghostSpeed: 1, ghosts: [] };

let startedAt = null;
let lastSpawnAt = null;
let items = [];   // { kind, x, y, spawnedAt, el }
let effects = []; // see addEffect()
let asking = false;
let serverDown = false;

// ---------- Legend ----------

function legendHtml(type) {
  return itemsOfType(type)
    .map((kind) => {
      const { icon, name, effect } = ITEMS[kind];
      return `<li><span class="legend__icon">${icon}</span><span>${name}<small>${EFFECTS[effect].label}</small></span></li>`;
    })
    .join("");
}

for (const el of document.querySelectorAll("[data-legend]")) {
  el.innerHTML = legendHtml(el.dataset.legend);
}

// ---------- Items on the board ----------

function placeAt(el, { x, y }) {
  el.style.gridArea = "1 / 1";
  el.style.transform = `translate(calc(var(--cell) * ${x}), calc(var(--cell) * ${y}))`;
}

function spawnItem({ kind, x, y }) {
  const { icon, name, type } = ITEMS[kind];
  const el = document.createElement("div");
  el.className = `item item--${type}`;
  el.textContent = icon;
  el.title = name;
  el.setAttribute("aria-label", `${name} (${type})`);
  Object.assign(el.dataset, { kind, x, y });
  // Positioned with `translate`, not `transform`: the pulse animates `scale`,
  // which the browser applies on top of `transform` and would stretch the
  // offset too, pushing items off their tile.
  el.style.gridArea = "1 / 1";
  el.style.translate = `calc(var(--cell) * ${x}) calc(var(--cell) * ${y})`;
  board.append(el);
  items.push({ kind, x, y, spawnedAt: Date.now(), el });
  lastSpawnAt = Date.now();
}

function removeItem(item) {
  item.el.remove();
  items = items.filter((i) => i !== item);
}

function popup(text, tile, type) {
  const el = document.createElement("div");
  el.className = `popup popup--${type}`;
  el.textContent = text;
  placeAt(el, tile);
  el.addEventListener("animationend", () => el.remove());
  board.append(el);
}

function pickUp(item) {
  const { name, type, effect } = ITEMS[item.kind];
  effects = addEffect(effects, item.kind, Date.now());
  popup(`${name}! ${EFFECTS[effect].label}`, item, type);
  removeItem(item);
  applySpeeds();
  renderEffects(Date.now());
}

document.addEventListener("pacman:moved", ({ detail }) => {
  const item = items.find((i) => i.x === detail.x && i.y === detail.y);
  if (item) pickUp(item);
});

// ---------- Asking Jev where to put things ----------

function gameSnapshot() {
  const now = Date.now();
  return {
    maze: LAYOUT,
    pacman: { x: state.x, y: state.y, direction: state.dir },
    ghosts: window.GAME.ghosts.map(({ x, y }) => ({ x, y })),
    items: items.map(({ kind, x, y }) => ({ kind, x, y })),
    level: window.GAME.level.number,
    secondsSinceSpawn: (now - lastSpawnAt) / 1000,
    effects: activeEffects(effects, now).map((e) => e.kind),
  };
}

async function askForItem() {
  if (asking) return;
  asking = true;
  const game = gameSnapshot();
  try {
    let spawn;
    if (serverDown) {
      spawn = fallbackSpawn(game);
    } else {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(game),
      });
      if (!response.ok) throw new Error(`Server replied ${response.status}`);
      ({ spawn } = await response.json());
    }
    // Pac-Man may have moved onto the spot while we were waiting.
    if (spawn && !(spawn.x === state.x && spawn.y === state.y) && !items.some((i) => i.x === spawn.x && i.y === spawn.y)) {
      spawnItem(spawn);
    }
  } catch (error) {
    console.warn("Item server unavailable, placing items at random. Start it with `npm start`.", error);
    serverDown = true;
  } finally {
    asking = false;
  }
}

// ---------- Level, effects and the side panel ----------

function applySpeeds() {
  const speeds = speedMultipliers(effects, Date.now());
  window.GAME.pacmanSpeed = speeds.pacman;
  window.GAME.ghostSpeed = speeds.ghosts;
}

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function showBanner(text) {
  const banner = $("banner");
  banner.textContent = text;
  banner.classList.remove("banner--show");
  void banner.offsetWidth; // restart the animation
  banner.classList.add("banner--show");
}

function renderLevel(level) {
  $("level-name").textContent = level.name.toUpperCase();
  $("level-number").textContent = `LEVEL ${level.number}/${LEVELS.length}`;
  document.querySelectorAll(".pips span").forEach((pip, i) => pip.classList.toggle("on", i < level.number));
  $("panel").dataset.level = level.number;
}

function renderCountdown(level) {
  const bar = $("level-bar");
  if (level.msUntilNext === null) {
    $("level-countdown").textContent = "MAX";
    bar.style.width = "100%";
    return;
  }
  $("level-countdown").textContent = formatTime(level.msUntilNext);
  bar.style.width = `${100 - (level.msUntilNext / LEVEL_MS) * 100}%`;
}

function renderEffects(now) {
  const list = $("effects");
  const active = activeEffects(effects, now);
  if (active.length === 0) {
    list.innerHTML = `<li class="effects__empty">None yet</li>`;
    return;
  }
  list.innerHTML = active
    .map(({ kind, effect, expiresAt }) => {
      const { icon, name, type } = ITEMS[kind];
      return `<li class="effect effect--${type}"><span>${icon}</span><span>${name}<small>${EFFECTS[effect].label}</small></span><b>${Math.ceil((expiresAt - now) / 1000)}s</b></li>`;
    })
    .join("");
}

function update() {
  const now = Date.now();
  const level = levelAt(now - startedAt);
  if (level.number !== window.GAME.level.number) {
    showBanner(`LEVEL ${level.number}: ${level.name.toUpperCase()}`);
    renderLevel(level);
  }
  window.GAME.level = level;
  renderCountdown(level);

  effects = activeEffects(effects, now);
  applySpeeds();
  renderEffects(now);

  for (const item of items) {
    const age = now - item.spawnedAt;
    if (age >= ITEM_LIFETIME_MS) removeItem(item);
    else item.el.classList.toggle("item--expiring", age >= ITEM_LIFETIME_MS - BLINK_BEFORE_MS);
  }
}

// ---------- Start ----------

renderLevel(window.GAME.level);
renderCountdown(window.GAME.level);
renderEffects(Date.now());

document.addEventListener("game:start", () => {
  startedAt = lastSpawnAt = Date.now();
  $("intro").classList.add("intro--hidden");
  update();
  setInterval(update, UI_EVERY_MS);
  setInterval(askForItem, ASK_EVERY_MS);
}, { once: true });
