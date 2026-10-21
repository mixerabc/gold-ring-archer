// Quick smoke probe for shared modules, run with: node scripts/probe.ts
import { launchSpeed, storedEnergyJ } from '../shared/src/physics/bow';
import { simulateShot } from '../shared/src/physics/shot';
import { scoreArrow } from '../shared/src/rules/scoring';
import { DEFAULT_WIND } from '../shared/src/physics/wind';

console.log('score', scoreArrow('wa122', { x: 0, y: 0.01 }));
const spec = {
  bowClass: 'recurve' as const,
  drawWeightLb: 44,
  drawLengthIn: 29,
  braceHeightIn: 8.75,
  letOff: 0,
  peakDrawIn: 21,
};
console.log('energy', storedEnergyJ(spec).toFixed(2));
console.log('speed', launchSpeed(spec, 315, 0.8, 1).toFixed(2));
const t0 = Date.now();
const outcome = simulateShot({
  bowClass: 'recurve',
  distanceM: 50,
  windSeed: 1,
  aim: { x: 0, y: 0 },
  drawFraction: 1,
  holdSeconds: 1.5,
  releaseQuality: 0.9,
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
  wind: DEFAULT_WIND,
});
console.log('sim ms', Date.now() - t0, 'impact', outcome.faceImpact, 'score', outcome.score.label);