/**
 * Match-manager integration tests: the bridge between the shared set-system
 * rules and the in-game shoot-off / winner state.
 */

import { describe, expect, it } from 'vitest';
import { MatchManager } from './matchManager';
import { DEFAULT_WIND } from '@shared/physics/wind';

function manager(): MatchManager {
  return new MatchManager({
    mode: 'match',
    bowClass: 'recurve',
    distanceM: 70,
    wind: DEFAULT_WIND,
    difficulty: 'standard',
    seed: 5,
  });
}

const arrows = (value: number, count = 3) =>
  Array.from({ length: count }, () => ({
    value,
    isX: false,
    lineCut: false,
    radius: 0.1,
    label: String(value),
  }));

describe('match manager', () => {
  it('reaches 5-5 after five sets and asks for a shoot-off', () => {
    const m = manager();
    // 2-0, 0-2, 2-0, 0-2, 1-1 => 5-5.
    const scores: Array<[number, number]> = [
      [29, 27],
      [27, 29],
      [29, 27],
      [27, 29],
      [28, 28],
    ];
    for (const [mine, theirs] of scores) {
      m.match!.recordEnd(arrows(mine), arrows(theirs));
    }
    expect(m.match!.mySets).toBe(5);
    expect(m.match!.theirSets).toBe(5);
    expect(m.match!.needsShootOff).toBe(true);
    expect(m.match!.winner).toBeNull();
  });

  it('writes the shoot-off winner back into the match state', () => {
    const m = manager();
    for (const [mine, theirs] of [
      [29, 27],
      [27, 29],
      [29, 27],
      [27, 29],
      [28, 28],
    ]) {
      m.match!.recordEnd(arrows(mine), arrows(theirs));
    }
    m.beginShootOff();
    expect(m.inShootOff).toBe(true);
    const result = m.resolveShootOff({
      value: 10,
      isX: true,
      lineCut: false,
      radius: 0.01,
      label: 'X',
      index: 0,
      impact: { x: 0, y: 0 },
    });
    expect(result.repeat).toBe(false);
    expect(m.inShootOff).toBe(false);
    expect(m.match!.winner).toBe(0);
    expect(m.match!.finished).toBe(true);
    expect(m.match!.needsShootOff).toBe(false);
  });

  it('counts a cumulative match by total and X count', () => {
    const m = manager();
    for (let i = 0; i < 5; i++) {
      m.match!.recordEnd(arrows(28), arrows(28));
    }
    // Both totals equal, X counts equal -> shoot-off.
    expect(m.match!.needsShootOff).toBe(true);
  });
});
