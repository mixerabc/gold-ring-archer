/**
 * Gear tuning panel.
 *
 * Sliders are generated from the class envelope in the rules config, so a
 * recurve can never be set to 60 lb or a barebow given a sight. The live stats
 * (launch speed, kinetic energy, spine match) are computed with the same bow
 * model the physics uses.
 */

import { launchSpeed, recommendedSpine, spineMatchQuality } from '@shared/physics/bow';
import { findArrow } from '@shared/data/gear';
import type { BowClass, ClassRules, GearSetup } from '@shared/types';
import type { TuningAdvice } from '@shared/data/gear';

export interface GearTuningOptions {
  gear: GearSetup;
  cls: ClassRules;
  advice: TuningAdvice[];
}

interface Row {
  key: keyof GearSetup;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  show: boolean;
}

export function renderGearTuning({ gear, cls, advice }: GearTuningOptions): string {
  const arrow = findArrow(gear.arrowId);
  const spec = {
    bowClass: gear.class,
    drawWeightLb: gear.drawWeightLb,
    drawLengthIn: gear.drawLengthIn,
    braceHeightIn: gear.braceHeightIn,
    letOff: cls.bow.letOff,
    peakDrawIn: 21,
  };
  const speed = launchSpeed(spec, arrow.weightGr, cls.bow.efficiency, 1);
  const spineQ = spineMatchQuality(arrow.spine, gear.drawWeightLb, gear.drawLengthIn, gear.arrowLengthIn);
  const idealSpine = recommendedSpine(gear.drawWeightLb, gear.drawLengthIn, gear.arrowLengthIn);

  const rows: Row[] = [
    { key: 'drawWeightLb', label: 'Draw weight', min: cls.bow.drawWeightLb.min, max: cls.bow.drawWeightLb.max, step: 1, unit: 'lb', show: true },
    { key: 'drawLengthIn', label: 'Draw length', min: cls.bow.drawLengthIn.min, max: cls.bow.drawLengthIn.max, step: 0.25, unit: '"', show: true },
    { key: 'braceHeightIn', label: 'Brace height', min: cls.bow.braceHeightIn.min, max: cls.bow.braceHeightIn.max, step: 0.125, unit: '"', show: true },
    { key: 'tillerMm', label: 'Tiller', min: -6, max: 8, step: 1, unit: 'mm', show: true },
    { key: 'clickerPositionMm', label: 'Clicker position', min: -4, max: 8, step: 0.5, unit: 'mm', show: cls.limits.clicker },
    { key: 'plungerTension', label: 'Plunger tension', min: 0, max: 1, step: 0.05, unit: '', show: !cls.limits.releaseAid },
    { key: 'arrowLengthIn', label: 'Arrow length', min: 26, max: 31, step: 0.25, unit: '"', show: true },
    { key: 'pointWeightGr', label: 'Point weight', min: 70, max: 150, step: 5, unit: 'gr', show: true },
    { key: 'nockHeightMm', label: 'Nock height', min: 0, max: 12, step: 0.5, unit: 'mm', show: true },
    { key: 'sightElevationMm', label: 'Sight elevation', min: 0, max: 80, step: 1, unit: 'mm', show: cls.limits.sight },
    { key: 'sightWindageMm', label: 'Sight windage', min: -20, max: 20, step: 0.5, unit: 'mm', show: cls.limits.sight },
    { key: 'sightExtensionIn', label: 'Sight extension', min: 1, max: 6, step: 0.5, unit: '"', show: cls.limits.sight },
  ];

  return `
    <div class="gear-grid">
      <div class="panel" style="padding:18px">
        <div class="card__meta" style="margin-bottom:6px">${cls.name} · ${gear.handedness}-handed</div>
        ${rows
          .filter((r) => r.show)
          .map((row) => {
            const value = Number(gear[row.key] ?? 0);
            return `<div class="gear-row">
              <label for="gear-${row.key}">${row.label}</label>
              <input id="gear-${row.key}" type="range" min="${row.min}" max="${row.max}" step="${row.step}"
                value="${value}" data-gear="${row.key}" />
              <output>${formatValue(row.key, value)}</output>
            </div>`;
          })
          .join('')}
        <div class="settings-row" style="margin-top:10px">
          <label>Arrow</label>
          <div style="font-size:12px;color:#cfd8e0">${arrow.brand} ${arrow.name} · spine ${arrow.spine} · ${arrow.weightGr} gr</div>
        </div>
        <div class="settings-row">
          <label>Recommended spine</label>
          <div style="font-family:var(--mono);color:${spineQ > 0.85 ? '#3ddc84' : '#f5c518'}">${idealSpine}</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="panel" style="padding:16px">
          <div class="card__meta" style="margin-bottom:10px">Live figures</div>
          <div class="stat-row">
            <div class="stat"><div class="stat__label">Launch speed</div><div class="stat__value stat__value--gold">${speed.toFixed(1)} <small style="font-size:10px;color:#93a1ae">m/s</small></div></div>
            <div class="stat"><div class="stat__label">Kinetic energy</div><div class="stat__value">${(0.5 * arrow.weightGr * 0.00006479891 * speed * speed).toFixed(1)} <small style="font-size:10px;color:#93a1ae">J</small></div></div>
            <div class="stat"><div class="stat__label">Spine match</div><div class="stat__value">${Math.round(spineQ * 100)}%</div></div>
            <div class="stat"><div class="stat__label">Grains / lb</div><div class="stat__value">${(arrow.weightGr / Math.max(1, gear.drawWeightLb)).toFixed(1)}</div></div>
          </div>
        </div>
        <div class="panel" style="padding:16px">
          <div class="card__meta" style="margin-bottom:8px">Draw force curve</div>
          <canvas id="draw-curve" class="curve-canvas"></canvas>
        </div>
        <div class="panel" style="padding:14px;display:flex;flex-direction:column;gap:7px">
          ${advice
            .map(
              (a) =>
                `<div class="advice${a.severity === 'warning' ? ' advice--warning' : a.severity === 'ok' ? ' advice--ok' : ''}">${a.message}</div>`,
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function formatValue(key: keyof GearSetup, value: number): string {
  switch (key) {
    case 'drawWeightLb':
      return `${value.toFixed(0)} lb`;
    case 'drawLengthIn':
    case 'braceHeightIn':
    case 'arrowLengthIn':
    case 'sightExtensionIn':
      return `${value.toFixed(2).replace(/0$/, '')}"`;
    case 'plungerTension':
      return value.toFixed(2);
    case 'pointWeightGr':
      return `${value.toFixed(0)} gr`;
    default:
      return `${value.toFixed(1).replace(/\.0$/, '')} mm`;
  }
}

export function gearClassOf(gear: GearSetup): BowClass {
  return gear.class;
}
