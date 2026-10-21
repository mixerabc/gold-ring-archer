/**
 * Draw controller: the feel of the bow, separated from the rendering.
 *
 * It owns the draw fraction, the clicker/wall events, the hold timer, stamina
 * and the release quality. The 3D layer only reads `drawFraction` to bend the
 * limbs and move the string; the physics layer receives `releaseQuality`.
 *
 * The model is deliberately explainable:
 *   - recurve/barebow: near-linear force, no wall, a clicker at full draw;
 *   - compound: cams, a hard wall, a let-off valley and a mechanical release
 *     that punishes punching the trigger.
 */

import { bowFeel, type BowFeel } from '@shared/physics/bow';
import { clamp } from '@shared/math/random';
import type { BowClass } from '@shared/types';

export interface DrawConfig {
  bowClass: BowClass;
  drawWeightLb: number;
  letOff: number;
  /** Difficulty multiplier on the human error (1 = standard). */
  errorScale: number;
  /** Full-draw threshold, 0..1. */
  fullDraw: number;
}

export interface ReleaseReport {
  quality: number;
  /** 0..1.02 draw at the moment of release. */
  drawFraction: number;
  holdSeconds: number;
  /** True when the clicker had not been reached (recurve). */
  shortOfClicker: boolean;
  /** True when a compound trigger was punched before the wall. */
  punchedTrigger: boolean;
  /** True when the release collapsed (let down while releasing). */
  collapsed: boolean;
  /** True when the archer held past the fatigue budget. */
  fatigued: boolean;
  notes: string[];
}

export class DrawController {
  readonly config: DrawConfig;
  readonly feel: BowFeel;

  draw = 0;
  drawing = false;
  /** Seconds spent at (or very near) full draw during this shot. */
  holdSeconds = 0;
  /** 0..1; 1 = fresh. */
  stamina = 1;
  clickerPassed = false;
  wallReached = false;
  /** Set by the game when the arrow is nocked and the archer may draw. */
  armed = true;

  /** Visual tremor amplitude (0..1), also read by the camera and the bow mesh. */
  tremor = 0;

  constructor(config: DrawConfig) {
    this.config = config;
    this.feel = bowFeel(config.bowClass, config.drawWeightLb, config.letOff);
  }

  get isFullDraw(): boolean {
    return this.draw >= this.config.fullDraw;
  }

  /** Normalised holding effort 0..1 (compound holds much less at the wall). */
  get holdingEffort(): number {
    return this.feel.holdingLb / Math.max(1, this.config.drawWeightLb);
  }

  /** Reset for the next arrow. */
  reset(): void {
    this.draw = 0;
    this.drawing = false;
    this.holdSeconds = 0;
    this.clickerPassed = false;
    this.wallReached = false;
    this.tremor = 0;
    this.armed = true;
  }

