/**
 * Target butt and face.
 *
 * The face is drawn into a canvas at runtime (rings, colours, X ring, numbers,
 * wear), so the game ships with no image assets and still gives a crisp 122 cm
 * or 80 cm World Archery style face. The face is tilted 15 degrees back, which
 * is the same tilt used by the flight integration and the scoring, so where the
 * arrow visually sticks is exactly where it scored.
 */

import * as THREE from 'three';
import { faceColorForRing, faceRadiusM, ringRadiusM, xRingRadiusM } from '@shared/rules/index';
import type { FaceConfig, Vec2 } from '@shared/types';

export interface TargetOptions {
  face: FaceConfig;
  distanceM: number;
  laneX?: number;
  centreHeightM: number;
  faceTiltDeg: number;
  /** Colour-blind-safe palette override. */
  palette?: 'standard' | 'cbSafe';
}

const CB_SAFE: Record<string, string> = {
  white: '#e8edf2',
  black: '#3b4652',
  blue: '#2f6fb5',
  red: '#c94f3d',
  gold: '#e0b52a',
};

export class Target {
  readonly group = new THREE.Group();
  readonly faceGroup = new THREE.Group();
  readonly faceMesh: THREE.Mesh;
  readonly face: FaceConfig;
  readonly distanceM: number;
  readonly laneX: number;
  readonly centreHeightM: number;
  readonly tiltRad: number;
  private texture: THREE.CanvasTexture;
  private material: THREE.MeshStandardMaterial;
  private palette: 'standard' | 'cbSafe';
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  constructor(options: TargetOptions) {
    this.face = options.face;
    this.distanceM = options.distanceM;
    this.laneX = options.laneX ?? 0;
    this.centreHeightM = options.centreHeightM;
    this.tiltRad = (options.faceTiltDeg * Math.PI) / 180;
    this.palette = options.palette ?? 'standard';

    this.group.position.set(this.laneX, this.centreHeightM, this.distanceM);
    this.faceGroup.rotation.x = this.tiltRad;
    this.group.add(this.faceGroup);

    this.texture = this.drawFace();
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.FrontSide,
    });
    this.materials.push(this.material);

    const radius = faceRadiusM(this.face);
    const faceGeo = new THREE.CircleGeometry(radius, 96);
    this.geometries.push(faceGeo);
    this.faceMesh = new THREE.Mesh(faceGeo, this.material);
    this.faceMesh.rotation.y = Math.PI;
    this.faceMesh.position.z = -0.005;
    this.faceMesh.receiveShadow = true;
    this.faceGroup.add(this.faceMesh);

    this.buildButt(radius);
    this.buildStand(radius);
  }

  /** Draw the rings into a canvas. 1024 px for a 122 cm face is ~1.2 mm/px. */
  private drawFace(): THREE.CanvasTexture {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;
    const outer = faceRadiusM(this.face);
    const pxPerM = c / outer;

    // Butt-coloured backing (the part of the face outside the printed rings).
    ctx.fillStyle = '#6d6a5a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#7c7a68';
    ctx.fillRect(0, 0, size, size);

    const outermostPrinted = ringRadiusM(this.face, this.face.minScoringRing);
    // A pale straw ring around the printed area, like a real butt.
    ctx.beginPath();
    ctx.arc(c, c, outermostPrinted * pxPerM, 0, Math.PI * 2);
    ctx.fillStyle = '#b9b39b';
    ctx.fill();

    // Rings from the outside in.
    for (let ring = this.face.minScoringRing; ring <= this.face.rings; ring++) {
      const r = ringRadiusM(this.face, ring) * pxPerM;
      const color = this.ringColor(ring);
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(15, 18, 22, 0.55)';
      ctx.stroke();
    }

    // X ring: a thin line inside the 10.
    const xr = xRingRadiusM(this.face) * pxPerM;
    ctx.beginPath();
    ctx.arc(c, c, xr, 0, Math.PI * 2);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(20, 20, 20, 0.55)';
    ctx.stroke();

    // Ring numbers at 12 o'clock.
    ctx.fillStyle = 'rgba(20, 22, 26, 0.72)';
    ctx.font = `600 ${Math.round(size * 0.018)}px Inter, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let ring = this.face.minScoringRing; ring <= this.face.rings; ring++) {
      const r = (ringRadiusM(this.face, ring) - this.face.ringWidthCm / 200) * pxPerM;
      ctx.fillText(String(ring), c, c - r);
    }

    // Canvas wear: a few scuffs and pinholes, deterministic so reloads match.
    let seed = 20261021;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 240; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * c;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      ctx.beginPath();
      ctx.arc(x, y, rand() * 2.2 + 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.05 + rand() * 0.1})`;
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }

  private ringColor(ring: number): string {
    const hex = faceColorForRing(this.face, ring);
    if (this.palette !== 'cbSafe') return hex;
    for (const color of this.face.colors) {
      if (color.rings.includes(ring)) return CB_SAFE[color.name.toLowerCase()] ?? hex;
    }
    return hex;
  }

  private buildButt(radius: number): void {
    const straw = new THREE.MeshStandardMaterial({ color: 0x9a8b62, roughness: 1, metalness: 0 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x3a352b, roughness: 0.9, metalness: 0.05 });
    this.materials.push(straw, strap);

    const width = Math.max(1.25, radius * 2 + 0.25);
    const buttGeo = new THREE.BoxGeometry(width, width, 0.32);
    this.geometries.push(buttGeo);
    const butt = new THREE.Mesh(buttGeo, straw);
    butt.position.z = 0.16;
    butt.castShadow = true;
    butt.receiveShadow = true;
    this.faceGroup.add(butt);

    // Two vertical straps holding the butt together.
    for (const x of [-width * 0.28, width * 0.28]) {
      const strapGeo = new THREE.BoxGeometry(0.05, width + 0.02, 0.34);
      this.geometries.push(strapGeo);
      const band = new THREE.Mesh(strapGeo, strap);
      band.position.set(x, 0, 0.16);
      this.faceGroup.add(band);
    }

    // A soft shadow catcher behind the butt.
    const shadowGeo = new THREE.PlaneGeometry(width * 1.6, 1.4);
    this.geometries.push(shadowGeo);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
    this.materials.push(shadowMat);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -this.centreHeightM + 0.01, 0.4);
    this.group.add(shadow);
  }

  private buildStand(radius: number): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x5c4a33, roughness: 0.85, metalness: 0.02 });
    this.materials.push(wood);

    for (const sign of [1, -1]) {
      const legGeo = new THREE.BoxGeometry(0.07, this.centreHeightM + 0.1, 0.07);
      this.geometries.push(legGeo);
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(sign * (radius + 0.1), -this.centreHeightM / 2 + 0.05, 0.36);
      leg.rotation.x = 0.08;
      leg.castShadow = true;
      this.group.add(leg);
    }

    const footGeo = new THREE.BoxGeometry(radius * 2 + 0.5, 0.08, 0.5);
    this.geometries.push(footGeo);
    const foot = new THREE.Mesh(footGeo, wood);
    foot.position.set(0, -this.centreHeightM + 0.04, 0.36);
    foot.castShadow = true;
    foot.receiveShadow = true;
    this.group.add(foot);

    // Distance marker board.
    const boardGeo = new THREE.BoxGeometry(0.5, 0.22, 0.03);
    this.geometries.push(boardGeo);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.7, metalness: 0.1 });
    this.materials.push(boardMat);
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(radius + 0.55, -0.35, 0.5);
    board.castShadow = true;
    this.group.add(board);
  }

  /** World position of a point on the face (metres from the gold centre). */
  facePointToWorld(point: Vec2): THREE.Vector3 {
    return new THREE.Vector3(
      this.laneX + point.x,
      this.centreHeightM + point.y * Math.cos(this.tiltRad),
      this.distanceM - point.y * Math.sin(this.tiltRad),
    );
  }

  /** Face normal in world space (points towards the archer and slightly up). */
  get normal(): THREE.Vector3 {
    return new THREE.Vector3(0, Math.sin(this.tiltRad), -Math.cos(this.tiltRad));
  }

  /** Where the arrow should stick: just behind the face surface. */
  impactPoint(point: Vec2): THREE.Vector3 {
    return this.facePointToWorld(point).addScaledVector(this.normal, 0.02);
  }

  setPalette(palette: 'standard' | 'cbSafe'): void {
    if (this.palette === palette) return;
    this.palette = palette;
    const next = this.drawFace();
    this.material.map = next;
    this.material.needsUpdate = true;
    this.texture.dispose();
    this.texture = next;
  }

  dispose(): void {
    this.texture.dispose();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
