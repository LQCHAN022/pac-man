// HTTP handler for the game: serves the frontend and the Jev-backed endpoints.
// The Jev API key stays on the server; the browser only sees the decisions.
//
//   POST /api/ghosts   { difficulty?, mode?, maze, pacman, ghosts } -> { moves }
//   POST /api/items    { maze, pacman, ghosts, items, level, secondsSinceSpawn, effects? }
//                      -> { spawn: { kind, x, y } | null }
//   GET  /...          static files (index.html, css/, js/, assets/)

import { readFile } from "node:fs/promises";
import path from "node:path";
import { BEHAVIOURS, DIFFICULTIES } from "../js/ghost-ai/index.js";
import { ITEMS } from "../js/game/items.js";
import { LEVELS } from "../js/game/levels.js";

const PUBLIC_DIRS = ["css", "js", "assets"];
const MAX_BODY_BYTES = 64 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/**
 * @param {object}   options
 * @param {string}   options.root              Project root to serve files from.
 * @param {Function} options.createController  (difficulty) => ghost controller with decide().
 * @param {{ decide: Function }} options.itemDirector  Decides item spawns (see js/game/item-director.js).
 */
export function createApp({ root, createController, itemDirector }) {
  const controllers = new Map();
  function controllerFor(difficulty) {
    if (!controllers.has(difficulty)) controllers.set(difficulty, createController(difficulty));
    return controllers.get(difficulty);
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/ghosts") {
        if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
        return await handleGhosts(req, res, controllerFor);
      }
      if (url.pathname === "/api/items") {
        if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
        return await handleItems(req, res, itemDirector);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
      return await serveStatic(res, root, url.pathname);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, { error: "Internal server error" });
    }
  };
}

// Parses a JSON body, or replies with an error and returns undefined.
async function readJson(req, res) {
  try {
    return JSON.parse(await readBody(req));
  } catch (error) {
    send(res, error.status || 400, { error: error.status ? error.message : "Body must be JSON" });
    return undefined;
  }
}

async function handleItems(req, res, itemDirector) {
  const body = await readJson(req, res);
  if (body === undefined) return;

  const problem = validateItemsRequest(body);
  if (problem) return send(res, 400, { error: problem });

  const spawn = await itemDirector.decide({
    maze: body.maze,
    pacman: body.pacman,
    ghosts: body.ghosts,
    items: body.items,
    level: body.level,
    secondsSinceSpawn: body.secondsSinceSpawn,
    effects: body.effects || [],
  });
  return send(res, 200, { spawn });
}

function validateItemsRequest(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object";
  const problem = validateBoard(body);
  if (problem) return problem;
  if (!Array.isArray(body.ghosts) || !body.ghosts.every(isTile)) return "ghosts must be an array of { x, y }";
  if (!Array.isArray(body.items) || !body.items.every((i) => isTile(i) && Object.hasOwn(ITEMS, i.kind))) {
    return `items must be an array of { kind, x, y } with kind one of: ${Object.keys(ITEMS).join(", ")}`;
  }
  if (!Number.isInteger(body.level) || body.level < 1 || body.level > LEVELS.length) {
    return `level must be an integer from 1 to ${LEVELS.length}`;
  }
  if (typeof body.secondsSinceSpawn !== "number" || !(body.secondsSinceSpawn >= 0)) {
    return "secondsSinceSpawn must be a number of seconds";
  }
  if (body.effects !== undefined && !(Array.isArray(body.effects) && body.effects.every((k) => Object.hasOwn(ITEMS, k)))) {
    return "effects must be an array of item kinds";
  }
  return null;
}

async function handleGhosts(req, res, controllerFor) {
  const body = await readJson(req, res);
  if (body === undefined) return;

  const problem = validateGame(body);
  if (problem) return send(res, 400, { error: problem });

  const difficulty = body.difficulty || "normal";
  const moves = await controllerFor(difficulty).decide({
    maze: body.maze,
    mode: body.mode,
    pacman: body.pacman,
    ghosts: body.ghosts,
  });
  return send(res, 200, { moves });
}

function validateGame(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object";
  if (body.difficulty !== undefined && !Object.hasOwn(DIFFICULTIES, body.difficulty)) {
    return `difficulty must be one of: ${Object.keys(DIFFICULTIES).join(", ")}`;
  }
  const problem = validateBoard(body);
  if (problem) return problem;
  const { ghosts } = body;
  if (!Array.isArray(ghosts) || !ghosts.every((g) => isTile(g) && typeof g.name === "string" && isTile(g.home))) {
    return "ghosts must be an array of { name, x, y, direction, behaviour, home: { x, y } }";
  }
  const unknown = ghosts.find((g) => !Object.hasOwn(BEHAVIOURS, g.behaviour));
  if (unknown) return `${unknown.name} has unknown behaviour; use one of: ${Object.keys(BEHAVIOURS).join(", ")}`;
  return null;
}

// Checks the maze and Pac-Man, which every endpoint needs.
function validateBoard({ maze, pacman }) {
  if (!Array.isArray(maze) || maze.length === 0 || !maze.every((row) => typeof row === "string")) {
    return "maze must be a non-empty array of strings";
  }
  if (!isTile(pacman)) return "pacman must have numeric x and y";
  return null;
}

function isTile(value) {
  return value && Number.isInteger(value.x) && Number.isInteger(value.y);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop buffering but keep draining, so the 413 reply still reaches the client.
        req.removeAllListeners("data");
        req.resume();
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Only index.html and the public folders are served, so .env, server/,
// node_modules/ etc. can never be downloaded.
async function serveStatic(res, root, pathname) {
  let relative;
  try {
    relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return send(res, 400, { error: "Bad path" });
  }
  const filePath = path.resolve(root, relative);
  const inside = path.relative(root, filePath);
  const [topLevel] = inside.split(path.sep);
  const allowed =
    !inside.startsWith("..") && !path.isAbsolute(inside) &&
    (inside === "index.html" || (PUBLIC_DIRS.includes(topLevel) && inside !== topLevel));
  if (!allowed) return send(res, 404, { error: "Not found" });

  let data;
  try {
    data = await readFile(filePath);
  } catch {
    return send(res, 404, { error: "Not found" });
  }
  const type = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type, "content-length": data.length });
  res.end(data);
}

function send(res, status, json) {
  const data = JSON.stringify(json);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  res.end(data);
}
