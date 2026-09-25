// Starts the game server:  npm start  (then open http://localhost:3000)
// Reads TYPESAFE_API_KEY from .env (see example.env). Without a key the game
// still works: ghosts use arcade target-seeking and items appear at random.

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { createGhostController } from "../js/ghost-ai/index.js";
import { createItemDirector } from "../js/game/item-director.js";
import { createApp } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No .env file: fall back to real environment variables.
}

const PORT = Number(process.env.PORT) || 3000;

function makeClient() {
  if (process.env.TYPESAFE_API_KEY) return new TypeSafeClient();
  console.warn("TYPESAFE_API_KEY is not set: ghosts and items will use local rules instead of Jev. See example.env.");
  // Every request "fails", so the controller uses its local fallback moves.
  return { systemOne: () => Promise.reject(new Error("Jev disabled: no API key")) };
}

const client = makeClient();
const online = client instanceof TypeSafeClient;

// Ghosts ask several times a second; log each kind of failure at most every 5s.
const lastErrorLog = {};
function logJevError(what) {
  return (error) => {
    if (!online || Date.now() - (lastErrorLog[what] || 0) < 5000) return;
    lastErrorLog[what] = Date.now();
    console.error(`Jev request for ${what} failed, using local rules: ${error.message}`);
  };
}

const app = createApp({
  root,
  createController: (difficulty) => createGhostController({ client, difficulty, onError: logJevError("ghosts") }),
  itemDirector: createItemDirector({ client, onError: logJevError("items") }),
});

const MAX_PORT_TRIES = 10;
const server = createServer(app);

// If the port is taken (e.g. by Docker), try the next few before giving up.
let port = PORT;
server.on("error", (error) => {
  if (error.code !== "EADDRINUSE") throw error;
  if (port - PORT + 1 >= MAX_PORT_TRIES) {
    console.error(`Ports ${PORT}-${port} are all in use. Pick another with e.g. PORT=8080 in .env.`);
    process.exit(1);
  }
  console.warn(`Port ${port} is in use, trying ${port + 1}...`);
  server.listen(++port);
});
server.once("listening", () => {
  console.log(`Pac-Man running at http://localhost:${port} (ghost AI: ${online ? "Jev" : "arcade fallback"})`);
});
server.listen(port);
