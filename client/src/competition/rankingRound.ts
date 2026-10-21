/**
 * Ranking round (72 arrows, 12 ends of 6).
 *
 * A thin stateful wrapper around the shared rules: it counts arrows, closes
 * ends, and produces the totals that seed the elimination bracket. The values
 * (72 arrows, 6 per end) come from `worldArchery.json`, never from constants in
 * this file.
 */

import { getFormat } from '@shared/rules/index';
import { sumEnd } from '@shared/rules/scoring';
import type { ArrowScore, EndResult, RankingEntryLike, ScoredArrow } from './types';
import { seedRanking } from '@shared/rules/formats';

export interface RankingSnapshot {
  ends: EndResult[];
  total: number;
  xCount: number;
  tenCount: number;
  arrowsShot: number;
  arrowsRemaining: number;
  currentEnd: number;
  currentArrow: number;
  complete: boolean;
}

export class RankingRound {
  readonly formatId: string;
  readonly arrowsPerEnd: number;
  readonly totalEnds: number;
  readonly maxArrows: number;

  readonly ends: EndResult[] = [];
  private current: ScoredArrow[] = [];
  private arrowIndex = 0;

  constructor(formatId = 'rankingRound') {
    const format = getFormat(formatId);
    this.formatId = formatId;
    this.arrowsPerEnd = format.arrowsPerEnd;
    this.totalEnds = format.ends;
    this.maxArrows = format.maxArrows ?? format.ends * format.arrowsPerEnd;
  }

  get arrowsShot(): number {
    return this.ends.length * this.arrowsPerEnd + this.current.length;
  }

  get arrowsRemaining(): number {
    return Math.max(0, this.maxArrows - this.arrowsShot);
  }

  get currentEnd(): number {
    return this.ends.length + 1;
  }

  get currentArrow(): number {
    return this.current.length + 1;
  }

  get complete(): boolean {
    return this.arrowsShot >= this.maxArrows;
  }

  get endTotal(): number {
    return this.current.reduce((sum, a) => sum + a.value, 0);
  }

  get total(): number {
    return this.ends.reduce((sum, e) => sum + e.total, 0) + this.endTotal;
  }

  get xCount(): number {
    return this.ends.reduce((sum, e) => sum + e.xCount, 0) + this.current.filter((a) => a.isX).length;
  }

  get tenCount(): number {
    return this.ends.reduce((sum, e) => sum + e.arrows.filter((a) => a.value === 10).length, 0) +
      this.current.filter((a) => a.value === 10).length;
  }

  /**
   * Record one arrow. Returns the completed end when the sixth arrow goes in,
   * otherwise null.
   */
  addArrow(score: ArrowScore): EndResult | null {
    if (this.complete) return null;
    const arrow: ScoredArrow = {
      ...score,
      index: this.arrowIndex++,
      impact: { x: 0, y: 0 },
    };
    this.current.push(arrow);
    if (this.current.length >= this.arrowsPerEnd) {
      const end = this.closeEnd();
      return end;
    }
    return null;
  }

  /** Attach the real impact to the last arrow (used by the heat map). */
  setLastImpact(x: number, y: number): void {
    const last = this.current[this.current.length - 1];
    if (last) last.impact = { x, y };
  }

  private closeEnd(): EndResult {
    const totals = sumEnd(this.current);
    const end: EndResult = {
      index: this.ends.length + 1,
      arrows: this.current.slice(),
      total: totals.total,
      xCount: totals.xCount,
    };
    this.ends.push(end);
    this.current = [];
    return end;
  }

  /** Abandon the current end (end of a session). */
  flushPartialEnd(): void {
    if (this.current.length > 0) this.closeEnd();
  }

  snapshot(): RankingSnapshot {
    return {
      ends: this.ends.slice(),
      total: this.total,
      xCount: this.xCount,
      tenCount: this.tenCount,
      arrowsShot: this.arrowsShot,
      arrowsRemaining: this.arrowsRemaining,
      currentEnd: Math.min(this.totalEnds, this.currentEnd),
      currentArrow: this.currentArrow,
      complete: this.complete,
    };
  }

  toEntry(archerId: string, name: string): RankingEntryLike {
    return {
      archerId,
      name,
      total: this.total,
      xCount: this.xCount,
      tenCount: this.tenCount,
      arrowsShot: this.arrowsShot,
      ends: this.ends.map((e) => e.total),
    };
  }

  /** End totals, for the scoreboard and the results table. */
  endTotals(): number[] {
    return this.ends.map((e) => e.total);
  }
}

/** Seed a list of completed ranking rounds exactly like World Archery does. */
export function seedFromRounds(entries: RankingEntryLike[]): RankingEntryLike[] {
  return seedRanking(entries) as RankingEntryLike[];
}
