// Difficulty levels control how closely ghosts follow Jev's answer.
//
// randomness      chance of ignoring Jev and taking a random legal move
// sample          true: pick a move weighted by Jev's probabilities
//                 false: always take Jev's top choice
// minConfidence   below this confidence, use the local target-seeking move instead

export const DIFFICULTIES = {
  easy:   { randomness: 0.4, sample: true,  minConfidence: 0 },
  normal: { randomness: 0.1, sample: true,  minConfidence: 0 },
  hard:   { randomness: 0,   sample: false, minConfidence: 0.5 },
};

export function getDifficulty(name) {
  const difficulty = DIFFICULTIES[name];
  if (!difficulty) {
    throw new Error(`Unknown difficulty "${name}". Use one of: ${Object.keys(DIFFICULTIES).join(", ")}`);
  }
  return difficulty;
}
