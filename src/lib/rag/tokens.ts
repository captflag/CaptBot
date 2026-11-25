// CJK punctuation, kana, Han and Hangul, and full-width forms: roughly one token per character,
// where alphabetic text runs about four characters per token.
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

function cjkCount(text: string): number {
  return text.match(CJK)?.length ?? 0;
}

/** Rough token count that holds for both alphabetic and CJK text. */
export function estimateTokens(text: string): number {
  const cjk = cjkCount(text);
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

/** Characters per token: 4 for alphabetic text, falling to 1 as the share of CJK characters grows. */
export function charsPerToken(text: string): number {
  if (!text) return 4;
  return 4 - 3 * (cjkCount(text) / text.length);
}

/** True when a good share of the letters aren't Latin script, where the English-only local models are unreliable. */
export function mostlyNonLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return false;
  const nonLatin = letters.filter((c) => !/\p{Script=Latin}/u.test(c)).length;
  return nonLatin / letters.length > 0.3;
}
