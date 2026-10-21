/**
 * Gear helpers: turn the equipment catalogue + a player's setup into the values
 * the physics and the renderer need, and give tuning advice.
 */

import catalogJson from './equipment.json';
import { getClassRules, rules } from '../rules/index';
import { recommendedSpine, spineMatchQuality } from '../physics/bow';
import type {
  ArrowSpecData,
  BowClass,
  EquipmentCatalog,
  GearSetup,
  RiserData,
  SightData,
  StabiliserData,
} from '../types';

export const catalog: EquipmentCatalog = catalogJson as unknown as EquipmentCatalog;

export function findRiser(id: string): RiserData {
  const found = catalog.risers.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown riser: ${id}`);
  return found;
}

export function findArrow(id: string): ArrowSpecData {
  const found = catalog.arrows.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown arrow: ${id}`);
  return found;
}

export function findSight(id: string | undefined): SightData | undefined {
  return id ? catalog.sights.find((s) => s.id === id) : undefined;
}

export function findStabiliser(id: string | undefined): StabiliserData | undefined {
  return id ? catalog.stabilisers.find((s) => s.id === id) : undefined;
}

/** A sensible, legal default setup for each bow class. */
export function defaultGear(bowClass: BowClass): GearSetup {
  const cls = getClassRules(bowClass);
  switch (bowClass) {
    case 'recurve':
      return {
        class: bowClass,
        riserId: 'riser-aurelian-forge-25',
        limbId: 'limb-northwind-zephyr',
        drawWeightLb: 44,
        drawLengthIn: 29,
        braceHeightIn: cls.bow.braceHeightIn.default,
        tillerMm: 3,
        clickerPositionMm: 0,
        plungerTension: 0.55,
        arrowId: 'arrow-fletchworks-carbon-500',
        arrowLengthIn: 29,
        pointWeightGr: 100,
        sightId: 'sight-meridian-pin',
        sightExtensionIn: 3,
        sightElevationMm: 80,
        sightWindageMm: 0,
        stabiliserId: 'stab-kestrel-long-30',
        restId: 'rest-meridian-magnetic',
        stringId: 'string-cordis-fast',
        tabId: 'tab-cordis-calfhair',
        nockHeightMm: 5,
        handedness: 'right',
      };
    case 'compound':
      return {
        class: bowClass,
        riserId: 'riser-ironwood-apex',
        limbId: 'limb-ironwood-torque',
        drawWeightLb: 55,
        drawLengthIn: 28.5,
        braceHeightIn: cls.bow.braceHeightIn.default,
        tillerMm: 0,
        clickerPositionMm: 0,
        plungerTension: 0,
        arrowId: 'arrow-fletchworks-ace-380',
        arrowLengthIn: 28,
        pointWeightGr: 120,
        sightId: 'sight-meridian-scope-4',
        sightExtensionIn: 4,
        sightElevationMm: 22,
        sightWindageMm: 0,
        stabiliserId: 'stab-kestrel-long-30',
        releaseId: 'release-talon-thumb',
        restId: 'rest-meridian-dropaway',
        stringId: 'string-cordis-fast',
        tabId: 'tab-cordis-glove',
        nockHeightMm: 6,
        handedness: 'right',
      };
    case 'barebow':
    default:
      return {
        class: 'barebow',
        riserId: 'riser-aurelian-aria-23',
        limbId: 'limb-northwind-boreal',
        drawWeightLb: 38,
        drawLengthIn: 29,
        braceHeightIn: cls.bow.braceHeightIn.default,
        tillerMm: 3,
        clickerPositionMm: 0,
        plungerTension: 0.5,
        arrowId: 'arrow-fletchworks-feather-450',
        arrowLengthIn: 29,
        pointWeightGr: 100,
        sightElevationMm: 0,
        sightWindageMm: 0,
        restId: 'rest-meridian-magnetic',
        stringId: 'string-cordis-smooth',
        tabId: 'tab-cordis-cordovan',
        nockHeightMm: 5,
        handedness: 'right',
      };
  }
}

/**
 * Remove equipment that is illegal for the class (barebow must have no sight and
 * no stabiliser; compound must have a release aid). Returns a clean copy.
 */
