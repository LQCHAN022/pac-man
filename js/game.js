// Game rules: ghost collisions, lives, frightened mode, level clear and game over.
//
// Reads Pac-Man's globals from pacman.js (state, pelletsLeft, addScore and the
// reset helpers) and listens for its "pacman:*" events; drives the ghosts
// through the exports of ghosts.js. Loaded as a module, so it runs after the
// classic scripts.
//
// Collisions are checked right after every Pac-Man step and every ghost tick.
// Everything moves one whole tile at a time, so two sprites can't pass
// through each other without sharing a tile at one of those checks.

import { frighten, ghosts, isFrightened, onGhostsMoved, resetGhosts, sendHome } from "./ghosts.js";

const FRIGHTENED_MS = 6000;
const GHOST_POINTS = [200, 400, 800, 1600]; // for each ghost eaten on one power pellet
const SPARE_LIVES = 2; // shown in the footer; the Pac-Man in play isn't counted
const DEATH_MS = 1500;
const READY_MS = 2000;
const LEVEL_CLEAR_MS = 2000;

const pacmanEl = document.querySelector(".sprite--pacman");
const messageEl = document.querySelector(".ready");
const livesEl = document.querySelector(".lives");

let lives = SPARE_LIVES;
let ghostsEaten = 0;
let gameOver = false;

function renderLives() {
  livesEl.replaceChildren(
    ...Array.from({ length: lives }, () => Object.assign(document.createElement("img"), { src: "assets/pacman.svg", alt: "" }))
  );
}

function showMessage(text, { gameOver = false } = {}) {
  messageEl.textContent = text;
  messageEl.hidden = !text;
  messageEl.classList.toggle("ready--game-over", gameOver);
}

function checkCollisions() {
  if (state.paused) return;
  for (const ghost of ghosts) {
    if (ghost.x !== state.x || ghost.y !== state.y) continue;
    if (!isFrightened(ghost)) return loseLife();
    addScore(GHOST_POINTS[Math.min(ghostsEaten, GHOST_POINTS.length - 1)]);
    ghostsEaten++;
    sendHome(ghost);
  }
}

function loseLife() {
  state.paused = true;
  pacmanEl.classList.add("sprite--dying");
  setTimeout(() => {
    pacmanEl.classList.remove("sprite--dying");
    if (lives === 0) return endGame();
    lives--;
    renderLives();
    startRound();
  }, DEATH_MS);
}

function clearLevel() {
  state.paused = true;
  board.classList.add("board--cleared");
  setTimeout(() => {
    board.classList.remove("board--cleared");
    resetPellets();
    startRound();
  }, LEVEL_CLEAR_MS);
}

// Everyone back to their starting tiles, "READY!", then play resumes.
function startRound() {
  resetPacman();
  resetGhosts();
  showMessage("READY!");
  setTimeout(() => {
    showMessage("");
    resetGhosts(); // restart the ghosts' release and scatter/chase clocks from now
    state.paused = false;
  }, READY_MS);
}

function endGame() {
  gameOver = true;
  pacmanEl.hidden = true;
  showMessage("GAME OVER", { gameOver: true });
}

function restart() {
  gameOver = false;
  pacmanEl.hidden = false;
  lives = SPARE_LIVES;
  renderLives();
  resetScore();
  resetPellets();
  document.dispatchEvent(new Event("game:restart")); // director.js resets difficulty and items
  startRound();
}

document.addEventListener("pacman:power", () => {
  ghostsEaten = 0;
  frighten(FRIGHTENED_MS);
});

document.addEventListener("pacman:moved", () => {
  checkCollisions();
  if (!state.paused && pelletsLeft === 0) clearLevel();
});

onGhostsMoved(checkCollisions);

// After game over, any direction key, Enter, Space or a tap starts a new game.
document.addEventListener("keydown", (event) => {
  if (gameOver && /^(Arrow|Enter$| $|[wasd]$)/i.test(event.key)) restart();
});
board.addEventListener("touchend", () => {
  if (gameOver) restart();
});

renderLives();
