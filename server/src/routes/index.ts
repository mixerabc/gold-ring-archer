/**
 * REST routes.
 *
 * Every payload is validated with Zod. The score endpoint accepts a ranking
 * total (already validated shot-by-shot over the WebSocket); the equipment
 * endpoint stores a legal setup per archer; the daily endpoint is seeded from
 * the UTC date so everyone gets the same challenge.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getClassRules, rules } from '@gold-ring/shared/rules/index';
import { sanitizeGear, defaultGear } from '@gold-ring/shared/data/gear';
import { hashSeed } from '@gold-ring/shared/math/random';
import type { BowClass, GearSetup } from '@gold-ring/shared/types';
import type { JsonStore } from '../db/store';

const bowClassSchema = z.enum(['recurve', 'compound', 'barebow']);

const ScoreBody = z.object({
  archerId: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  bowClass: bowClassSchema,
  formatId: z.string().min(1).max(48),
  score: z.number().int().min(0).max(1000),
  xCount: z.number().int().min(0).max(200),
});

const EquipmentBody = z.object({
  archerId: z.string().min(1).max(64),
  gear: z.record(z.string(), z.unknown()),
});

const AuthBody = z.object({
  name: z.string().min(1).max(32),
});

function fail(reply: FastifyReply, error: unknown): void {
  reply.code(400).send({ error: 'validation', detail: error instanceof Error ? error.message : String(error) });
}

export async function registerRoutes(app: FastifyInstance, store: JsonStore): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    service: 'gold-ring',
    rulesEdition: rules.meta.rulebook.edition,
    rulesVerified: rules.meta.rulebook.verified,
    ...store.stats(),
  }));

  app.get('/api/formats', async () => ({
    formats: Object.values(rules.formats),
    classes: Object.values(rules.classes).map((c) => ({
      id: c.id,
      name: c.name,
      distanceM: c.distanceM,
      face: c.face,
      totalArrows: c.totalArrows,
      matchStyle: c.matchStyle,
    })),
    faces: Object.values(rules.faces),
    timing: rules.timing,
    signals: rules.signals,
  }));

  app.post('/api/auth', async (request, reply) => {
    const parsed = AuthBody.safeParse(request.body);
    if (!parsed.success) return fail(reply, parsed.error);
    const id = `p-${hashSeed(parsed.data.name + Date.now()).toString(36)}`;
    const user = store.upsertUser(id, parsed.data.name);
    // Demo token: a real deployment would sign a JWT here.
    return { token: Buffer.from(`${user.id}:${Date.now()}`).toString('base64url'), user };
  });

  app.post('/api/score', async (request, reply) => {
    const parsed = ScoreBody.safeParse(request.body);
    if (!parsed.success) return fail(reply, parsed.error);
    const body = parsed.data;
    const cls = getClassRules(body.bowClass as BowClass);
    if (body.score > cls.totalArrows * 10) {
      reply.code(422).send({ error: 'impossible', message: 'Score exceeds the maximum for this round.' });
      return;
    }
    if (body.xCount > cls.totalArrows) {
      reply.code(422).send({ error: 'impossible', message: 'X count exceeds the number of arrows.' });
      return;
    }
    const saved = store.addScore({
      archerId: body.archerId,
      name: body.name,
      bowClass: body.bowClass as BowClass,
      formatId: body.formatId,
      score: body.score,
      xCount: body.xCount,
    });
    return { ok: true, entry: saved };
  });

  app.get('/api/leaderboard', async (request, reply) => {
    const query = z
      .object({
        class: bowClassSchema.default('recurve'),
        format: z.string().default('rankingRound'),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .safeParse(request.query);
    if (!query.success) return fail(reply, query.error);
    return {
      bowClass: query.data.class,
      formatId: query.data.format,
      entries: store.leaderboard(query.data.class as BowClass, query.data.format, query.data.limit),
    };
  });

  app.get('/api/daily', async (request, reply) => {
    const query = z
      .object({ class: bowClassSchema.default('recurve') })
      .safeParse(request.query);
    if (!query.success) return fail(reply, query.error);
    const day = new Date().toISOString().slice(0, 10);
    const seed = hashSeed(`${day}|${query.data.class}`);
    const cls = getClassRules(query.data.class as BowClass);
    const expires = new Date();
    expires.setUTCHours(24, 0, 0, 0);
    return {
      seed,
      distanceM: cls.distanceM,
      class: query.data.class,
      challengeId: `daily-${day}-${query.data.class}`,
      expiresAt: expires.toISOString(),
    };
  });

  app.get('/api/equipment', async (request, reply) => {
    const query = z.object({ archerId: z.string().min(1) }).safeParse(request.query);
    if (!query.success) return fail(reply, query.error);
    const gear = store.getEquipment(query.data.archerId);
    if (!gear) return { gear: null };
    return { gear };
  });

  app.put('/api/equipment', async (request, reply) => {
    const parsed = EquipmentBody.safeParse(request.body);
    if (!parsed.success) return fail(reply, parsed.error);
    const raw = parsed.data.gear as unknown as GearSetup;
    const bowClass = (raw.class ?? 'recurve') as BowClass;
    const legal = sanitizeGear({ ...defaultGear(bowClass), ...raw, class: bowClass });
    const saved = store.setEquipment(parsed.data.archerId, legal);
    return { ok: true, equipment: saved };
  });

  // 404 for anything else under /api.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'not_found', path: request.url });
  });
}
