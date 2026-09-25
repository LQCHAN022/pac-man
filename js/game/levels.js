// Difficulty ramps up every LEVEL_MS. Each level sets how smart the ghosts
// are (the ghost AI difficulty), how fast they move, and how likely the
// item fallback is to pick a distraction.

export const LEVEL_MS = 30000;

export const LEVELS = [
  { name: "Easy",      ai: "easy",   ghostStepMs: 260, distractionChance: 0.3 },
  { name: "Normal",    ai: "normal", ghostStepMs: 230, distractionChance: 0.4 },
  { name: "Hard",      ai: "hard",   ghostStepMs: 200, distractionChance: 0.5 },
  { name: "Very hard", ai: "hard",   ghostStepMs: 175, distractionChance: 0.6 },
  { name: "Extreme",   ai: "hard",   ghostStepMs: 150, distractionChance: 0.7 },
];

// Level for a given time since the game started.
// `number` is 1-based; `msUntilNext` is null once the last level is reached.
export function levelAt(elapsedMs) {
  const index = Math.min(Math.floor(Math.max(0, elapsedMs) / LEVEL_MS), LEVELS.length - 1);
  const isLast = index === LEVELS.length - 1;
  return {
    ...LEVELS[index],
    number: index + 1,
    msUntilNext: isLast ? null : (index + 1) * LEVEL_MS - elapsedMs,
  };
}
