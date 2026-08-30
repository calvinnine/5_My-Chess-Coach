/**
 * Korean particle selection.
 *
 * 이/가, 은/는, 을/를 and 과/와 depend on whether the preceding syllable ends in
 * a final consonant (받침). Hangul syllables are laid out contiguously from
 * U+AC00, so the final-consonant index is `(code - 0xAC00) % 28`; 0 means none.
 */
export function hasFinalConsonant(word: string): boolean {
  const last = word.trim().at(-1);
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

type ParticlePair = "이/가" | "은/는" | "을/를" | "과/와" | "으로/로";

/** Appends the correct form of a particle to `word`. */
export function withParticle(word: string, particle: ParticlePair): string {
  const [withFinal, withoutFinal] = particle.split("/");
  return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`;
}
