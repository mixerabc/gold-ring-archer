/**
 * WebSocket matchmaking and server-authoritative online duels.
 *
 * The server owns everything that can be contested:
 *   - the queue and the room,
 *   - the end clock (3 arrows, 60 s),
 *   - every shot's validity and score (shared physics replay),
 *   - the end totals and the match winner.
 *
 * Format: five ends of three arrows, cumulative score, X count as the
 * tie-break. That is deliberately the simplest format that still exercises
 * every part of the rules pipeline, and it works for all three divisions.
 */

import type { WebSocket } from 'ws';
import { EndClock, endClockConfig, formatClock } from '@gold-ring/shared/rules/timing';
import type { ArrowScore, BowClass } from '@gold-ring/shared/types';
import { validateShot } from '../services/validation';

interface Client {
  id: string;
  socket: WebSocket;
  name: string;
  bowClass: BowClass;
  roomId: string | null;
  lastShotAt: number;
  shots: number;
}

interface RoomPlayer {
  client: Client;
  /** Arrows in the current end. */
  arrows: ArrowScore[];
  /** Completed end totals. */
  endTotals: number[];
  total: number;
  xCount: number;
}

interface Room {
  id: string;
  players: [RoomPlayer, RoomPlayer];
  clock: EndClock;
  broadcastTimer: NodeJS.Timeout | null;
  breakTimer: NodeJS.Timeout | null;
  endIndex: number;
  arrowsPerEnd: number;
  totalEnds: number;
  state: 'shooting' | 'break' | 'finished';
  closed: boolean;
}

let nextClient = 1;
let nextRoom = 1;

const ARROWS_PER_END = 3;
const TOTAL_ENDS = 5;

export class MatchServer {
  private clients = new Map<WebSocket, Client>();
  private rooms = new Map<string, Room>();
  private queue: Client[] = [];

  handleConnection(socket: WebSocket): void {
    const client: Client = {
      id: `c-${nextClient++}`,
      socket,
      name: 'Archer',
      bowClass: 'recurve',
      roomId: null,
      lastShotAt: 0,
      shots: 0,
    };
    this.clients.set(socket, client);
    this.send(socket, { type: 'welcome', clientId: client.id, serverTime: Date.now() });

    socket.on('message', (data) => this.onMessage(client, String(data)));
    socket.on('close', () => this.onClose(client));
    socket.on('error', () => this.onClose(client));
  }

  private onMessage(client: Client, raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.send(client.socket, { type: 'error', message: 'Malformed JSON.' });
      return;
    }

