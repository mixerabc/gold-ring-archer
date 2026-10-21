/**
 * REST route tests with Fastify's inject (no network, no open port).
 */

import { afterAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../db/store';
import { registerRoutes } from './index';

const dir = mkdtempSync(join(tmpdir(), 'gold-ring-test-'));
const store = new JsonStore(dir);
const app = Fastify({ logger: false });
await registerRoutes(app, store);
await app.ready();

afterAll(async () => {
  await app.close();
  store.flush();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can hold the file briefly; the OS temp cleaner will get it.
  }
});

describe('REST routes', () => {
  it('reports health and the unverified ruleset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.rulesVerified).toBe(false);
  });

  it('accepts a plausible ranking score and lists it', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/score',
      payload: {
        archerId: 'p1',
        name: 'Tester',
        bowClass: 'recurve',
        formatId: 'rankingRound',
        score: 648,
        xCount: 22,
      },
    });
    expect(post.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/leaderboard?class=recurve&format=rankingRound&limit=5' });
    expect(list.statusCode).toBe(200);
    expect(list.json().entries[0].score).toBe(648);
  });

  it('rejects a score above the maximum for the round', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/score',
      payload: {
        archerId: 'p1',
        name: 'Tester',
        bowClass: 'recurve',
        formatId: 'rankingRound',
        score: 900,
        xCount: 0,
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects malformed equipment payloads', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/equipment', payload: { archerId: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('strips an illegal barebow sight when saving equipment', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/equipment',
      payload: { archerId: 'p1', gear: { class: 'barebow', sightId: 'sight-meridian-pin' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().equipment.gear.sightId).toBeUndefined();
  });

  it('returns the same daily seed for the same day and class', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/daily?class=compound' });
    const b = await app.inject({ method: 'GET', url: '/api/daily?class=compound' });
    expect(a.json().seed).toBe(b.json().seed);
    expect(a.json().challengeId).toBe(b.json().challengeId);
  });
});
