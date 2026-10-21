/**
 * Match manager.
 *
 * One object owns the competitive flow: the clock, the end, the arrows, the
 * opponent, the set/cumulative state and the shoot-off. The 3D game calls into
 * it when an arrow lands and reads the summary for the scoreboard, so the
 * rules are never re-implemented in the render loop.
 */

import { EndClock, endClockConfig, type EndClockConfig, type SignalState } from '@shared/rules/timing';
import { getClassRules } from '@shared/rules/index';
import { clamp } from '@shared/math/random';
import type { ArrowScore, BowClass, Difficulty, ScoredArrow, WindFieldConfig } from '@shared/types';
import type { GameMode } from '../state/store';
import { AIOpponent } from '../ai/archerAI';
import { RankingRound } from './rankingRound';
import { MatchPlay } from './setSystem';
import { ShootOff } from './shootOff';

export interface EndSummary {
  endNumber: number;
  myArrows: ScoredArrow[];
  theirArrows: ScoredArrow[];
  myTotal: number;
  theirTotal: number;
  mySetPoints: number;
  theirSetPoints: number;
  finished: boolean;
  needsShootOff: boolean;
  message: string;
}

export interface MatchManagerOptions {
  mode: GameMode;
  bowClass: BowClass;
  distanceM: number;
  wind: WindFieldConfig;
  difficulty: Difficulty;
  opponentName?: string;
  seed?: number;
}

export class MatchManager {
  readonly mode: GameMode;
  readonly bowClass: BowClass;
  readonly distanceM: number;
  readonly wind: WindFieldConfig;
  readonly difficulty: Difficulty;
  readonly opponent: AIOpponent | null;
  readonly ranking: RankingRound | null;
  readonly match: MatchPlay | null;
  shootOff: ShootOff | null = null;

  clock: EndClock;
  readonly arrowsPerEnd: number;

  /** Arrows in the current end (cleared when the end closes). */
  myEndArrows: ScoredArrow[] = [];
  theirEndArrows: ScoredArrow[] = [];

  /** True when the last arrow was shot outside the time limit. */
  timingViolation = false;
  /** Set when the player must shoot a single arrow to break a tie. */
  inShootOff = false;

  private endIndex = 0;
  private listeners = new Map<string, Array<(payload?: unknown) => void>>();

  constructor(options: MatchManagerOptions) {
    this.mode = options.mode;
    this.bowClass = options.bowClass;
    this.distanceM = options.distanceM;
    this.wind = options.wind;
    this.difficulty = options.difficulty;

    const cls = getClassRules(options.bowClass);

    this.ranking = options.mode === 'ranking' ? new RankingRound('rankingRound') : null;
    this.match =
      options.mode === 'match' || options.mode === 'tournament'
        ? new MatchPlay(options.bowClass)
        : null;

    this.arrowsPerEnd = this.ranking ? cls.arrowsPerEnd : this.match ? this.match.arrowsPerEnd : 3;

    this.opponent =
      this.match !== null
        ? new AIOpponent({
            bowClass: options.bowClass,
            distanceM: options.distanceM,
            wind: options.wind,
            difficulty: options.difficulty,
            seed: options.seed ?? 11,
            name: options.opponentName,
          })
        : null;

    this.clock = new EndClock(this.clockConfig());
  }

  private clockConfig(): EndClockConfig {
    const flow = this.mode === 'ranking' ? 'ranking' : this.mode === 'practice' ? 'practice' : this.mode === 'tournament' || this.mode === 'match' ? 'match' : 'practice';
    return endClockConfig(flow, this.arrowsPerEnd);
  }

