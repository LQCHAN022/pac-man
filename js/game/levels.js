// Difficulty ramps up every LEVEL_MS. Each level sets how smart the ghosts
// are (the ghost AI difficulty), how fast they move, and the share of items
// that are distractions (debuffs). That share is over half from the start and
// grows each level; Jev can only nudge it (see pickKind in item-director.js).

export const LEVEL_MS = 30000;

export const LEVELS = [
  { name: "Easy",      ai: "easy",   ghostStepMs: 260, distractionChance: 0.65 },
  { name: "Normal",    ai: "normal", ghostStepMs: 230, distractionChance: 0.7 },
  { name: "Hard",      ai: "hard",   ghostStepMs: 200, distractionChance: 0.75 },
  { name: "Very hard", ai: "hard",   ghostStepMs: 175, distractionChance: 0.82 },
  { name: "Extreme",   ai: "hard",   ghostStepMs: 150, distractionChance: 0.9 },
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
