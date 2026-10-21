/**
 * Timing and signal state machine.
 *
 * The server is the single source of time in multiplayer; the client runs the
 * same machine locally in single player. Everything here is a pure function of
 * (elapsed seconds, duration, warning offset) so it can be unit tested and
 * replayed from a server message.
 */

import { rules, warningSeconds, type TimingFlow } from './index';

export type SignalPhase = 'prepare' | 'shoot' | 'warning' | 'expired';
export type SignalLight = 'red' | 'green' | 'yellow';

export interface SignalState {
  phase: SignalPhase;
  light: SignalLight;
  /** Seconds left in the end (never negative). */
  remaining: number;
  /** Seconds since the end started. */
  elapsed: number;
  /** True once the clock has run out. */
  expired: boolean;
  /** True when the archer may legally shoot. */
  canShoot: boolean;
  /** True when the warning (yellow) light is showing. */
  warning: boolean;
  /** Human-readable label from the rules config. */
  label: string;
}

export interface EndClockConfig {
  flow: TimingFlow;
  arrowsInEnd: number;
  /** Override the total duration (seconds); 0 = no limit (practice). */
  durationSeconds?: number;
  /** Override the warning offset (seconds before the end). */
  warningBeforeSeconds?: number;
}

export function endClockConfig(flow: TimingFlow, arrowsInEnd: number): EndClockConfig {
  const duration = rules.timing;
  const durationSeconds =
    flow === 'ranking'
      ? duration.rankingEndSeconds
      : flow === 'match'
        ? duration.matchArrowSeconds * Math.max(1, arrowsInEnd)
        : flow === 'team'
          ? duration.teamEndSeconds
          : flow === 'mixedTeam'
            ? duration.mixedTeamEndSeconds
            : flow === 'shootOff'
              ? duration.shootOffArrowSeconds
              : duration.practiceEndSeconds;
  return { flow, arrowsInEnd, durationSeconds, warningBeforeSeconds: warningSeconds(flow) };
}

function phaseLabel(phase: SignalPhase): string {
  const found = rules.signals.phases.find((p) => p.id === phase);
  return found?.label ?? phase;
}

/**
 * Evaluate the signal for an end at `elapsed` seconds.
 *
 * Phase timeline:
 *   0                     -> shoot (green)
 *   duration - warning    -> warning (yellow)
 *   duration              -> expired (red)
 */
export function evaluateSignal(elapsed: number, config: EndClockConfig): SignalState {
  const duration = config.durationSeconds ?? 0;
  const warning = config.warningBeforeSeconds ?? warningSeconds(config.flow);

  // Practice: no clock at all, always green.
  if (duration <= 0) {
    return {
      phase: 'shoot',
      light: 'green',
      remaining: Number.POSITIVE_INFINITY,
      elapsed,
      expired: false,
      canShoot: true,
      warning: false,
      label: phaseLabel('shoot'),
    };
  }

  const remaining = Math.max(0, duration - elapsed);
  if (elapsed >= duration) {
    return {
      phase: 'expired',
      light: 'red',
      remaining: 0,
      elapsed,
      expired: true,
      canShoot: false,
      warning: false,
      label: phaseLabel('expired'),
    };
  }
  if (remaining <= warning) {
    return {
      phase: 'warning',
      light: 'yellow',
      remaining,
      elapsed,
      expired: false,
      canShoot: true,
      warning: true,
      label: phaseLabel('warning'),
    };
  }
  return {
    phase: 'shoot',
    light: 'green',
    remaining,
    elapsed,
    expired: false,
    canShoot: true,
    warning: false,
    label: phaseLabel('shoot'),
  };
}

/** mm:ss for the shot clock HUD. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${rest.toString().padStart(2, '0')}`;
}

/**
 * A tiny clock driver used by the client and the server: it owns the elapsed
 * time and emits phase changes exactly once, so buzzers are never doubled.
 */
export class EndClock {
  private startedAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private lastPhase: SignalPhase | null = null;

  constructor(public config: EndClockConfig) {}

  start(nowMs: number): void {
    this.startedAt = nowMs;
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.lastPhase = null;
  }

  pause(nowMs: number): void {
    if (this.pausedAt === null) this.pausedAt = nowMs;
  }

  resume(nowMs: number): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += nowMs - this.pausedAt;
      this.pausedAt = null;
    }
  }

  elapsed(nowMs: number): number {
    if (this.startedAt === null) return 0;
    const reference = this.pausedAt ?? nowMs;
    return Math.max(0, (reference - this.startedAt - this.pausedTotal) / 1000);
  }

  signal(nowMs: number): SignalState {
    return evaluateSignal(this.elapsed(nowMs), this.config);
  }

  /** Returns the new phase when it changed since the last call, otherwise null. */
  consumePhaseChange(nowMs: number): SignalPhase | null {
    const phase = this.signal(nowMs).phase;
    if (phase !== this.lastPhase) {
      this.lastPhase = phase;
      return phase;
    }
    return null;
  }

  reset(config: EndClockConfig): void {
    this.config = config;
    this.startedAt = null;
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.lastPhase = null;
  }
}
