/**
 * Range signals and the digital scoreboard.
 *
 * The traffic light is the visible half of the timing state machine in
 * `shared/rules/timing.ts`: red = do not shoot, green = shoot, yellow = last
 * 30 s (10 s in match play), red again at the end. The scoreboard is a canvas
 * texture redrawn only when its data changes.
 */

import * as THREE from 'three';

export type LampState = 'red' | 'green' | 'yellow';

export class TrafficLight {
  readonly group = new THREE.Group();
  private lamps: Record<LampState, { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; light: THREE.PointLight }>;
  private pole: THREE.Mesh;
  private geometries: THREE.BufferGeometry[] = [];

  constructor(position: THREE.Vector3) {
    this.group.position.copy(position);

    const metal = new THREE.MeshStandardMaterial({ color: 0x2b323a, roughness: 0.5, metalness: 0.7 });
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 1.7, 8);
    this.geometries.push(poleGeo);
    this.pole = new THREE.Mesh(poleGeo, metal);
    this.pole.position.y = 0.85;
    this.pole.castShadow = true;
    this.group.add(this.pole);

    const boxGeo = new THREE.BoxGeometry(0.22, 0.62, 0.16);
    this.geometries.push(boxGeo);
    const box = new THREE.Mesh(boxGeo, metal);
    box.position.y = 1.95;
    box.castShadow = true;
    this.group.add(box);

    const makeLamp = (color: number, y: number): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; light: THREE.PointLight } => {
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0,
        roughness: 0.35,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.065, 20), material);
      mesh.position.set(0, y, 0.085);
      this.group.add(mesh);
      const light = new THREE.PointLight(color, 0, 4);
      light.position.set(0, y, 0.2);
      this.group.add(light);
      return { mesh, material, light };
    };

    this.lamps = {
      red: makeLamp(0xff2d2d, 2.12),
      yellow: makeLamp(0xffcc22, 1.95),
      green: makeLamp(0x2ee66b, 1.78),
    };

    this.setLamp('red');
  }

  setLamp(state: LampState): void {
    (Object.keys(this.lamps) as LampState[]).forEach((key) => {
      const lamp = this.lamps[key];
      const on = key === state;
      lamp.material.emissiveIntensity = on ? 2.4 : 0;
      lamp.material.color.setHex(on ? 0xffffff : key === 'red' ? 0x551111 : key === 'yellow' ? 0x554411 : 0x115522);
      lamp.light.intensity = on ? 1.4 : 0;
    });
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
  }
}

export interface ScoreboardRow {
  name: string;
  score: number;
  detail: string;
  isMe: boolean;
}

export interface ScoreboardData {
  event: string;
  distanceM: number;
  endLabel: string;
  clock: string;
  windLabel: string;
  windSpeed: number;
  rows: ScoreboardRow[];
  footer: string;
}

/**
 * Broadcast-style scoreboard on a truss at the side of the field.
 * The canvas is 1024x512 and redrawn at most twice a second.
 */
export class Scoreboard {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshStandardMaterial;
  private geometries: THREE.BufferGeometry[] = [];
  private lastKey = '';
  private lastDraw = 0;

  constructor(position: THREE.Vector3, rotationY = 0) {
    this.group.position.copy(position);
    this.group.rotation.y = rotationY;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: this.texture,
      emissiveIntensity: 0.42,
      roughness: 0.7,
      metalness: 0.05,
    });

    const geo = new THREE.PlaneGeometry(4.4, 2.2);
    this.geometries.push(geo);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = 2.6;
    this.group.add(this.mesh);

    // Frame and legs.
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.6, metalness: 0.5 });
    const frameGeo = new THREE.BoxGeometry(4.6, 2.4, 0.12);
    this.geometries.push(frameGeo);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 2.6, -0.08);
    this.group.add(frame);

    for (const x of [-1.6, 1.6]) {
      const legGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.55, 8);
      this.geometries.push(legGeo);
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(x, 0.77, 0);
      this.group.add(leg);
    }

    this.draw({
      event: 'GOLD RING',
      distanceM: 70,
      endLabel: 'END 1',
      clock: '4:00',
      windLabel: 'CALM',
      windSpeed: 0,
      rows: [],
      footer: 'UNOFFICIAL SIMULATION',
    });
  }

  update(data: ScoreboardData, force = false): void {
    const key = JSON.stringify(data);
    const now = performance.now();
    if (!force && (key === this.lastKey || now - this.lastDraw < 500)) return;
    this.lastKey = key;
    this.lastDraw = now;
    this.draw(data);
  }

  private draw(data: ScoreboardData): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background.
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#101820');
    gradient.addColorStop(1, '#070b0f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Gold header bar.
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, w, 8);

    ctx.fillStyle = '#f5c518';
    ctx.font = '700 30px Inter, Arial';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.event.toUpperCase(), 32, 46);

    ctx.fillStyle = '#93a1ae';
    ctx.font = '500 20px Inter, Arial';
    ctx.fillText(`${data.distanceM} m`, 32, 82);

    // Clock, right aligned.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 54px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(data.clock, w - 32, 54);
    ctx.font = '500 18px Inter, Arial';
    ctx.fillStyle = '#93a1ae';
    ctx.fillText(data.endLabel, w - 32, 92);
    ctx.textAlign = 'left';

    // Wind block.
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(32, 108, 300, 54);
    ctx.fillStyle = '#cfd8e0';
    ctx.font = '600 20px Inter, Arial';
    ctx.fillText(`WIND ${data.windLabel}`, 48, 128);
    ctx.fillStyle = '#f5c518';
    ctx.font = '700 26px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(`${data.windSpeed.toFixed(1)} m/s`, 48, 154);

    // Rows.
    const top = 190;
    const rowHeight = 62;
    data.rows.slice(0, 4).forEach((row, i) => {
      const y = top + i * rowHeight;
      ctx.fillStyle = row.isMe ? 'rgba(245,197,24,0.14)' : 'rgba(255,255,255,0.035)';
      ctx.fillRect(32, y, w - 64, rowHeight - 8);
      if (row.isMe) {
        ctx.fillStyle = '#f5c518';
        ctx.fillRect(32, y, 5, rowHeight - 8);
      }
      ctx.fillStyle = row.isMe ? '#ffe27a' : '#eef2f6';
      ctx.font = '600 24px Inter, Arial';
      ctx.fillText(row.name.slice(0, 22), 52, y + 27);
      ctx.fillStyle = '#93a1ae';
      ctx.font = '500 16px Inter, Arial';
      ctx.fillText(row.detail, 52, y + 45);
      ctx.textAlign = 'right';
      ctx.fillStyle = row.isMe ? '#f5c518' : '#ffffff';
      ctx.font = '700 32px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(String(row.score), w - 52, y + 30);
      ctx.textAlign = 'left';
    });

    // Footer.
    ctx.fillStyle = '#4c5762';
    ctx.font = '500 15px Inter, Arial';
    ctx.fillText(data.footer, 32, h - 22);
    ctx.textAlign = 'right';
    ctx.fillText('GOLD RING', w - 32, h - 22);
    ctx.textAlign = 'left';

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometries.forEach((g) => g.dispose());
  }
}
