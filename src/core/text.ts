export interface Char {
  ch: string;
  hl: boolean;
}

export interface Line {
  /** Size steps from the line prefix: each `^` is +1, each `~` is -1. */
  step: number;
  chars: Char[];
}

export type TextCase = 'as-typed' | 'upper' | 'sentence' | 'lower';

/**
 * Markup:
 *   *word*      highlight (can span lines)
 *   ^ / ~       at the start of a line: one size step bigger / smaller (stackable)
 *   \* \^ \~    literal characters
 */
export function parseText(src: string): Line[] {
  const lines: Line[] = [];
  let hl = false;
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const cps = Array.from(raw);
    let i = 0;
    let step = 0;
    while (i < cps.length && (cps[i] === '^' || cps[i] === '~')) {
      step += cps[i] === '^' ? 1 : -1;
      i++;
    }
    const chars: Char[] = [];
    for (; i < cps.length; i++) {
      const c = cps[i];
      if (c === '\\' && i + 1 < cps.length) {
        chars.push({ ch: cps[++i], hl });
      } else if (c === '*') {
        hl = !hl;
      } else if (c === '\t') {
        chars.push({ ch: ' ', hl });
      } else {
        chars.push({ ch: c, hl });
      }
    }
    lines.push({ step, chars });
  }
  return lines;
}

const LETTER = /\p{L}/u;
const SENTENCE_END = new Set(['.', '!', '?']);

export function applyCase(lines: Line[], mode: TextCase): Line[] {
  if (mode === 'as-typed') return lines;

  const expand = (line: Line, fn: (c: Char, idx: number) => string): Line => ({
    step: line.step,
    chars: line.chars.flatMap((c, idx) => Array.from(fn(c, idx)).map((ch) => ({ ch, hl: c.hl }))),
  });

  if (mode === 'upper') return lines.map((l) => expand(l, (c) => c.ch.toUpperCase()));
  if (mode === 'lower') return lines.map((l) => expand(l, (c) => c.ch.toLowerCase()));

  // Sentence case: capitalize the first letter of the text and after . ! ?
  // (across line breaks); everything else lowercase, except a standalone "I".
  let capNext = true;
  return lines.map((line) =>
    expand(line, (c, idx) => {
      const ch = c.ch;
      if (LETTER.test(ch)) {
        let out = capNext ? ch.toUpperCase() : ch.toLowerCase();
        capNext = false;
        if (out === 'i') {
          const prev = line.chars[idx - 1]?.ch ?? ' ';
          const next = line.chars[idx + 1]?.ch ?? ' ';
          if (!LETTER.test(prev) && !LETTER.test(next)) out = 'I';
        }
        return out;
      }
      if (SENTENCE_END.has(ch)) capNext = true;
      return ch;
    }),
  );
}
