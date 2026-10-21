/**
 * Wind flags and the on-range wind display.
 *
 * The flags are not decoration: each one samples the same `sampleWind` field
 * the arrow flies through, at its own distance downrange and at the current
 * time. If the flag at 50 m is standing up, the arrow at 50 m is being pushed.
 */

import * as THREE from 'three';
import { sampleWind } from '@shared/physics/wind';
import { describeWind, windSeverity } from '@shared/physics/wind';
import type { WindFieldConfig } from '@shared/types';

export interface FlagOptions {
  z: number;
  x: number;
  height: number;
  index: number;
}

interface Flag {
  group: THREE.Group;
  cloth: THREE.Mesh;
  clothMaterial: THREE.MeshStandardMaterial;
  options: FlagOptions;
  phase: number;
}

export class WindFlags {
  readonly group = new THREE.Group();
  readonly flags: Flag[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];
  private uniforms: { uTime: { value: number }; uAmp: { value: number } };

  constructor(positions: FlagOptions[]) {
    this.uniforms = { uTime: { value: 0 }, uAmp: { value: 0.1 } };

    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd9dee4, roughness: 0.4, metalness: 0.8 });
    this.materials.push(poleMat);

    positions.forEach((options, i) => {
      const group = new THREE.Group();
      group.position.set(options.x, 0, options.z);

      const poleGeo = new THREE.CylinderGeometry(0.02, 0.026, options.height, 8);
      this.geometries.push(poleGeo);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = options.height / 2;
      pole.castShadow = true;
      group.add(pole);

      const baseGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.08, 12);
      this.geometries.push(baseGeo);
      const base = new THREE.Mesh(baseGeo, poleMat);
      base.position.y = 0.04;
      group.add(base);

      // Cloth: a plane subdivided so the vertex shader can ripple it.
      const clothGeo = new THREE.PlaneGeometry(0.52, 0.3, 10, 4);
      this.geometries.push(clothGeo);
      const clothMat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0xf5c518 : 0xe8eef5,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      this.materials.push(clothMat);

      // Inject a travelling wave along the flag, scaled by the wind strength.
      clothMat.onBeforeCompile = (shader) => {
        shader.uniforms['uTime'] = this.uniforms.uTime;
        shader.uniforms['uAmp'] = this.uniforms.uAmp;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
             uniform float uTime;
             uniform float uAmp;`,
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             float w = clamp(position.x / 0.52 + 0.5, 0.0, 1.0);
             transformed.z += sin(position.x * 12.0 + uTime * 7.0 + ${(i * 1.7).toFixed(2)}) * uAmp * w;
             transformed.y += sin(position.x * 8.0 + uTime * 4.0) * uAmp * 0.25 * w;`,
          );
      };

      const cloth = new THREE.Mesh(clothGeo, clothMat);
      cloth.position.set(0.26, options.height - 0.18, 0);
      cloth.castShadow = true;
      group.add(cloth);

      // A small halyard and a weighted bottom edge.
      const halyardGeo = new THREE.CylinderGeometry(0.004, 0.004, options.height - 0.3, 4);
      this.geometries.push(halyardGeo);
      const halyard = new THREE.Mesh(halyardGeo, poleMat);
      halyard.position.y = (options.height - 0.3) / 2;
      group.add(halyard);

      this.group.add(group);
      this.flags.push({ group, cloth, clothMaterial: clothMat, options, phase: options.index * 0.9 });
    });
  }

  /**
   * Orient every flag with the local wind.
   *
   * @param wind wind configuration
   * @param time seconds since the end started
   */
  update(wind: WindFieldConfig, time: number): void {
    this.uniforms.uTime.value = time;
    let strongest = 0;
    for (const flag of this.flags) {
      const sample = sampleWind(wind, flag.options.x, flag.options.height, flag.options.z, time);
      const speed = Math.hypot(sample.x, sample.z);
      strongest = Math.max(strongest, speed);
      // The cloth extends along local +x, so rotate +x onto the wind vector.
      flag.group.rotation.y = Math.atan2(sample.x, sample.z) - Math.PI / 2;
      flag.cloth.scale.y = 0.75 + Math.min(0.5, speed * 0.06);
      flag.clothMaterial.color.setHSL(0.13, 0.72, 0.55 + Math.min(0.12, speed * 0.012));
      flag.cloth.rotation.z = Math.sin(time * 1.3 + flag.phase) * 0.03 * (1 + speed * 0.1);
    }
    this.uniforms.uAmp.value = 0.03 + Math.min(0.18, strongest * 0.02);
  }

  /** Wind summary for the HUD. */
  static summary(wind: WindFieldConfig, time: number): { clock: number; label: string; speed: number; severity: string } {
    const sample = sampleWind(wind, 0, 10, 35, time);
    const described = describeWind(sample);
    return { ...described, severity: windSeverity(described.speed) };
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
