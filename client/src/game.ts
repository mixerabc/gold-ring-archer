/**
 * GOLD RING — game orchestration.
 *
 * This is the only place where the renderer, the physics, the competition
 * rules and the DOM overlay meet. It owns the frame loop, the world (venue,
 * archer, bow, arrows), the input-to-shot pipeline and the screen flow.
 *
 * The shot pipeline mirrors the real sequence:
 *   stance -> nock -> draw -> clicker/wall -> anchor -> aim -> release ->
 *   follow-through -> arrow cam -> score.
 */

import * as THREE from 'three';
import { getClassFace, getClassRules, getFace, rules } from '@shared/rules/index';
import { launchSpeed, specFromShot } from '@shared/physics/bow';
import { simulateShot, sightMarkMm } from '@shared/physics/shot';
import { findArrow } from '@shared/data/gear';
import { sanitizeWind, DEFAULT_WIND } from '@shared/physics/wind';
import { formatClock } from '@shared/rules/timing';
import { clamp, mulberry32, hashSeed } from '@shared/math/random';
import { arrowFromSpec, ArrowTrail, ArrowVisual, ImpactArrowPool } from './equipment/arrows';
import { buildRecurve } from './equipment/recurve';
import { buildCompound } from './equipment/compound';
import { buildBarebow } from './equipment/barebow';
import type { BowVisual } from './equipment/bowTypes';
import { ArcherModel } from './archer/archerModel';
import { DrawController } from './archer/drawController';
import { BreathingModel, PressureModel } from './archer/breathing';
import { CameraStateMachine } from './camera/cameraStateMachine';
import { CameraRig } from './camera/cameraRig';
import { RenderPipeline } from './render/renderer';
import { Lighting, type TimeOfDay, type Weather } from './render/lighting';
import { Venue } from './range/venue';
import { MatchManager, type EndSummary } from './competition/matchManager';
import { OnlineMatchManager } from './competition/onlineMatch';
import { groupStats, judgeCall } from './competition/scoring';
import { seedFromRounds } from './competition/rankingRound';
import { Tournament } from './competition/bracket';
import { createField } from './ai/archerAI';
import { UI, type HudData, type ResultsData } from './ui';
import type { UIActions } from './ui/menus';
import { Input } from './input/input';
import { AudioEngine } from './audio/audio';
import { NetClient, type ServerMessage } from './net/client';
import { gameState, useGameStore, type GameMode, type Screen } from './state/store';
import type { ArrowScore, GearSetup, ScoredArrow, ShotOutcome, Vec2, WindFieldConfig } from '@shared/types';
import type { ShootRequest } from '@shared/net/protocol';

interface ShotState {
  outcome: ShotOutcome;
  time: number;
  landed: boolean;
  triggered: boolean;
  impactAt: number;
}

