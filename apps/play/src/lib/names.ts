/**
 * Random player names (from the original Memizy multiplayer – the funny ones
 * are a proven hit with students). Normal parts are twice as likely as funny ones.
 */

const FUNNY_EMOJIS = ['🗿', '💀', '🤡', '👑', '💅', '🐺', '🥶', '📈', '🧠', '🐐', '🤫', '🧏', '🔥', '🤓'];
const FUNNY_ADJECTIVES = ['Skibidi', 'Sigma', 'Alpha', 'Beta', 'Gigachad', 'Based', 'Cringe', 'Sus', 'Ohio', 'Rizz', 'Mewing', 'Goated', 'Delulu', 'Savage', 'Bro', 'Bruh'];
const FUNNY_NOUNS = ['Boy', 'Girl', 'Queen', 'Male', 'Grindset', 'Rizzler', 'Boss', 'CEO', 'NPC', 'Boomer', 'Chad', 'Bop', 'Maxxer', '69', '67'];

const NORMAL_EMOJIS = [
  '😊', '😎', '🙂', '😄', '😁', '🤗', '😏', '🤔', '🌟', '⭐', '🎯', '💪', '🏆', '🎮',
  '📚', '🎵', '🌈', '🔑', '💡', '🎲', '🏅', '✨', '🌺', '🦁', '🐯', '🦊', '🐻', '🐼',
  '🐸', '🦋', '🐧', '🦅', '🌙', '☀️', '⚡', '🌊', '🍀', '🎸', '🎨', '🎭',
];
const NORMAL_ADJECTIVES = [
  'Happy', 'Smart', 'Clever', 'Fast', 'Brave', 'Calm', 'Cool', 'Swift', 'Bold', 'Keen',
  'Sharp', 'Bright', 'Quick', 'Wise', 'Mighty', 'Agile', 'Gentle', 'Fierce', 'Noble', 'Sturdy',
  'Lucky', 'Sunny', 'Witty', 'Silent', 'Daring', 'Humble', 'Loyal', 'Curious', 'Fearless', 'Sneaky',
  'Jolly', 'Crafty', 'Steady', 'Playful', 'Nimble', 'Shiny', 'Fuzzy', 'Electric', 'Cosmic', 'Golden',
];
const NORMAL_NOUNS = [
  'Star', 'Explorer', 'Pilot', 'Scholar', 'Champion', 'Ranger', 'Scout', 'Ace', 'Hero', 'Player',
  'Thinker', 'Dreamer', 'Builder', 'Coder', 'Solver', 'Learner', 'Master', 'Expert', 'Captain', 'Legend',
  'Ninja', 'Wizard', 'Knight', 'Guardian', 'Voyager', 'Rookie', 'Veteran', 'Maverick', 'Gladiator', 'Phantom',
  'Fox', 'Bear', 'Wolf', 'Eagle', 'Shark', 'Falcon', 'Dragon', 'Tiger', 'Lion', 'Panda',
];

function weightedPick<T>(funny: readonly T[], normal: readonly T[], random: () => number): T {
  const pool = [...normal, ...normal, ...funny];
  return pool[Math.floor(random() * pool.length)];
}

export function generateName(random: () => number = Math.random): string {
  return `${weightedPick(FUNNY_EMOJIS, NORMAL_EMOJIS, random)} ${weightedPick(FUNNY_ADJECTIVES, NORMAL_ADJECTIVES, random)} ${weightedPick(FUNNY_NOUNS, NORMAL_NOUNS, random)}`;
}

/** `count` distinct names. */
export function generateNames(count: number, random: () => number = Math.random): string[] {
  const names = new Set<string>();
  while (names.size < count) names.add(generateName(random));
  return [...names];
}
