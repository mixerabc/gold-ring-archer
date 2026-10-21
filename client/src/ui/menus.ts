/**
 * Menus and full-screen views.
 *
 * The overlay is plain DOM built from templates: no framework, no virtual DOM,
 * no per-frame cost. Every screen is rebuilt when it is shown, and interactive
 * elements are handled by one delegated click listener using `data-action`.
 */

import { getClassRules, getFace, isRulesVerified, rules } from '@shared/rules/index';
import { defaultGear, tuningAdvice } from '@shared/data/gear';
import type { BowClass, GearSetup } from '@shared/types';
import { gameState, type GameMode, type QualityPreset, type Screen, type Settings, type VenueId } from '../state/store';
import type { Tournament } from '../competition/bracket';
import { renderGearTuning } from './gearTuning';
import type { TimeOfDay, Weather } from '../render/lighting';

export interface ResultsRow {
  name: string;
  detail: string;
  score: number;
  xCount: number;
  isMe: boolean;
}

export interface ResultsData {
  title: string;
  subtitle: string;
  rows: ResultsRow[];
  stats: Array<{ label: string; value: string }>;
  medal: 'gold' | 'silver' | 'bronze' | null;
  canRematch: boolean;
  canContinue: boolean;
}

export interface UIActions {
  begin: (mode: GameMode) => void;
  open: (screen: Screen) => void;
  back: () => void;
  resume: () => void;
  pause: () => void;
  restart: () => void;
  quit: () => void;
  next: () => void;
  setMode: (mode: GameMode) => void;
  setClass: (bowClass: BowClass) => void;
  setVenue: (venue: VenueId) => void;
  patchSettings: (patch: Partial<Settings>) => void;
  patchCamera: (patch: Partial<Settings['camera']>) => void;
  patchGear: (patch: Partial<GearSetup>) => void;
  setEnvironment: (time: TimeOfDay, weather: Weather) => void;
  openLeaderboard: () => void;
  queueOnline: (name: string) => void;
  cancelQueue: () => void;
  uiSound: () => void;
}

export class Menus {
  readonly root: HTMLDivElement;
  private actions: UIActions;
  private getState: () => {
    screen: Screen;
    bowClass: BowClass;
    venue: VenueId;
    gear: GearSetup;
    settings: Settings;
  };
  private results: ResultsData | null = null;
  private leaderboard: { rows: Array<{ name: string; score: number; xCount: number; bowClass: string; playedAt: string }>; status: string } | null = null;
  private bracket: Tournament | null = null;
  private current: Screen = 'menu';

  constructor(parent: HTMLElement, actions: UIActions, getState: Menus['getState']) {
    this.actions = actions;
    this.getState = getState;
    this.root = document.createElement('div');
    this.root.className = 'screen-host';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (event) => this.onClick(event));
    this.root.addEventListener('input', (event) => this.onInput(event));
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action!;
    this.actions.uiSound();

    if (action.startsWith('mode:')) {
      const mode = action.slice(5) as GameMode;
      this.pendingMode = mode;
      this.actions.setMode(mode);
      if (mode === 'tutorial') {
        this.actions.open('tutorial');
      } else if (mode === 'online') {
        this.actions.open('online');
      } else {
        this.actions.open('class');
      }
      return;
    }
    if (action.startsWith('class:')) {
      this.actions.setClass(action.slice(6) as BowClass);
      this.show('class');
      return;
    }
    if (action.startsWith('venue:')) {
      this.actions.setVenue(action.slice(6) as VenueId);
      this.show('venue');
      return;
    }
    if (action.startsWith('screen:')) {
      this.actions.open(action.slice(7) as Screen);
      return;
    }
    if (action === 'leaderboard') {
      this.actions.openLeaderboard();
      return;
    }
    if (action === 'queue-online') {
      const input = document.getElementById('online-name') as HTMLInputElement | null;
      this.actions.queueOnline(input?.value?.trim() || 'Archer');
      return;
    }
    if (action === 'cancel-queue') {
      this.actions.cancelQueue();
      return;
    }
    if (action.startsWith('quality:')) {
      this.actions.patchSettings({ quality: action.slice(8) as QualityPreset });
      this.show('settings');
      return;
    }
    if (action.startsWith('difficulty:')) {
      this.actions.patchSettings({ difficulty: action.slice(11) as Settings['difficulty'] });
      this.show('settings');
      return;
    }
    if (action.startsWith('handedness:')) {
      const handedness = action.slice(11) as Settings['handedness'];
      this.actions.patchSettings({ handedness });
      this.actions.patchGear({ handedness });
      this.show('settings');
      return;
    }
    if (action.startsWith('toggle:')) {
      const key = action.slice(7) as keyof Settings;
      const settings = this.getState().settings;
      if (key === 'reducedMotion' || key === 'colourBlindSafe' || key === 'subtitles' || key === 'judgeVoice' || key === 'muted' || key === 'showHud' || key === 'showFps' || key === 'trainingOverlay') {
        this.actions.patchSettings({ [key]: !settings[key] } as Partial<Settings>);
        this.show('settings');
      }
      return;
    }
    if (action.startsWith('camera:')) {
      const key = action.slice(7) as keyof Settings['camera'];
      if (key === 'autoReturn' || key === 'arrowCam' || key === 'invertY') {
        this.actions.patchCamera({ [key]: !this.getState().settings.camera[key] } as Partial<Settings['camera']>);
        this.show('settings');
      }
      return;
    }
    if (action.startsWith('time:')) {
      this.actions.setEnvironment(action.slice(5) as TimeOfDay, 'clear');
      return;
    }
    if (action.startsWith('weather:')) {
      this.actions.setEnvironment('noon', action.slice(8) as Weather);
      return;
    }

