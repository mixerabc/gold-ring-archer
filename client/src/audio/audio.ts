/**
 * Audio engine.
 *
 * All sounds are synthesised with the Web Audio API, so the game has a full
 * soundscape without shipping a single audio file (and without a download that
 * could fail offline). Spatialisation uses PannerNodes for the range, while the
 * crowd and wind are non-positional beds.
 *
 * Howler is kept in the dependency list for drop-in recorded packs later; the
 * procedural engine is the default because it always works.
 */

export type SoundName =
  | 'clicker'
  | 'release'
  | 'whoosh'
  | 'thud'
  | 'missGrass'
  | 'net'
  | 'buzzer'
  | 'ui'
  | 'drawCreak';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBed: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private started = false;
  private muted = false;
  private volume = 0.7;

  /** Must be called from a user gesture (click/keydown). */
  async start(): Promise<void> {
    if (this.started) {
      // Resume is best-effort: some browsers only allow it from a gesture.
      void this.ctx?.resume().catch(() => undefined);
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    // Never block gameplay on the audio context: if resume is rejected we
    // simply stay silent until the next user gesture.
    void this.ctx.resume().catch(() => undefined);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    this.noiseBuffer = this.makeNoise(2);
    this.startAmbience();
    this.started = true;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      // Slightly brown noise: softer and less hissy than pure white.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  private startAmbience(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const ctx = this.ctx;

    // Crowd: filtered noise with a slow amplitude wobble.
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noiseBuffer;
    crowd.loop = true;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.value = 700;
    crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    crowd.connect(crowdFilter).connect(this.crowdGain).connect(this.master);
    crowd.start();

    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.13;
    const wobbleGain = ctx.createGain();
    wobbleGain.gain.value = 0.015;
    wobble.connect(wobbleGain).connect(this.crowdGain.gain);
    wobble.start();

    // Wind: a higher band of noise, gain driven by the wind speed.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'highpass';
    windFilter.frequency.value = 900;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    wind.connect(windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    this.musicBed = ctx.createGain();
    this.musicBed.gain.value = 0.0;
    this.musicBed.connect(this.master);
  }

  setVolume(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : volume, this.ctx.currentTime, 0.05);
    }
  }

  setWind(speed: number): void {
    if (!this.ctx || !this.windGain) return;
    const gain = Math.min(0.16, 0.01 + speed * 0.012);
    this.windGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.4);
  }

  cheer(intensity = 1): void {
    if (!this.ctx || !this.crowdGain) return;
    const now = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(now);
    this.crowdGain.gain.setValueAtTime(this.crowdGain.gain.value, now);
    this.crowdGain.gain.linearRampToValueAtTime(0.16 * intensity, now + 0.12);
    this.crowdGain.gain.linearRampToValueAtTime(0.05, now + 1.6);
  }

  /** Update the listener so the panners follow the camera. */
  setListener(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, this.ctx.currentTime, 0.02);
      listener.positionY.setTargetAtTime(position.y, this.ctx.currentTime, 0.02);
      listener.positionZ.setTargetAtTime(position.z, this.ctx.currentTime, 0.02);
      listener.forwardX.setTargetAtTime(forward.x, this.ctx.currentTime, 0.02);
      listener.forwardY.setTargetAtTime(forward.y, this.ctx.currentTime, 0.02);
      listener.forwardZ.setTargetAtTime(forward.z, this.ctx.currentTime, 0.02);
      listener.upX.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      listener.upY.setTargetAtTime(1, this.ctx.currentTime, 0.02);
      listener.upZ.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  play(name: SoundName, position?: { x: number; y: number; z: number }): void {
    if (!this.ctx || !this.master || this.muted) return;
    switch (name) {
      case 'clicker':
        this.blip(2100, 0.03, 0.16, 'square');
        break;
      case 'ui':
        this.blip(660, 0.05, 0.06, 'sine');
        break;
      case 'buzzer':
        this.blip(180, 0.5, 0.18, 'square', 120);
        break;
      case 'release':
        this.twang(position);
        break;
      case 'drawCreak':
        this.noiseSweep(220, 900, 0.35, 0.05);
        break;
      case 'whoosh':
        this.noiseSweep(1600, 300, 0.55, 0.1);
        break;
      case 'thud':
        this.thud(position, 110, 0.09);
        break;
      case 'missGrass':
        this.thud(position, 70, 0.06);
        this.noiseSweep(1200, 400, 0.12, 0.05);
        break;
      case 'net':
        this.thud(position, 150, 0.05);
        break;
    }
  }

  private blip(frequency: number, duration: number, gain: number, type: OscillatorType, endFrequency?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + duration);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  /** Bow string + limbs: a low thump with a metallic ring. */
  private twang(position?: { x: number; y: number; z: number }): void {
    const ctx = this.ctx!;
    const output = this.spatial(position);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(85, ctx.currentTime + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(g).connect(output);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);

    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(680, ctx.currentTime);
    ring.frequency.exponentialRampToValueAtTime(420, ctx.currentTime + 0.18);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.05, ctx.currentTime);
    rg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    ring.connect(rg).connect(output);
    ring.start();
    ring.stop(ctx.currentTime + 0.22);
  }

  private thud(position: { x: number; y: number; z: number } | undefined, frequency: number, gain: number): void {
    const ctx = this.ctx!;
    const output = this.spatial(position);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.55, ctx.currentTime + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(g).connect(output);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  private noiseSweep(from: number, to: number, duration: number, gain: number): void {
    if (!this.noiseBuffer) return;
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(filter).connect(g).connect(this.master!);
    source.start();
    source.stop(ctx.currentTime + duration + 0.02);
  }

  private spatial(position?: { x: number; y: number; z: number }): AudioNode {
    const ctx = this.ctx!;
    if (!position) return this.master!;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.maxDistance = 120;
    panner.rolloffFactor = 1.2;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    panner.connect(this.master!);
    return panner;
  }

  /** Judge call with subtitles handled by the caller. */
  speak(text: string, enabled: boolean): void {
    if (!enabled || this.muted) return;
    if (typeof speechSynthesis === 'undefined') return;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 0.95;
      utterance.volume = 0.8;
      speechSynthesis.speak(utterance);
    } catch {
      // Speech synthesis is optional.
    }
  }

  get ready(): boolean {
    return this.started;
  }

  dispose(): void {
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