    switch (message.type) {
      case 'queue':
        client.name = typeof message.name === 'string' ? message.name.slice(0, 32) : client.name;
        client.bowClass = message.bowClass === 'compound' || message.bowClass === 'barebow' ? message.bowClass : 'recurve';
        this.enqueue(client);
        break;
      case 'cancelQueue':
        this.queue = this.queue.filter((c) => c !== client);
        this.send(client.socket, { type: 'queued', position: 0, cancelled: true });
        break;
      case 'shoot':
        this.onShoot(client, message);
        break;
      case 'ping':
        this.send(client.socket, { type: 'pong', serverTime: Date.now() });
        break;
      default:
        this.send(client.socket, { type: 'error', message: `Unknown message type: ${String(message.type)}` });
    }
  }

  private enqueue(client: Client): void {
    if (client.roomId) return;
    if (this.queue.includes(client)) return;
    const opponent = this.queue.find((c) => c !== client && c.bowClass === client.bowClass);
    if (opponent) {
      this.queue = this.queue.filter((c) => c !== opponent && c !== client);
      this.createRoom(opponent, client);
      return;
    }
    this.queue.push(client);
    this.send(client.socket, { type: 'queued', position: this.queue.length });
  }

  private createRoom(a: Client, b: Client): void {
    const room: Room = {
      id: `r-${nextRoom++}`,
      players: [this.makePlayer(a), this.makePlayer(b)],
      clock: new EndClock(endClockConfig('match', ARROWS_PER_END)),
      broadcastTimer: null,
      breakTimer: null,
      endIndex: 0,
      arrowsPerEnd: ARROWS_PER_END,
      totalEnds: TOTAL_ENDS,
      state: 'shooting',
      closed: false,
    };
    a.roomId = room.id;
    b.roomId = room.id;
    this.rooms.set(room.id, room);

    this.send(a.socket, {
      type: 'matchFound',
      roomId: room.id,
      opponent: b.name,
      lane: 0,
      format: 'cumulative',
      arrowsPerEnd: ARROWS_PER_END,
      ends: TOTAL_ENDS,
    });
    this.send(b.socket, {
      type: 'matchFound',
      roomId: room.id,
      opponent: a.name,
      lane: 1,
      format: 'cumulative',
      arrowsPerEnd: ARROWS_PER_END,
      ends: TOTAL_ENDS,
    });

    this.startEnd(room);
  }

  private makePlayer(client: Client): RoomPlayer {
    return { client, arrows: [], endTotals: [], total: 0, xCount: 0 };
  }

  private startEnd(room: Room): void {
    if (room.closed) return;
    room.endIndex++;
    room.state = 'shooting';
    for (const player of room.players) player.arrows = [];

    room.clock.reset(endClockConfig('match', room.arrowsPerEnd));
    room.clock.start(Date.now());
    if (room.broadcastTimer) clearInterval(room.broadcastTimer);
    room.broadcastTimer = setInterval(() => this.tick(room), 250);

    for (const player of room.players) {
      this.send(player.client.socket, {
        type: 'endStart',
        end: room.endIndex,
        ends: room.totalEnds,
        arrowsPerEnd: room.arrowsPerEnd,
        clock: this.clockPayload(room),
      });
    }
    this.broadcastState(room);
  }

  private tick(room: Room): void {
    if (room.closed) return;
    const signal = room.clock.signal(Date.now());
    for (const player of room.players) {
      this.send(player.client.socket, {
        type: 'signal',
        state: {
          phase: signal.phase,
          light: signal.light,
          remaining: Number.isFinite(signal.remaining) ? signal.remaining : 0,
          elapsed: signal.elapsed,
          expired: signal.expired,
          clock: formatClock(signal.remaining),
          end: room.endIndex,
        },
      });
    }

    if (signal.expired && room.state === 'shooting') {
      // Time is up: every arrow not shot is a miss.
      for (const player of room.players) {
        while (player.arrows.length < room.arrowsPerEnd) {
          player.arrows.push({ value: 0, isX: false, lineCut: false, radius: 0, label: 'M' });
        }
      }
      this.closeEnd(room);
    }
  }

  private onShoot(client: Client, message: Record<string, unknown>): void {
    if (!client.roomId) {
      this.send(client.socket, { type: 'error', message: 'Join a match before shooting.' });
      return;
    }
    const room = this.rooms.get(client.roomId);
    if (!room) return;
    const player = room.players.find((p) => p.client === client);
    if (!player) return;

    if (room.state !== 'shooting') {
      this.send(client.socket, {
        type: 'shotResult',
        result: {
          type: 'shotResult',
          gameId: room.id,
          arrowId: `${client.id}-${client.shots}`,
          accepted: false,
          reason: 'late',
          notes: ['The end is closed.'],
        },
      });
      return;
    }
    if (player.arrows.length >= room.arrowsPerEnd) {
      this.send(client.socket, {
        type: 'shotResult',
        result: {
          type: 'shotResult',
          gameId: room.id,
          arrowId: `${client.id}-${client.shots}`,
          accepted: false,
          reason: 'invalid',
          notes: ['You have already shot all arrows in this end.'],
        },
      });
      return;
    }

    const now = Date.now();
    if (now - client.lastShotAt < 300) {
      this.send(client.socket, { type: 'error', message: 'Shots are arriving too quickly.' });
      return;
    }
    client.lastShotAt = now;
    client.shots++;

    const signal = room.clock.signal(now);
    const result = validateShot(message);
    const inTime = signal.canShoot;
    const accepted = result.accepted && inTime;
    const score: ArrowScore =
      result.outcome && inTime
        ? result.outcome.score
        : { value: 0, isX: false, lineCut: false, radius: 0, label: 'M' };

    if (accepted) {
      player.arrows.push(score);
      player.total += score.value;
      if (score.isX) player.xCount++;
    }

    this.send(client.socket, {
      type: 'shotResult',
      result: {
        type: 'shotResult',
        gameId: room.id,
        arrowId: `${client.id}-${client.shots}`,
        accepted,
        reason: !inTime ? (signal.expired ? 'late' : 'early') : result.reason,
        score,
        flight: result.outcome
          ? {
              impact: result.outcome.flight.impact,
              samples: result.outcome.flight.samples,
              timeOfFlight: result.outcome.flight.timeOfFlight,
              maxHeight: result.outcome.flight.maxHeight,
              windDrift: result.outcome.flight.windDrift,
              drop: result.outcome.flight.drop,
              hitGround: result.outcome.flight.hitGround,
            }
          : undefined,
        muzzleSpeed: result.outcome?.muzzleSpeed,
        notes: [result.message, ...(result.outcome?.notes ?? [])],
      },
    });

    this.broadcastState(room);

    if (room.players.every((p) => p.arrows.length >= room.arrowsPerEnd)) {
      this.closeEnd(room);
    }
  }

  private closeEnd(room: Room): void {
    if (room.closed || room.state !== 'shooting') return;
    room.state = 'break';
    if (room.broadcastTimer) clearInterval(room.broadcastTimer);
    room.broadcastTimer = null;

    for (const player of room.players) {
      const endTotal = player.arrows.reduce((sum, a) => sum + a.value, 0);
      player.endTotals.push(endTotal);
    }

    const finished = room.endIndex >= room.totalEnds;
    for (const player of room.players) {
      const other = room.players.find((p) => p !== player)!;
      this.send(player.client.socket, {
        type: 'endResult',
        end: room.endIndex,
        ends: room.totalEnds,
        myEndTotal: player.endTotals[player.endTotals.length - 1],
        theirEndTotal: other.endTotals[other.endTotals.length - 1],
        myTotal: player.total,
        theirTotal: other.total,
        myX: player.xCount,
        theirX: other.xCount,
        myArrows: player.arrows,
        theirArrows: other.arrows,
        finished,
        clock: this.clockPayload(room),
      });
    }

    if (finished) {
      this.finish(room);
      return;
    }

    room.breakTimer = setTimeout(() => {
      room.breakTimer = null;
      this.startEnd(room);
    }, 4000);
  }

  private finish(room: Room): void {
    room.closed = true;
    room.state = 'finished';
    if (room.broadcastTimer) clearInterval(room.broadcastTimer);
    if (room.breakTimer) clearTimeout(room.breakTimer);
    room.broadcastTimer = null;
    room.breakTimer = null;

    const [a, b] = room.players;
    let winner: 0 | 1 | null = null;
    if (a.total !== b.total) winner = a.total > b.total ? 0 : 1;
    else if (a.xCount !== b.xCount) winner = a.xCount > b.xCount ? 0 : 1;

    room.players.forEach((player, index) => {
      const other = room.players[1 - index];
      this.send(player.client.socket, {
        type: 'matchOver',
        winner: winner === null ? 'draw' : winner === index ? 'you' : 'opponent',
        myTotal: player.total,
        theirTotal: other.total,
        myX: player.xCount,
        theirX: other.xCount,
        opponent: other.client.name,
        ends: player.endTotals,
        theirEnds: other.endTotals,
      });
    });

    this.rooms.delete(room.id);
    for (const player of room.players) player.client.roomId = null;
  }

  private broadcastState(room: Room): void {
    if (room.closed) return;
    room.players.forEach((player) => {
      const other = room.players.find((p) => p !== player)!;
      this.send(player.client.socket, {
        type: 'matchState',
        end: room.endIndex,
        ends: room.totalEnds,
        arrowsPerEnd: room.arrowsPerEnd,
        state: room.state,
        my: this.playerPayload(player),
        opponent: this.playerPayload(other),
        clock: this.clockPayload(room),
      });
    });
  }

  private playerPayload(player: RoomPlayer): {
    name: string;
    total: number;
    xCount: number;
    endTotal: number;
    arrowsLeft: number;
    arrows: ArrowScore[];
    endTotals: number[];
  } {
    return {
      name: player.client.name,
      total: player.total,
      xCount: player.xCount,
      endTotal: player.arrows.reduce((sum, a) => sum + a.value, 0),
      arrowsLeft: Math.max(0, ARROWS_PER_END - player.arrows.length),
      arrows: player.arrows,
      endTotals: player.endTotals,
    };
  }

  private clockPayload(room: Room): { remaining: number; phase: string; light: string; clock: string } {
    const signal = room.clock.signal(Date.now());
    return {
      remaining: Number.isFinite(signal.remaining) ? signal.remaining : 0,
      phase: signal.phase,
      light: signal.light,
      clock: formatClock(signal.remaining),
    };
  }

  private onClose(client: Client): void {
    this.queue = this.queue.filter((c) => c !== client);
    if (client.roomId) {
      const room = this.rooms.get(client.roomId);
      if (room) {
        room.closed = true;
        if (room.broadcastTimer) clearInterval(room.broadcastTimer);
        if (room.breakTimer) clearTimeout(room.breakTimer);
        this.rooms.delete(room.id);
        for (const player of room.players) {
          if (player.client === client) continue;
          player.client.roomId = null;
          this.send(player.client.socket, { type: 'error', message: 'Opponent disconnected.' });
        }
      }
    }
    this.clients.delete(client.socket);
  }

  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  }

  stats(): { clients: number; rooms: number; queued: number } {
    return { clients: this.clients.size, rooms: this.rooms.size, queued: this.queue.length };
  }

  close(): void {
    for (const room of this.rooms.values()) {
      if (room.broadcastTimer) clearInterval(room.broadcastTimer);
      if (room.breakTimer) clearTimeout(room.breakTimer);
    }
    this.rooms.clear();
    this.queue = [];
  }
}