    switch (action) {
      case 'start':
        this.actions.begin(this.currentMode());
        break;
      case 'resume':
        this.actions.resume();
        break;
      case 'pause':
        this.actions.pause();
        break;
      case 'restart':
        this.actions.restart();
        break;
      case 'quit':
        this.actions.quit();
        break;
      case 'next':
        this.actions.next();
        break;
      case 'rematch':
        this.actions.restart();
        break;
      case 'back':
        this.actions.back();
        break;
      case 'gear-reset': {
        this.actions.patchGear(defaultGear(this.getState().bowClass));
        this.show('gear');
        break;
      }
      case 'gear-done':
        this.actions.open('venue');
        break;
    }
  }

  private currentMode(): GameMode {
    const screen = this.getState().screen;
    void screen;
    return this.pendingMode;
  }

  private pendingMode: GameMode = 'practice';

  private onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.dataset.gear && !input.dataset.setting) return;
    const value = Number(input.value);
    if (input.dataset.gear) {
      const key = input.dataset.gear as keyof GearSetup;
      this.actions.patchGear({ [key]: value } as Partial<GearSetup>);
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = formatGearValue(key, value);
      return;
    }
    if (input.dataset.setting === 'volume') {
      this.actions.patchSettings({ masterVolume: value / 100 });
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = `${value}%`;
    }
    if (input.dataset.setting === 'sensitivity') {
      this.actions.patchCamera({ sensitivity: value / 100 });
      const output = input.parentElement?.querySelector('output');
      if (output) output.textContent = `${value}%`;
    }
  }

  /** Show a screen. Results and bracket have their own data-driven views. */
  show(screen: Screen): void {
    this.current = screen;
    const state = this.getState();
    this.root.innerHTML = '';
    switch (screen) {
      case 'menu':
        this.renderMenu();
        break;
      case 'class':
        this.renderClass();
        break;
      case 'venue':
        this.renderVenue();
        break;
      case 'gear':
        this.renderGear(state.gear);
        break;
      case 'settings':
        this.renderSettings();
        break;
      case 'paused':
        this.renderPause();
        break;
      case 'results':
        this.renderResults();
        break;
      case 'bracket':
        this.renderBracket();
        break;
      case 'medal':
        this.renderMedal();
        break;
      case 'leaderboard':
        this.renderLeaderboard();
        break;
      case 'online':
        this.renderOnline();
        break;
      case 'tutorial':
        this.renderTutorial();
        break;
      case 'playing':
      case 'boot':
        break;
    }
  }

  hide(): void {
    this.root.innerHTML = '';
  }

  setResults(data: ResultsData): void {
    this.results = data;
    this.show('results');
  }

  setLeaderboard(rows: Array<{ name: string; score: number; xCount: number; bowClass: string; playedAt: string }>, status: string): void {
    this.leaderboard = { rows, status };
    this.show('leaderboard');
  }

  setBracket(tournament: Tournament): void {
    this.bracket = tournament;
    this.show('bracket');
  }

  private shell(title: string, lead: string, body: string, actions: string, options: { wide?: boolean } = {}): void {
    const screen = document.createElement('div');
    screen.className = 'screen';
    screen.innerHTML = `
      <div class="screen__top">
        <div class="screen__brand">GOLD RING <small>World Archery style</small></div>
        <div class="chip${isRulesVerified() ? ' chip--gold' : ' chip--warn'}">
          ${isRulesVerified() ? `Rules ${rules.meta.rulebook.edition}` : 'Unofficial rule values'}
        </div>
      </div>
      <div class="screen__body" style="${options.wide ? 'width:min(1400px,100%)' : ''}">
        <div>
          <h2 class="screen__title">${title}</h2>
          <p class="screen__lead">${lead}</p>
        </div>
        ${body}
        <div class="menu-actions">${actions}</div>
      </div>
    `;
    this.root.appendChild(screen);
  }

  private renderMenu(): void {
    const state = this.getState();
    const cls = getClassRules(state.bowClass);
    const cards: Array<{ mode: GameMode; title: string; meta: string; text: string }> = [
      {
        mode: 'practice',
        title: 'Practice range',
        meta: 'Free shooting',
        text: 'Pick a distance, shoot unlimited arrows, and watch the group and heat map build up. Sight marks and tuning advice included.',
      },
      {
        mode: 'ranking',
        title: 'Ranking round',
        meta: `${cls.totalArrows} arrows`,
        text: `${cls.ends} ends of ${cls.arrowsPerEnd} at ${cls.distanceM} m on the ${getFace(cls.face).diameterCm} cm face. Seeds the elimination bracket.`,
      },
      {
        mode: 'match',
        title: 'Head-to-head',
        meta: cls.matchStyle === 'setSystem' ? 'Set system' : 'Cumulative',
        text:
          cls.matchStyle === 'setSystem'
            ? 'Up to five sets of three arrows, first to six set points, single-arrow shoot-off at five-all.'
            : 'Fifteen arrows, five ends of three, cumulative score with an X-count tie-break.',
      },
      {
        mode: 'tournament',
        title: 'Tournament',
        meta: 'Bracket to the final',
        text: 'Ranking round, then a single-elimination bracket with a bronze-medal match and a medal ceremony.',
      },
      {
        mode: 'daily',
        title: 'Daily challenge',
        meta: 'Fixed seed',
        text: 'The same wind and the same seed for everyone today. Six arrows, best score wins.',
      },
      {
        mode: 'online',
        title: 'Online duel',
        meta: 'Live',
        text: 'Five ends of three arrows against another archer. The server validates every shot and owns the clock.',
      },
      {
        mode: 'tutorial',
        title: 'Tutorial',
        meta: 'Learn the shot',
        text: 'Stance, nock, draw, anchor, aim, release and follow-through, one step at a time for your bow class.',
      },
    ];

    const body = `
      <div class="grid grid--3">
        ${cards
          .map(
            (card) => `
          <button class="card card--pick" data-action="mode:${card.mode}">
            <div class="card__head"><span class="card__title">${card.title}</span><span class="card__meta">${card.meta}</span></div>
            <p class="card__text">${card.text}</p>
          </button>`,
          )
          .join('')}
      </div>
      <div class="panel" style="padding:16px;display:flex;gap:22px;flex-wrap:wrap;align-items:center;justify-content:space-between">
        <div class="stat-row">
          <div class="stat"><div class="stat__label">Division</div><div class="stat__value stat__value--gold">${cls.shortName}</div></div>
          <div class="stat"><div class="stat__label">Distance</div><div class="stat__value">${cls.distanceM} m</div></div>
          <div class="stat"><div class="stat__label">Face</div><div class="stat__value">${getFace(cls.face).diameterCm} cm</div></div>
          <div class="stat"><div class="stat__label">Draw weight</div><div class="stat__value">${state.gear.drawWeightLb} lb</div></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm" data-action="screen:class">Change division</button>
          <button class="btn btn--sm" data-action="screen:gear">Equipment</button>
          <button class="btn btn--sm" data-action="leaderboard">Leaderboard</button>
          <button class="btn btn--sm" data-action="screen:settings">Settings</button>
        </div>
      </div>
      <p style="color:#4c5762;font-size:11px;line-height:1.6">
        Unofficial fan / educational simulation. Not affiliated with World Archery or the IOC.
        Rule values are data-driven and must be verified against the current rulebook before competition use.
      </p>
    `;

    this.shell(
      'Choose your round',
      'A complete World Archery style target archery simulation: three divisions, real draw-force curves, wind you can read on the flags, and a camera that steps into the bow.',
      body,
      `<button class="btn btn--primary" data-action="screen:class">Set up a round</button>
       <button class="btn" data-action="screen:gear">Tune equipment</button>
       <button class="btn" data-action="screen:settings">Settings</button>`,
    );
  }

  private renderClass(): void {
    const state = this.getState();
    const classes: BowClass[] = ['recurve', 'compound', 'barebow'];
    const body = `
      <div class="grid grid--3">
        ${classes
          .map((id) => {
            const cls = getClassRules(id);
            const active = state.bowClass === id ? ' is-active' : '';
            const limits = cls.limits;
            return `
            <button class="card card--pick${active}" data-action="class:${id}">
              <div class="card__head"><span class="card__title">${cls.name}</span><span class="card__meta">${cls.distanceM} m</span></div>
              <p class="card__text">${cls.description}</p>
              <div class="stat-row" style="margin-top:14px">
                <div class="stat"><div class="stat__label">Draw</div><div class="stat__value">${cls.bow.drawWeightLb.min}-${cls.bow.drawWeightLb.max} lb</div></div>
                <div class="stat"><div class="stat__label">Speed</div><div class="stat__value">${cls.arrowSpeedMps.min}-${cls.arrowSpeedMps.max} m/s</div></div>
                <div class="stat"><div class="stat__label">Let-off</div><div class="stat__value">${Math.round(cls.bow.letOff * 100)}%</div></div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
                <span class="chip">${limits.sight ? 'Sight' : 'No sight'}</span>
                <span class="chip">${limits.stabiliser ? 'Stabiliser' : 'No stabiliser'}</span>
                <span class="chip">${limits.clicker ? 'Clicker' : 'No clicker'}</span>
                <span class="chip">${limits.releaseAid ? 'Release aid' : 'Fingers'}</span>
              </div>
            </button>`;
          })
          .join('')}
      </div>
    `;
    this.shell(
      'Division',
      'The three divisions are not skins: draw force, holding weight, sight picture, speed and equipment limits all change.',
      body,
      `<button class="btn btn--primary" data-action="screen:venue">Continue</button>
       <button class="btn btn--ghost" data-action="back">Back</button>`,
    );
  }

  private renderVenue(): void {
    const state = this.getState();
    const venues: Array<{ id: VenueId; title: string; meta: string; text: string }> = [
      { id: 'stadium', title: 'Championship stadium', meta: 'Outdoor', text: 'Grandstands, banners, a big screen and a crowd that reacts to every ten.' },
      { id: 'club', title: 'Countryside club', meta: 'Outdoor', text: 'A quiet club range with trees, a fence and a clubhouse. Best for practice.' },
      { id: 'indoor', title: 'Indoor hall', meta: '18 m', text: 'A wooden hall with overhead strip lights. Short distance, tight groups, no wind.' },
    ];
    const cls = getClassRules(state.bowClass);
    const body = `
      <div class="grid grid--3">
        ${venues
          .map(
            (v) => `
          <button class="card card--pick${state.venue === v.id ? ' is-active' : ''}" data-action="venue:${v.id}">
            <div class="card__head"><span class="card__title">${v.title}</span><span class="card__meta">${v.meta}</span></div>
            <p class="card__text">${v.text}</p>
          </button>`,
          )
          .join('')}
      </div>
      <div class="panel" style="padding:18px;display:flex;gap:26px;flex-wrap:wrap;justify-content:space-between;align-items:center">
        <div class="stat-row">
          <div class="stat"><div class="stat__label">Division</div><div class="stat__value stat__value--gold">${cls.shortName}</div></div>
          <div class="stat"><div class="stat__label">Round</div><div class="stat__value">${cls.distanceM} m · ${getFace(cls.face).diameterCm} cm</div></div>
          <div class="stat"><div class="stat__label">Arrows</div><div class="stat__value">${cls.ends} × ${cls.arrowsPerEnd}</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" data-action="screen:gear">Equipment</button>
          <button class="btn btn--primary" data-action="start">Enter the range</button>
        </div>
      </div>
    `;
    this.shell(
      'Venue',
      'Every venue uses the same field-of-play rules: shooting line, waiting line, 2.5 m lanes, targets at 130 cm with a 15 degree face lean.',
      body,
      `<button class="btn btn--ghost" data-action="screen:class">Back</button>`,
    );
  }

  private renderGear(gear: GearSetup): void {
    const cls = getClassRules(gear.class);
    const advice = tuningAdvice(gear);
    const body = renderGearTuning({ gear, cls, advice });
    this.shell(
      'Equipment',
      'Tuning changes the shot: draw weight and length set the launch speed, brace height and spine change the forgiveness, the sight marks move the group.',
      body,
      `<button class="btn btn--primary" data-action="gear-done">Continue</button>
       <button class="btn" data-action="gear-reset">Reset to default</button>
       <button class="btn btn--ghost" data-action="screen:venue">Back</button>`,
      { wide: true },
    );
    // Draw the curve canvas after the markup exists.
    const canvas = this.root.querySelector<HTMLCanvasElement>('#draw-curve');
    if (canvas) drawCurve(canvas, gear);
  }

  private renderSettings(): void {
    const s = this.getState().settings;
    const toggle = (key: string, label: string, on: boolean, group: 'toggle' | 'camera' = 'toggle') => `
      <div class="settings-row">
        <label>${label}</label>
        <button class="toggle${on ? ' is-on' : ''}" data-action="${group}:${key}" aria-pressed="${on}"></button>
      </div>`;

    const body = `
      <div class="grid grid--2">
        <div class="panel" style="padding:18px">
          <div class="card__meta" style="margin-bottom:8px">Gameplay</div>
          <div class="settings-row">
            <label>Difficulty</label>
            <div style="display:flex;gap:6px">
              ${(['arcade', 'standard', 'realistic'] as const)
                .map((d) => `<button class="btn btn--sm${s.difficulty === d ? ' btn--primary' : ''}" data-action="difficulty:${d}">${d}</button>`)
                .join('')}
            </div>
          </div>
          <div class="settings-row">
            <label>Quality</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${(['low', 'medium', 'high', 'ultra'] as const)
                .map((q) => `<button class="btn btn--sm${s.quality === q ? ' btn--primary' : ''}" data-action="quality:${q}">${q}</button>`)
                .join('')}
            </div>
          </div>
          <div class="settings-row">
            <label>Handedness</label>
            <div style="display:flex;gap:6px">
              ${(['right', 'left'] as const)
                .map((h) => `<button class="btn btn--sm${s.handedness === h ? ' btn--primary' : ''}" data-action="handedness:${h}">${h}-handed</button>`)
                .join('')}
            </div>
          </div>
          ${toggle('reducedMotion', 'Reduced motion', s.reducedMotion)}
          ${toggle('colourBlindSafe', 'Colour-blind-safe target', s.colourBlindSafe)}
          ${toggle('trainingOverlay', 'Barebow gap guide (practice only)', s.trainingOverlay)}
          ${toggle('showFps', 'FPS overlay', s.showFps)}
        </div>

        <div class="panel" style="padding:18px">
          <div class="card__meta" style="margin-bottom:8px">Camera</div>
          ${toggle('autoReturn', 'Auto return to third person', s.camera.autoReturn, 'camera')}
          ${toggle('arrowCam', 'Follow the arrow', s.camera.arrowCam, 'camera')}
          ${toggle('invertY', 'Invert look Y', s.camera.invertY, 'camera')}
          <div class="settings-row">
            <label>Look sensitivity</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="range" min="30" max="220" value="${Math.round(s.camera.sensitivity * 100)}" data-setting="sensitivity" />
              <output>${Math.round(s.camera.sensitivity * 100)}%</output>
            </div>
          </div>
          <div class="settings-row">
            <label>Third-person FOV</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="range" min="50" max="80" value="${s.camera.fov}" data-setting="fov" disabled />
              <output>${s.camera.fov}°</output>
            </div>
          </div>
        </div>

        <div class="panel" style="padding:18px">
          <div class="card__meta" style="margin-bottom:8px">Audio</div>
          ${toggle('muted', 'Mute all', s.muted)}
          ${toggle('judgeVoice', 'Judge voice', s.judgeVoice)}
          ${toggle('subtitles', 'Subtitles for judge calls', s.subtitles)}
          <div class="settings-row">
            <label>Master volume</label>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="range" min="0" max="100" value="${Math.round(s.masterVolume * 100)}" data-setting="volume" />
              <output>${Math.round(s.masterVolume * 100)}%</output>
            </div>
          </div>
        </div>

        <div class="panel" style="padding:18px">
          <div class="card__meta" style="margin-bottom:8px">Controls</div>
          <div class="card__text" style="line-height:2">
            <span class="kbd">RMB</span> hold to draw, release to shoot<br/>
            <span class="kbd">F</span> / <span class="kbd">Space</span> clean release<br/>
            <span class="kbd">Shift</span> hold breath &nbsp; <span class="kbd">Q</span>/<span class="kbd">E</span> lean<br/>
            <span class="kbd">Mouse wheel</span> sight zoom &nbsp; <span class="kbd">R</span> cycle sight<br/>
            <span class="kbd">C</span> camera &nbsp; <span class="kbd">V</span> spectator &nbsp; <span class="kbd">Esc</span> pause
          </div>
        </div>
      </div>
    `;
    this.shell(
      'Settings',
      'Settings apply immediately and persist between sessions.',
      body,
      `<button class="btn btn--primary" data-action="back">Back</button>`,
    );
  }

  private renderPause(): void {
    const el = document.createElement('div');
    el.className = 'pause';
    el.innerHTML = `
      <div class="panel pause__card">
        <div class="pause__title">Paused</div>
        <div class="pause__sub">The clock is stopped. The end resumes where you left it.</div>
        <button class="btn btn--primary" data-action="resume">Resume</button>
        <button class="btn" data-action="restart">Restart round</button>
        <button class="btn" data-action="screen:settings">Settings</button>
        <button class="btn btn--danger" data-action="quit">Quit to menu</button>
      </div>
    `;
    this.root.appendChild(el);
  }

  private renderResults(): void {
    const data = this.results;
    if (!data) return;
    const medalClass = data.medal === 'silver' ? ' medal__disc--silver' : data.medal === 'bronze' ? ' medal__disc--bronze' : '';
    const body = `
      ${data.medal ? `<div class="medal"><div class="medal__disc${medalClass}">${data.medal === 'gold' ? '1' : data.medal === 'silver' ? '2' : '3'}</div><div><div class="card__meta">${data.medal.toUpperCase()} MEDAL</div><div class="screen__title" style="font-size:24px">${data.title}</div></div></div>` : ''}
      <div class="stat-row">
        ${data.stats.map((s) => `<div class="stat"><div class="stat__label">${s.label}</div><div class="stat__value stat__value--gold">${s.value}</div></div>`).join('')}
      </div>
      <div class="panel" style="padding:8px 12px;overflow:auto">
        <table class="results-table">
          <thead><tr><th>#</th><th>Archer</th><th>Detail</th><th>Score</th><th>X</th></tr></thead>
          <tbody>
            ${data.rows
              .map(
                (row, i) => `<tr class="${row.isMe ? 'is-me' : ''}">
                  <td>${i + 1}</td>
                  <td class="name">${row.name}</td>
                  <td>${row.detail}</td>
                  <td>${row.score}</td>
                  <td>${row.xCount}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    this.shell(
      data.title,
      data.subtitle,
      body,
      `${data.canContinue ? '<button class="btn btn--primary" data-action="next">Continue</button>' : ''}
       ${data.canRematch ? '<button class="btn" data-action="rematch">Shoot again</button>' : ''}
       <button class="btn btn--ghost" data-action="quit">Main menu</button>`,
      { wide: true },
    );
  }

  private renderBracket(): void {
    const tournament = this.bracket;
    if (!tournament) return;
    const view = tournament.bracketView();
    const body = `
      <div class="bracket">
        ${view
          .map(
            (round) => `
          <div class="bracket__round">
            <div class="bracket__round-title">${round.title}</div>
            ${round.matches
              .map(
                (m) => `
              <div class="bracket__match">
                ${m.players
                  .map((p) => {
                    const isMe = p?.id === 'player';
                    const isWinner = m.winner && p && m.winner.id === p.id;
                    return `<div class="bracket__slot${isWinner ? ' is-winner' : ''}${isMe ? ' is-me' : ''}">
                      <span>${p ? p.name : '—'}</span><span>${isWinner ? m.score || 'W' : ''}</span>
                    </div>`;
                  })
                  .join('')}
              </div>`,
              )
              .join('')}
          </div>`,
          )
          .join('')}
      </div>
    `;
    this.shell(
      'Elimination bracket',
      'Winners advance; the two beaten semi-finalists meet for bronze. The player match is highlighted.',
      body,
      `<button class="btn btn--primary" data-action="next">Continue</button>
       <button class="btn btn--ghost" data-action="quit">Main menu</button>`,
      { wide: true },
    );
  }

  private renderMedal(): void {
    const data = this.results;
    const medal = data?.medal ?? 'gold';
    const cls = medal === 'gold' ? '' : medal === 'silver' ? ' medal__disc--silver' : ' medal__disc--bronze';
    const body = `
      <div class="medal" style="padding:40px">
        <div class="medal__disc${cls}" style="width:110px;height:110px;font-size:38px">${medal === 'gold' ? '1' : medal === 'silver' ? '2' : '3'}</div>
        <div>
          <div class="card__meta">${medal.toUpperCase()} MEDAL</div>
          <div class="screen__title" style="font-size:34px">${data?.title ?? 'Medal ceremony'}</div>
          <p class="screen__lead" style="margin-top:6px">${data?.subtitle ?? ''}</p>
        </div>
      </div>
      <div class="stat-row">
        ${(data?.stats ?? []).map((s) => `<div class="stat"><div class="stat__label">${s.label}</div><div class="stat__value stat__value--gold">${s.value}</div></div>`).join('')}
      </div>
    `;
    this.shell(
      'Medal ceremony',
      'Unofficial simulation — no affiliation with World Archery or the IOC.',
      body,
      `<button class="btn btn--primary" data-action="quit">Main menu</button>`,
    );
  }

  private renderOnline(): void {
    const body = `
      <div class="grid grid--2">
        <div class="panel" style="padding:20px">
          <div class="card__meta" style="margin-bottom:10px">Your name</div>
          <input id="online-name" type="text" maxlength="24" value="${this.onlineName()}"
            style="width:100%;padding:11px 12px;border-radius:9px;border:1px solid var(--line-strong);background:#141a21;color:var(--text);font:inherit" />
          <p class="card__text" style="margin-top:10px">
            Five ends of three arrows, cumulative score, X count breaks ties. The server owns the clock and
            re-simulates every shot.
          </p>
          <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
            <button class="btn btn--primary" data-action="queue-online">Find a match</button>
            <button class="btn" data-action="cancel-queue">Cancel</button>
          </div>
          <p id="online-status" class="card__text" style="margin-top:14px;color:var(--gold)">Not queued.</p>
        </div>
        <div class="panel" style="padding:20px">
          <div class="card__meta" style="margin-bottom:10px">How it works</div>
          <p class="card__text" style="line-height:1.8">
            Matchmaking pairs you with another archer in the same division. If nobody is waiting, the search
            stays open — open a second browser window and queue there to test it locally.
          </p>
          <p class="card__text" style="margin-top:10px;color:var(--muted)">
            The server must be running: <span class="kbd">npm run dev:server</span>. The rest of the game works offline.
          </p>
        </div>
      </div>
    `;
    this.shell(
      'Online duel',
      'A live head-to-head against another archer, with the server validating every arrow.',
      body,
      `<button class="btn btn--ghost" data-action="back">Back</button>`,
    );
  }

  private onlineName(): string {
    try {
      return localStorage.getItem('gold-ring:name') ?? 'Archer';
    } catch {
      return 'Archer';
    }
  }

  /** Called by the game when the queue state changes. */
  setOnlineStatus(text: string): void {
    const el = document.getElementById('online-status');
    if (el) el.textContent = text;
    try {
      const input = document.getElementById('online-name') as HTMLInputElement | null;
      if (input?.value) localStorage.setItem('gold-ring:name', input.value);
    } catch {
      // Private browsing.
    }
  }

  private renderLeaderboard(): void {
    const data = this.leaderboard ?? { rows: [], status: 'Loading…' };
    const body = data.rows.length
      ? `<div class="panel" style="padding:8px 12px;overflow:auto">
          <table class="results-table">
            <thead><tr><th>#</th><th>Archer</th><th>Division</th><th>Score</th><th>X</th><th>Played</th></tr></thead>
            <tbody>
              ${data.rows
                .map(
                  (row, i) => `<tr>
                    <td>${i + 1}</td>
                    <td class="name">${row.name}</td>
                    <td>${row.bowClass}</td>
                    <td>${row.score}</td>
                    <td>${row.xCount}</td>
                    <td>${new Date(row.playedAt).toLocaleDateString()}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>`
      : `<div class="card"><p class="card__text">${data.status}</p></div>`;
    this.shell(
      'Leaderboard',
      'Ranking-round scores submitted to the GOLD RING server. The table is empty when the server is not running — the game is fully playable offline.',
      body,
      `<button class="btn" data-action="leaderboard">Refresh</button>
       <button class="btn btn--ghost" data-action="back">Back</button>`,
    );
  }

  private renderTutorial(): void {
    const steps = [
      ['Stance', 'Stand side-on, feet either side of the shooting line, shoulders in line with the target.'],
      ['Nock', 'Pick an arrow, clip the nock under the nocking point and lay the shaft on the rest.'],
      ['Set and hook', 'Recurve and barebow: three fingers under the nock. Compound: attach the release aid.'],
      ['Raise and draw', 'Hold the draw control. Draw smoothly; the recurve clicker must click before you release.'],
      ['Anchor and aim', 'Reach the anchor under the chin, then hold your breath and settle the pin on the gold.'],
      ['Release', 'Relax the fingers or squeeze the trigger. Do not punch it.'],
      ['Follow-through', 'Keep the bow arm up until the arrow lands; the bow will jump forward.'],
    ];
    const body = `
      <div class="grid grid--2">
        ${steps
          .map(
            (s, i) => `<div class="card"><div class="card__head"><span class="card__title">${i + 1}. ${s[0]}</span></div><p class="card__text">${s[1]}</p></div>`,
          )
          .join('')}
      </div>
      <p class="card__text">In competition, shooting before the green light or after time loses the highest arrow of the end.</p>
    `;
    this.shell(
      'The shot, step by step',
      'A fast mode is available: once you know the sequence you can shoot an end in well under a minute.',
      body,
      `<button class="btn btn--primary" data-action="mode:practice">Practice now</button>
       <button class="btn btn--ghost" data-action="back">Back</button>`,
    );
  }
}

function formatGearValue(key: keyof GearSetup, value: number): string {
  switch (key) {
    case 'drawWeightLb':
      return `${value.toFixed(0)} lb`;
    case 'drawLengthIn':
    case 'braceHeightIn':
    case 'arrowLengthIn':
      return `${value.toFixed(1)}"`;
    case 'tillerMm':
    case 'clickerPositionMm':
    case 'nockHeightMm':
    case 'sightElevationMm':
    case 'sightWindageMm':
    case 'pointWeightGr':
      return `${value.toFixed(0)} mm`;
    case 'plungerTension':
      return value.toFixed(2);
    default:
      return String(value);
  }
}

