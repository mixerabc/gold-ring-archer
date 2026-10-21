/**
 * Bracket tests: seeding order, byes, propagation and the bronze match.
 */

import { describe, expect, it } from 'vitest';
import { bronzeMatch, buildBracket, finalMatch, matchesInRound, recordMatchResult, seedOrder, type Player } from './rules/bracket';

function field(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Archer ${i + 1}`, seed: i + 1 }));
}

describe('bracket', () => {
  it('uses standard seeding order', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('pairs 1v8, 4v5, 2v7, 3v6 in the first round', () => {
    const matches = buildBracket(field(8));
    const first = matchesInRound(matches, 0);
    expect(first).toHaveLength(4);
    expect(first[0].players.map((p) => p?.seed)).toEqual([1, 8]);
    expect(first[1].players.map((p) => p?.seed)).toEqual([4, 5]);
    expect(first[2].players.map((p) => p?.seed)).toEqual([2, 7]);
    expect(first[3].players.map((p) => p?.seed)).toEqual([3, 6]);
  });

  it('creates a bronze match in addition to the final', () => {
    const matches = buildBracket(field(8));
    expect(matches.filter((m) => m.bronze)).toHaveLength(1);
    expect(finalMatch(matches)?.round).toBe(2);
  });

  it('gives byes to the top seeds', () => {
    const matches = buildBracket(field(6));
    const first = matchesInRound(matches, 0);
    // Seeds 1 and 2 get a bye in a six-player field padded to eight.
    expect(first[0].winner?.seed).toBe(1);
    expect(first[2].winner?.seed).toBe(2);
  });

  it('advances winners and fills the bronze match from the semi-final losers', () => {
    let matches = buildBracket(field(8));
    const first = matchesInRound(matches, 0);
    for (const match of first) {
      const [a, b] = match.players;
      recordMatchResult(matches, match.id, { winnerId: a!.id, score: '6-2' });
    }
    const semis = matchesInRound(matches, 1);
    expect(semis).toHaveLength(2);
    for (const match of semis) {
      recordMatchResult(matches, match.id, { winnerId: match.players[0]!.id, score: '6-4' });
    }
    const bronze = bronzeMatch(matches);
    expect(bronze?.players[0]).toBeTruthy();
    expect(bronze?.players[1]).toBeTruthy();
    const final = finalMatch(matches);
    expect(final?.players.every(Boolean)).toBe(true);
  });

  it('produces a champion after the final', () => {
    let matches = buildBracket(field(4));
    for (const match of matchesInRound(matches, 0)) {
      recordMatchResult(matches, match.id, { winnerId: match.players[0]!.id, score: '6-0' });
    }
    const final = finalMatch(matches)!;
    recordMatchResult(matches, final.id, { winnerId: final.players[0]!.id, score: '6-2' });
    expect(finalMatch(matches)?.winner).toBeTruthy();
  });
});
