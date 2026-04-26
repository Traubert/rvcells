/** Mulberry32: small seeded PRNG (Tommy Ettinger). Returns a function that yields
 *  uniform floats in [0, 1). Full 2^32 period. Use when you need deterministic
 *  randomness — e.g. UI state where re-renders must not reshuffle results. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