export function sanitizeGear(setup: GearSetup): GearSetup {
  const limits = getClassRules(setup.class).limits;
  const clean: GearSetup = { ...setup };
  if (!limits.sight) {
    delete clean.sightId;
    delete clean.sightExtensionIn;
    clean.sightElevationMm = 0;
    clean.sightWindageMm = 0;
  }
  if (!limits.stabiliser) {
    delete clean.stabiliserId;
  }
  if (!limits.releaseAid) {
    delete clean.releaseId;
  }
  // Clamp weight/length into the class envelope.
  const bow = getClassRules(setup.class).bow;
  clean.drawWeightLb = clampRange(clean.drawWeightLb, bow.drawWeightLb.min, bow.drawWeightLb.max);
  clean.drawLengthIn = clampRange(clean.drawLengthIn, bow.drawLengthIn.min, bow.drawLengthIn.max);
  clean.braceHeightIn = clampRange(clean.braceHeightIn, bow.braceHeightIn.min, bow.braceHeightIn.max);
  return clean;
}

function clampRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface TuningAdvice {
  severity: 'ok' | 'info' | 'warning';
  message: string;
}

/**
 * The "recommended setup" helper on the gear tuning screen. Every message names
 * the value it wants and why, so the player learns the real relationship.
 */
export function tuningAdvice(setup: GearSetup): TuningAdvice[] {
  const advice: TuningAdvice[] = [];
  const cls = getClassRules(setup.class);
  const arrow = findArrow(setup.arrowId);

  const spineQ = spineMatchQuality(
    arrow.spine,
    setup.drawWeightLb,
    setup.drawLengthIn,
    setup.arrowLengthIn,
  );
  const ideal = recommendedSpine(setup.drawWeightLb, setup.drawLengthIn, setup.arrowLengthIn);

  if (spineQ < 0.75) {
    const direction = arrow.spine > ideal ? 'stiffer (lower spine number)' : 'softer (higher spine number)';
    advice.push({
      severity: 'warning',
      message: `Arrow spine ${arrow.spine} is off for ${setup.drawWeightLb} lb at ${setup.drawLengthIn}" draw. Try about ${ideal} — you need a ${direction} shaft.`,
    });
  } else {
    advice.push({
      severity: 'ok',
      message: `Arrow spine ${arrow.spine} matches the bow (ideal ≈ ${ideal}).`,
    });
  }

  if (arrow.lengthIn > setup.drawLengthIn + 1.5) {
    advice.push({
      severity: 'info',
      message: `Arrows are ${(arrow.lengthIn - setup.drawLengthIn).toFixed(1)}" longer than your draw: safe, but a longer shaft is softer dynamically.`,
    });
  }

  if (setup.drawWeightLb > arrow.recommendedDrawWeightLb.max) {
    advice.push({
      severity: 'warning',
      message: `${setup.drawWeightLb} lb is above this shaft's recommended range (${arrow.recommendedDrawWeightLb.min}-${arrow.recommendedDrawWeightLb.max} lb).`,
    });
  }

  if (setup.class === 'compound' && !setup.releaseId) {
    advice.push({ severity: 'warning', message: 'Compound needs a release aid; add one in the equipment screen.' });
  }
  if (setup.class === 'barebow' && setup.sightId) {
    advice.push({ severity: 'warning', message: 'Barebow may not use a sight. It has been removed.' });
  }
  if (setup.class === 'barebow' && setup.stabiliserId) {
    advice.push({ severity: 'warning', message: 'Barebow may not use a stabiliser. It has been removed.' });
  }

  if (setup.braceHeightIn < cls.bow.braceHeightIn.min + 0.2) {
    advice.push({ severity: 'info', message: 'Low brace height: faster but harsher; the bow is less forgiving.' });
  }
  if (setup.braceHeightIn > cls.bow.braceHeightIn.max - 0.2) {
    advice.push({ severity: 'info', message: 'High brace height: quieter and more forgiving, slightly slower.' });
  }

  if (Math.abs(setup.tillerMm) > 6) {
    advice.push({
      severity: 'info',
      message: `Tiller ${setup.tillerMm} mm is far from neutral; the bow will want to roll in the hand.`,
    });
  }

  return advice;
}

/** Rulebook reminder shown in the tuning screen header. */
export const TUNING_RULE_NOTE =
  'Barebow: no sight, no stabiliser, no clicker. Compound: release aid required, let-off must stay inside the division limits. ' +
  `Values shown are from the ${rules.meta.rulebook.edition} ruleset.`;
