const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const SYMBOLS = "!@#$%^&*_-+=?";

function pick(chars: string) {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % chars.length;
  return chars[index];
}

export function generatePassword(length = 20) {
  const all = LOWER + UPPER + NUMBERS + SYMBOLS;
  const required = [pick(LOWER), pick(UPPER), pick(NUMBERS), pick(SYMBOLS)];
  const rest = Array.from({ length: Math.max(length - required.length, 0) }, () => pick(all));
  return [...required, ...rest]
    .sort(() => crypto.getRandomValues(new Uint32Array(1))[0] - 2 ** 31)
    .join("");
}
