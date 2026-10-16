/**
 * Deterministic random numbers of the game rules (sfc32, a 128-bit state). The host gives
 * the authority a secret seed (`InitPayload.seed`, SPEC 4.2), so players cannot compute a
 * shuffled deck; the generator state is part of the snapshot, so a resumed game continues
 * with the same sequence. Not cryptographic – fair enough for games.
 */

/** 128 bits from a string (cyrb128). */
export function seedFromString(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export class SeededRandom {
  /** The generator state (saved in snapshots). */
  state: [number, number, number, number];

  constructor(seed: string) {
    this.state = seedFromString(seed);
    for (let i = 0; i < 15; i++) this.next(); // mix the seed in
  }

  /**
   * Continues from a saved state. A number is the state of the 32-bit generator of the
   * release candidates (snapshots saved by them): it seeds a new generator.
   */
  restore(state: unknown): void {
    if (Array.isArray(state) && state.length === 4 && state.every((n) => Number.isInteger(n))) {
      this.state = state.map((n) => n >>> 0) as [number, number, number, number];
    } else if (typeof state === 'number') {
      this.state = new SeededRandom(`legacy:${state}`).state;
    }
  }

  next(): number {
    let [a, b, c, d] = this.state;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.state = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return (t >>> 0) / 4294967296;
  }

  shuffle<T>(array: readonly T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
