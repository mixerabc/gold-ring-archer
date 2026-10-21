/**
 * Network client.
 *
 * REST for formats, leaderboards, daily seeds and equipment; WebSocket for
 * matchmaking, end signals and authoritative shot validation. Everything is
 * optional: the game is fully playable offline, and every call degrades to a
 * local fallback when the server is not running.
 */

import type { BowClass, ShotOutcome } from '@shared/types';
import type { ShootRequest, ShootResponse } from '@shared/net/protocol';

export interface LeaderboardRow {
  archerId: string;
  name: string;
  bowClass: BowClass;
  formatId: string;
  score: number;
  xCount: number;
  playedAt: string;
}

export interface DailyChallenge {
  seed: number;
  distanceM: number;
  class: BowClass;
  challengeId: string;
  expiresAt: string;
}

export interface OnlineArrow {
  value: number;
  isX: boolean;
  lineCut: boolean;
  radius: number;
  label: string;
}

export interface OnlinePlayerState {
  name: string;
  total: number;
  xCount: number;
  endTotal: number;
  arrowsLeft: number;
  arrows: OnlineArrow[];
  endTotals: number[];
}

export interface OnlineClock {
  remaining: number;
  phase: string;
  light: string;
  clock: string;
}

export type ServerMessage =
  | { type: 'welcome'; clientId: string; serverTime: number }
  | { type: 'queued'; position: number; cancelled?: boolean }
  | {
      type: 'matchFound';
      roomId: string;
      opponent: string;
      lane: number;
      format?: string;
      arrowsPerEnd?: number;
      ends?: number;
    }
  | {
      type: 'signal';
      state: {
        phase: string;
        light: string;
        remaining: number;
        elapsed: number;
        expired: boolean;
        clock?: string;
        end?: number;
      };
    }
  | {
      type: 'matchState';
      end: number;
      ends: number;
      arrowsPerEnd: number;
      state: 'shooting' | 'break' | 'finished';
      my: OnlinePlayerState;
      opponent: OnlinePlayerState;
      clock: OnlineClock;
    }
  | {
      type: 'endStart';
      end: number;
      ends: number;
      arrowsPerEnd: number;
      clock: OnlineClock;
    }
  | {
      type: 'endResult';
      end: number;
      ends: number;
      myEndTotal: number;
      theirEndTotal: number;
      myTotal: number;
      theirTotal: number;
      myX: number;
      theirX: number;
      myArrows: OnlineArrow[];
      theirArrows: OnlineArrow[];
      finished: boolean;
      clock: OnlineClock;
    }
  | {
      type: 'matchOver';
      winner: 'you' | 'opponent' | 'draw';
      myTotal: number;
      theirTotal: number;
      myX: number;
      theirX: number;
      opponent: string;
      ends: number[];
      theirEnds: number[];
    }
  | { type: 'shotResult'; result: ShootResponse }
  | { type: 'error'; message: string };

export class NetClient {
  private socket: WebSocket | null = null;
  private handlers = new Set<(message: ServerMessage) => void>();
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;

  private baseUrl: string;
  private wsUrl: string;

  constructor(baseUrl = '') {
    // Build-time configuration (Netlify / Vercel):
    //   VITE_API_URL=https://gold-ring-api.onrender.com
    //   VITE_WS_URL=wss://gold-ring-api.onrender.com/ws   (optional)
    // In local dev/preview, point at the local Fastify server by default.
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    const localPort = typeof location !== 'undefined' ? location.port : '';
    const localDefault = localPort === '5173' || localPort === '4173' ? 'http://127.0.0.1:8080' : '';
    this.baseUrl = (baseUrl || env.VITE_API_URL || localDefault).replace(/\/$/, '');
    this.wsUrl = env.VITE_WS_URL ?? '';
  }

  private url(path: string): string {
    if (!this.baseUrl) return path;
    return `${this.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T | null> {
    try {
      const response = await fetch(this.url(path), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  getFormats(): Promise<unknown | null> {
    return this.json('/api/formats');
  }

  async leaderboard(bowClass: BowClass, formatId = 'rankingRound', limit = 20): Promise<LeaderboardRow[] | null> {
    const response = await this.json<{ entries?: LeaderboardRow[] }>(
      `/api/leaderboard?class=${bowClass}&format=${formatId}&limit=${limit}`,
    );
    return response?.entries ?? null;
  }

  daily(bowClass: BowClass): Promise<DailyChallenge | null> {
    return this.json(`/api/daily?class=${bowClass}`);
  }

  submitScore(payload: {
    archerId: string;
    name: string;
    bowClass: BowClass;
    formatId: string;
    score: number;
    xCount: number;
  }): Promise<unknown | null> {
    return this.json('/api/score', { method: 'POST', body: JSON.stringify(payload) });
  }

  saveEquipment(gear: unknown): Promise<unknown | null> {
    return this.json('/api/equipment', { method: 'PUT', body: JSON.stringify(gear) });
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= 1) return;
    this.shouldReconnect = true;
    try {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = this.wsUrl
        ? this.wsUrl
        : this.baseUrl
          ? `${this.baseUrl.replace(/^http/, 'ws')}/ws`
          : `${protocol}://${location.host}/ws`;
      this.socket = new WebSocket(url);
      this.socket.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as ServerMessage;
          this.handlers.forEach((handler) => handler(parsed));
        } catch {
          // Ignore malformed frames.
        }
      });
      this.socket.addEventListener('close', () => {
        this.socket = null;
        if (this.shouldReconnect && this.reconnectTimer === null) {
          this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 3000);
        }
      });
      this.socket.addEventListener('error', () => {
        // Offline play is a supported state; no need to shout about it.
      });
    } catch {
      this.socket = null;
    }
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private send(payload: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  queue(bowClass: BowClass, name: string): boolean {
    return this.send({ type: 'queue', bowClass, name });
  }

  cancelQueue(): boolean {
    return this.send({ type: 'cancelQueue' });
  }

  /** Submit a shot for authoritative validation. */
  submitShot(request: ShootRequest): boolean {
    return this.send(request);
  }

  /** Build a wire request from a locally simulated outcome. */
  static shotRequest(
    archerId: string,
    gameId: string,
    outcome: ShotOutcome,
    request: ShootRequest,
  ): ShootRequest {
    void outcome;
    return { ...request, archerId, gameId, simulatedAt: Date.now() } as ShootRequest;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}
