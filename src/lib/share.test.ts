import { describe, expect, it } from 'vitest';
import { parseInvite } from './share';

const SLUG = 'a1b2c3d4e5f60718';

describe('parseInvite', () => {
  it('accepts a bare slug, with or without surrounding whitespace', () => {
    expect(parseInvite(SLUG)).toBe(SLUG);
    expect(parseInvite(`  ${SLUG}\n`)).toBe(SLUG);
  });

  it('accepts a production invite URL', () => {
    expect(parseInvite(`https://bmeetze.github.io/grouptab/t/${SLUG}`)).toBe(SLUG);
  });

  it('accepts a URL pasted without a scheme', () => {
    expect(parseInvite(`bmeetze.github.io/grouptab/t/${SLUG}`)).toBe(SLUG);
  });

  it('accepts any origin, including localhost', () => {
    expect(parseInvite(`http://localhost:5173/grouptab/t/${SLUG}`)).toBe(SLUG);
  });

  it('ignores query strings and fragments', () => {
    expect(parseInvite(`https://bmeetze.github.io/grouptab/t/${SLUG}?utm_source=chat`)).toBe(SLUG);
    expect(parseInvite(`https://bmeetze.github.io/grouptab/t/${SLUG}#top`)).toBe(SLUG);
  });

  it('accepts a deep link to a screen inside the trip', () => {
    expect(parseInvite(`https://bmeetze.github.io/grouptab/t/${SLUG}/settle`)).toBe(SLUG);
    expect(parseInvite(`https://bmeetze.github.io/grouptab/t/${SLUG}/e/abc`)).toBe(SLUG);
  });

  it('rejects uppercase hex', () => {
    expect(parseInvite(SLUG.toUpperCase())).toBeNull();
  });

  it('rejects slugs of the wrong length', () => {
    expect(parseInvite('a1b2c3d4e5f6071')).toBeNull();   // 15
    expect(parseInvite('a1b2c3d4e5f60718a')).toBeNull(); // 17
    expect(parseInvite(`https://bmeetze.github.io/grouptab/t/a1b2c3d4e5f6071`)).toBeNull();
  });

  it('rejects non-hex characters', () => {
    expect(parseInvite('z1b2c3d4e5f60718')).toBeNull();
  });

  it('rejects unrelated input', () => {
    expect(parseInvite('')).toBeNull();
    expect(parseInvite('   ')).toBeNull();
    expect(parseInvite('https://example.com/hello')).toBeNull();
    expect(parseInvite('what is this')).toBeNull();
    expect(parseInvite('https://bmeetze.github.io/grouptab/')).toBeNull();
  });
});
