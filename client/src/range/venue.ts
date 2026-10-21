/**
 * Venue builder.
 *
 * Three venues share one layout so the rules (lane width, shooting line,
 * waiting line, target centre height, 15 degree face tilt) are identical
 * everywhere:
 *   stadium - Olympic-style field with grandstands, banners and a big screen
 *   club    - countryside range with trees, a fence and a small clubhouse
 *   indoor  - 18 m hall with a wooden floor and overhead lighting
 *
 * Everything is procedural, so the project runs with no asset downloads.
 */

import * as THREE from 'three';
import { rules } from '@shared/rules/index';
import type { FaceConfig, WindFieldConfig } from '@shared/types';
import type { QualitySettings } from '../render/renderer';
import type { VenueId } from '../state/store';
import { Target } from './target';
import { WindFlags } from './wind';
import { GrassField } from './grass';
import { Crowd } from './crowd';
import { Scoreboard, TrafficLight } from './signals';

export interface VenueOptions {
  id: VenueId;
  face: FaceConfig;
  distanceM: number;
  lanes: number;
  quality: QualitySettings;
  palette?: 'standard' | 'cbSafe';
}

export class Venue {
  readonly group = new THREE.Group();
  readonly targets: Target[] = [];
  readonly flags: WindFlags;
  readonly crowd: Crowd | null;
  readonly grass: GrassField | null;
  readonly scoreboard: Scoreboard;
  readonly trafficLight: TrafficLight;
  readonly id: VenueId;
  readonly distanceM: number;
  readonly laneWidthM = rules.fieldOfPlay.laneWidthM;

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private groundTexture!: THREE.CanvasTexture;
  private netTexture!: THREE.CanvasTexture;
  private bannerTextures: THREE.CanvasTexture[] = [];

  constructor(options: VenueOptions) {
    this.id = options.id;
    this.distanceM = options.distanceM;

    this.buildGround(options.id);
    this.buildLines();
    this.buildBackstop(options.distanceM);
    this.buildDistanceMarkers(options.distanceM);

    for (let lane = 0; lane < options.lanes; lane++) {
      const target = new Target({
        face: options.face,
        distanceM: options.distanceM,
        laneX: lane * this.laneWidthM,
        centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
        faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
        palette: options.palette,
      });
      this.targets.push(target);
      this.group.add(target.group);
    }

    const flagPositions = rules.fieldOfPlay.windFlagPositionsM
      .filter((z) => z < options.distanceM + 4)
      .map((z, i) => ({ z, x: -6.5, height: 2.6 + (i % 2) * 0.3, index: i }));
    if (flagPositions.length === 0) flagPositions.push({ z: options.distanceM * 0.5, x: -6.5, height: 2.6, index: 0 });
    this.flags = new WindFlags(flagPositions);
    this.group.add(this.flags.group);

    this.trafficLight = new TrafficLight(new THREE.Vector3(3.2, 0, 1.6));
    this.trafficLight.group.rotation.y = Math.PI;
    this.group.add(this.trafficLight.group);

    this.scoreboard = new Scoreboard(new THREE.Vector3(-9.5, 0, Math.min(34, options.distanceM * 0.55)), Math.PI * 0.62);
    this.group.add(this.scoreboard.group);

    if (options.id === 'stadium') {
      this.buildStadium(options.quality);
      this.crowd = options.quality.crowdDensity > 0
        ? new Crowd(Math.round(520 * options.quality.crowdDensity))
        : null;
      this.grass = options.quality.grassDensity > 0
        ? new GrassField(Math.round(9000 * options.quality.grassDensity))
        : null;
    } else if (options.id === 'club') {
      this.buildClub();
      this.crowd = new Crowd(Math.round(90 * options.quality.crowdDensity), { rows: 3, startZ: 8 });
      this.grass = options.quality.grassDensity > 0
        ? new GrassField(Math.round(12000 * options.quality.grassDensity))
        : null;
    } else {
      this.buildIndoor();
      this.crowd = null;
      this.grass = null;
    }

    if (this.crowd) this.group.add(this.crowd.mesh);
    if (this.grass) this.group.add(this.grass.mesh);
  }

