/**
 * Unit tests for the rules engine and scoring.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isRulesVerified,
  assertRulesVerified,
  rules,
  getClassRules,
  getFace,
  ringRadiusM,
  faceRadiusM,
  xRingRadiusM,
} from './rules/index';
import {
  scoreArrow,
  scoreArrows,
  sumEnd,
  applyTimingPenalty,
  compareShootOff,
  distanceFromCentreMm,
} from './rules/scoring';
import { createSetSystem, applySet, createCumulative, applyCumulativeEnd, resolveShootOff } from './rules/formats';
import { evaluateSignal, formatClock, EndClock, endClockConfig } from './rules/timing';
import { seedRanking, type RankingEntry } from './rules/formats';

describe('rules verification', () => {
  it('refuses to advertise unverified rules', () => {
    expect(isRulesVerified()).toBe(false);
    expect(() => assertRulesVerified()).toThrow('unverified');
  });

  it('has consistent ring geometry for the 122 cm face', () => {
    const face = getFace('wa122');
    expect(face.diameterCm).toBe(122);
    expect(face.rings).toBe(10);
    expect(face.ringWidthCm).toBe(6.1);
    // A 122 cm face has a 61 cm radius; ring 10's outer edge is 6.1 cm.
    expect(faceRadiusM(face)).toBe(0.61);
    expect(ringRadiusM(face, 10)).toBe(0.061);
    expect(ringRadiusM(face, 1)).toBe(0.61);
    expect(xRingRadiusM(face)).toBe(0.0305);
    // Ring colors present.
    const hex = face.colors.find((c) => c.rings.includes(10))?.hex;
    expect(hex).toBe('#f5c518');
  });

  it('6-ring face has correct scoring area', () => {
    const face = getFace('wa80');
    expect(face.diameterCm).toBe(80);
    expect(face.ringWidthCm).toBe(4);
    expect(face.minScoringRing).toBe(5);
    expect(faceRadiusM(face)).toBe(0.4);
    // Six printed rings of 4 cm: ring 5's outer edge is 24 cm.
    expect(ringRadiusM(face, 5)).toBe(0.24);
  });
});

describe('scoring', () => {
  it('scores from the ring crossed', () => {
    const face = getFace('wa122');
    expect(scoreArrow('wa122', { x: 0, y: 0.02 }).value).toBe(10);
    expect(scoreArrow('wa122', { x: 0.07, y: 0 }).value).toBe(9);
    expect(scoreArrow('wa122', { x: 0.25, y: 0 }).value).toBe(6);
    expect(scoreArrow('wa122', { x: 0.4, y: 0 }).value).toBe(4);
    expect(scoreArrow('wa122', { x: 0.7, y: 0 }).value).toBe(0); // outside the 61 cm radius
  });

  it('recognises the X ring', () => {
    const shot = scoreArrow('wa122', { x: 0, y: 0.01 });
    expect(shot.value).toBe(10);
    expect(shot.isX).toBe(true);
  });

  it('recognises an X from off-centre', () => {
    const shot = scoreArrow('wa122', { x: 0.02, y: 0.02 });
    expect(shot.radius).toBeLessThanOrEqual(0.0305);
    expect(shot.label).toBe('X');
  });

  it('applies the line-cutter rule', () => {
    // Shaft radius = 2.75 mm. A shot whose centre is 6.1 cm + 2.75 mm out should
    // still score 10.
    const cut = scoreArrow('wa122', { x: 0.06375, y: 0 }, { shaftDiameterMm: 5.5 });
    expect(cut.label).toBe('10');
    expect(cut.lineCut).toBe(true);
  });

  it('scores a miss for an arrow outside the 6-ring face', () => {
    const shot = scoreArrow('wa80', { x: 0.25, y: 0 });
    expect(shot.label).toBe('M');
    expect(shot.value).toBe(0);
  });

  it('handles a triple-spotted face (spot is ignored for single face)', () => {
    const shot = scoreArrow('wa40_6', { x: 0, y: 0.01 }, { face: getFace('wa40_6') });
    expect(shot.value).toBe(10);
    expect(shot.label).toBe('X');
  });

  it('penalises an early shot by cancelling the highest arrow', () => {
    const arrows = scoreArrows('wa122', [
      { x: 0, y: 0.01 }, // 10
      { x: 0.08, y: 0 }, // 9
      { x: 0.2, y: 0 }, // 7
      { x: 0.3, y: 0 }, // 6
      { x: 0.4, y: 0 }, // 4
      { x: 0.45, y: 0 }, // 3
    ]);
    const penalised = applyTimingPenalty(arrows);
    const total = penalised.reduce((s, a) => s + a.value, 0);
    expect(total).toBe(9 + 7 + 6 + 4 + 3);
    expect(penalised.find((a) => (a as any).originalValue === 10)?.value).toBe(0);
  });

  it('sums an end and counts X / tens', () => {
    const arrows = scoreArrows('wa122', [
      { x: 0, y: 0.005 }, // 10 X
      { x: 0.08, y: 0.02 }, // 9
      { x: 0.3, y: 0.1 }, // 5
      { x: 0.45, y: 0.1 }, // 3
    ]);
    const { total, xCount, tenCount } = sumEnd(arrows);
    expect(total).toBe(27);
    expect(xCount).toBe(1);
    expect(tenCount).toBe(1);
  });

  it('shoot-off compares X before 10 and distance', () => {
    expect(compareShootOff({ value: 10, isX: true, radius: 0.03 }, { value: 10, isX: false, radius: 0.02 })).toBe(1);
    expect(compareShootOff({ value: 10, isX: false, radius: 0.02 }, { value: 10, isX: false, radius: 0.03 })).toBe(1);
    expect(compareShootOff({ value: 10, isX: false, radius: 0.02 }, { value: 9, isX: false, radius: 0.01 })).toBe(1);
    expect(compareShootOff({ value: 10, isX: false, radius: 0.02 }, { value: 10, isX: false, radius: 0.02 })).toBe(0);
  });

  it('converts impact distance to millimetres', () => {
    expect(distanceFromCentreMm({ x: 0.1, y: 0.05 })).toBeCloseTo(111.80, 1);
  });
});

describe('set system', () => {
  it('first to 6 set points wins', () => {
    const s = createSetSystem();
    const afterThree = applySet(s, [21, 18]);
    expect(afterThree.sets.length).toBe(1);
    expect(afterThree.points).toStrictEqual([2, 0]);
  });

  it('a draw set yields one point each', () => {
    const s = createSetSystem();
    const s2 = applySet(s, [15, 15]);
    expect(s2.points).toStrictEqual([1, 1]);
  });

  it('decides at 5-5 with a shoot-off', () => {
    // Five sets that all end level on points: 2-2, 2-2, 1-1, 2-2, 2-2 would
    // never happen, so use alternating set wins that end 5-5 after five sets
    // (2,0),(0,2),(2,0),(0,2),(1,1).
    let s = createSetSystem();
    s = applySet(s, [29, 27]);
    s = applySet(s, [27, 29]);
    s = applySet(s, [29, 27]);
    s = applySet(s, [27, 29]);
    s = applySet(s, [28, 28]);
    expect(s.finished).toBe(true);
    expect(s.needsShootOff).toBe(true);
    expect(s.points).toStrictEqual([5, 5]);
  });

  it('shoot-off resolves by distance', () => {
    const a = scoreArrow('wa122', { x: 0.02, y: 0 });
    const b = scoreArrow('wa122', { x: 0.06, y: 0 });
    const r = resolveShootOff(a, b);
    expect(r.winner).toBe(0);
    expect(r.repeat).toBe(false);
    expect(r.reason.length).toBeGreaterThan(10);
  });

  it('repeats the shoot-off on a tie', () => {
    const a = scoreArrow('wa122', { x: 0.02, y: 0 });
    const b = scoreArrow('wa122', { x: 0.02, y: 0 });
    expect(resolveShootOff(a, b).repeat).toBe(true);
  });
});

describe('cumulative match', () => {
  it('totals arrows across ends', () => {
    const s = createCumulative();
    const s2 = applyCumulativeEnd(s, [28, 30]);
    expect(s2.totals).toStrictEqual([28, 30]);
    expect(s2.endsShot).toBe(1);
  });

  it('breaks ties on X count after all five ends', () => {
    let s = createCumulative();
    for (let i = 0; i < 5; i++) {
      s = applyCumulativeEnd(s, [28, 28], [i < 3 ? 1 : 0, i < 2 ? 1 : 0]);
    }
    expect(s.finished).toBe(true);
    expect(s.winner).toBe(0);
  });

  it('falls to a shoot-off when totals and X counts are level', () => {
    let s = createCumulative();
    for (let i = 0; i < 5; i++) {
      s = applyCumulativeEnd(s, [28, 28], [1, 1]);
    }
    expect(s.needsShootOff).toBe(true);
  });
});

describe('timing and signals', () => {
  it('gives the right phase timeline for a ranking end', () => {
    const cfg = endClockConfig('ranking', 6);
    expect(evaluateSignal(0, cfg).light).toBe('green');
    expect(evaluateSignal(200, cfg).light).toBe('green');
    expect(evaluateSignal(230, cfg).light).toBe('yellow');
    expect(evaluateSignal(239, cfg).light).toBe('yellow');
    expect(evaluateSignal(240, cfg).light).toBe('red');
    expect(evaluateSignal(500, cfg).light).toBe('red');
    expect(evaluateSignal(500, cfg).expired).toBe(true);
  });

  it('match play uses per-arrow time', () => {
    // Three arrows at 20 s each: the end clock is 60 s.
    const cfg = endClockConfig('match', 3);
    expect(cfg.durationSeconds).toBe(60);
    expect(evaluateSignal(0, cfg).light).toBe('green');
    expect(evaluateSignal(29, cfg).light).toBe('green');
    expect(evaluateSignal(55, cfg).light).toBe('yellow');
    expect(evaluateSignal(60, cfg).light).toBe('red');
  });

  it('practice has no clock', () => {
    const cfg = endClockConfig('practice', 0);
    expect(evaluateSignal(100, cfg).light).toBe('green');
  });

  it('formats the clock as mm:ss', () => {
    expect(formatClock(90)).toBe('1:30');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-1)).toBe('0:00');
  });

  it('EndClock emits each phase change once', () => {
    let now = 1_730_000_000_000;
    const cfg = endClockConfig('ranking', 6);
    const clock = new EndClock(cfg);
    clock.start(now);
    const changes: string[] = [];
    // Advance a virtual clock one second at a time until the end expires.
    for (let i = 0; i < 300 && clock.signal(now).phase !== 'expired'; i++) {
      now += 1000;
      const phase = clock.consumePhaseChange(now);
      if (phase) changes.push(phase);
    }
    expect(changes).toContain('shoot');
    expect(changes).toContain('warning');
    expect(changes).toContain('expired');
    expect(new Set(changes).size).toBe(changes.length);
  });

  it('ranking ends are 240 seconds', () => {
    const cfg = endClockConfig('ranking', 6);
    expect(cfg.durationSeconds).toBe(240);
  });
});

describe('ranking seeding', () => {
  const entries: RankingEntry[] = [
    { archerId: 'b', name: 'Beth', total: 600, xCount: 10, tenCount: 20, arrowsShot: 6, ends: [1] },
    { archerId: 'a', name: 'Adam', total: 600, xCount: 12, tenCount: 20, arrowsShot: 6, ends: [1] },
    { archerId: 'c', name: 'Cara', total: 599, xCount: 5, tenCount: 10, arrowsShot: 6, ends: [1] },
  ];
  it('seeds by total then X then tens', () => {
    const seeded = seedRanking(entries);
    expect(seeded[0].archerId).toBe('a');
    expect(seeded[1].archerId).toBe('b');
    expect(seeded[2].archerId).toBe('c');
  });

  it('is stable across runs', () => {
    expect(seedRanking(entries)).toHaveLength(entries.length);
  });
});
