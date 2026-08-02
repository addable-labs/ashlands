import * as THREE from 'three';
import type { TerrainQuery } from '../core/types';
import type { SpeciesDef } from './Species';

/**
 * Ambient creature behaviour.
 *
 * Steering rather than pathfinding: a desired velocity is assembled from a
 * handful of forces and the actor's own turn rate integrates it. That is the
 * right model for wildlife — it produces the drift, hesitation and banking that
 * make a herd look alive, where a waypoint follower produces mechanical
 * traversal.
 */

export type Behaviour = 'idle' | 'graze' | 'wander' | 'flee' | 'approach' | 'circle' | 'dive' | 'path';

export interface Brain {
  behaviour: Behaviour;
  /** Seconds until the current behaviour is reconsidered. */
  timer: number;
  goal: THREE.Vector3;
  /** Orbit centre for circling flyers, and home for territorial ground actors. */
  home: THREE.Vector3;
  orbitRadius: number;
  orbitDir: number;
  orbitAngle: number;
  /** 0..1 arousal. Drives idle rate, gait selection and head tracking. */
  alarm: number;
  seed: number;
  /** Path waypoints for NPCs. */
  path: THREE.Vector3[];
  pathIdx: number;
  /** Cruise altitude for flyers/drifters, resampled per behaviour change. */
  altitude: number;
}