interface TournamentState {
  stage: 'ranking' | 'bracket';
  bracket: Tournament | null;
  profileNames: Map<string, string>;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private uiRoot: HTMLElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.05, 700);
  private pipeline!: RenderPipeline;
  private lighting!: Lighting;
  private venue!: Venue;
  private archer!: ArcherModel;
  private bow!: BowVisual;
  private impactPool!: ImpactArrowPool;
  private nockedArrow!: ArrowVisual;
  private flightArrow!: ArrowVisual;
  private trail!: ArrowTrail;
  private ui!: UI;
  private input!: Input;
  private audio = new AudioEngine();
  private net = new NetClient();

  private cameraMachine = new CameraStateMachine();
  private cameraRig!: CameraRig;
  private drawController!: DrawController;
  private breathing = new BreathingModel();
  private pressure = new PressureModel();

  private manager: MatchManager | OnlineMatchManager | null = null;
  private online: OnlineMatchManager | null = null;
  private lastRequest: ShootRequest | null = null;
  private onlineName = 'Archer';
  private wind: WindFieldConfig = { ...DEFAULT_WIND };
  private shot: ShotState | null = null;
  private bowRecoil = 0;
  private shotCount = 0;
  private arrowVelocity = new THREE.Vector3(0, 0, 1);
  private lastArrowPos = new THREE.Vector3();

  private aim: Vec2 = { x: 0, y: 0 };
  private cant = 0;
  private orbit = { yaw: 0, pitch: 0 };
  private breathHeld = false;
  private sway: Vec2 = { x: 0, y: 0 };
  private zoom = 1;

  private practiceImpacts: Vec2[] = [];
  private practiceScores: ArrowScore[] = [];
  private endArrows: string[] = [];
  private endTotal = 0;

  private timeOfDay: TimeOfDay = 'noon';
  private weather: Weather = 'clear';
  private time = 0;
  private last = performance.now();
  private frameTimes: number[] = [];
  private adaptiveRatio = 1;

  private tournament: TournamentState | null = null;
  private inBronzeMatch = false;
  private finishing = false;
  private pendingNext: (() => void) | null = null;
  private lastPhase = '';
  private lastScoreboard = 0;
  private disposed = false;
  private sessionSeed = 20261021;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
  }

  async init(): Promise<void> {
    const store = gameState();
    this.camera.position.set(0, 1.7, -3);
    this.scene.add(this.camera);

    this.pipeline = await RenderPipeline.create(
      { canvas: this.canvas, quality: store.settings.quality, preferWebGPU: false },
      this.scene,
      this.camera,
    );
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
    this.lighting = new Lighting(this.scene, this.pipeline.renderer);
    this.lighting.apply(this.timeOfDay, this.weather);

    this.cameraRig = new CameraRig(this.camera);
    this.input = new Input(this.canvas);
    this.buildWorld();
    this.ui = new UI(this.uiRoot, this.actions(), () => {
      const s = gameState();
      return { screen: s.screen, bowClass: s.bowClass, venue: s.venue, gear: s.gear, settings: s.settings };
    });
    this.ui.show('menu');
    this.bindResize();
    this.bindGlobalKeys();
    this.net.connect();
    this.bindNetwork();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ------------------------------------------------------------------ */
  /* World                                                              */
  /* ------------------------------------------------------------------ */

  private buildWorld(): void {
    const state = gameState();
    if (this.venue) {
      this.scene.remove(this.venue.group);
      this.venue.dispose();
    }
    if (this.archer) {
      this.scene.remove(this.archer.root);
      this.archer.dispose();
    }
    if (this.impactPool) {
      this.scene.remove(this.impactPool.parent);
      this.impactPool.dispose();
    }

    const indoor = state.venue === 'indoor';
    const distance = indoor ? 18 : getClassRules(state.bowClass).distanceM;
    const face = indoor ? getFace('wa40') : getClassFace(state.bowClass);

    this.venue = new Venue({
      id: state.venue,
      face,
      distanceM: distance,
      lanes: 2,
      quality: this.pipeline.qualityPreset,
      palette: state.settings.colourBlindSafe ? 'cbSafe' : 'standard',
    });
    this.scene.add(this.venue.group);

    this.archer = new ArcherModel({
      handedness: state.settings.handedness,
      bibNumber: '07',
      kitColor: state.bowClass === 'compound' ? 0x1d3b2a : state.bowClass === 'barebow' ? 0x3b2a1d : 0x16365f,
    });
    this.archer.root.position.set(0, 0, 0);
    this.scene.add(this.archer.root);

    this.buildBow(state.gear);

    const arrowSpec = state.gear.arrowId;
    const options = arrowFromSpec({
      id: arrowSpec,
      brand: '',
      name: '',
      spine: 500,
      lengthIn: state.gear.arrowLengthIn,
      weightGr: 300,
      pointWeightGr: state.gear.pointWeightGr,
      diameterMm: 5.5,
      fletching: 'vane',
      fletchingLengthIn: 2,
      colors: { shaft: '#20242a', fletching: state.bowClass === 'barebow' ? '#3ddc84' : '#f5c518', nock: '#e8eef5' },
      recommendedDrawWeightLb: { min: 30, max: 60 },
    });

    this.nockedArrow = new ArrowVisual(options);
    this.bow.group.add(this.nockedArrow.group);

    this.flightArrow = new ArrowVisual(options);
    this.flightArrow.group.visible = false;
    this.scene.add(this.flightArrow.group);

    this.trail = new ArrowTrail();
    this.trail.line.visible = false;
    this.scene.add(this.trail.line);

    this.impactPool = new ImpactArrowPool(this.scene, options, 30);

    this.aim = { x: 0, y: 0 };
    this.zoom = state.settings.camera.zoom;
    this.cant = 0;
    this.drawController = new DrawController({
      bowClass: state.bowClass,
      drawWeightLb: state.gear.drawWeightLb,
      letOff: getClassRules(state.bowClass).bow.letOff,
      errorScale: state.settings.difficulty === 'arcade' ? 0.45 : state.settings.difficulty === 'realistic' ? 1.2 : 1,
      fullDraw: 0.985,
    });
    this.cameraMachine.reset();
    this.cameraRig.snap();
    this.breathing.reset();
  }

  private buildBow(gear: GearSetup): void {
    if (this.bow) this.archer.bowMount.remove(this.bow.group);
    const accent = gear.class === 'compound' ? 0x57a6ff : gear.class === 'barebow' ? 0x3ddc84 : 0xf5c518;
    this.bow =
      gear.class === 'compound'
        ? buildCompound({ gear, accent })
        : gear.class === 'barebow'
          ? buildBarebow({ gear, accent })
          : buildRecurve({ gear, accent });
    this.archer.bowMount.add(this.bow.group);
    // The nocked arrow lives on the bow so it follows the string; re-parent it
    // when the equipment changes.
    if (this.nockedArrow) this.bow.group.add(this.nockedArrow.group);
  }

  /* ------------------------------------------------------------------ */
  /* UI actions                                                         */
  /* ------------------------------------------------------------------ */

  private actions(): UIActions {
    return {
      begin: (mode) => this.begin(mode),
      open: (screen) => this.open(screen),
      back: () => this.back(),
      resume: () => this.resume(),
      pause: () => this.pause(),
      restart: () => {
        if (gameState().mode === 'online') this.setScreen('online');
        else this.begin(gameState().mode);
      },
      quit: () => this.quit(),
      next: () => this.next(),
      setMode: (mode) => useGameStore.getState().setMode(mode),
      setClass: (bowClass) => {
        useGameStore.getState().setBowClass(bowClass);
        this.buildWorld();
        this.applyQuality();
      },
      setVenue: (venue) => {
        useGameStore.getState().setVenue(venue);
        this.buildWorld();
      },
      patchSettings: (patch) => {
        useGameStore.getState().patchSettings(patch);
        this.applyQuality();
        this.applyVisualSettings();
      },
      patchCamera: (patch) => {
        useGameStore.getState().patchCamera(patch);
        if (patch.zoom !== undefined) this.zoom = patch.zoom;
        this.cameraMachine.setOptions({
          autoReturn: gameState().settings.camera.autoReturn,
          arrowCam: gameState().settings.camera.arrowCam,
          transitionSeconds: gameState().settings.camera.transitionSeconds,
        });
      },
      patchGear: (patch) => {
        useGameStore.getState().patchGear(patch);
        this.buildBow(gameState().gear);
        this.drawController = new DrawController({
          bowClass: gameState().bowClass,
          drawWeightLb: gameState().gear.drawWeightLb,
          letOff: getClassRules(gameState().bowClass).bow.letOff,
          errorScale: gameState().settings.difficulty === 'arcade' ? 0.45 : gameState().settings.difficulty === 'realistic' ? 1.2 : 1,
          fullDraw: 0.985,
        });
      },
      openLeaderboard: () => {
        void this.openLeaderboard();
      },
      queueOnline: (name) => {
        void this.queueOnline(name);
      },
      cancelQueue: () => {
        this.net.cancelQueue();
        this.ui.setOnlineStatus('Not queued.');
      },
      setEnvironment: (time, weather) => {
        this.timeOfDay = time;
        this.weather = weather;
        this.lighting.apply(time, weather);
      },
      uiSound: () => this.audio.play('ui'),
    };
  }

  private async openLeaderboard(): Promise<void> {
    this.setScreen('leaderboard');
    const state = gameState();
    this.ui.showLeaderboard([], 'Loading scores…');
    const rows = await this.net.leaderboard(state.bowClass, 'rankingRound', 15);
    if (rows === null) {
      this.ui.showLeaderboard([], 'The server is offline. Start it with `npm run dev:server` to keep a leaderboard.');
      return;
    }
    if (rows.length === 0) {
      this.ui.showLeaderboard([], 'No ranking rounds have been submitted yet. Finish one to appear here.');
      return;
    }
    this.ui.showLeaderboard(rows, '');
  }

  private applyQuality(): void {
    const settings = gameState().settings;
    this.pipeline.setQuality(settings.quality);
    this.ui?.showFps(settings.showFps);
  }

  private applyVisualSettings(): void {
    const settings = gameState().settings;
    this.archer.setHandedness(settings.handedness);
    this.venue.targets.forEach((t) => t.setPalette(settings.colourBlindSafe ? 'cbSafe' : 'standard'));
    this.audio.setVolume(settings.masterVolume, settings.muted);
  }

  /* ------------------------------------------------------------------ */
  /* Online                                                             */
  /* ------------------------------------------------------------------ */

  private bindNetwork(): void {
    this.net.onMessage((message) => {
      if (message.type === 'matchFound') {
        this.beginOnline(message);
        return;
      }
      if (message.type === 'queued') {
        this.ui.setOnlineStatus(
          message.cancelled ? 'Not queued.' : `Searching for an opponent… (${message.position} in queue)`,
        );
        return;
      }
      if (message.type === 'error') {
        this.ui.toast(message.message, 'warn');
        if (this.online) this.leaveOnline(message.message);
      }
    });
  }

  private async queueOnline(name: string): Promise<void> {
    this.onlineName = name || 'Archer';
    void this.audio.start();
    this.net.connect();
    for (let i = 0; i < 12 && !this.net.connected; i++) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (!this.net.connected) {
      this.ui.setOnlineStatus('Server offline. Start it with npm run dev:server.');
      this.ui.toast('Online server is not reachable.', 'warn');
      return;
    }
    const state = gameState();
    this.ui.setOnlineStatus('Searching for an opponent…');
    this.net.queue(state.bowClass, this.onlineName);
  }

  private beginOnline(info: Extract<ServerMessage, { type: 'matchFound' }>): void {
    const state = gameState();
    void this.audio.start();
    useGameStore.getState().setMode('online');
    useGameStore.getState().resetSession({
      mode: 'online',
      bowClass: state.bowClass,
      venue: state.venue,
      distanceM: this.distanceM(),
    });

    this.wind = sanitizeWind({
      ...DEFAULT_WIND,
      seed: Date.now() % 100000,
      baseSpeed: 3.2,
      baseDirectionDeg: 55,
    });
    this.practiceImpacts = [];
    this.practiceScores = [];
    this.endArrows = [];
    this.endTotal = 0;
    this.shot = null;
    this.tournament = null;
    this.inBronzeMatch = false;
    this.finishing = false;
    this.pendingNext = null;
    this.cameraMachine.reset();
    this.cameraRig.snap();
    this.drawController.reset();
    this.breathing.reset();
    this.zoom = state.settings.camera.zoom;
    this.pressure.value = 0;
    this.impactPool.clear();
    this.nockedArrow.group.visible = true;

    this.online?.dispose();
    this.online = new OnlineMatchManager(
      this.net,
      this.onlineName,
      info.opponent,
      state.bowClass,
      info.arrowsPerEnd ?? 3,
      info.ends ?? 5,
    );
    this.manager = this.online;
    this.bindManagerEvents();
    this.online.on('shotRejected', (payload) => this.ui.toast(String(payload), 'warn'));
    this.online.on('error', (payload) => {
      this.ui.toast(String(payload), 'warn');
      this.leaveOnline(String(payload));
    });

    this.ui.setOnlineStatus(`Matched against ${info.opponent}.`);
    this.setScreen('playing');
    this.input.requestPointerLock();
    this.ui.toast(`Online duel: you vs ${info.opponent}`, 'gold');
  }

  private leaveOnline(reason: string): void {
    this.online?.dispose();
    this.online = null;
    this.manager = null;
    this.shot = null;
    this.setScreen('online');
    this.ui.setOnlineStatus(reason);
  }

  private showOnlineResults(): void {
    const result = this.online?.result;
    if (!result) {
      this.leaveOnline('The match ended without a result.');
      return;
    }
    const won = result.winner === 'you';
    const draw = result.winner === 'draw';
    const data: ResultsData = {
      title: won ? 'Online match won' : draw ? 'Online match drawn' : 'Online match lost',
      subtitle: `${result.myTotal}-${result.theirTotal} against ${result.opponent} (X ${result.myX}-${result.theirX}).`,
      rows: [
        {
          name: 'You',
          detail: result.ends.join(' · '),
          score: result.myTotal,
          xCount: result.myX,
          isMe: true,
        },
        {
          name: result.opponent,
          detail: result.theirEnds.join(' · '),
          score: result.theirTotal,
          xCount: result.theirX,
          isMe: false,
        },
      ],
      stats: [
        { label: 'Result', value: won ? 'WIN' : draw ? 'DRAW' : 'LOSS' },
        { label: 'Your total', value: String(result.myTotal) },
        { label: 'X count', value: String(result.myX) },
        { label: 'Ends', value: String(result.ends.length) },
      ],
      medal: null,
      canRematch: true,
      canContinue: false,
    };
    this.ui.showResults(data);
    this.pendingNext = () => this.setScreen('online');
    this.setScreen('results');
  }

  /* ------------------------------------------------------------------ */
  /* Screen flow                                                        */
  /* ------------------------------------------------------------------ */

  private setScreen(screen: Screen): void {
    useGameStore.getState().setScreen(screen);
    this.ui.show(screen);
    if (screen !== 'playing') {
      this.input.exitPointerLock();
    }
  }

  private open(screen: Screen): void {
    if (screen === 'settings' && gameState().screen === 'playing') {
      this.pause();
      return;
    }
    this.setScreen(screen);
  }

  private back(): void {
    const screen = gameState().screen;
    if (screen === 'class') this.setScreen('menu');
    else if (screen === 'venue') this.setScreen('class');
    else if (screen === 'gear') this.setScreen('venue');
    else if (screen === 'settings') this.setScreen('menu');
    else if (screen === 'tutorial') this.setScreen('menu');
    else this.setScreen('menu');
  }

  private begin(mode: GameMode): void {
    // Audio unlock is fire-and-forget: it must never delay the first end.
    void this.audio.start();
    this.online?.dispose();
    this.online = null;
    const state = gameState();
    useGameStore.getState().setMode(mode);
    useGameStore.getState().resetSession({ mode, bowClass: state.bowClass, venue: state.venue, distanceM: this.distanceM() });
    this.sessionSeed = mode === 'daily' ? hashSeed(new Date().toISOString().slice(0, 10)) : 20261021;
    this.wind = sanitizeWind({
      ...DEFAULT_WIND,
      seed: this.sessionSeed,
      baseSpeed: mode === 'daily' ? 4.2 : this.weather === 'windy' ? 6.4 : this.weather === 'lightRain' ? 5.2 : 3.1,
      baseDirectionDeg: 40 + (this.sessionSeed % 60),
    });

    this.practiceImpacts = [];
    this.practiceScores = [];
    this.endArrows = [];
    this.endTotal = 0;
    this.shot = null;
    this.impactPool.clear();
    this.tournament = mode === 'tournament' ? { stage: 'ranking', bracket: null, profileNames: new Map() } : null;
    this.pendingNext = null;
    this.inBronzeMatch = false;
    this.finishing = false;
    this.cameraMachine.reset();
    this.cameraRig.snap();
    this.drawController.reset();
    this.breathing.reset();
    this.zoom = state.settings.camera.zoom;
    this.pressure.value = 0;
    this.nockedArrow.group.visible = true;

    // Indoor sessions use the 18 m round: an archer would move the sight to the
    // 18 m mark before shooting, so do the same for the player (barebow has no
    // sight and aims by string picture).
    if (state.venue === 'indoor' && state.bowClass !== 'barebow') {
      const cls = getClassRules(state.bowClass);
      const arrow = findArrow(state.gear.arrowId);
      const spec = specFromShot({
        bowClass: state.bowClass,
        drawWeightLb: state.gear.drawWeightLb,
        drawLengthIn: state.gear.drawLengthIn,
        braceHeightIn: state.gear.braceHeightIn,
        letOff: cls.bow.letOff,
        peakDrawIn: 21,
        arrowMassGr: arrow.weightGr,
        efficiency: cls.bow.efficiency,
      });
      const speed = launchSpeed(spec, arrow.weightGr, cls.bow.efficiency, 1);
      const ideal = sightMarkMm(speed, 18);
      if (Math.abs(state.gear.sightElevationMm - ideal) > 2) {
        useGameStore.getState().patchGear({ sightElevationMm: Math.round(ideal) });
        this.buildBow(gameState().gear);
      }
    }

    this.manager = new MatchManager({
      mode: mode === 'tournament' ? 'ranking' : mode === 'daily' || mode === 'tutorial' ? 'practice' : mode,
      bowClass: state.bowClass,
      distanceM: this.distanceM(),
      wind: this.wind,
      difficulty: state.settings.difficulty,
      seed: this.sessionSeed % 97,
    });
    this.bindManagerEvents();
    this.manager.beginEnd();

    this.setScreen('playing');
    this.input.requestPointerLock();
    this.audio.play('ui');
    if (mode === 'tutorial') {
      this.ui.toast('Draw with the right mouse button. Release to shoot.', 'gold');
    }
  }

  private bindManagerEvents(): void {
    if (!this.manager) return;
    this.manager.on('endComplete', (payload) => {
      const summary = payload as EndSummary;
      this.onEndComplete(summary);
    });
    this.manager.on('matchComplete', () => {
      window.setTimeout(() => this.finishSession(), 1800);
    });
    this.manager.on('rankingComplete', () => {
      window.setTimeout(() => this.finishSession(), 1800);
    });
    this.manager.on('shootOffResolved', () => {
      window.setTimeout(() => this.finishSession(), 1600);
    });
    this.manager.on('timingViolation', () => {
      this.ui.toast('Shot after time: the arrow does not count.', 'warn');
    });
  }

  private onEndComplete(summary: EndSummary): void {
    this.endArrows = summary.myArrows.map((a) => a.label);
    this.endTotal = summary.myTotal;
    useGameStore.getState().setEndArrows(this.endArrows);
    this.ui.toast(
      summary.theirArrows.length
        ? `${summary.message} — opponent ${summary.theirTotal}`
        : summary.message,
      'gold',
    );
    this.audio.cheer(summary.myTotal >= 55 ? 0.8 : 0.35);

    window.setTimeout(() => {
      if (!this.manager || this.disposed) return;
      if (this.manager.inShootOff) return;
      if (this.manager.finished) {
        this.finishSession();
        return;
      }
      this.manager.beginEnd();
      this.endArrows = [];
      this.endTotal = 0;
      this.resetArrow();
    }, 2800);
  }

  private finishSession(): void {
    if (!this.manager || this.finishing) return;
    this.finishing = true;
    // Results are shown once; a later duplicate event must not re-open the
    // results screen on top of itself.
    window.setTimeout(() => {
      this.finishing = false;
    }, 500);
    const mode = gameState().mode;

    if (mode === 'online') {
      this.showOnlineResults();
      return;
    }

    if (mode === 'tournament' && this.tournament) {
      if (this.tournament.stage === 'ranking') {
        this.beginBracket();
      } else {
        this.finishPlayerMatch();
      }
      return;
    }

    if (mode === 'practice') {
      this.showPracticeResults();
      return;
    }

    if (mode === 'ranking') {
      this.showRankingResults();
      return;
    }

    this.showMatchResults();
  }

  private showPracticeResults(): void {
    const stats = groupStats(this.practiceImpacts, this.practiceScores);
    const daily = gameState().mode === 'daily';
    const data: ResultsData = {
      title: daily ? 'Daily challenge' : 'Practice summary',
      subtitle: daily
        ? `${this.practiceScores.reduce((s, a) => s + a.value, 0)} points from six arrows. Same seed for everyone today.`
        : `${this.practiceImpacts.length} arrows at ${this.distanceM()} m. The mean point of impact is where your sight should move to.`,
      rows: this.practiceScores.slice(-12).map((a, i) => ({
        name: `Arrow ${this.practiceScores.length - Math.min(12, this.practiceScores.length) + i + 1}`,
        detail: a.lineCut ? 'line cutter' : a.isX ? 'inner ten' : '',
        score: a.value,
        xCount: a.isX ? 1 : 0,
        isMe: false,
      })),
      stats: [
        { label: 'Arrows', value: String(stats.count) },
        { label: 'Average', value: stats.average.toFixed(2) },
        { label: 'Group size', value: `${(stats.groupSize * 100).toFixed(1)} cm` },
        { label: 'Mean radius', value: `${(stats.meanRadius * 100).toFixed(1)} cm` },
        { label: 'Mean X', value: `${(stats.mean.x * 100).toFixed(1)} cm` },
        { label: 'Mean Y', value: `${(stats.mean.y * 100).toFixed(1)} cm` },
      ],
      medal: null,
      canRematch: true,
      canContinue: false,
    };
    this.ui.showResults(data);
    this.pendingNext = () => this.setScreen('menu');
    this.setScreen('results');
  }

  private showRankingResults(): void {
    const ranking = this.manager instanceof MatchManager ? this.manager.ranking : null;
    const entry = ranking?.toEntry('player', 'You');
    const total = entry?.total ?? 0;
    const xCount = entry?.xCount ?? 0;
    const field = this.simulatedField(total, xCount, 7);
    const rows = seedFromRounds([...(entry ? [entry] : []), ...field]).map((e) => ({
      name: e.name,
      detail: `${e.arrowsShot} arrows`,
      score: e.total,
      xCount: e.xCount,
      isMe: e.archerId === 'player',
    }));
    const rank = rows.findIndex((r) => r.isMe) + 1;
    const data: ResultsData = {
      title: 'Ranking round complete',
      subtitle: `${total} points, ${xCount} X. You seeded ${rank} of ${rows.length}.`,
      rows,
      stats: [
        { label: 'Total', value: String(total) },
        { label: 'X count', value: String(xCount) },
        { label: 'Seed', value: String(rank) },
        { label: 'Average arrow', value: (total / Math.max(1, 72)).toFixed(2) },
      ],
      medal: null,
      canRematch: true,
      canContinue: false,
    };
    this.ui.showResults(data);
    this.pendingNext = () => this.setScreen('menu');
    this.setScreen('results');
    void this.net.submitScore({
      archerId: 'local-player',
      name: 'You',
      bowClass: gameState().bowClass,
      formatId: 'rankingRound',
      score: total,
      xCount,
    });
  }

  private showMatchResults(): void {
    const match = this.manager?.match;
    if (!match) return;
    const won = match.winner === 0;
    const drew = match.winner === null;
    const data: ResultsData = {
      title: won ? 'Match won' : drew ? 'Match drawn' : 'Match lost',
      subtitle: `${match.style === 'setSystem' ? `${match.mySets}-${match.theirSets} set points` : `${match.myTotal}-${match.theirTotal}`} against ${this.manager?.opponent?.profile.name ?? 'the opponent'}.`,
      rows: [
        {
          name: 'You',
          detail: match.records.map((r) => r.mine).join(' · '),
          score: match.style === 'setSystem' ? match.mySets : match.myTotal,
          xCount: match.myX,
          isMe: true,
        },
        {
          name: this.manager?.opponent?.profile.name ?? 'Opponent',
          detail: match.records.map((r) => r.theirs).join(' · '),
          score: match.style === 'setSystem' ? match.theirSets : match.theirTotal,
          xCount: match.theirX,
          isMe: false,
        },
      ],
      stats: [
        { label: 'Total', value: String(match.myTotal) },
        { label: 'X count', value: String(match.myX) },
        { label: 'Ends', value: String(match.records.length) },
        { label: 'Result', value: won ? 'WIN' : drew ? 'DRAW' : 'LOSS' },
      ],
      medal: null,
      canRematch: true,
      canContinue: false,
    };
    this.ui.showResults(data);
    this.pendingNext = () => this.setScreen('menu');
    this.setScreen('results');
  }

  /* ------------------------------------------------------------------ */
  /* Tournament                                                         */
  /* ------------------------------------------------------------------ */

  private beginBracket(): void {
    if (!this.tournament) return;
    const ranking = this.manager instanceof MatchManager ? this.manager.ranking : null;
    const entry = ranking?.toEntry('player', 'You');
    const total = entry?.total ?? 600;
    const xCount = entry?.xCount ?? 20;
    const aiField = this.simulatedField(total, xCount, 7).map((e, i) => ({
      id: `ai-${i + 1}`,
      name: e.name,
      country: 'INT',
      skill: 0.6 + ((i * 7) % 30) / 100,
      clutch: 0.4 + (i % 5) * 0.1,
      style: 'steady' as const,
    }));

    // The player is seeded by score against the AI field.
    const all = [
      { id: 'player', name: 'You', total, xCount },
      ...aiField.map((a, i) => ({ id: a.id, name: a.name, total: 560 + ((i * 13) % 90), xCount: 8 + (i % 12) })),
    ].sort((a, b) => b.total - a.total || b.xCount - a.xCount);

    const orderedProfiles = all.map((entryRow) =>
      entryRow.id === 'player'
        ? { id: 'player', name: 'You', country: 'YOU', skill: 0.8, clutch: 0.7, style: 'steady' as const }
        : aiField.find((a) => a.id === entryRow.id)!,
    );

    const bracket = new Tournament(orderedProfiles, this.sessionSeed);
    this.tournament = { stage: 'bracket', bracket, profileNames: new Map(orderedProfiles.map((p) => [p.id, p.name])) };
    bracket.simulateRound();
    this.ui.showBracket(bracket);
    this.setScreen('bracket');
    this.pendingNext = () => this.startPlayerMatch();
  }

  private startPlayerMatch(): void {
    if (!this.tournament?.bracket) return;
    this.inBronzeMatch = false;
    const match = this.tournament.bracket.playerMatch;
    if (!match) {
      this.showTournamentResults();
      return;
    }
    const opponent = match.players.find((p) => p && p.id !== 'player');
    const state = gameState();
    this.manager = new MatchManager({
      mode: 'tournament',
      bowClass: state.bowClass,
      distanceM: this.distanceM(),
      wind: this.wind,
      difficulty: state.settings.difficulty,
      opponentName: opponent?.name,
      seed: this.sessionSeed % 89,
    });
    this.bindManagerEvents();
    this.endArrows = [];
    this.endTotal = 0;
    this.shot = null;
    this.impactPool.clear();
    this.drawController.reset();
    this.nockedArrow.group.visible = true;
    this.cameraMachine.reset();
    this.manager.beginEnd();
    this.setScreen('playing');
    this.ui.toast(`${this.roundName(match.round)}: ${opponent?.name ?? 'Opponent'}`, 'gold');
  }

  private roundName(round: number): string {
    if (!this.tournament?.bracket) return 'Match';
    const total = this.tournament.bracket.rounds;
    const remaining = Math.pow(2, total - round);
    return remaining === 2 ? 'Final' : remaining === 4 ? 'Semi-final' : remaining === 8 ? 'Quarter-final' : `Round of ${remaining}`;
  }

  private finishPlayerMatch(): void {
    if (!this.tournament?.bracket || !this.manager?.match) return;
    const won = this.manager.match.winner === 0;
    const score =
      this.manager.match.style === 'setSystem'
        ? `${this.manager.match.mySets}-${this.manager.match.theirSets}`
        : `${this.manager.match.myTotal}-${this.manager.match.theirTotal}`;

    if (this.inBronzeMatch) {
      const bronze = this.tournament.bracket.bronzeMatch;
      if (bronze) {
        const me = bronze.players.find((p) => p?.id === 'player');
        const opponent = bronze.players.find((p) => p && p.id !== 'player');
        const winnerId = won ? me?.id : opponent?.id;
        if (winnerId) this.tournament.bracket.recordBronze(winnerId, score);
      }
      this.inBronzeMatch = false;
      this.showTournamentResults();
      return;
    }

    this.tournament.bracket.recordPlayerMatch(won, score);
    this.tournament.bracket.simulateRound();

    const bronze = this.tournament.bracket.bronzeMatch;
    const bronzeMine = bronze?.players.some((p) => p?.id === 'player');
    const next = this.tournament.bracket.playerMatch;
    if (next) {
      this.ui.showBracket(this.tournament.bracket);
      this.setScreen('bracket');
      this.pendingNext = () => this.startPlayerMatch();
      return;
    }
    if (bronzeMine && !bronze?.winner) {
      this.startBronzeMatch();
      return;
    }
    // Neither semi-final loser is the player: play the bronze match out so the
    // ceremony always names a third place.
    this.tournament.bracket.simulateBronze();
    this.showTournamentResults();
  }

  private startBronzeMatch(): void {
    if (!this.tournament?.bracket) return;
    const bronze = this.tournament.bracket.bronzeMatch;
    if (!bronze) return;
    const opponent = bronze.players.find((p) => p && p.id !== 'player');
    const state = gameState();
    this.manager = new MatchManager({
      mode: 'tournament',
      bowClass: state.bowClass,
      distanceM: this.distanceM(),
      wind: this.wind,
      difficulty: state.settings.difficulty,
      opponentName: opponent?.name,
      seed: this.sessionSeed % 71,
    });
    this.bindManagerEvents();
    this.endArrows = [];
    this.endTotal = 0;
    this.shot = null;
    this.impactPool.clear();
    this.drawController.reset();
    this.cameraMachine.reset();
    this.manager.beginEnd();
    this.setScreen('playing');
    this.ui.toast(`Bronze medal match: ${opponent?.name ?? 'Opponent'}`, 'gold');
    this.tournament.stage = 'bracket';
    this.inBronzeMatch = true;
  }

  private showTournamentResults(): void {
    if (!this.tournament?.bracket) return;
    const result = this.tournament.bracket.result();
    const isPlayer = (id?: string) => id === 'player';
    const medal = isPlayer(result.champion?.id) ? 'gold' : isPlayer(result.runnerUp?.id) ? 'silver' : isPlayer(result.bronze?.id) ? 'bronze' : null;
    const championName = result.champion?.id === 'player' ? 'You win' : `${result.champion?.name ?? 'The winner'} wins`;
    const bronzeText = result.bronze ? `, ${result.bronze.name} bronze` : '';
    const data: ResultsData = {
      title: medal ? `${medal[0].toUpperCase()}${medal.slice(1)} medal` : 'Tournament complete',
      subtitle: result.champion
        ? `${championName} GOLD RING. ${result.runnerUp?.name ?? ''} takes silver${bronzeText}.`
        : 'The bracket is complete.',
      rows: [
        ...(result.champion ? [{ name: result.champion.name, detail: 'Champion', score: 1, xCount: 0, isMe: isPlayer(result.champion.id) }] : []),
        ...(result.runnerUp ? [{ name: result.runnerUp.name, detail: 'Runner-up', score: 2, xCount: 0, isMe: isPlayer(result.runnerUp.id) }] : []),
        ...(result.bronze ? [{ name: result.bronze.name, detail: 'Bronze', score: 3, xCount: 0, isMe: isPlayer(result.bronze.id) }] : []),
      ],
      stats: [
        { label: 'Your result', value: medal ? medal.toUpperCase() : 'ELIMINATED' },
        { label: 'Field', value: String(this.tournament.bracket.profiles.size) },
      ],
      medal,
      canRematch: false,
      canContinue: false,
    };
    this.ui.showMedal(data);
    this.pendingNext = () => this.setScreen('menu');
    this.setScreen('medal');
  }

  private next(): void {
    const action = this.pendingNext;
    this.pendingNext = null;
    if (action) action();
    else this.setScreen('menu');
  }

  private pause(): void {
    if (gameState().screen !== 'playing') return;
    this.manager?.pause();
    this.setScreen('paused');
  }

  private resume(): void {
    this.manager?.resume();
    this.setScreen('playing');
    this.input.requestPointerLock();
  }

  private quit(): void {
    if (this.online) {
      this.net.cancelQueue();
      this.online.dispose();
      this.online = null;
    }
    this.manager = null;
    this.tournament = null;
    this.pendingNext = null;
    this.shot = null;
    this.impactPool?.clear();
    this.cameraMachine.reset();
    this.setScreen('menu');
  }

  /* ------------------------------------------------------------------ */
  /* Frame loop                                                         */
  /* ------------------------------------------------------------------ */

  private loop(now: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.input.pollGamepad();

    const screen = gameState().screen;
    if (screen === 'playing') {
      this.updateGameplay(dt);
    } else {
      this.updateIdle(dt, screen);
    }

    this.updateCamera(dt, screen);
    this.render(dt);
    this.input.endFrame();
    this.trackPerformance(dt);
    requestAnimationFrame((t) => this.loop(t));
  }

  private updateIdle(dt: number, screen: Screen): void {
    this.venue.update(dt, this.time, this.wind, 0);
    this.archer.setDraw(0, false);
    this.archer.update(dt);
    this.bow.update(0, 0, this.time);
    if (this.nockedArrow) this.nockedArrow.group.visible = true;
    this.venue.trafficLight.setLamp('red');
    if (screen === 'menu') {
      this.cameraMachine.send('toSpectator');
    }
  }

  private updateGameplay(dt: number): void {
    const state = gameState();
    const settings = state.settings;
    const manager = this.manager;
    if (!manager) return;

    // Clock and signals.
    const signal = manager.clockState();
    this.venue.trafficLight.setLamp(manager.mode === 'practice' ? 'green' : signal.light);
    if (signal.phase !== this.lastPhase) {
      this.lastPhase = signal.phase;
      if (signal.phase === 'shoot') this.audio.play('buzzer');
      if (signal.phase === 'warning') this.audio.play('buzzer');
      if (signal.phase === 'expired') this.audio.play('buzzer');
    }

    // Pointer look / aim.
    const assistLevel = settings.aimAssist === 'strong' ? 1 : settings.aimAssist === 'light' ? 0.5 : 0;
    const mpp = (this.distanceM() * 0.00006 * settings.camera.sensitivity) / Math.max(1, this.zoom);
    if (this.cameraMachine.state === 'THIRD_PERSON') {
      if (this.input.pointerLocked) {
        this.orbit.yaw = clamp(this.orbit.yaw - this.input.pointer.dx * 0.0022 * settings.camera.sensitivity, -0.85, 0.85);
        this.orbit.pitch = clamp(this.orbit.pitch - this.input.pointer.dy * 0.0018 * settings.camera.sensitivity * (settings.camera.invertY ? -1 : 1), -0.4, 0.4);
      }
    } else if (this.cameraMachine.isAiming) {
      // Aim assist: near the gold the sight moves more slowly, which makes fine
      // corrections possible without pulling the shot away from the wind hold.
      const radius = Math.hypot(this.aim.x, this.aim.y);
      const nearGold = clamp(1 - radius / 0.45, 0, 1);
      const moveScale = 1 - nearGold * assistLevel * 0.55;
      this.aim.x = clamp(this.aim.x - this.input.pointer.dx * mpp * moveScale, -1.6, 1.6);
      this.aim.y = clamp(this.aim.y - this.input.pointer.dy * mpp * moveScale * (settings.camera.invertY ? -1 : 1), -1.6, 1.6);
      this.orbit.yaw = clamp(this.orbit.yaw - this.input.pointer.dx * 0.0006, -0.85, 0.85);
    }

    // Cant and zoom.
    if (this.input.isDown('leanLeft')) this.cant = clamp(this.cant + dt * 0.22, -0.09, 0.09);
    if (this.input.isDown('leanRight')) this.cant = clamp(this.cant - dt * 0.22, -0.09, 0.09);
    if (!this.input.isDown('leanLeft') && !this.input.isDown('leanRight')) this.cant *= Math.exp(-dt * 1.2);
    if (this.input.pointer.wheel !== 0 && this.cameraMachine.isAiming) {
      this.zoom = clamp(this.zoom + this.input.pointer.wheel * 0.25, 1, 6);
    }

    this.breathHeld = this.input.isDown('holdBreath');
    this.drawController.update(dt, this.input.drawing && !this.shot, this.breathHeld);

    // Draw state machine.
    if (this.cameraMachine.state === 'THIRD_PERSON' && this.input.drawing && this.drawController.armed) {
      this.cameraMachine.send('drawStart');
      this.audio.play('drawCreak');
    }
    if (this.cameraMachine.state === 'DRAWING_TRANSITION' && this.drawController.isFullDraw) {
      this.cameraMachine.send('drawFull');
      if (this.drawController.clickerPassed) this.audio.play('clicker');
      else if (this.drawController.wallReached) this.audio.play('clicker');
    }

    // Release by letting go of the draw control, or by pressing fire.
    const releasedDraw =
      !this.input.drawing &&
      (this.cameraMachine.state === 'FIRST_PERSON_AIM' || this.cameraMachine.state === 'DRAWING_TRANSITION');
    if (releasedDraw && this.drawController.draw > 0.04 && !this.shot) {
      this.releaseShot(false);
    }
    if (this.input.firePressed && !this.shot) {
      if (this.cameraMachine.state === 'FIRST_PERSON_AIM' || this.cameraMachine.state === 'DRAWING_TRANSITION') {
        this.releaseShot(true);
      }
    }
    if (this.input.wasPressed('cameraToggle')) {
      this.cameraMachine.send('toThirdPerson');
      this.ui.toast('Third-person view');
    }
    if (this.input.wasPressed('spectator')) {
      this.cameraMachine.send('toSpectator');
      const mode = this.cameraRig.spectator.cycle();
      this.ui.toast(`Spectator: ${mode}`);
    }
    if (this.input.wasPressed('pause')) {
      this.pause();
      return;
    }
    if (this.input.wasPressed('hud')) {
      useGameStore.getState().patchSettings({ showHud: !settings.showHud });
    }

    // Breathing sway and pressure.
    const tremor = this.drawController.tremor * (1 - assistLevel * 0.5);
    const sway = this.breathing.sample(dt, {
      difficulty: settings.difficulty,
      stability: this.drawController.feel.holdStability,
      distanceM: this.distanceM(),
      pressure: this.pressure.value,
      breathHeld: this.breathHeld,
      stamina: this.drawController.stamina,
      tremor,
    });
    const swayScale = 1 - assistLevel * 0.55;
    this.sway = { x: sway.x * swayScale, y: sway.y * swayScale };
    this.pressure.update(dt, {
      matchPlay: manager.mode === 'match' || manager.mode === 'tournament',
      margin: manager.match ? manager.match.mySets - manager.match.theirSets : 0,
      arrowsLeft: manager.arrowsLeftInEnd,
    });

    // Camera machine timing.
    this.cameraMachine.tick(dt);

    // Archer and bow.
    this.archer.setDraw(this.drawController.draw, this.input.drawing);
    this.archer.setAim(0, 0, this.cant, tremor * 0.4);
    this.archer.update(dt);
    this.bowRecoil = Math.max(0, this.bowRecoil - dt * 4);
    this.bow.update(this.drawController.draw, this.bowRecoil, this.time);

    // View-model alignment: in first person the sight pin must sit on the line
    // the camera is looking down, otherwise the player aims with a pin that is
    // not pointing at the target. The physics already models the sight mark
    // error; this nudge only aligns the visual pin with the aim ray.
    this.bow.group.position.set(0, 0, 0);
    if (this.cameraMachine.isFirstPerson && this.bow.sightPin) {
      const pinWorld = this.bow.sightPin.getWorldPosition(new THREE.Vector3());
      const eye = this.camera.position;
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      const depth = pinWorld.clone().sub(eye).dot(forward);
      if (depth > 0.1) {
        const onRay = eye.clone().addScaledVector(forward, depth);
        const delta = onRay.sub(pinWorld);
        delta.x = clamp(delta.x, -0.16, 0.16);
        delta.y = clamp(delta.y, -0.16, 0.16);
        this.bow.group.position.add(delta);
      }
    }

    // Nocked arrow follows the string.
    if (this.nockedArrow) {
      const visible = this.cameraMachine.state !== 'ARROW_CAM' && !this.shot;
      this.nockedArrow.group.visible = visible;
      if (visible) {
        this.nockedArrow.group.position.copy(this.bow.nockLocal);
        this.nockedArrow.group.quaternion.identity();
      }
    }

    // Flight.
    this.updateFlight(dt);

    // Venue, wind, crowd.
    this.venue.update(dt, this.time, this.wind, manager.match ? this.pressure.value * 0.6 : 0.15);
    this.audio.setWind(this.wind.baseSpeed);
    this.lighting.followArcher(0, 0);

    // Camera aim point.
    this.updateHud(signal);
    this.updateScoreboard();
  }

  private releaseShot(triggered: boolean): void {
    if (!this.manager || this.shot) return;
    const state = gameState();
    const report = this.drawController.release(triggered);
    const gear = state.gear;
    const cls = getClassRules(state.bowClass);
    const spec = specFromShot({
      bowClass: state.bowClass,
      drawWeightLb: gear.drawWeightLb,
      drawLengthIn: gear.drawLengthIn,
      braceHeightIn: gear.braceHeightIn,
      letOff: cls.bow.letOff,
      peakDrawIn: 21,
      arrowMassGr: 0,
      efficiency: cls.bow.efficiency,
    });
    const arrow = findArrow(gear.arrowId);
    const arrowMassGr = arrow.weightGr + Math.max(0, gear.pointWeightGr - arrow.pointWeightGr);
    const speed = launchSpeed(spec, arrowMassGr, cls.bow.efficiency, 1);
    const idealSight = sightMarkMm(speed, this.distanceM());
    const barebow = state.bowClass === 'barebow';
    const assistLevel = state.settings.aimAssist === 'strong' ? 1 : state.settings.aimAssist === 'light' ? 0.5 : 0;
    const tremor = this.drawController.tremor * (1 - assistLevel * 0.5);

    // Strong assist also applies a partial wind hold: the arrow is aimed at the
    // point that would drift into the gold, not at the gold itself. Light assist
    // only steadies the sight.
    let aimPoint = { ...this.aim };
    if (state.settings.aimAssist === 'strong') {
      const dir = (this.wind.baseDirectionDeg * Math.PI) / 180;
      const drift = this.distanceM() * 0.0055 * (this.wind.baseSpeed / 3.2) * Math.sin(dir);
      aimPoint = { x: aimPoint.x * 0.35 - drift * 0.65, y: aimPoint.y * 0.35 };
    }

    const req = {
      bowClass: state.bowClass,
      distanceM: this.distanceM(),
      windSeed: this.wind.seed,
      aim: aimPoint,
      drawFraction: report.drawFraction,
      holdSeconds: report.holdSeconds,
      releaseQuality: report.quality,
      cantRad: this.cant,
      torqueRad: (Math.random() - 0.5) * 0.012 * (1 + tremor),
      // Barebow has no sight: the archer aims by string picture and gap, so
      // there is no sight mark to be off. Sighted bows compare the fitted mark
      // with the ideal mark for this distance.
      sightElevationOffsetMm: barebow ? 0 : gear.sightElevationMm - idealSight,
      sightWindageOffsetMm: barebow ? 0 : gear.sightWindageMm,
      sway: { ...this.sway },
      gear: {
        drawWeightLb: gear.drawWeightLb,
        drawLengthIn: gear.drawLengthIn,
        braceHeightIn: gear.braceHeightIn,
        letOff: cls.bow.letOff,
        arrowMassGr,
        arrowSpine: arrow.spine,
        arrowLengthIn: gear.arrowLengthIn,
        efficiency: cls.bow.efficiency,
      },
      wind: this.wind,
    };

    const target = this.venue.targets[0];
    this.lastRequest = req as unknown as ShootRequest;
    const outcome = simulateShot(req, {
      face: target.face,
      distanceM: this.distanceM(),
      laneX: 0,
      centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
      faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    });

    this.shot = { outcome, time: 0, landed: false, triggered, impactAt: 0 };
    this.shotCount++;
    this.cameraMachine.send('release');
    this.archer.triggerRelease(report.quality);
    this.bowRecoil = 1;
    this.audio.play('release', this.archer.bowHandWorld);
    window.setTimeout(() => this.audio.play('whoosh'), 90);
    this.flightArrow.group.visible = true;
    this.flightArrow.group.position.copy(this.archer.bowHandWorld);
    this.trail.reset();
    this.trail.line.visible = true;
    this.nockedArrow.group.visible = false;

    if (report.notes.length) {
      this.ui.toast(report.notes[0], report.quality < 0.65 ? 'warn' : 'info');
    }
  }

  private updateFlight(dt: number): void {
    const shot = this.shot;
    if (!shot || shot.landed) return;
    shot.time += dt;
    const samples = shot.outcome.flight.samples;
    if (samples.length === 0) return;

    // Interpolate along the sampled trail.
    let index = 0;
    while (index < samples.length - 1 && samples[index].t < shot.time) index++;
    const a = samples[Math.max(0, index - 1)];
    const b = samples[index];
    const span = Math.max(1e-4, b.t - a.t);
    const f = clamp((shot.time - a.t) / span, 0, 1);
    const position = new THREE.Vector3(
      a.x + (b.x - a.x) * f,
      a.y + (b.y - a.y) * f,
      a.z + (b.z - a.z) * f,
    );
    this.flightArrow.group.position.copy(position);
    const direction = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    if (direction.lengthSq() > 1e-8) {
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
      this.flightArrow.group.quaternion.copy(quaternion);
      this.arrowVelocity.copy(direction).normalize().multiplyScalar(Math.max(1, b.speed));
    }
    this.lastArrowPos.copy(position);
    this.trail.push(position);

    if (shot.time >= shot.outcome.flight.timeOfFlight - 0.002 || shot.outcome.flight.hitGround) {
      this.landArrow(position);
    }
  }

  private landArrow(position: THREE.Vector3): void {
    const shot = this.shot;
    if (!shot || shot.landed) return;
    shot.landed = true;
    shot.impactAt = this.time;
    this.flightArrow.group.visible = false;
    this.trail.line.visible = false;

    const target = this.venue.targets[0];
    const impact = shot.outcome.faceImpact;
    const missed = shot.outcome.flight.hitGround;
    const world = missed ? position : target.impactPoint(impact);

    this.impactPool.place(world, missed ? new THREE.Vector3(0, 1, 0) : target.normal, missed ? 0.05 : 0.06);

    if (missed) {
      this.audio.play('missGrass', world);
    } else {
      this.audio.play('thud', world);
    }

    const score = shot.outcome.score;
    const call = judgeCall(score, target.face.id, impact);
    this.ui.hud.showCall(score.label, call.toUpperCase());
    this.audio.speak(call, gameState().settings.judgeVoice && gameState().settings.subtitles);
    this.pressure.react(score.value);

    // Practice analytics (and the daily challenge, which is six arrows).
    const mode = gameState().mode;
    if (mode === 'practice' || mode === 'daily' || mode === 'tutorial') {
      this.practiceImpacts.push({ x: impact.x, y: impact.y });
      this.practiceScores.push(score);
      this.endArrows.push(score.label);
      if (this.endArrows.length > 6) this.endArrows.shift();
      this.endTotal = this.practiceScores.slice(-6).reduce((s, a) => s + a.value, 0);
      if (mode === 'daily' && this.practiceScores.length >= 6) {
        window.setTimeout(() => this.finishSession(), 1600);
      }
    }

    if (this.manager) {
      if (this.manager instanceof OnlineMatchManager) {
        this.manager.addPlayerArrow(score, impact);
        if (this.lastRequest) this.manager.submitShot(this.lastRequest, score);
      } else if (this.manager.inShootOff) {
        const shootOffArrow: ScoredArrow = { ...score, index: 0, impact: { x: impact.x, y: impact.y } };
        const result = this.manager.resolveShootOff(shootOffArrow);
        this.ui.toast(result.reason, 'gold');
      } else {
        const endDone = this.manager.addPlayerArrow(score, impact);
        void endDone;
      }
    }

    if (score.value === 10) this.audio.cheer(0.9);

    // Return the camera after the arrow lands.
    window.setTimeout(() => {
      if (!this.shot) return;
      this.cameraMachine.send('arrowLanded');
      this.resetArrow();
    }, 1500);
  }

  private resetArrow(): void {
    if (!this.manager) return;
    if (this.manager.finished) return;
    this.shot = null;
    this.drawController.reset();
    this.breathing.reset();
    this.zoom = gameState().settings.camera.zoom;
    this.cant = 0;
    this.nockedArrow.group.visible = true;
    this.flightArrow.group.visible = false;
    this.trail.line.visible = false;
    this.cameraMachine.send('toThirdPerson');
    this.aim = { x: 0, y: 0 };
  }

  private updateCamera(dt: number, screen: Screen): void {
    const state = gameState();
    const target = this.venue.targets[0];
    const arrowPos = this.flightArrow?.group.position;

    if (screen !== 'playing' && screen !== 'paused') {
      this.cameraMachine.send('toSpectator');
    }

    this.cameraRig.update(
      {
        state: this.cameraMachine.state,
        aimBlend: this.cameraMachine.aimBlend,
        head: this.archer.eyePosition,
        eye: this.archer.eyePosition,
        target,
        aim: this.aim,
        cant: this.cant,
        orbitYaw: this.orbit.yaw,
        orbitPitch: this.orbit.pitch,
        armLength: state.settings.camera.armLength,
        fov: state.settings.camera.fov,
        zoom: this.zoom,
        mirror: state.settings.handedness === 'right' ? 1 : -1,
        breath: 0.5,
        pressure: this.pressure.value,
        tremor: (this.drawController?.tremor ?? 0) * (1 - (gameState().settings.aimAssist === 'strong' ? 0.5 : gameState().settings.aimAssist === 'light' ? 0.25 : 0)),
        time: this.time,
        recoil: this.bowRecoil,
        arrow: arrowPos && this.shot ? { position: arrowPos, velocity: this.arrowVelocity, landed: this.shot.landed } : undefined,
      },
      dt,
    );

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    this.audio.setListener(
      { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      { x: forward.x, y: forward.y, z: forward.z },
    );
  }

  private render(dt: number): void {
    const state = gameState();
    const scope =
      state.bowClass === 'compound' && this.cameraMachine.isFirstPerson
        ? {
            magnification: this.bow.scopeMagnification,
            cantRad: this.cant,
            position: this.bow.sightPin?.getWorldPosition(new THREE.Vector3()),
          }
        : null;

    const focus = this.camera.position.distanceTo(this.venue.targets[0].facePointToWorld({ x: 0, y: 0 }));
    this.pipeline.render(
      dt,
      {
        aimBlend: this.cameraMachine.aimBlend,
        focusDistance: focus,
        aperture: 0.0007,
      },
      scope,
    );
  }

  private updateHud(signal: ReturnType<MatchManager['clockState']>): void {
    if (!this.manager) return;
    const state = gameState();
    const scoreboard = this.manager.scoreboard();
    const cls = getClassRules(state.bowClass);
    const face = this.venue.targets[0].face;

    const windSample = this.windSample();
    const hint = this.hintForState();
    const onlineManager = this.manager instanceof OnlineMatchManager ? this.manager : null;
    const online = onlineManager !== null;
    const matchInfo = onlineManager
      ? {
          style: 'cumulative' as const,
          mine: onlineManager.my.total,
          theirs: onlineManager.opponentState.total,
          mySets: 0,
          theirSets: 0,
          sets: [] as Array<{ mine: number; theirs: number }>,
          opponentName: onlineManager.opponentState.name,
        }
      : this.manager.match
        ? {
            style: this.manager.match.style,
            mine: scoreboard.myTotal,
            theirs: scoreboard.theirTotal,
            mySets: scoreboard.mySets,
            theirSets: scoreboard.theirSets,
            sets: this.manager.match.setState.sets.map((s) => ({ mine: s.points[0], theirs: s.points[1] })),
            opponentName: this.manager.opponent?.profile.name ?? 'Opponent',
          }
        : null;
    const data: HudData = {
      event: this.modeLabel(),
      sub: `${this.distanceM()} m · ${cls.shortName} · ${face.diameterCm} cm`,
      meta: online
        ? `ONLINE · END ${scoreboard.end} · ${scoreboard.arrowsLeft} ARROWS LEFT`
        : this.manager.match
          ? `${this.manager.match.style === 'setSystem' ? 'SET' : 'END'} ${scoreboard.end} · ${scoreboard.arrowsLeft} ARROWS LEFT`
          : `END ${scoreboard.end} · ${scoreboard.arrowsLeft} LEFT`,
      clock: this.manager.mode === 'practice' ? '--:--' : formatClock(signal.remaining),
      phase: this.manager.mode === 'practice' ? 'practice' : signal.label,
      light: this.manager.mode === 'practice' ? 'green' : signal.light,
      wind: windSample,
      match: matchInfo,
      end: {
        number: scoreboard.end,
        label: this.endLabel(scoreboard.arrowsLeft),
        arrows: this.endArrows,
        total: this.endTotal || scoreboard.myTotal,
        arrowsLeft: scoreboard.arrowsLeft,
        planned: this.manager.arrowsPerEnd,
      },
      draw: {
        visible: this.cameraMachine.isAiming || this.drawController.draw > 0.02,
        fraction: this.drawController.draw,
        clicker: this.drawController.feel.clicker,
        wall: this.drawController.wallReached,
        stamina: this.drawController.stamina,
        pressure: this.pressure.value,
        hint,
      },
      mode: state.mode,
      hint,
    };
    this.ui.updateHud(data);
    this.ui.setFps(1 / Math.max(0.001, this.frameTimes[this.frameTimes.length - 1] ?? 0.016), this.pipeline.backend);
  }

  private windSample(): { speed: number; label: string; clock: number; directionRad: number } {
    const rad = (this.wind.baseDirectionDeg * Math.PI) / 180;
    const speed = this.wind.baseSpeed;
    const clock = Math.round(((this.wind.baseDirectionDeg + 180) % 360) / 30) % 12 || 12;
    const label = Math.abs(Math.sin(rad)) > Math.abs(Math.cos(rad))
      ? Math.sin(rad) > 0
        ? 'Crosswind R→L'
        : 'Crosswind L→R'
      : Math.cos(rad) > 0
        ? 'Tailwind'
        : 'Headwind';
    return { speed, label, clock, directionRad: rad };
  }

  private hintForState(): string {
    switch (this.cameraMachine.state) {
      case 'THIRD_PERSON':
        return this.drawController.armed ? 'Hold right mouse to draw' : 'Wait for the next arrow';
      case 'DRAWING_TRANSITION':
        return this.drawController.feel.clicker ? 'Draw through the clicker' : 'Draw to the wall';
      case 'FIRST_PERSON_AIM':
        return this.drawController.feel.clicker ? 'Aim, hold breath, then release' : 'Settle the pin, then release';
      case 'RELEASE':
        return 'Follow through';
      case 'ARROW_CAM':
        return 'Arrow cam';
      default:
        return '';
    }
  }

  private endLabel(arrowsLeft: number): string {
    const mode = gameState().mode;
    if (mode === 'online') return `ONLINE · END ${this.manager?.scoreboard().end ?? 1} · ${arrowsLeft} LEFT`;
    if (mode === 'practice') return 'PRACTICE · UNLIMITED';
    if (mode === 'tutorial') return 'TUTORIAL · UNLIMITED';
    if (mode === 'daily') return `DAILY · ${Math.max(0, 6 - this.practiceScores.length)} LEFT`;
    if (this.manager?.match?.style === 'setSystem') return `SET ${this.manager.match.currentEnd} · ${arrowsLeft} LEFT`;
    return `END ${this.manager?.scoreboard().end ?? 1} · ${arrowsLeft} LEFT`;
  }

  private modeLabel(): string {
    switch (gameState().mode) {
      case 'ranking':
        return 'RANKING ROUND';
      case 'match':
        return 'HEAD-TO-HEAD';
      case 'online':
        return 'ONLINE DUEL';
      case 'tournament':
        return this.tournament?.stage === 'bracket' ? 'TOURNAMENT' : 'RANKING ROUND';
      case 'daily':
        return 'DAILY CHALLENGE';
      case 'tutorial':
        return 'TUTORIAL';
      default:
        return 'PRACTICE';
    }
  }

  private updateScoreboard(): void {
    if (performance.now() - this.lastScoreboard < 600 || !this.manager) return;
    this.lastScoreboard = performance.now();
    const scoreboard = this.manager.scoreboard();
    const wind = this.windSample();
    this.venue.scoreboard.update({
      event: 'GOLD RING',
      distanceM: this.distanceM(),
      endLabel: `END ${scoreboard.end}`,
      clock: this.manager.mode === 'practice' ? '--:--' : formatClock(this.manager.signal.remaining),
      windLabel: wind.label.toUpperCase(),
      windSpeed: wind.speed,
      rows: this.manager instanceof OnlineMatchManager
        ? [
            { name: 'YOU', score: scoreboard.myTotal, detail: `X ${this.manager.my.xCount}`, isMe: true },
            {
              name: this.manager.opponentState.name.toUpperCase(),
              score: scoreboard.theirTotal,
              detail: `X ${this.manager.opponentState.xCount}`,
              isMe: false,
            },
          ]
        : this.manager.match
          ? [
              { name: 'YOU', score: scoreboard.myTotal, detail: `SETS ${scoreboard.mySets}`, isMe: true },
              {
                name: (this.manager.opponent?.profile.name ?? 'OPPONENT').toUpperCase(),
                score: scoreboard.theirTotal,
                detail: `SETS ${scoreboard.theirSets}`,
                isMe: false,
              },
            ]
          : [{ name: 'YOU', score: scoreboard.myTotal, detail: `END ${scoreboard.end}`, isMe: true }],
      footer: 'UNOFFICIAL SIMULATION',
    });
  }

  private distanceM(): number {
    if (gameState().venue === 'indoor') return 18;
    return getClassRules(gameState().bowClass).distanceM;
  }

  private simulatedField(playerTotal: number, playerX: number, count: number): Array<{
    archerId: string;
    name: string;
    total: number;
    xCount: number;
    tenCount: number;
    arrowsShot: number;
    ends: number[];
  }> {
    const profiles = createField(count, gameState().bowClass, gameState().settings.difficulty, this.sessionSeed % 13);
    const rand = mulberry32(this.sessionSeed);
    return profiles.map((p) => {
      const base = 600 + (p.skill - 0.7) * 90 + (rand() - 0.5) * 26;
      const total = Math.round(clamp(base, 480, 690));
      return {
        archerId: p.id,
        name: p.name,
        total,
        xCount: Math.round(clamp((total - 540) / 4 + rand() * 8, 0, 60)),
        tenCount: Math.round(clamp((total - 520) / 2, 0, 60)),
        arrowsShot: 72,
        ends: [],
      };
    });
  }

  private bindResize(): void {
    const onResize = () => this.pipeline.resize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', onResize);
  }

  private bindGlobalKeys(): void {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && gameState().screen === 'playing') {
        this.pause();
      }
    });
    this.canvas.addEventListener('pointerdown', () => {
      if (gameState().screen === 'playing') this.input.requestPointerLock();
    });
    window.addEventListener('beforeunload', () => this.net.close());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && gameState().screen === 'playing') this.pause();
    });
  }

  private trackPerformance(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (gameState().screen !== 'playing' || this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length;
    if (avg > 0.021 && this.adaptiveRatio > 0.75) {
      this.adaptiveRatio = Math.max(0.75, this.adaptiveRatio - 0.1);
      this.pipeline.setPixelRatio(this.pipeline.qualityPreset.pixelRatio * this.adaptiveRatio);
      this.frameTimes.length = 0;
    } else if (avg < 0.013 && this.adaptiveRatio < 1) {
      this.adaptiveRatio = Math.min(1, this.adaptiveRatio + 0.1);
      this.pipeline.setPixelRatio(this.pipeline.qualityPreset.pixelRatio * this.adaptiveRatio);
      this.frameTimes.length = 0;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.input?.dispose();
    this.ui?.destroy();
    this.venue?.dispose();
    this.archer?.dispose();
    this.impactPool?.dispose();
    this.pipeline?.dispose();
    this.lighting?.dispose();
    this.audio.dispose();
    this.net.close();
  }
}
