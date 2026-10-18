/**
 * Windows-1252 bytes to text, spelled out rather than through TextDecoder,
 * which some environments treat as Latin-1 (losing curly quotes and dashes in
 * 0x80–0x9F). Used by the older Word (.doc) and RTF readers.
 */
const HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd,
  0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
]

export function decodeCp1252(bytes: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? HIGH[b - 0x80] : b)
  }
  return out
}