  /**
   * Advance the draw.
   *
   * @param dt seconds
   * @param holding true while the draw control is held
   * @param breathHeld true while the archer is holding their breath (steadier,
   *   but stamina drains faster)
   */
  update(dt: number, holding: boolean, breathHeld = false): void {
    if (!this.armed) return;
    this.drawing = holding;

    const classRate =
      this.config.bowClass === 'compound' ? 0.62 : this.config.bowClass === 'barebow' ? 0.55 : 0.58;
    // A tired archer draws more slowly.
    const fatigueRate = 0.75 + 0.25 * this.stamina;

    if (holding) {
      // Compound cams roll over: the last part of the draw is quick into the wall.
      const ease = this.config.bowClass === 'compound' && this.draw > 0.82 ? 1.55 : 1;
      this.draw = clamp(this.draw + dt * classRate * fatigueRate * ease, 0, 1);

      if (this.isFullDraw) {
        this.holdSeconds += dt;
        // Holding weight drains stamina; a compound at let-off drains far less.
        const drain = (0.055 + 0.075 * this.holdingEffort) * (breathHeld ? 1.35 : 1);
        this.stamina = clamp(this.stamina - dt * drain, 0, 1);
      } else {
        this.stamina = clamp(this.stamina - dt * 0.012, 0, 1);
      }
    } else if (this.draw > 0) {
      // Letting down: controlled, a little faster than drawing.
      this.draw = clamp(this.draw - dt * 0.95, 0, 1);
      this.holdSeconds = 0;
      this.clickerPassed = false;
      this.wallReached = false;
      this.stamina = clamp(this.stamina + dt * 0.16, 0, 1);
    } else {
      this.stamina = clamp(this.stamina + dt * 0.2, 0, 1);
      this.holdSeconds = 0;
    }

    // Clicker: a recurve's clicker is set just past full draw.
    if (this.feel.clicker && this.draw >= 0.995) this.clickerPassed = true;
    if (this.config.bowClass === 'compound' && this.draw >= 0.995) this.wallReached = true;

    // Tremor: grows with time past the comfort budget and with low stamina.
    const overHold = Math.max(0, this.holdSeconds - this.feel.holdBudgetS);
    const fatigue = clamp(overHold / 5, 0, 1.6);
    const lowStamina = 1 - this.stamina;
    this.tremor = clamp(
      (0.16 + fatigue * 0.55 + lowStamina * 0.5) * this.feel.holdStability * (this.draw > 0.5 ? 1 : 0.3),
      0,
      1.6,
    );
  }

  /**
   * Release the string.
   *
   * @param triggered true when the archer asked for the shot (F / trigger).
   *   Releasing the draw control also releases, but is treated as a relaxation
   *   of the fingers rather than a deliberate trigger.
   */
  release(triggered: boolean): ReleaseReport {
    const notes: string[] = [];
    const drawFraction = this.draw;
    const full = this.config.fullDraw;

    let quality = 1;

    // Under-draw: the bow never reached the wall/clicker.
    if (drawFraction < full) {
      quality -= (full - drawFraction) * 2.4;
      notes.push('Released short of full draw: the arrow leaves slower and low.');
    }

    // Recurve clicker.
    const shortOfClicker = this.feel.clicker && !this.clickerPassed;
    if (shortOfClicker) {
      quality -= 0.16;
      notes.push('The clicker never clicked: the draw was not completed.');
    }

    // Compound: punching the trigger before the wall is a flinch.
    const punchedTrigger = this.config.bowClass === 'compound' && triggered && !this.wallReached;
    if (punchedTrigger) {
      quality -= 0.34;
      notes.push('Punched the trigger before the wall: the shot was torqued off target.');
    }

    // Collapsing release: letting the draw control go while still creeping forward.
    const collapsed = !triggered && this.drawing && drawFraction > 0.8;
    if (collapsed) {
      quality -= 0.1;
      notes.push('Collapsing release: the fingers opened instead of relaxing back.');
    }

    // Hold fatigue / target panic.
    const overHold = Math.max(0, this.holdSeconds - this.feel.holdBudgetS);
    const fatigued = overHold > 0;
    if (fatigued) {
      quality -= clamp(overHold / 6, 0, 0.45);
      notes.push(`Held ${overHold.toFixed(1)} s past the comfort window: target panic creeping in.`);
    }

    // Low stamina.
    quality -= (1 - this.stamina) * 0.12;

    // Release sensitivity differs per class (compound is the cleanest, barebow
    // the most punishing because the fingers are on the string).
    quality = 1 - (1 - clamp(quality, 0, 1)) * this.feel.releaseSensitivity;
    quality = clamp(quality * this.config.errorScale, 0, 1);

    if (quality > 0.93) notes.push('Clean release.');
    else if (quality < 0.6) notes.push('Rough release: expect a wide arrow.');

    this.armed = false;

    return {
      quality,
      drawFraction,
      holdSeconds: this.holdSeconds,
      shortOfClicker,
      punchedTrigger,
      collapsed,
      fatigued,
      notes,
    };
  }

  /** Reset stamina between ends (archers recover during the break). */
  recover(seconds: number): void {
    this.stamina = clamp(this.stamina + seconds * 0.05, 0, 1);
  }
}
