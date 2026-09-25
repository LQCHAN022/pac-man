// Board items: responsibilities are buffs to chase, distractions are
// debuffs to avoid. Shared by the page and the server (which describes them
// to Jev), so keep this file free of DOM and Node APIs.

export const EFFECT_MS = 6000;
export const ITEM_LIFETIME_MS = 12000;

// Speed multipliers applied while an effect is active.
export const EFFECTS = {
  pacmanFaster: { target: "pacman", multiplier: 2,   label: "You speed up" },
  pacmanSlower: { target: "pacman", multiplier: 0.5, label: "You slow down" },
  ghostsSlower: { target: "ghosts", multiplier: 0.5, label: "Ghosts slow down" },
  ghostsFaster: { target: "ghosts", multiplier: 1.8, label: "Ghosts speed up" },
};

export const ITEMS = {
  homework:     { type: "responsibility", name: "Homework",     icon: "📚", effect: "pacmanFaster" },
  exercise:     { type: "responsibility", name: "Exercise",     icon: "🏃", effect: "pacmanFaster" },
  chores:       { type: "responsibility", name: "Chores",       icon: "🧹", effect: "ghostsSlower" },
  early_night:  { type: "responsibility", name: "Early night",  icon: "😴", effect: "ghostsSlower" },
  anime:        { type: "distraction",    name: "Anime",        icon: "📺", effect: "pacmanSlower" },
  social_media: { type: "distraction",    name: "Social media", icon: "📱", effect: "pacmanSlower" },
  gaming:       { type: "distraction",    name: "Gaming",       icon: "🎮", effect: "ghostsFaster" },
  junk_food:    { type: "distraction",    name: "Junk food",    icon: "🍟", effect: "ghostsFaster" },
};

export function itemsOfType(type) {
  return Object.keys(ITEMS).filter((kind) => ITEMS[kind].type === type);
}

// Adds (or refreshes) the effect of picking up `kind`. Returns a new list.
export function addEffect(effects, kind, now) {
  const { effect } = ITEMS[kind];
  return [...effects.filter((e) => e.effect !== effect), { effect, kind, expiresAt: now + EFFECT_MS }];
}

export function activeEffects(effects, now) {
  return effects.filter((e) => e.expiresAt > now);
}

// Combined speed multipliers for Pac-Man and the ghosts.
export function speedMultipliers(effects, now) {
  const speeds = { pacman: 1, ghosts: 1 };
  for (const { effect } of activeEffects(effects, now)) {
    const { target, multiplier } = EFFECTS[effect];
    speeds[target] *= multiplier;
  }
  return speeds;
}
