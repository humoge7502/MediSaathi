/** The family join code: the only credential on the caregiver surface.
 *
 *  Whoever presents it reads a relative's medication escalations, so it is
 *  drawn uniformly (no modulo bias), from an alphabet that survives being read
 *  aloud over the phone, and it is never logged or echoed in full.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/0/1
export const CODE_LENGTH = 6;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** `b % 31` over a Uint32 is not uniform — 2^32 is not a multiple of the
 *  alphabet — and this string is a credential, so the tail symbols would be
 *  measurably likelier than the head. Draw from the largest multiple of the
 *  alphabet size that fits in 32 bits and re-draw anything above it. */
export function familyCode(): string {
  const universe = 2 ** 32;
  const limit = Math.floor(universe / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  let out = "";
  while (out.length < CODE_LENGTH) {
    const draw = new Uint32Array(CODE_LENGTH * 4);
    crypto.getRandomValues(draw);
    for (const value of draw) {
      if (value < limit) out += CODE_ALPHABET[value % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** Log enough to match an audit row to a link, never enough to re-use it. */
export function codeHint(code: string): string {
  return `${code.slice(0, 2)}${"•".repeat(code.length - 2)}`;
}
