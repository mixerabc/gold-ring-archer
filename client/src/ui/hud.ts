/**
 * In-game HUD.
 *
 * DOM only, updated from one `update()` call per frame. The draw meter, the
 * shot clock, the traffic light, the wind box, the set scoreboard and the end
 * arrows are all here; the 3D layer owns the sight picture.
 */

import type { GameMode } from '../state/store';

export interface HudData {
  event: string;
  sub: string;
  meta: string;
  clock: string;
  phase: string;
  light: 'red' | 'green' | 'yellow';
  wind: { speed: number; label: string; clock: number; directionRad: number };
  match: {
    style: 'setSystem' | 'cumulative';
    mine: number;
    theirs: number;
    mySets: number;
    theirSets: number;
    sets: Array<{ mine: number; theirs: number }>;
    opponentName: string;
  } | null;
  end: { number: number; label?: string; arrows: string[]; total: number; arrowsLeft: number; planned: number };
  draw: {
    visible: boolean;
    fraction: number;
    clicker: boolean;
    wall: boolean;
    stamina: number;
    pressure: number;
    hint: string;
  };
  mode: GameMode;
  hint: string;
}

export class Hud {
  readonly root: HTMLDivElement;
  private els: Record<string, HTMLElement> = {};
  private lastArrows = '';

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud__top">
        <div class="hud__event">
          <div class="hud__event-name" data-el="event">PRACTICE</div>
          <div class="hud__event-sub" data-el="sub">70 m · Recurve</div>
          <div class="hud__event-meta" data-el="meta">END 1 · 6 ARROWS</div>
        </div>
        <div class="hud__right">
          <div class="wind-box">
            <div class="wind-box__label">WIND AT 10 m</div>
            <div class="wind-box__row">
              <svg class="wind-arrow" data-el="windArrow" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 L12 21 M12 3 L7 9 M12 3 L17 9" stroke="#f5c518" stroke-width="2" fill="none" stroke-linecap="round"/>
              </svg>
              <div class="wind-box__speed"><span data-el="windSpeed">0.0</span> <small>m/s</small></div>
            </div>
            <div class="wind-box__dir" data-el="windDir">CALM · 12 o'clock</div>
          </div>
          <div class="clock">
            <div class="clock__lights">
              <span class="lamp" data-el="lampRed"></span>
              <span class="lamp" data-el="lampYellow"></span>
              <span class="lamp" data-el="lampGreen"></span>
            </div>
            <div class="clock__time" data-el="clock">--:--</div>
            <div class="clock__phase" data-el="phase">WAITING</div>
          </div>
        </div>
      </div>

      <div class="match-strip" data-el="matchStrip" hidden>
        <div class="match-strip__side is-mine">
          <div class="match-strip__name">YOU</div>
          <div class="match-strip__score" data-el="myScore">0</div>
          <div class="match-strip__sets" data-el="mySets"></div>
        </div>
        <div class="match-strip__vs">VS</div>
        <div class="match-strip__side">
          <div class="match-strip__name" data-el="theirName">AI</div>
          <div class="match-strip__score" data-el="theirScore">0</div>
          <div class="match-strip__sets" data-el="theirSets"></div>
        </div>
      </div>

      <div class="end-panel">
        <div class="end-panel__head">
          <div class="end-panel__label" data-el="endLabel">END 1 · 6 ARROWS</div>
          <div class="end-panel__total" data-el="endTotal">0</div>
        </div>
        <div class="arrow-slots" data-el="slots"></div>
      </div>

      <div class="shot-panel" data-el="shotPanel">
        <div class="draw-meter">
          <div class="draw-meter__fill" data-el="drawFill"></div>
          <div class="draw-meter__clicker" data-el="clickerMark" hidden></div>
          <div class="draw-meter__wall" data-el="wallMark" hidden></div>
        </div>
        <div class="shot-panel__row">
          <span data-el="drawLabel">DRAW</span>
          <span data-el="staminaLabel">STAMINA</span>
        </div>
        <div class="stamina"><i data-el="staminaFill"></i></div>
        <div class="pressure"><i data-el="pressureFill"></i></div>
        <div class="shot-panel__hint" data-el="hint"></div>
      </div>

      <div class="hud__hint">
        <span class="kbd">RMB</span> draw &nbsp; <span class="kbd">F</span> release<br/>
        <span class="kbd">Shift</span> hold breath &nbsp; <span class="kbd">Q</span><span class="kbd">E</span> lean<br/>
        <span class="kbd">C</span> camera &nbsp; <span class="kbd">V</span> spectator &nbsp; <span class="kbd">Esc</span> pause
      </div>

      <div class="center-call" data-el="call">
        <div class="center-call__value" data-el="callValue">10</div>
        <div class="center-call__label" data-el="callLabel">INNER TEN</div>
      </div>