  on(event: string, handler: (payload?: unknown) => void): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
    return () => {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(event, current.filter((h) => h !== handler));
    };
  }

  private emit(event: string, payload?: unknown): void {
    (this.listeners.get(event) ?? []).forEach((handler) => handler(payload));
  }

  get endNumber(): number {
    return this.endIndex + 1;
  }

  get arrowsLeftInEnd(): number {
    return Math.max(0, this.arrowsPerEnd - this.myEndArrows.length);
  }

  get signal(): SignalState {
    return this.clock.signal(performance.now());
  }

  get finished(): boolean {
    if (this.ranking) return this.ranking.complete;
    if (this.match) return this.match.finished && !this.match.needsShootOff;
    return false;
  }

  /** Start the clock for a new end (or the shoot-off arrow). */
  beginEnd(now = performance.now()): void {
    this.clock.reset(this.inShootOff ? endClockConfig('shootOff', 1) : this.clockConfig());
    this.clock.start(now);
    this.myEndArrows = [];
    this.theirEndArrows = [];
    this.timingViolation = false;
    this.emit('endStart', { end: this.endNumber });
  }

  /** Pause/resume for the pause menu. */
  pause(): void {
    this.clock.pause(performance.now());
  }

  resume(): void {
    this.clock.resume(performance.now());
  }

  /**
   * Record a player arrow.
   *
   * @returns true when this arrow completed the end.
   */
  addPlayerArrow(score: ArrowScore, impact: { x: number; y: number }): boolean {
    const signal = this.signal;
    let finalScore = score;
    if (!signal.canShoot && this.mode !== 'practice') {
      this.timingViolation = true;
      finalScore = { ...score, value: 0, isX: false, label: 'M' };
      this.emit('timingViolation');
    }

    const arrow: ScoredArrow = {
      ...finalScore,
      index: this.myEndArrows.length,
      impact: { x: impact.x, y: impact.y },
    };
    this.myEndArrows.push(arrow);
    this.ranking?.addArrow(finalScore);
    this.ranking?.setLastImpact(impact.x, impact.y);

    this.emit('arrow', arrow);

    if (this.mode === 'practice') return false;
    if (this.myEndArrows.length >= this.arrowsPerEnd) {
      this.closeEnd();
      return true;
    }
    return false;
  }

  /** Close the end: shoot the opponent's arrows and apply the format rules. */
  private closeEnd(): EndSummary {
    const myArrows = this.myEndArrows.slice();
    this.endIndex++;

    if (this.ranking) {
      const myTotal = myArrows.reduce((s, a) => s + a.value, 0);
      const summary: EndSummary = {
        endNumber: this.endIndex,
        myArrows,
        theirArrows: [],
        myTotal,
        theirTotal: 0,
        mySetPoints: 0,
        theirSetPoints: 0,
        finished: this.ranking.complete,
        needsShootOff: false,
        message: `End ${this.endIndex}: ${myTotal}`,
      };
      this.myEndArrows = [];
      this.emit('endComplete', summary);
      if (summary.finished) this.emit('rankingComplete', this.ranking.toEntry('player', 'You'));
      return summary;
    }

    if (this.match && this.opponent) {
      const pressure = clamp(this.endIndex / 5, 0, 1);
      const theirArrows = this.opponent.shootEnd(this.arrowsPerEnd, pressure);
      this.theirEndArrows = theirArrows;
      const record = this.match.recordEnd(myArrows, theirArrows);
      const summary: EndSummary = {
        endNumber: this.endIndex,
        myArrows,
        theirArrows,
        myTotal: record.mine,
        theirTotal: record.theirs,
        mySetPoints: this.match.mySets,
        theirSetPoints: this.match.theirSets,
        finished: this.match.finished,
        needsShootOff: this.match.needsShootOff,
        message: this.match.style === 'setSystem'
          ? `Set ${this.endIndex}: ${record.mine}-${record.theirs}`
          : `End ${this.endIndex}: ${record.mine}-${record.theirs}`,
      };
      this.myEndArrows = [];
      this.emit('endComplete', summary);
      if (summary.needsShootOff) {
        this.beginShootOff();
      } else if (summary.finished) {
        this.emit('matchComplete', summary);
      }
      return summary;
    }

    // Practice has no ends; this branch is only defensive.
    const summary: EndSummary = {
      endNumber: this.endIndex,
      myArrows,
      theirArrows: [],
      myTotal: myArrows.reduce((s, a) => s + a.value, 0),
      theirTotal: 0,
      mySetPoints: 0,
      theirSetPoints: 0,
      finished: false,
      needsShootOff: false,
      message: '',
    };
    this.myEndArrows = [];
    return summary;
  }

  /** Start the single-arrow tie-break. */
  beginShootOff(): void {
    this.shootOff = new ShootOff();
    this.inShootOff = true;
    this.beginEnd();
    this.emit('shootOffStart');
  }

  /**
   * Resolve the shoot-off with the player's arrow.
   * Returns the call text and whether a re-shoot is needed.
   */
  resolveShootOff(myArrow: ScoredArrow): { repeat: boolean; winner: 0 | 1 | null; reason: string } {
    if (!this.shootOff || !this.opponent) {
      return { repeat: false, winner: null, reason: 'No shoot-off in progress.' };
    }
    const theirArrow = this.opponent.shootArrow(1);
    const result = this.shootOff.resolve(myArrow, theirArrow);
    this.theirEndArrows = [theirArrow];
    if (result.repeat) {
      this.beginEnd();
    } else {
      this.inShootOff = false;
      // A shoot-off decides the match: push the winner into the match state so
      // results and tournament advancement read the same answer as the judge.
      if (this.match && result.winner !== null) {
        this.match.setState = {
          ...this.match.setState,
          winner: result.winner,
          needsShootOff: false,
          finished: true,
        };
        this.match.cumulativeState = {
          ...this.match.cumulativeState,
          winner: result.winner,
          needsShootOff: false,
          finished: true,
        };
      }
      this.emit('shootOffResolved', result);
    }
    return { repeat: result.repeat, winner: result.winner, reason: result.reason };
  }

  /** Scoreboard view. */
  scoreboard(): {
    myTotal: number;
    theirTotal: number;
    mySets: number;
    theirSets: number;
    myEnds: number[];
    theirEnds: number[];
    end: number;
    arrowsLeft: number;
  } {
    if (this.match) {
      return {
        myTotal: this.match.myTotal,
        theirTotal: this.match.theirTotal,
        mySets: this.match.mySets,
        theirSets: this.match.theirSets,
        myEnds: this.match.records.map((r) => r.mine),
        theirEnds: this.match.records.map((r) => r.theirs),
        end: this.match.currentEnd,
        arrowsLeft: this.arrowsLeftInEnd,
      };
    }
    return {
      myTotal: this.ranking?.total ?? 0,
      theirTotal: 0,
      mySets: 0,
      theirSets: 0,
      myEnds: this.ranking?.endTotals() ?? [],
      theirEnds: [],
      end: this.ranking?.currentEnd ?? 1,
      arrowsLeft: this.arrowsLeftInEnd,
    };
  }

  /** Clock label and phase for the HUD. */
  clockState(): SignalState {
    return this.signal;
  }
}
