/**
 * Debug "Range Test": fire at 30, 50 and 70 m and report drop and wind drift
 * against the reference values the unit tests use.
 *
 * Run with: npm run range-test
 */

import { G, launchSpeed, specFromShot } from '../shared/src/physics/bow';
import { simulateShot } from '../shared/src/physics/shot';
import { DEFAULT_WIND } from '../shared/src/physics/wind';
import { getClassRules } from '../shared/src/rules/index';

const spec = specFromShot({
  bowClass: 'recurve',
  drawWeightLb: 44,
  drawLengthIn: 29,
  braceHeightIn: 8.75,
  letOff: 0,
  peakDrawIn: 21,
  arrowMassGr: 315,
  efficiency: 0.8,
});

const speed = launchSpeed(spec, 315, 0.8, 1);
console.log(`GOLD RING range test — recurve 44 lb, 29" draw, 315 gr`);
console.log(`Muzzle speed: ${speed.toFixed(1)} m/s\n`);
console.log('dist   time    drop(cm)  1/2gt²(cm)  drift(cm)  impact(cm)      score');
console.log('---------------------------------------------------------------------------');

for (const distance of [30, 50, 70]) {
  const t0 = Date.now();
  const outcome = simulateShot({
    bowClass: 'recurve',
    distanceM: distance,
    windSeed: DEFAULT_WIND.seed,
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
    wind: DEFAULT_WIND,
  });

  const t = outcome.flight.timeOfFlight;
  const dropCm = outcome.flight.drop * 100;
  const referenceCm = 0.5 * G * t * t * 100;
  const driftCm = outcome.flight.windDrift * 100;
  const impactCm = `${(outcome.faceImpact.x * 100).toFixed(1)}, ${(outcome.faceImpact.y * 100).toFixed(1)}`;
  const ms = Date.now() - t0;
  console.log(
    `${String(distance).padStart(3)} m  ${t.toFixed(3)}s  ${dropCm.toFixed(1).padStart(8)}  ${referenceCm.toFixed(1).padStart(10)}  ${driftCm.toFixed(1).padStart(8)}  ${impactCm.padEnd(14)}  ${outcome.score.label.padEnd(3)} (${ms} ms)`,
  );
}

console.log('\nWind: 3.2 m/s from 62°, gusts on. At 70 m this pushes the group tens of centimetres right.');
console.log('Tolerance: drop is the closed-form 1/2 g t²; the integrator must match it to <1 mm.');
console.log('Classes:');
for (const id of ['recurve', 'compound', 'barebow'] as const) {
  const cls = getClassRules(id);
  const s = specFromShot({
    bowClass: id,
    drawWeightLb: cls.bow.drawWeightLb.default,
    drawLengthIn: cls.bow.drawLengthIn.default,
    braceHeightIn: cls.bow.braceHeightIn.default,
    letOff: cls.bow.letOff,
    peakDrawIn: 21,
    arrowMassGr: 300,
    efficiency: cls.bow.efficiency,
  });
  console.log(`  ${cls.shortName.padEnd(9)} ${launchSpeed(s, 300, cls.bow.efficiency, 1).toFixed(1)} m/s at ${cls.distanceM} m`);
}
