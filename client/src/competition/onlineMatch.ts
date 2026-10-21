/**
 * Online duel session.
 *
 * Presents the same small interface the game loop uses for a local
 * `MatchManager`, but every number that matters comes from the server:
 * the clock, the arrow count, the totals and the winner. The client still
 * predicts the shot locally for the camera and the arrow, then submits it for
 * authoritative scoring.
 *
 * Format: five ends of three arrows, cumulative, X-count tie-break.
 */

import type { ArrowScore, BowClass, ScoredArrow } from '@shared/types';
import type { ShootRequest } from '@shared/net/protocol';
import type { SignalState } from '@shared/rules/timing';
import type { EndSummary } from './matchManager';
import type { GameMode } from '../state/store';
import type { NetClient, OnlineClock, OnlinePlayerState, ServerMessage } from '../net/client';

export interface OnlineResult {
  winner: 'you' | 'opponent' | 'draw';
  myTotal: number;
  theirTotal: number;
  myX: number;
  theirX: number;
  opponent: string;
  ends: number[];
  theirEnds: number[];
}

function emptyPlayer(name: string): OnlinePlayerState {
  return { name, total: 0, xCount: 0, endTotal: 0, arrowsLeft: 3, arrows: [], endTotals: [] };
}

export class OnlineMatchManager {
  readonly mode: GameMode = 'online';
  readonly bowClass: BowClass;
  readonly arrowsPerEnd: number;
  readonly totalEnds: number;
  readonly match = null;
  readonly inShootOff = false;

  endNumber = 1;
  state: 'shooting' | 'break' | 'finished' = 'shooting';
  my: OnlinePlayerState;
  opponentState: OnlinePlayerState;
  clock: OnlineClock = { remaining: 60, phase: 'shoot', light: 'green', clock: '1:00' };
  finished = false;
  result: OnlineResult | null = null;

  private net: NetClient;
  private listeners = new Map<string, Array<(payload?: unknown) => void>>();
  private unsubscribe: () => void;
  private lastServerScore: ArrowScore | null = null;

  constructor(net: NetClient, myName: string, opponentName: string, bowClass: BowClass, arrowsPerEnd = 3, ends = 5) {
    this.net = net;
    this.bowClass = bowClass;
    this.arrowsPerEnd = arrowsPerEnd;
    this.totalEnds = ends;
    this.my = emptyPlayer(myName);
    this.opponentState = emptyPlayer(opponentName);
    this.unsubscribe = net.onMessage((message) => this.onMessage(message));
  }

  /** Small adapter so the HUD can read `opponent.profile.name`. */
  get opponent(): { profile: { name: string } } {
    return { profile: { name: this.opponentState.name } };
  }

  get arrowsLeftInEnd(): number {
    return Math.max(0, this.my.arrowsLeft);
  }

  get endNumberSafe(): number {
    return this.endNumber;
  }

  get signal(): SignalState {
    const canShoot = this.state === 'shooting' && this.clock.remaining > 0 && this.clock.phase !== 'expired';
    return {
      phase: (this.clock.phase as SignalState['phase']) ?? 'shoot',
      light: (this.clock.light as SignalState['light']) ?? 'green',
      remaining: this.clock.remaining,
      elapsed: Math.max(0, 60 - this.clock.remaining),
      expired: this.clock.phase === 'expired' || this.clock.remaining <= 0,
      canShoot,
      warning: this.clock.phase === 'warning',
      label: this.clock.phase,
    };
  }