function drawCurve(canvas: HTMLCanvasElement, gear: GearSetup): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = (canvas.width = canvas.clientWidth * Math.min(2, window.devicePixelRatio || 1));
  const height = (canvas.height = canvas.clientHeight * Math.min(2, window.devicePixelRatio || 1));
  const cls = getClassRules(gear.class);
  const spec = {
    bowClass: gear.class,
    drawWeightLb: gear.drawWeightLb,
    drawLengthIn: gear.drawLengthIn,
    braceHeightIn: gear.braceHeightIn,
    letOff: cls.bow.letOff,
    peakDrawIn: 21,
  };
  ctx.clearRect(0, 0, width, height);
  const pad = 22 * (width / canvas.clientWidth);
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= 100; i++) {
    const s = i / 100;
    let force: number;
    if (gear.class !== 'compound') {
      force = s;
    } else {
      const peakFraction = Math.min(0.75, Math.max(0.25, (21 - gear.braceHeightIn) / Math.max(0.5, gear.drawLengthIn - gear.braceHeightIn)));
      if (s <= peakFraction) force = Math.pow(s / peakFraction, 0.85);
      else if (s <= 0.85) force = 1;
      else force = 1 - cls.bow.letOff * ((s - 0.85) / 0.15);
    }
    points.push([pad + s * plotW, pad + plotH - force * plotH]);
  }

  const gradient = ctx.createLinearGradient(0, pad, 0, pad + plotH);
  gradient.addColorStop(0, 'rgba(245,197,24,0.35)');
  gradient.addColorStop(1, 'rgba(245,197,24,0.02)');
  ctx.beginPath();
  ctx.moveTo(points[0][0], pad + plotH);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(points[points.length - 1][0], pad + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = '#f5c518';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px Inter, Arial';
  ctx.fillText(`${gear.drawWeightLb} lb peak`, pad + 4, pad + 12);
  ctx.fillText('brace', pad, height - 6);
  ctx.fillText('full draw', width - pad - 52, height - 6);
}
