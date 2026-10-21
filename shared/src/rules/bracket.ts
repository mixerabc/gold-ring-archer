/**
 * Single-elimination bracket generator.
 *
 * Used for the elimination stage that follows the ranking round: the ranking
 * seeds the bracket (1 v 16, 8 v 9, ... in the standard order), winners
 * propagate to the next round, and the two beaten semi-finalists meet in the
 * bronze-medal match.
 *
 * Everything here is pure and deterministic: the same seeds always produce the
 * same bracket, which lets the client and the server agree on the draw without
 * exchanging the whole tree.
 */

import type { ArcherMatchScore, EndResult } from '../types';

export interface Player {
  id: string;
  name: string;
  seed: number;
}

export interface Match {
  id: string;
  number: number;
  /** 1-based position inside the round. */
  position: number;
  /** 0 = first round (round of 16 for 16 archers), increasing towards the final. */
  round: number;
  players: [Player | null, Player | null];
  winner: Player | null;
  loser: Player | null;
  /** Bracket-style score: "6-2" for sets or "148-145" for cumulative. */
  score: string;
  /** The archer scores per end (for cumulative formats) or set records (set system). */
  history: EndResult[] | unknown[];
  /** Match id the winner advances to (null for the final and the bronze match). */
  nextMatchId: string | null;
  /** True for the bronze-medal match. */
  bronze: boolean;
}

/**
 * Standard bracket slot order for a power-of-two field.
 *
 * For 8: [1, 8, 4, 5, 2, 7, 3, 6] — seed 1 meets 8, 4 meets 5, and the top
 * half of the draw contains 1 and 4, exactly as printed brackets do.
 */
export function seedOrder(size: number): number[] {
  const rounds = Math.round(Math.log2(size));
  let order = [1];
  for (let r = 0; r < rounds; r++) {
    const nextSize = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, nextSize + 1 - seed);
    }
    order = next;
  }
  return order;
}

/**
 * Build a single-elimination bracket with a separate bronze-medal match.
 *
 * @param seeds ordered list of players (seed 1 = first place). The field is
 *   padded to the next power of two; missing players become byes that advance
 *   their opponent automatically.
 */
export function buildBracket(seeds: Player[]): Match[] {
  const n = seeds.length;
  if (n < 2) return [];

  const size = 2 ** Math.ceil(Math.log2(n));
  const order = seedOrder(size);
  const slots: (Player | null)[] = order.map((seedNumber) => seeds[seedNumber - 1] ?? null);

  const roundCount = Math.round(Math.log2(size));
  const matches: Match[] = [];
  const rounds: Match[][] = [];

  let nextNumber = 1;
  for (let round = 0; round < roundCount; round++) {
    const matchesInRound = size / 2 ** (round + 1);
    const roundMatches: Match[] = [];
    for (let position = 1; position <= matchesInRound; position++) {
      roundMatches.push({
        id: `m-${nextNumber}`,
        number: nextNumber,
        position,
        round,
        players: [null, null],
        winner: null,
        loser: null,
        score: '',
        history: [],
        nextMatchId: null,
        bronze: false,
      });
      nextNumber++;
    }
    rounds.push(roundMatches);
    matches.push(...roundMatches);
  }

  // Link each match to the one its winner advances to.
  for (let round = 0; round < rounds.length - 1; round++) {
    for (const match of rounds[round]) {
      const target = rounds[round + 1][Math.floor((match.position - 1) / 2)];
      match.nextMatchId = target.id;
    }
  }

  // Fill the first round from the seeded slots.
  for (let i = 0; i < rounds[0].length; i++) {
    rounds[0][i].players = [slots[i * 2], slots[i * 2 + 1]];
  }

  // Resolve byes: a match with exactly one player advances that player without
  // shooting. Iterate because a bye can cascade through several rounds.
  for (let round = 0; round < rounds.length; round++) {
    for (const match of rounds[round]) {
      const [a, b] = match.players;
      if (a && !b) advance(match, a, 'bye');
      else if (!a && b) advance(match, b, 'bye');
      else if (!a && !b) {
        match.score = 'bye';
      }
    }
  }

  // Bronze match: the two beaten semi-finalists (or the two beaten finalists if
  // the field is tiny). It is always the last entry in the returned array.
  const semis = rounds[Math.max(0, rounds.length - 2)] ?? [];
  const bronzePlayers: [Player | null, Player | null] =
    semis.length >= 2
      ? [semis[0].loser, semis[1].loser]
      : [rounds[0][0]?.loser ?? null, rounds[0][1]?.loser ?? null];

  matches.push({
    id: `m-${nextNumber}`,
    number: nextNumber,
    position: 1,
    round: roundCount,
    players: bronzePlayers,
    winner: null,
    loser: null,
    score: '',
    history: [],
    nextMatchId: null,
    bronze: true,
  });

  return matches;
}

