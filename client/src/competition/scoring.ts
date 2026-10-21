/**
 * Practice analytics and judge calls.
 *
 * The practice range records every impact and reports group size and the mean
 * point of impact, which is how archers actually tune a sight: move the group,
 * not the single arrow. The heat map is drawn on a canvas in face coordinates.
 */

import { faceColorForRing, faceRadiusM, ringRadiusM } from '@shared/rules/index';
import { needsJudgeReview } from '@shared/rules/scoring';
import type { ArrowScore, Vec2 } from '@shared/types';
import type { FaceConfig } from '@shared/types';

export interface GroupStats {
  count: number;
  /** Mean point of impact, metres from the gold centre. */
  mean: Vec2;
  /** Largest centre-to-centre distance in the group, metres. */
  groupSize: number;
  /** Mean distance from the gold centre, metres. */
  meanRadius: number;
  /** Score average per arrow. */
  average: number;
  xCount: number;
}

export function groupStats(impacts: Vec2[], scores: ArrowScore[] = []): GroupStats {
  if (impacts.length === 0) {
    return { count: 0, mean: { x: 0, y: 0 }, groupSize: 0, meanRadius: 0, average: 0, xCount: 0 };
  }
  let sx = 0;
  let sy = 0;
  let sr = 0;
  for (const p of impacts) {
    sx += p.x;
    sy += p.y;
    sr += Math.hypot(p.x, p.y);
  }
  const mean = { x: sx / impacts.length, y: sy / impacts.length };
  let groupSize = 0;
  for (let i = 0; i < impacts.length; i++) {
    for (let j = i + 1; j < impacts.length; j++) {
      groupSize = Math.max(groupSize, Math.hypot(impacts[i].x - impacts[j].x, impacts[i].y - impacts[j].y));
    }
  }
  const total = scores.reduce((s, a) => s + a.value, 0);
  return {
    count: impacts.length,
    mean,
    groupSize,
    meanRadius: sr / impacts.length,
    average: scores.length ? total / scores.length : 0,
    xCount: scores.filter((a) => a.isX).length,
  };
}

/** Draw a top-down heat map of the group on a target face. */
export function drawHeatmap(
  canvas: HTMLCanvasElement,
  impacts: Vec2[],
  face: FaceConfig,
  options: { palette?: 'standard' | 'cbSafe'; showMean?: boolean } = {},
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = 360;
  canvas.width = size;
  canvas.height = size;
  const c = size / 2;
  const radiusM = faceRadiusM(face);
  const px = c / radiusM;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#10161b';
  ctx.fillRect(0, 0, size, size);

  for (let ring = face.rings; ring >= face.minScoringRing; ring--) {
    const r = ringRadiusM(face, ring) * px;
    const hex = faceColorForRing(face, ring);
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = options.palette === 'cbSafe' ? cbColor(hex) : hex;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Impacts as soft dots.
  for (const p of impacts) {
    const x = c + p.x * px;
    const y = c - p.y * px;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, 11);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.35, 'rgba(245,197,24,0.7)');
    gradient.addColorStop(1, 'rgba(245,197,24,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,24,28,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  if (options.showMean !== false && impacts.length > 1) {
    const stats = groupStats(impacts);
    const x = c + stats.mean.x * px;
    const y = c - stats.mean.y * px;
    ctx.strokeStyle = 'rgba(87,166,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 7, y);
    ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x, y + 7);
    ctx.stroke();
  }
}

function cbColor(hex: string): string {
  switch (hex.toLowerCase()) {
    case '#f5c518':
      return '#e0b52a';
    case '#e63946':
    case '#d62828':
      return '#c94f3d';
    case '#1d4ed8':
    case '#1e6fd9':
      return '#2f6fb5';
    case '#111111':
      return '#3b4652';
    default:
      return hex;
  }
}

/** Judge call text for the popup after an arrow. */
export function judgeCall(score: ArrowScore, faceId: string, impact: Vec2, shaftDiameterMm?: number): string {
  if (score.value === 0) return 'Miss.';
  if (needsJudgeReview(faceId, impact, shaftDiameterMm)) {
    return score.lineCut ? `Line cutter — ${score.label}.` : `Close call — judge confirms ${score.label}.`;
  }
  if (score.isX) return 'Inner ten — X.';
  return `${score.label}.`;
}

/** Compact arrow label list for the HUD ("X 10 9 M"). */
export function arrowLabels(scores: ArrowScore[]): string[] {
  return scores.map((s) => s.label);
}