      <div class="reticle" data-el="reticle"></div>
    `;
    parent.appendChild(el);
    this.root = el;
    el.querySelectorAll<HTMLElement>('[data-el]').forEach((node) => {
      this.els[node.dataset.el!] = node;
    });
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? '' : 'none';
  }

  update(data: HudData): void {
    const setText = (key: string, value: string) => {
      const el = this.els[key];
      if (el && el.textContent !== value) el.textContent = value;
    };

    setText('event', data.event);
    setText('sub', data.sub);
    setText('meta', data.meta);
    setText('clock', data.clock);
    setText('phase', data.phase.toUpperCase());
    setText('windSpeed', data.wind.speed.toFixed(1));
    setText('windDir', `${data.wind.label.toUpperCase()} · ${data.wind.clock} o'clock`);

    const arrow = this.els['windArrow'];
    if (arrow) arrow.style.transform = `rotate(${(-data.wind.directionRad * 180) / Math.PI}deg)`;

    // Traffic light.
    const lamps: Array<[string, string]> = [
      ['lampRed', 'red'],
      ['lampYellow', 'yellow'],
      ['lampGreen', 'green'],
    ];
    for (const [key, color] of lamps) {
      const lamp = this.els[key];
      if (lamp) lamp.className = `lamp${data.light === color ? ` is-on-${color}` : ''}`;
    }

    // Match strip.
    const strip = this.els['matchStrip'];
    if (strip) {
      strip.hidden = !data.match;
      if (data.match) {
        setText('myScore', data.match.style === 'setSystem' ? String(data.match.mySets) : String(data.match.mine));
        setText('theirScore', data.match.style === 'setSystem' ? String(data.match.theirSets) : String(data.match.theirs));
        setText('theirName', data.match.opponentName.toUpperCase());
        this.renderSetDots('mySets', data.match.sets.map((s) => s.mine), true);
        this.renderSetDots('theirSets', data.match.sets.map((s) => s.theirs), false);
      }
    }

    // End arrows.
    setText('endLabel', data.end.label ?? `END ${data.end.number} · ${data.end.arrowsLeft} LEFT`);
    setText('endTotal', String(data.end.total));
    const arrowsKey = data.end.arrows.join(',') + `|${data.end.planned}`;
    if (arrowsKey !== this.lastArrows) {
      this.lastArrows = arrowsKey;
      this.renderSlots(data.end.arrows, data.end.planned);
    }

    // Draw meter.
    const panel = this.els['shotPanel'];
    if (panel) panel.classList.toggle('is-visible', data.draw.visible);
    const fill = this.els['drawFill'];
    if (fill) fill.style.width = `${Math.min(100, data.draw.fraction * 100)}%`;
    const clicker = this.els['clickerMark'];
    if (clicker) clicker.hidden = !data.draw.clicker;
    const wall = this.els['wallMark'];
    if (wall) wall.hidden = !data.draw.wall;
    const stamina = this.els['staminaFill'];
    if (stamina) stamina.style.width = `${Math.max(0, Math.min(1, data.draw.stamina)) * 100}%`;
    const pressure = this.els['pressureFill'];
    if (pressure) pressure.style.width = `${Math.max(0, Math.min(1, data.draw.pressure)) * 100}%`;
    setText('hint', data.draw.hint || data.hint);

    const reticle = this.els['reticle'];
    if (reticle) reticle.classList.toggle('is-visible', data.mode === 'practice' && !data.draw.visible);
  }

  private renderSlots(arrows: string[], planned: number): void {
    const slots = this.els['slots'];
    if (!slots) return;
    const count = Math.max(planned, arrows.length, 1);
    const html: string[] = [];
    for (let i = 0; i < count; i++) {
      const label = arrows[i] ?? '';
      let cls = 'arrow-slot';
      if (label === 'X') cls += ' is-x';
      else if (label === '10') cls += ' is-ten';
      else if (label === 'M') cls += ' is-miss';
      else if (!label && i === arrows.length) cls += ' is-current';
      html.push(`<div class="${cls}">${label || (i === arrows.length ? '·' : '')}</div>`);
    }
    slots.innerHTML = html.join('');
  }

  private renderSetDots(key: string, points: number[], mine: boolean): void {
    const el = this.els[key];
    if (!el) return;
    const html = points
      .map((p) => {
        const win = mine ? p === 2 : p === 2;
        return `<span class="set-dot${win ? ' is-win' : p === 1 ? ' is-draw' : ''}">${p}</span>`;
      })
      .join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  showCall(value: string, label: string): void {
    const call = this.els['call'];
    const valueEl = this.els['callValue'];
    const labelEl = this.els['callLabel'];
    if (!call || !valueEl || !labelEl) return;
    valueEl.textContent = value;
    labelEl.textContent = label;
    call.classList.add('is-visible');
    window.setTimeout(() => call.classList.remove('is-visible'), 1400);
  }

  destroy(): void {
    this.root.remove();
  }
}
