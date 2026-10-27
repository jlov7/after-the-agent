/** Bounded strict packet JSON. Preserve duplicate-key and integer spelling checks. */
export function packetJson(raw: string, byteLimit: number): unknown {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > byteLimit) throw new TypeError('Packet input exceeds its byte limit');
  let cursor = 0;
  const fail = (): never => { throw new TypeError('Invalid packet JSON'); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(raw[cursor] ?? '\0')) cursor++; };
  const string = (): string => {
    const start = cursor++;
    while (cursor < raw.length) {
      const char = raw[cursor++];
      if (char === '"') { try { return JSON.parse(raw.slice(start, cursor)) as string; } catch { return fail(); } }
      if (char === '\\') cursor++;
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    if (depth > 64) return fail();
    whitespace(); const char = raw[cursor];
    if (char === '"') return string();
    if (char === '{') {
      cursor++; whitespace(); const object: Record<string, unknown> = {}, keys = new Set<string>();
      if (raw[cursor] === '}') { cursor++; return object; }
      for (;;) {
        whitespace(); if (raw[cursor] !== '"') return fail(); const key = string();
        if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return fail();
        keys.add(key); whitespace(); if (raw[cursor++] !== ':') return fail(); object[key] = value(depth + 1); whitespace();
        const delimiter = raw[cursor++]; if (delimiter === '}') return object; if (delimiter !== ',') return fail();
      }
    }
    if (char === '[') {
      cursor++; whitespace(); const array: unknown[] = [];
      if (raw[cursor] === ']') { cursor++; return array; }
      for (;;) { array.push(value(depth + 1)); whitespace(); const delimiter = raw[cursor++]; if (delimiter === ']') return array; if (delimiter !== ',') return fail(); }
    }
    for (const [token, parsed] of [['true', true], ['false', false], ['null', null]] as const) if (raw.startsWith(token, cursor)) { cursor += token.length; return parsed; }
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(raw.slice(cursor)); if (!match) return fail(); cursor += match[0].length;
    if (/[.eE]/.test(raw[cursor] ?? '\0')) return fail(); const number = Number(match[0]); if (!Number.isSafeInteger(number)) return fail(); return number;
  };
  const parsed = value(0); whitespace(); if (cursor !== raw.length) return fail(); return parsed;
}
