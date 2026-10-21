/**
 * Online session tests with a fake transport: the manager must mirror the
 * server's authoritative totals, not its own local guesses.
 */

import { describe, expect, it } from 'vitest';
import { OnlineMatchManager } from './onlineMatch';
import type { NetClient, ServerMessage } from '../net/client';
import type { ShootRequest } from '@shared/net/protocol';

class FakeNet {
  handlers = new Set<(message: ServerMessage) => void>();
  lastShot: ShootRequest | null = null;

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  submitShot(request: ShootRequest): boolean {
    this.lastShot = request;
    return true;
  }

  emit(message: ServerMessage): void {
    this.handlers.forEach((handler) => handler(message));
  }
}

function setup(): { net: FakeNet; manager: OnlineMatchManager } {
  const net = new FakeNet();
  const manager = new OnlineMatchManager(net as unknown as NetClient, 'You', 'Rival', 'recurve', 3, 5);
  return { net, manager };
}

const score = { value: 10, isX: false, lineCut: false, radius: 0.05, label: '10' };

describe('online match manager', () => {
  it('mirrors the server state and arrow count', () => {
    const { net, manager } = setup();
    net.emit({
      type: 'matchState',
      end: 2,
      ends: 5,
      arrowsPerEnd: 3,
      state: 'shooting',
      my: { name: 'You', total: 28, xCount: 2, endTotal: 28, arrowsLeft: 2, arrows: [], endTotals: [30] },
      opponent: { name: 'Rival', total: 26, xCount: 1, endTotal: 26, arrowsLeft: 1, arrows: [], endTotals: [27] },
      clock: { remaining: 40, phase: 'shoot', light: 'green', clock: '0:40' },
    });
    expect(manager.endNumber).toBe(2);
    expect(manager.scoreboard().myTotal).toBe(28);
    expect(manager.scoreboard().theirTotal).toBe(26);
    expect(manager.arrowsLeftInEnd).toBe(2);
  });

  it('emits an end summary and then the final result', () => {
    const { net, manager } = setup();
    const summaries: unknown[] = [];
    manager.on('endComplete', (payload) => summaries.push(payload));

    net.emit({
      type: 'endResult',
      end: 5,
      ends: 5,
      myEndTotal: 29,
      theirEndTotal: 27,
      myTotal: 140,
      theirTotal: 135,
      myX: 12,
      theirX: 9,
      myArrows: [score, score, score],
      theirArrows: [score, score, score],
      finished: true,
      clock: { remaining: 0, phase: 'expired', light: 'red', clock: '0:00' },
    });
    expect(summaries).toHaveLength(1);
    expect(manager.my.total).toBe(140);
    expect(manager.opponentState.total).toBe(135);

    net.emit({
      type: 'matchOver',
      winner: 'you',
      myTotal: 140,
      theirTotal: 135,
      myX: 12,
      theirX: 9,
      opponent: 'Rival',
      ends: [29, 28, 27, 28, 28],
      theirEnds: [27, 27, 27, 27, 27],
    });
    expect(manager.finished).toBe(true);
    expect(manager.result?.winner).toBe('you');
  });

  it('submits a shot with the claimed score and wind', () => {
    const { net, manager } = setup();
    const request = {
      type: 'shoot',
      archerId: 'x',
      gameId: 'g',
      bowClass: 'recurve',
      distanceM: 70,
      windSeed: 1,
      aim: { x: 0, y: 0 },
      drawFraction: 1,
      holdSeconds: 1.5,
      releaseQuality: 1,
      cantRad: 0,
      torqueRad: 0,
      sightElevationOffsetMm: 0,
      sightWindageOffsetMm: 0,
      sway: { x: 0, y: 0 },
      gear: {
        drawWeightLb: 44,
        drawLengthIn: 29,
        braceHeightIn: 8.75,
        letOff: 0,
        arrowMassGr: 315,
        arrowSpine: 500,
        arrowLengthIn: 29,
        efficiency: 0.8,
      },
      simulatedAt: 1,
    } as unknown as ShootRequest;
    manager.submitShot(request, score);
    expect(net.lastShot?.type).toBe('shoot');
    expect(net.lastShot?.claimedScore?.value).toBe(10);
  });
});