function advance(match: Match, winner: Player, score: string): void {
  match.winner = winner;
  match.score = score;
}

/** All matches in one round, in bracket order. */
export function matchesInRound(matches: Match[], round: number): Match[] {
  return matches.filter((m) => m.round === round && !m.bronze).sort((a, b) => a.position - b.position);
}

/** Number of rounds excluding the bronze match. */
export function bracketRounds(matches: Match[]): number {
  const competitive = matches.filter((m) => !m.bronze);
  if (competitive.length === 0) return 0;
  return Math.max(...competitive.map((m) => m.round)) + 1;
}

export interface MatchResult {
  winnerId: string;
  score: string;
  history?: EndResult[] | unknown[];
}

/**
 * Record a played match and push the winner into the next round.
 *
 * Returns the matches that changed (useful for a bracket animation).
 */
export function recordMatchResult(matches: Match[], matchId: string, result: MatchResult): Match[] {
  const match = matches.find((m) => m.id === matchId);
  if (!match) return [];
  const winner = match.players.find((p) => p?.id === result.winnerId) ?? null;
  if (!winner) return [];

  const changed: Match[] = [match];
  match.winner = winner;
  match.loser = match.players.find((p) => p && p.id !== winner.id) ?? null;
  match.score = result.score;
  if (result.history) match.history = result.history;

  if (match.nextMatchId) {
    const next = matches.find((m) => m.id === match.nextMatchId);
    if (next) {
      const slot = match.position % 2 === 1 ? 0 : 1;
      next.players[slot] = winner;
      changed.push(next);
      // Do NOT auto-advance a lone player here: the other slot may simply be
      // waiting for a match that has not been played yet (for example the
      // player's own quarter-final). First-round byes are resolved when the
      // bracket is built.
    }
  }

  // The two beaten semi-finalists meet in the bronze-medal match.
  const competitive = matches.filter((m) => !m.bronze);
  const lastRound = competitive.length ? Math.max(...competitive.map((m) => m.round)) : 0;
  if (match.round === lastRound - 1) {
    const bronze = matches.find((m) => m.bronze);
    if (bronze) {
      const slot = match.position % 2 === 1 ? 0 : 1;
      bronze.players[slot] = match.loser;
      changed.push(bronze);
    }
  }

  if (match.bronze) {
    // Nothing to propagate.
  }

  return changed;
}

/** Convenience: the final match (the last non-bronze match). */
export function finalMatch(matches: Match[]): Match | undefined {
  return matches.filter((m) => !m.bronze).sort((a, b) => b.round - a.round)[0];
}

export function bronzeMatch(matches: Match[]): Match | undefined {
  return matches.find((m) => m.bronze);
}

/**
 * Fill in bracket scores from an array of end results per archer.
 *
 * Kept for the results screen: it does not decide winners (that is
 * `recordMatchResult`), it only attaches the per-end history for display.
 */
export function fillBracket(
  matches: Match[],
  results: { player: Player; ends: EndResult[]; total: number }[],
): void {
  for (const match of matches) {
    const [left, right] = match.players;
    if (!left || !right) continue;
    const lr = results.find((r) => r.player.id === left.id);
    const rr = results.find((r) => r.player.id === right.id);
    match.history = [...(lr?.ends ?? []), ...(rr?.ends ?? [])];
  }
}

/** Team match scoring helper (mixed team / team events, later stage). */
export function teamTotal(archers: ArcherMatchScore[]): number {
  return archers.reduce((sum, a) => sum + a.total, 0);
}