  clockState(): SignalState {
    return this.signal;
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

  /** The server drives the end; the client only resets its local view. */
  beginEnd(): void {
    this.my.arrowsLeft = this.arrowsPerEnd;
    this.my.endTotal = 0;
  }

  pause(): void {
    // The server clock cannot be paused by one player.
  }

  resume(): void {
    // No-op.
  }

  /** Locally count the arrow so the HUD responds immediately. */
  addPlayerArrow(score: ArrowScore, _impact: { x: number; y: number }): boolean {
    if (this.state !== 'shooting') return false;
    this.my.arrowsLeft = Math.max(0, this.my.arrowsLeft - 1);
    this.my.endTotal += score.value;
    this.my.arrows = [...this.my.arrows, score];
    return this.my.arrowsLeft === 0;
  }

  /** Submit the shot for authoritative scoring. */
  submitShot(request: ShootRequest, score: ArrowScore): void {
    this.net.submitShot({
      ...request,
      type: 'shoot',
      archerId: 'online-player',
      gameId: 'online',
      simulatedAt: Date.now(),
      claimedScore: { value: score.value, isX: score.isX, label: score.label },
    });
  }

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
    return {
      myTotal: this.my.total,
      theirTotal: this.opponentState.total,
      mySets: 0,
      theirSets: 0,
      myEnds: this.my.endTotals,
      theirEnds: this.opponentState.endTotals,
      end: this.endNumber,
      arrowsLeft: this.arrowsLeftInEnd,
    };
  }

  private onMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'endStart': {
        this.endNumber = message.end;
        this.state = 'shooting';
        this.my.arrowsLeft = message.arrowsPerEnd;
        this.my.endTotal = 0;
        this.my.arrows = [];
        this.clock = message.clock;
        this.emit('endStart', message);
        break;
      }
      case 'matchState': {
        this.endNumber = message.end;
        this.state = message.state;
        this.my = message.my;
        this.opponentState = message.opponent;
        this.clock = message.clock;
        break;
      }
      case 'signal': {
        this.clock = {
          remaining: message.state.remaining,
          phase: message.state.phase,
          light: message.state.light,
          clock: message.state.clock ?? '',
        };
        break;
      }
      case 'endResult': {
        this.my.total = message.myTotal;
        this.my.xCount = message.myX;
        this.my.endTotals = [...this.my.endTotals, message.myEndTotal];
        this.opponentState.total = message.theirTotal;
        this.opponentState.xCount = message.theirX;
        this.opponentState.endTotals = [...this.opponentState.endTotals, message.theirEndTotal];
        this.state = message.finished ? 'finished' : 'break';
        const myArrows: ScoredArrow[] = message.myArrows.map((a, i) => ({
          ...a,
          index: i,
          impact: { x: 0, y: 0 },
        }));
        const theirArrows: ScoredArrow[] = message.theirArrows.map((a, i) => ({
          ...a,
          index: i,
          impact: { x: 0, y: 0 },
        }));
        const summary: EndSummary = {
          endNumber: message.end,
          myArrows,
          theirArrows,
          myTotal: message.myEndTotal,
          theirTotal: message.theirEndTotal,
          mySetPoints: 0,
          theirSetPoints: 0,
          finished: message.finished,
          needsShootOff: false,
          message: `End ${message.end}: ${message.myEndTotal}-${message.theirEndTotal}`,
        };
        this.emit('endComplete', summary);
        break;
      }
      case 'matchOver': {
        this.finished = true;
        this.state = 'finished';
        this.result = {
          winner: message.winner,
          myTotal: message.myTotal,
          theirTotal: message.theirTotal,
          myX: message.myX,
          theirX: message.theirX,
          opponent: message.opponent,
          ends: message.ends,
          theirEnds: message.theirEnds,
        };
        this.emit('matchComplete', this.result);
        break;
      }
      case 'shotResult': {
        if (!message.result.accepted) {
          this.emit('shotRejected', message.result.notes?.[0] ?? 'Shot rejected by the server.');
        } else if (message.result.score) {
          this.lastServerScore = message.result.score;
          this.emit('shotAccepted', message.result.score);
        }
        break;
      }
      case 'error':
        this.emit('error', message.message);
        break;
      default:
        break;
    }
  }

  get lastAccepted(): ArrowScore | null {
    return this.lastServerScore;
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }
}
