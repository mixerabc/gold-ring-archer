/**
 * Tournament bracket.
 *
 * The bracket structure comes from `shared/rules/bracket.ts`; this layer only
 * plays the matches the player is not in (AI v AI, resolved from the archers'
 * skill with a seeded variance) and advances the player's results.
 */

import { buildBracket, finalMatch, matchesInRound, recordMatchResult, type Match, type Player } from '@shared/rules/bracket';
import { mulberry32, hashSeed } from '@shared/math/random';
import type { ArcherProfile } from './types';

export interface TournamentResult {
  champion: ArcherProfile | null;
  runnerUp: ArcherProfile | null;
  bronze: ArcherProfile | null;
}

export class Tournament {
  readonly matches: Match[];
  readonly profiles: Map<string, ArcherProfile>;
  readonly rounds: number;

  constructor(profiles: ArcherProfile[], seed = 20261021) {
    this.profiles = new Map(profiles.map((p) => [p.id, p]));
    const players: Player[] = profiles.map((p, i) => ({ id: p.id, name: p.name, seed: i + 1 }));
    this.matches = buildBracket(players);
    this.rounds = Math.max(1, Math.ceil(Math.log2(profiles.length)));
    this.seed = seed;
  }

  private seed: number;

  get currentRound(): number {
    const open = this.matches.filter((m) => !m.bronze && !m.winner);
    if (open.length === 0) return this.rounds;
    return Math.min(...open.map((m) => m.round));
  }

  get playerMatch(): Match | null {
    return (
      this.matches.find(
        (m) => !m.winner && !m.bronze && m.players.some((p) => p?.id === 'player'),
      ) ?? null
    );
  }

  get finished(): boolean {
    const final = finalMatch(this.matches);
    return Boolean(final?.winner);
  }

  /** Play every AI-vs-AI match in the current round. */
  simulateRound(): Match[] {
    const round = this.currentRound;
    const changed: Match[] = [];
    for (const match of matchesInRound(this.matches, round)) {
      if (match.winner) continue;
      const [a, b] = match.players;
      if (!a || !b) continue;
      if (a.id === 'player' || b.id === 'player') continue;
      changed.push(...this.playAIMatch(match));
    }
    return changed;
  }

  private playAIMatch(match: Match): Match[] {
    const [a, b] = match.players as [Player, Player];
    const pa = this.profiles.get(a.id);
    const pb = this.profiles.get(b.id);
    if (!pa || !pb) return [];
    const rand = mulberry32(hashSeed(`${match.id}|${a.id}|${b.id}|${this.seed}`));
    const formA = pa.skill + (rand() - 0.5) * 0.22 + pa.clutch * 0.04;
    const formB = pb.skill + (rand() - 0.5) * 0.22 + pb.clutch * 0.04;
    const winner = formA >= formB ? a : b;
    const loser = winner === a ? b : a;
    const winnerProfile = this.profiles.get(winner.id)!;
    const loserProfile = this.profiles.get(loser.id)!;
    // Plausible set/cumulative score line from the skill gap.
    const gap = Math.abs(formA - formB);
    const scoreline =
      gap > 0.14 ? '6-0' : gap > 0.08 ? '6-2' : gap > 0.03 ? '6-4' : '7-5';
    void winnerProfile;
    void loserProfile;
    return recordMatchResult(this.matches, match.id, {
      winnerId: winner.id,
      score: scoreline,
    });
  }

  /** Record the player's own match and advance the bracket. */
  recordPlayerMatch(won: boolean, score: string): Match[] {
    const match = this.playerMatch;
    if (!match) return [];
    const me = match.players.find((p) => p?.id === 'player');
    const opponent = match.players.find((p) => p && p.id !== 'player');
    if (!me || !opponent) return [];
    return recordMatchResult(this.matches, match.id, {
      winnerId: won ? me.id : opponent.id,
      score,
    });
  }

  /** Bronze match (only meaningful once the semi-finals are done). */
  get bronzeMatch(): Match | null {
    return this.matches.find((m) => m.bronze && !m.winner) ?? null;
  }

  recordBronze(winnerId: string, score: string): Match[] {
    const bronze = this.matches.find((m) => m.bronze);
    if (!bronze || !bronze.players.some((p) => p?.id === winnerId)) return [];
    return recordMatchResult(this.matches, bronze.id, { winnerId, score });
  }

  /**
   * Play the bronze match when neither semi-final loser is the player, so the
   * medal ceremony always has a third place. Seeded by the two archers' skill.
   */
  simulateBronze(): Match[] {
    const bronze = this.matches.find((m) => m.bronze);
    if (!bronze || bronze.winner) return [];
    const [a, b] = bronze.players;
    if (!a || !b) return [];
    const pa = this.profiles.get(a.id);
    const pb = this.profiles.get(b.id);
    const rand = mulberry32(hashSeed(`bronze|${a.id}|${b.id}|${this.seed}`));
    const formA = (pa?.skill ?? 0.5) + (rand() - 0.5) * 0.2;
    const formB = (pb?.skill ?? 0.5) + (rand() - 0.5) * 0.2;
    const winner = formA >= formB ? a : b;
    const gap = Math.abs(formA - formB);
    return recordMatchResult(this.matches, bronze.id, {
      winnerId: winner.id,
      score: gap > 0.1 ? '6-2' : '6-4',
    });
  }

  result(): TournamentResult {
    const final = finalMatch(this.matches);
    const bronze = this.matches.find((m) => m.bronze);
    const champion = final?.winner ? this.profiles.get(final.winner.id) ?? null : null;
    const runnerUp = final?.loser ? this.profiles.get(final.loser.id) ?? null : null;
    const bronzeWinner = bronze?.winner ? this.profiles.get(bronze.winner.id) ?? null : null;
    return { champion, runnerUp, bronze: bronzeWinner };
  }

  /** Rounds for the bracket screen. */
  bracketView(): Array<{ title: string; matches: Match[] }> {
    const rounds: Array<{ title: string; matches: Match[] }> = [];
    const total = this.rounds;
    for (let round = 0; round < total; round++) {
      const remaining = Math.pow(2, total - round);
      rounds.push({
        title: remaining === 2 ? 'Final' : remaining === 4 ? 'Semi-finals' : remaining === 8 ? 'Quarter-finals' : `Round of ${remaining}`,
        matches: matchesInRound(this.matches, round),
      });
    }
    const bronze = this.matches.find((m) => m.bronze);
    if (bronze) rounds.push({ title: 'Bronze medal', matches: [bronze] });
    return rounds;
  }
}
