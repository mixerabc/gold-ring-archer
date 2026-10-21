/**
 * Single-arrow shoot-off.
 *
 * World Archery tie-break: one arrow each, closest to the centre wins; an X
 * beats a 10 at the same distance, and an exact tie is re-shot. The comparison
 * itself lives in `shared/rules/scoring.ts` so the server can replay it.
 */

import { resolveShootOff, type ShootOffResult } from '@shared/rules/formats';
import type { ArrowScore } from './types';

export interface ShootOffAttempt {
  index: number;
  mine: ArrowScore;
  theirs: ArrowScore;
  result: ShootOffResult;
}

export class ShootOff {
  readonly attempts: ShootOffAttempt[] = [];

  get resolved(): boolean {
    return this.attempts.length > 0 && !this.attempts[this.attempts.length - 1].result.repeat;
  }

  get winner(): 0 | 1 | null {
    return this.attempts.length ? this.attempts[this.attempts.length - 1].result.winner : null;
  }

  resolve(mine: ArrowScore, theirs: ArrowScore): ShootOffResult {
    const result = resolveShootOff(mine, theirs);
    this.attempts.push({ index: this.attempts.length + 1, mine, theirs, result });
    return result;
  }

  /** Human-readable call for the judge popup. */
  get call(): string {
    if (!this.attempts.length) return 'Shoot-off: one arrow each, closest to the centre.';
    return this.attempts[this.attempts.length - 1].result.reason;
  }
}