export interface WorldSense {
  terrain: TerrainQuery;
  /** Player eye position; null before the player system is up. */
  player: THREE.Vector3 | null;
  wind: THREE.Vector2;
  windSpeed: number;
  dt: number;
  time: number;
  /** Visit every other actor within `r` of `p`. */
  neighbours(p: THREE.Vector3, r: number, fn: (x: number, y: number, z: number, radius: number) => void): void;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _probe = new THREE.Vector3();

function rand(seed: number, n: number): number {
  const s = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Sea level. Ground creatures treat anything below it as impassable. */
const SEA = 0.5;

/**
 * Terrain-aware avoidance.
 *
 * Three whiskers ahead of the actor, scaled by how fast it is going, sampled
 * against the heightfield. A whisker that climbs too steeply — or drops into
 * water — pushes laterally, which is what makes creatures follow the contours
 * of a drainage rather than walking up a cliff face.
 */
function avoidTerrain(
  out: THREE.Vector3,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
  speed: number,
  def: SpeciesDef,
  w: WorldSense,
): void {
  const look = def.radius * 2.5 + speed * 1.1;
  const h0 = w.terrain.heightAt(pos.x, pos.z);
  const maxRise = 0.75;
  for (let k = -1; k <= 1; k++) {
    const a = k * 0.62;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const dx = dir.x * cs - dir.z * sn;
    const dz = dir.x * sn + dir.z * cs;
    const px = pos.x + dx * look;
    const pz = pos.z + dz * look;
    const h = w.terrain.heightAt(px, pz);
    const rise = (h - h0) / look;
    let bad = 0;
    if (rise > maxRise) bad = (rise - maxRise) * 2.2;
    if (h < SEA) bad = Math.max(bad, 1.6);
    if (Math.abs(px) > w.terrain.extent - 40 || Math.abs(pz) > w.terrain.extent - 40) bad = Math.max(bad, 2.0);
    if (bad > 0) {
      // Push away from the offending whisker, biased sideways so the actor
      // slides along the obstacle instead of stalling nose-first into it.
      out.x -= dx * bad;
      out.z -= dz * bad;
      out.x += -dz * bad * (k === 0 ? 0.9 : k * 0.9);
      out.z += dx * bad * (k === 0 ? 0.9 : k * 0.9);
    }
  }
}

/** A point on flat-enough, dry-enough ground near `from`. */
export function findGround(
  out: THREE.Vector3,
  from: THREE.Vector3,
  minR: number,
  maxR: number,
  seed: number,
  terrain: TerrainQuery,
  surfaces: readonly number[],
): boolean {
  // Two passes: the first insists on the species' preferred surface, the
  // second will take any dry, walkable ground. Without the fallback a strict
  // biome filter can fail every candidate and leave an actor stranded, and
  // because the search is seeded it would then fail identically forever.
  for (let i = 0; i < 28; i++) {
    const strict = i < 18;
    const a = rand(seed, i * 2) * Math.PI * 2;
    const r = minR + (maxR - minR) * Math.sqrt(rand(seed, i * 2 + 1));
    const x = from.x + Math.cos(a) * r;
    const z = from.z + Math.sin(a) * r;
    if (Math.abs(x) > terrain.extent - 60 || Math.abs(z) > terrain.extent - 60) continue;
    const h = terrain.heightAt(x, z);
    if (h < SEA + 0.6) continue;
    const n = terrain.normalAt(x, z, _probe);
    if (n.y < (strict ? 0.82 : 0.7)) continue;
    if (strict && surfaces.length > 0 && !surfaces.includes(terrain.materialAt(x, z))) continue;
    out.set(x, h, z);
    return true;
  }
  return false;
}

export function initBrain(brain: Brain, def: SpeciesDef, pos: THREE.Vector3, seed: number, w: WorldSense): void {
  brain.seed = seed;
  brain.alarm = 0;
  brain.home.copy(pos);
  brain.orbitRadius = 24 + rand(seed, 3) * 40;
  brain.orbitDir = rand(seed, 4) > 0.5 ? 1 : -1;
  brain.orbitAngle = rand(seed, 5) * Math.PI * 2;
  brain.pathIdx = 0;
  brain.path = [];
  brain.timer = 1 + rand(seed, 6) * 4;
  brain.altitude = def.altitude !== undefined
    ? def.altitude[0] + rand(seed, 7) * (def.altitude[1] - def.altitude[0])
    : 0;

  if (def.locomotion === 'fly') brain.behaviour = 'circle';
  else if (def.locomotion === 'drift') brain.behaviour = 'wander';
  else if (def.faction === 'dunmer') {
    // A loop of waypoints around the spawn, so NPCs walk a route and come back.
    const n = 4 + Math.floor(rand(seed, 8) * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(seed, 20 + i) * 0.7;
      const r = 30 + rand(seed, 40 + i) * 55;
      const p = new THREE.Vector3();
      _v.set(pos.x + Math.cos(a) * r, 0, pos.z + Math.sin(a) * r);
      if (findGround(p, _v, 0, 18, seed + i, w.terrain, def.surfaces)) brain.path.push(p);
    }
    brain.behaviour = brain.path.length > 1 ? 'path' : 'wander';
  } else brain.behaviour = 'graze';

  brain.goal.copy(pos);
}

/**
 * Choose a desired world velocity for this frame. The caller integrates it with
 * the species' own acceleration and turn limits, which is where the difference
 * between a kwama and a silt strider actually lives.
 */
export function steer(
  outVel: THREE.Vector3,
  brain: Brain,
  def: SpeciesDef,
  pos: THREE.Vector3,
  forward: THREE.Vector3,
  w: WorldSense,
): void {
  const dt = w.dt;
  brain.timer -= dt;

  // --- threat assessment -------------------------------------------------
  let playerDist = Infinity;
  if (w.player !== null) playerDist = pos.distanceTo(w.player);
  const skittish = def.faction === 'wild' || def.faction === 'tame';
  const fleeRange = def.radius * 6 + 14;
  let wantAlarm = 0;
  if (playerDist < fleeRange * 2.2) wantAlarm = THREE.MathUtils.clamp(1 - playerDist / (fleeRange * 2.2), 0, 1);
  brain.alarm += (wantAlarm - brain.alarm) * Math.min(1, dt * 1.6);

  if (skittish && playerDist < fleeRange && def.locomotion === 'ground' && def.kind !== 'siltstrider') {
    brain.behaviour = 'flee';
    brain.timer = 2.5;
  } else if (def.faction === 'predator' && playerDist < 48 && playerDist > 3) {
    brain.behaviour = 'approach';
    brain.timer = 1.5;
  }

  // --- behaviour transitions --------------------------------------------
  if (brain.timer <= 0) {
    const r = rand(brain.seed, Math.floor(w.time * 3) + 11);
    brain.timer = 3 + r * 7;
    if (def.locomotion === 'fly') {
      brain.behaviour = r < 0.22 ? 'dive' : 'circle';
      if (brain.behaviour === 'dive') brain.timer = 2.2 + r * 2;
      if (brain.behaviour === 'circle') {
        brain.altitude = def.altitude![0] + r * (def.altitude![1] - def.altitude![0]);
        // Cliff racers do not orbit one spot forever; the centre wanders.
        brain.home.x += (r - 0.5) * 140;
        brain.home.z += (rand(brain.seed, w.time | 0) - 0.5) * 140;
        const e = w.terrain.extent - 200;
        brain.home.x = THREE.MathUtils.clamp(brain.home.x, -e, e);
        brain.home.z = THREE.MathUtils.clamp(brain.home.z, -e, e);
      }
    } else if (def.locomotion === 'drift') {
      brain.behaviour = 'wander';
    } else if (def.faction === 'dunmer' && brain.path.length > 1) {
      brain.behaviour = 'path';
    } else if (brain.behaviour === 'graze' || brain.behaviour === 'idle') {
      brain.behaviour = 'wander';
      if (!findGround(brain.goal, pos, def.radius * 6, 40 + def.radius * 12, brain.seed + w.time, w.terrain, def.surfaces)) {
        brain.goal.copy(brain.home);
      }
    } else {
      brain.behaviour = r < 0.55 ? 'graze' : 'idle';
      brain.timer = 4 + r * 8;
    }
  }

  // --- desired direction --------------------------------------------------
  outVel.set(0, 0, 0);
  let speed = 0;

  switch (brain.behaviour) {
    case 'idle':
    case 'graze':
      speed = brain.behaviour === 'graze' ? def.walkSpeed * 0.22 : 0;
      _v.copy(brain.goal).sub(pos);
      _v.y = 0;
      if (_v.lengthSq() > 1) outVel.copy(_v).normalize();
      else speed = 0;
      break;

    case 'wander':
    case 'path': {
      if (brain.behaviour === 'path' && brain.path.length > 1) {
        const wp = brain.path[brain.pathIdx % brain.path.length];
        if (pos.distanceTo(wp) < def.radius * 3 + 2) brain.pathIdx++;
        brain.goal.copy(brain.path[brain.pathIdx % brain.path.length]);
      }
      _v.copy(brain.goal).sub(pos);
      _v.y = 0;
      const d = _v.length();
      if (d < def.radius * 2 + 1.5) {
        if (!findGround(brain.goal, pos, def.radius * 5, 60, brain.seed + w.time * 2, w.terrain, def.surfaces)) {
          brain.goal.copy(brain.home);
        }
      }
      if (d > 0.01) outVel.copy(_v).multiplyScalar(1 / d);
      speed = def.walkSpeed;
      // Netches do not swim against the weather; they are pushed by it.
      if (def.locomotion === 'drift') {
        outVel.x += w.wind.x * 0.9;
        outVel.z += w.wind.y * 0.9;
        speed = def.walkSpeed * (0.35 + 0.5 * THREE.MathUtils.clamp(w.windSpeed / 12, 0, 1.4));
      }
      break;
    }

    case 'flee': {
      if (w.player !== null) {
        _v.subVectors(pos, w.player);
        _v.y = 0;
        if (_v.lengthSq() > 1e-4) outVel.copy(_v).normalize();
      } else outVel.copy(forward);
      speed = def.runSpeed;
      if (playerDist > fleeRange * 2.4) {
        brain.behaviour = 'wander';
        brain.timer = 2;
      }
      break;
    }

    case 'approach': {
      if (w.player !== null) {
        _v.subVectors(w.player, pos);
        _v.y = 0;
        const d = _v.length();
        if (d > 1e-3) outVel.copy(_v).multiplyScalar(1 / d);
        // Predators stalk, then commit. The lull below 12 m is what makes a
        // nix-hound look like it is choosing a moment.
        speed = d > 14 ? def.runSpeed : def.walkSpeed * 1.3;
        if (d < 4) speed = 0;
      }
      break;
    }

    case 'circle': {
      brain.orbitAngle += brain.orbitDir * dt * (def.walkSpeed / Math.max(brain.orbitRadius, 6));
      _w.set(
        brain.home.x + Math.cos(brain.orbitAngle) * brain.orbitRadius,
        0,
        brain.home.z + Math.sin(brain.orbitAngle) * brain.orbitRadius,
      );
      _v.subVectors(_w, pos);
      _v.y = 0;
      if (_v.lengthSq() > 1e-4) outVel.copy(_v).normalize();
      speed = def.walkSpeed;
      break;
    }

    case 'dive': {
      // Stoop at the player if there is one, otherwise at the ground below the
      // orbit. Either way the altitude term below pulls it back up after.
      const t = w.player !== null ? w.player : brain.home;
      _v.subVectors(t, pos);
      _v.y = 0;
      if (_v.lengthSq() > 1e-4) outVel.copy(_v).normalize();
      speed = def.runSpeed;
      break;
    }
  }

  if (outVel.lengthSq() > 1e-8) outVel.normalize();

  // --- avoidance ----------------------------------------------------------
  if (def.locomotion === 'ground') {
    _w.set(0, 0, 0);
    avoidTerrain(_w, pos, outVel.lengthSq() > 1e-6 ? outVel : forward, speed, def, w);
    outVel.addScaledVector(_w, 0.55);
  }

  // Separation. Cheap, and the single biggest contributor to a group of
  // creatures reading as individuals rather than as one clumped blob.
  const sepR = def.radius * 3.2;
  _w.set(0, 0, 0);
  w.neighbours(pos, sepR, (x, y, z, r) => {
    const dx = pos.x - x;
    const dy = pos.y - y;
    const dz = pos.z - z;
    const d2 = dx * dx + dz * dz + (def.locomotion === 'ground' ? 0 : dy * dy);
    const rr = sepR * 0.5 + r;
    if (d2 > rr * rr || d2 < 1e-6) return;
    const d = Math.sqrt(d2);
    const push = (1 - d / rr) / d;
    _w.x += dx * push;
    _w.z += dz * push;
    if (def.locomotion !== 'ground') _w.y += dy * push;
  });
  outVel.addScaledVector(_w, 1.3);

  if (outVel.lengthSq() > 1e-8) outVel.normalize();
  outVel.multiplyScalar(speed * (1 + brain.alarm * 0.35));

  // --- vertical -----------------------------------------------------------
  if (def.locomotion !== 'ground') {
    const ground = w.terrain.heightAt(pos.x, pos.z);
    let want = Math.max(ground, SEA) + brain.altitude;
    if (brain.behaviour === 'dive') want = Math.max(ground, SEA) + brain.altitude * 0.22;
    // Bob on the thermals; netches wallow slowly, racers ride sharper.
    const bobRate = def.locomotion === 'drift' ? 0.22 : 0.7;
    want += Math.sin(w.time * bobRate + brain.seed * 5) * (def.locomotion === 'drift' ? 0.9 : 1.6);
    outVel.y = THREE.MathUtils.clamp((want - pos.y) * 0.8, -def.runSpeed, def.runSpeed);
  }
}
