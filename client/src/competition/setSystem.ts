/**
 * Match play: the set system (recurve/barebow) and cumulative scoring
 * (compound), both driven by the shared rule functions so the client and the
 * server can never disagree about who is ahead.
 */

import { applyCumulativeEnd, applySet, createCumulative, createSetSystem, type CumulativeState, type SetSystemState } from '@shared/rules/formats';
import { sumEnd } from '@shared/rules/scoring';
import { getDefaultMatchFormat, getFormat } from '@shared/rules/index';
import type { ArrowScore, BowClass, EndResult } from './types';

export interface MatchEndRecord {
  index: number;
  mine: number;
  theirs: number;
  myX: number;
  theirX: number;
  myArrows: ArrowScore[];
  theirArrows: ArrowScore[];
  points?: [number, number];
}

export class MatchPlay {
  readonly bowClass: BowClass;
  readonly formatId: string;
  readonly style: 'setSystem' | 'cumulative';
  readonly arrowsPerEnd: number;
  readonly endsPlanned: number;

  setState: SetSystemState;
  cumulativeState: CumulativeState;
  readonly records: MatchEndRecord[] = [];

  constructor(bowClass: BowClass, formatId?: string) {
    this.bowClass = bowClass;
    const resolved = formatId ? getFormat(formatId) : getDefaultMatchFormat(bowClass);
    this.formatId = resolved.id;
    this.style = resolved.scoringStyle;
    this.arrowsPerEnd = resolved.arrowsPerEnd;
    this.endsPlanned = resolved.ends;
    this.setState = createSetSystem(this.formatId);
    this.cumulativeState = createCumulative(this.formatId);
  }

  get mySets(): number {
    return this.setState.points[0];
  }

  get theirSets(): number {
    return this.setState.points[1];
  }

  get myTotal(): number {
    return this.records.reduce((sum, r) => sum + r.mine, 0);
  }

  get theirTotal(): number {
    return this.records.reduce((sum, r) => sum + r.theirs, 0);
  }

  get myX(): number {
    return this.records.reduce((sum, r) => sum + r.myX, 0);
  }

  get theirX(): number {
    return this.records.reduce((sum, r) => sum + r.theirX, 0);
  }

  get finished(): boolean {
    return this.style === 'setSystem' ? this.setState.finished : this.cumulativeState.finished;
  }

  get needsShootOff(): boolean {
    return this.style === 'setSystem' ? this.setState.needsShootOff : this.cumulativeState.needsShootOff;
  }

  /** 0 = player, 1 = opponent, null = undecided. */
  get winner(): 0 | 1 | null {
    return this.style === 'setSystem' ? this.setState.winner : this.cumulativeState.winner;
  }

  get currentEnd(): number {
    return this.records.length + 1;
  }

  /**
   * Record a completed end (both archers have shot).
   */
  recordEnd(myArrows: ArrowScore[], theirArrows: ArrowScore[]): MatchEndRecord {
    const mine = sumEnd(myArrows);
    const theirs = sumEnd(theirArrows);
    const record: MatchEndRecord = {
      index: this.records.length + 1,
      mine: mine.total,
      theirs: theirs.total,
      myX: mine.xCount,
      theirX: theirs.xCount,
      myArrows: myArrows.slice(),
      theirArrows: theirArrows.slice(),
    };

    if (this.style === 'setSystem') {
      const next = applySet(this.setState, [mine.total, theirs.total], [mine.xCount, theirs.xCount]);
      this.setState = next;
      record.points = next.sets[next.sets.length - 1]?.points ?? [0, 0];
    } else {
      this.cumulativeState = applyCumulativeEnd(this.cumulativeState, [mine.total, theirs.total], [mine.xCount, theirs.xCount]);
    }

    this.records.push(record);
    return record;
  }

  /** Scoreboard view model. */
  summary(): {
    style: 'setSystem' | 'cumulative';
    mine: { total: number; sets: number; x: number };
    theirs: { total: number; sets: number; x: number };
    ends: number[];
    theirEnds: number[];
    setPoints: number[];
    theirSetPoints: number[];
    currentEnd: number;
    finished: boolean;
  } {
    return {
      style: this.style,
      mine: { total: this.myTotal, sets: this.mySets, x: this.myX },
      theirs: { total: this.theirTotal, sets: this.theirSets, x: this.theirX },
      ends: this.records.map((r) => r.mine),
      theirEnds: this.records.map((r) => r.theirs),
      setPoints: this.setState.sets.map((s) => s.points[0]),
      theirSetPoints: this.setState.sets.map((s) => s.points[1]),
      currentEnd: this.currentEnd,
      finished: this.finished,
    };
  }
}

/** End totals from a list of scored arrows, for the results table. */
export function endFromArrows(index: number, arrows: ArrowScore[]): EndResult {
  const totals = sumEnd(arrows);
  return {
    index,
    arrows: arrows.map((a, i) => ({ ...a, index: i, impact: { x: 0, y: 0 } })),
    total: totals.total,
    xCount: totals.xCount,
  };
}
