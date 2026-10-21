/**
 * Persistence.
 *
 * A small JSON store keeps the project dependency-free (no native SQLite build
 * step) while still surviving restarts. The interface is deliberately the same
 * shape a SQL repository would have, so swapping in Postgres later is a
 * drop-in change; `db/schema.sql` documents the equivalent relational schema.
 *
 * Writes are atomic (write temp file, then rename) so a crash cannot leave a
 * half-written leaderboard behind.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BowClass } from '@gold-ring/shared';

export interface StoredScore {
  id: string;
  archerId: string;
  name: string;
  bowClass: BowClass;
  formatId: string;
  score: number;
  xCount: number;
  playedAt: string;
}

export interface StoredEquipment {
  archerId: string;
  gear: unknown;
  updatedAt: string;
}

interface StoreData {
  scores: StoredScore[];
  equipment: Record<string, StoredEquipment>;
  users: Record<string, { id: string; name: string; createdAt: string }>;
}

const EMPTY: StoreData = { scores: [], equipment: {}, users: {} };

export class JsonStore {
  private data: StoreData = { ...EMPTY };
  private file: string;
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data')) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'gold-ring.json');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      this.data = {
        scores: parsed.scores ?? [],
        equipment: parsed.equipment ?? {},
        users: parsed.users ?? {},
      };
    } catch {
      this.data = { ...EMPTY };
    }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 250);
  }

  flush(): void {
    if (!this.dirty) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    renameSync(tmp, this.file);
    this.dirty = false;
  }

  addScore(entry: Omit<StoredScore, 'id' | 'playedAt'> & { playedAt?: string }): StoredScore {
    const score: StoredScore = {
      ...entry,
      id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      playedAt: entry.playedAt ?? new Date().toISOString(),
    };
    this.data.scores.push(score);
    // Keep the file bounded in a demo deployment.
    if (this.data.scores.length > 5000) this.data.scores.splice(0, this.data.scores.length - 5000);
    this.scheduleFlush();
    return score;
  }

  leaderboard(bowClass: BowClass, formatId: string, limit: number): StoredScore[] {
    return this.data.scores
      .filter((s) => s.bowClass === bowClass && s.formatId === formatId)
      .sort((a, b) => b.score - a.score || b.xCount - a.xCount)
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  getEquipment(archerId: string): unknown | null {
    return this.data.equipment[archerId]?.gear ?? null;
  }

  setEquipment(archerId: string, gear: unknown): StoredEquipment {
    const record: StoredEquipment = { archerId, gear, updatedAt: new Date().toISOString() };
    this.data.equipment[archerId] = record;
    this.scheduleFlush();
    return record;
  }

  upsertUser(id: string, name: string): { id: string; name: string; createdAt: string } {
    const existing = this.data.users[id];
    if (existing) return existing;
    const user = { id, name, createdAt: new Date().toISOString() };
    this.data.users[id] = user;
    this.scheduleFlush();
    return user;
  }

  stats(): { scores: number; users: number } {
    return { scores: this.data.scores.length, users: Object.keys(this.data.users).length };
  }
}
