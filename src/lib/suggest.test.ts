import { describe, expect, it } from 'vitest';
import { suggestDescriptions } from './suggest';

const ex = (id: string, description: string) => ({ id, description });

// Newest-first, matching fetchTripData's created_at desc ordering.
const feed = [
  ex('e5', 'Gas'),
  ex('e4', 'Groceries'),
  ex('e3', 'Dinner'),
  ex('e2', 'Groceries'),
  ex('e1', 'Grocery run'),
];

describe('suggestDescriptions', () => {
  it('returns nothing for an empty or whitespace draft', () => {
    expect(suggestDescriptions(feed, '')).toEqual([]);
    expect(suggestDescriptions(feed, '   ')).toEqual([]);
  });

  it('matches on prefix, case-insensitively', () => {
    expect(suggestDescriptions(feed, 'gro')).toEqual(['Groceries', 'Grocery run']);
    expect(suggestDescriptions(feed, 'GRO')).toEqual(['Groceries', 'Grocery run']);
  });

  it('de-duplicates and keeps the most recent occurrence first', () => {
    // 'Groceries' appears at e4 and e2; it should appear once, ahead of the
    // older 'Grocery run'.
    expect(suggestDescriptions(feed, 'g')).toEqual(['Gas', 'Groceries', 'Grocery run']);
  });

  it('ranks prefix matches ahead of substring matches', () => {
    const list = [ex('a', 'Bar tab'), ex('b', 'Tab at the pub')];
    expect(suggestDescriptions(list, 'tab')).toEqual(['Tab at the pub', 'Bar tab']);
  });

  it('drops a description identical to the draft', () => {
    expect(suggestDescriptions(feed, 'Dinner')).toEqual([]);
    expect(suggestDescriptions(feed, 'dinner')).toEqual([]);
  });

  it('still suggests longer matches when the draft exactly equals a shorter one', () => {
    expect(suggestDescriptions(feed, 'Groceries')).toEqual([]);
    expect(suggestDescriptions(feed, 'Grocer')).toEqual(['Groceries', 'Grocery run']);
  });

  it('excludes the expense being edited', () => {
    // e1 is the only 'Grocery run', so excluding it removes the suggestion...
    expect(suggestDescriptions(feed, 'gro', 'e1')).toEqual(['Groceries']);
    // ...but 'Groceries' survives excluding e4 because e2 says it too: the
    // exclusion is per-expense, not per-description.
    expect(suggestDescriptions(feed, 'gro', 'e4')).toEqual(['Groceries', 'Grocery run']);
  });

  it('caps the list at four', () => {
    const many = ['Taxi 1', 'Taxi 2', 'Taxi 3', 'Taxi 4', 'Taxi 5', 'Taxi 6']
      .map((d, i) => ex(`x${i}`, d));
    expect(suggestDescriptions(many, 'taxi')).toEqual(['Taxi 1', 'Taxi 2', 'Taxi 3', 'Taxi 4']);
  });

  it('ignores blank descriptions and handles an empty feed', () => {
    expect(suggestDescriptions([ex('a', '   ')], 'a')).toEqual([]);
    expect(suggestDescriptions([], 'anything')).toEqual([]);
  });

  it('trims the draft before matching', () => {
    expect(suggestDescriptions(feed, '  din  ')).toEqual(['Dinner']);
  });
});
