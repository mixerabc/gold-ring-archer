/**
 * Competition-layer types.
 *
 * The shared package owns the domain types; this file only re-exports the ones
 * the client uses and adds the view-model shapes that are specific to the UI.
 */

export type {
  ArrowImpact,
  ArrowScore,
  BowClass,
  EndResult,
  FormatRules,
  ScoredArrow,
  ShotOutcome,
} from '@shared/types';
export type { RankingEntry } from '@shared/rules/formats';

import type { RankingEntry } from '@shared/rules/formats';
export type RankingEntryLike = RankingEntry;

export interface ArcherProfile {
  id: string;
  name: string;
  country: string;
  skill: number;
  clutch: number;
  style: 'steady' | 'fast' | 'streaky';
}

export interface MatchSide {
  id: string;
  name: string;
  isPlayer: boolean;
  total: number;
  xCount: number;
  setPoints: number;
  ends: number[];
}

export type MatchStatus = 'idle' | 'shooting' | 'waiting' | 'shootOff' | 'finished';