  private buildGround(id: VenueId): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const base = id === 'indoor' ? '#6b4a2c' : id === 'club' ? '#4c6a32' : '#4f7033';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 512);
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 9000; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      const l = 0.16 + rand() * 0.16;
      ctx.fillStyle = id === 'indoor'
        ? `rgba(${90 + rand() * 40}, ${60 + rand() * 30}, ${35 + rand() * 20}, ${l})`
        : `rgba(${40 + rand() * 40}, ${75 + rand() * 55}, ${28 + rand() * 35}, ${l})`;
      ctx.fillRect(x, y, 1 + rand() * 3, 1 + rand() * 3);
    }
    // Mowing stripes for the outdoor venues.
    if (id !== 'indoor') {
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
        ctx.fillRect(0, i * 32, 512, 32);
      }
    }

    this.groundTexture = new THREE.CanvasTexture(canvas);
    this.groundTexture.wrapS = THREE.RepeatWrapping;
    this.groundTexture.wrapT = THREE.RepeatWrapping;
    this.groundTexture.repeat.set(40, 40);
    this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.groundTexture.anisotropy = 8;

    const geo = new THREE.PlaneGeometry(320, 320);
    this.geometries.push(geo);
    const mat = new THREE.MeshStandardMaterial({
      map: this.groundTexture,
      color: id === 'indoor' ? 0x8a6a48 : 0xffffff,
      roughness: id === 'indoor' ? 0.55 : 0.96,
      metalness: 0,
    });
    this.materials.push(mat);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = 40;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private buildLines(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.8, metalness: 0 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.8, metalness: 0 });
    this.materials.push(white, yellow);

    // Shooting line.
    const lineGeo = new THREE.BoxGeometry(30, 0.012, rules.fieldOfPlay.shootingLineWidthM);
    this.geometries.push(lineGeo);
    const line = new THREE.Mesh(lineGeo, white);
    line.position.set(0, 0.006, 0);
    line.receiveShadow = true;
    this.group.add(line);

    // Waiting line, 5 m behind the shooting line.
    const waitGeo = new THREE.BoxGeometry(30, 0.012, 0.04);
    this.geometries.push(waitGeo);
    const wait = new THREE.Mesh(waitGeo, yellow);
    wait.position.set(0, 0.006, -rules.fieldOfPlay.waitingLineM);
    this.group.add(wait);

    // Lane boxes (2.5 m wide) on the shooting line.
    for (let lane = -2; lane <= 3; lane++) {
      const boxGeo = new THREE.BoxGeometry(this.laneWidthM - 0.15, 0.008, 0.9);
      this.geometries.push(boxGeo);
      const box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 0.95 }));
      box.position.set(lane * this.laneWidthM + this.laneWidthM / 2, 0.004, 0.4);
      box.receiveShadow = true;
      this.group.add(box);
    }

    // Officials / media zone lines.
    const mediaGeo = new THREE.BoxGeometry(30, 0.01, 0.03);
    this.geometries.push(mediaGeo);
    for (const z of [-rules.fieldOfPlay.mediaZoneDepthM, -rules.fieldOfPlay.officialsZoneDepthM]) {
      const stripe = new THREE.Mesh(mediaGeo, white);
      stripe.position.set(0, 0.005, z);
      this.group.add(stripe);
    }
  }

  private buildBackstop(distanceM: number): void {
    // Net texture: a transparent grid.
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(20,24,28,0.85)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 128);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(128, i);
      ctx.stroke();
    }
    this.netTexture = new THREE.CanvasTexture(canvas);
    this.netTexture.wrapS = THREE.RepeatWrapping;
    this.netTexture.wrapT = THREE.RepeatWrapping;
    this.netTexture.repeat.set(26, 5);
    this.netTexture.colorSpace = THREE.SRGBColorSpace;

    const netGeo = new THREE.PlaneGeometry(42, 8);
    this.geometries.push(netGeo);
    const netMat = new THREE.MeshStandardMaterial({
      map: this.netTexture,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.1,
      color: 0x30363c,
    });
    this.materials.push(netMat);
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, 3.6, distanceM + 3.2);
    net.receiveShadow = true;
    this.group.add(net);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5d646c, roughness: 0.5, metalness: 0.7 });
    this.materials.push(poleMat);
    for (const x of [-21, -7, 7, 21]) {
      const poleGeo = new THREE.CylinderGeometry(0.06, 0.07, 8, 8);
      this.geometries.push(poleGeo);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 4, distanceM + 3.2);
      pole.castShadow = true;
      this.group.add(pole);
    }
  }

  private buildDistanceMarkers(distanceM: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, 512, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 110px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(distanceM)} m`, 256, 130);
    ctx.fillStyle = '#93a1ae';
    ctx.font = '500 34px Inter, Arial';
    ctx.fillText('SHOOTING LINE', 256, 210);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.bannerTextures.push(texture);

    const geo = new THREE.PlaneGeometry(1.6, 0.8);
    this.geometries.push(geo);
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7, metalness: 0.05 });
    this.materials.push(mat);
    const sign = new THREE.Mesh(geo, mat);
    sign.position.set(8.6, 1.15, 0.4);
    sign.rotation.y = -0.3;
    this.group.add(sign);

    const legGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.8, 8);
    this.geometries.push(legGeo);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3c434a, roughness: 0.5, metalness: 0.6 });
    this.materials.push(legMat);
    for (const x of [8.2, 9.0]) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, 0.4, 0.4);
      this.group.add(leg);
    }
  }

  private buildStadium(quality: QualitySettings): void {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.9, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.8, metalness: 0.1 });
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.7, metalness: 0.05 });
    this.materials.push(concrete, dark, bannerMat);

    for (const side of [-1, 1]) {
      for (let row = 0; row < 7; row++) {
        const geo = new THREE.BoxGeometry(1.1, 0.55, 46);
        this.geometries.push(geo);
        const step = new THREE.Mesh(geo, row === 0 ? dark : concrete);
        step.position.set(side * (11 + row * 1.1), 1.1 + row * 0.55, 22);
        step.castShadow = true;
        step.receiveShadow = true;
        this.group.add(step);
      }
      // Back wall.
      const wallGeo = new THREE.BoxGeometry(0.4, 5, 46);
      this.geometries.push(wallGeo);
      const wall = new THREE.Mesh(wallGeo, dark);
      wall.position.set(side * 18.8, 4.5, 22);
      this.group.add(wall);
    }

    // Banner boards along the front of each stand.
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 1024;
    bannerCanvas.height = 256;
    const bctx = bannerCanvas.getContext('2d')!;
    bctx.fillStyle = '#0b1016';
    bctx.fillRect(0, 0, 1024, 256);
    bctx.fillStyle = '#f5c518';
    bctx.fillRect(0, 0, 1024, 12);
    bctx.fillRect(0, 244, 1024, 12);
    bctx.font = '800 92px Inter, Arial';
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillStyle = '#f5c518';
    bctx.fillText('GOLD RING', 512, 118);
    bctx.fillStyle = '#93a1ae';
    bctx.font = '500 34px Inter, Arial';
    bctx.fillText('WORLD ARCHERY STYLE', 512, 196);
    const bannerTexture = new THREE.CanvasTexture(bannerCanvas);
    bannerTexture.colorSpace = THREE.SRGBColorSpace;
    this.bannerTextures.push(bannerTexture);

    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(20, 1.1);
      this.geometries.push(geo);
      const mat = new THREE.MeshStandardMaterial({ map: bannerTexture, roughness: 0.75, metalness: 0.05 });
      this.materials.push(mat);
      const banner = new THREE.Mesh(geo, mat);
      banner.position.set(side * 10.4, 0.75, 12);
      banner.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(banner);
    }

    // Judge tent and camera boom silhouettes.
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, roughness: 0.85, metalness: 0 });
    this.materials.push(tentMat);
    const tentGeo = new THREE.BoxGeometry(3.2, 2.2, 2.6);
    this.geometries.push(tentGeo);
    const tent = new THREE.Mesh(tentGeo, tentMat);
    tent.position.set(-8.5, 1.1, -2.5);
    tent.castShadow = true;
    this.group.add(tent);
    const roofGeo = new THREE.ConeGeometry(2.6, 0.9, 4);
    this.geometries.push(roofGeo);
    const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x1f6b45, roughness: 0.8 }));
    roof.position.set(-8.5, 2.65, -2.5);
    roof.rotation.y = Math.PI / 4;
    this.group.add(roof);

    // A pair of camera booms, purely for the broadcast look.
    const boomMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.6, metalness: 0.5 });
    this.materials.push(boomMat);
    for (const x of [-7.5, 7.5]) {
      const boomGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.4, 6);
      this.geometries.push(boomGeo);
      const boom = new THREE.Mesh(boomGeo, boomMat);
      boom.position.set(x, 1.7, 8);
      boom.rotation.z = x > 0 ? -0.12 : 0.12;
      this.group.add(boom);
    }

    void quality;
  }

  private buildClub(): void {
    // Fence line.
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6a5336, roughness: 0.9 });
    this.materials.push(postMat);
    for (let x = -24; x <= 24; x += 3) {
      const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6);
      this.geometries.push(postGeo);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, 0.6, -12);
      this.group.add(post);
    }
    for (let i = 0; i < 2; i++) {
      const railGeo = new THREE.BoxGeometry(48, 0.06, 0.04);
      this.geometries.push(railGeo);
      const rail = new THREE.Mesh(railGeo, postMat);
      rail.position.set(0, 0.5 + i * 0.45, -12);
      this.group.add(rail);
    }

    // Trees.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.9 });
    this.materials.push(trunkMat, leafMat);
    let seed = 77;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 14; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (13 + rand() * 8);
      const z = -8 + rand() * 60;
      const h = 3.5 + rand() * 2.5;
      const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, h * 0.45, 6);
      this.geometries.push(trunkGeo);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, h * 0.225, z);
      trunk.castShadow = true;
      this.group.add(trunk);
      const crownGeo = new THREE.ConeGeometry(1.4 + rand(), h * 0.8, 7);
      this.geometries.push(crownGeo);
      const crown = new THREE.Mesh(crownGeo, leafMat);
      crown.position.set(x, h * 0.45 + h * 0.35, z);
      crown.castShadow = true;
      this.group.add(crown);
    }

    // Clubhouse.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9ac96, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.85 });
    this.materials.push(wallMat, roofMat);
    const houseGeo = new THREE.BoxGeometry(9, 3, 6);
    this.geometries.push(houseGeo);
    const house = new THREE.Mesh(houseGeo, wallMat);
    house.position.set(-16, 1.5, -6);
    house.castShadow = true;
    house.receiveShadow = true;
    this.group.add(house);
    const roofGeo = new THREE.ConeGeometry(7, 2, 4);
    this.geometries.push(roofGeo);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(-16, 4, -6);
    roof.rotation.y = Math.PI / 4;
    this.group.add(roof);
  }

  private buildIndoor(): void {
    const floor = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.45, metalness: 0.05 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.85, metalness: 0.05 });
    const ceiling = new THREE.MeshStandardMaterial({ color: 0x151a20, roughness: 0.9 });
    this.materials.push(floor, wall, ceiling);

    // Replace the grass ground with a polished wooden floor.
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    this.geometries.push(floorGeo);
    const floorMesh = new THREE.Mesh(floorGeo, floor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0.002, 10);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    for (const side of [-1, 1]) {
      const wallGeo = new THREE.BoxGeometry(0.3, 6, 40);
      this.geometries.push(wallGeo);
      const w = new THREE.Mesh(wallGeo, wall);
      w.position.set(side * 12, 3, 10);
      w.receiveShadow = true;
      this.group.add(w);
    }
    const backGeo = new THREE.BoxGeometry(24, 6, 0.3);
    this.geometries.push(backGeo);
    const back = new THREE.Mesh(backGeo, wall);
    back.position.set(0, 3, 30);
    this.group.add(back);

    const ceilGeo = new THREE.BoxGeometry(24, 0.2, 40);
    this.geometries.push(ceilGeo);
    const ceil = new THREE.Mesh(ceilGeo, ceiling);
    ceil.position.set(0, 6, 10);
    this.group.add(ceil);

    // Strip lights.
    for (let z = 0; z <= 24; z += 6) {
      const lightGeo = new THREE.BoxGeometry(6, 0.08, 0.3);
      this.geometries.push(lightGeo);
      const stripMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(0xfff4e0),
        emissiveIntensity: 2.2,
        roughness: 0.4,
      });
      this.materials.push(stripMat);
      const strip = new THREE.Mesh(lightGeo, stripMat);
      strip.position.set(0, 5.85, z + 2);
      this.group.add(strip);
      const light = new THREE.PointLight(0xfff0d8, 22, 18, 2);
      light.position.set(0, 5.4, z + 2);
      this.group.add(light);
    }

    // Lane dividers on the floor.
    for (let lane = -1; lane <= 2; lane++) {
      const dividerGeo = new THREE.BoxGeometry(0.04, 0.01, 18);
      this.geometries.push(dividerGeo);
      const divider = new THREE.Mesh(dividerGeo, new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6 }));
      divider.position.set(lane * 2.5 + 1.25, 0.01, 9);
      this.group.add(divider);
    }
  }

  /** Set the face on every target (class change). */
  setFace(face: FaceConfig): void {
    this.targets.forEach((target) => {
      // Rebuild only when the geometry actually changes.
      if (target.face.id !== face.id) {
        const replacement = new Target({
          face,
          distanceM: target.distanceM,
          laneX: target.laneX,
          centreHeightM: target.centreHeightM,
          faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
        });
        this.group.add(replacement.group);
        this.group.remove(target.group);
        target.dispose();
        const index = this.targets.indexOf(target);
        this.targets[index] = replacement;
      }
    });
  }

  update(dt: number, time: number, wind: WindFieldConfig, cheer = 0): void {
    this.flags.update(wind, time);
    this.crowd?.setCheer(cheer);
    this.crowd?.update(dt);
    this.grass?.update(time, wind.baseSpeed * Math.sin((wind.baseDirectionDeg * Math.PI) / 180), wind.baseSpeed, 0.09 + wind.baseSpeed * 0.012);
  }

  dispose(): void {
    this.targets.forEach((t) => t.dispose());
    this.flags.dispose();
    this.crowd?.dispose();
    this.grass?.dispose();
    this.scoreboard.dispose();
    this.trafficLight.dispose();
    this.groundTexture.dispose();
    this.netTexture.dispose();
    this.bannerTextures.forEach((t) => t.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
