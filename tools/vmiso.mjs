#!/usr/bin/env node
/**
 * VIEWMODEL, ISOLATED — the view a first-person capture cannot give you.
 *
 *   OUT=shots/vm-iso node tools/vmiso.mjs
 *
 * A bad elbow hides behind its own forearm in the first-person frame, which is
 * how three reviews missed one. This lifts the posed arms out of the scene,
 * drops them on a flat background under neutral light, and photographs them
 * from the SIDE (along the aim right axis, so the forward/up plane is the page)
 * and from ABOVE. It also prints the elbow and wrist in aim coordinates, so
 * "below and behind" is a number and not an impression.
 */
import { launch } from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = 'http://127.0.0.1:5178/';
const OUT = process.env.OUT ?? 'shots/vm-iso';

async function up() { try { return (await fetch(URL, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', '5178', '--host', '127.0.0.1'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(500);
}
await mkdir(OUT, { recursive: true });

const browser = await launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--window-size=1200,1200', '--mute-audio'],
  defaultViewport: { width: 1200, height: 1200 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('!!window.engine', { timeout: 180_000 });
await sleep(1500);

await page.evaluate(async () => {
  const ctx = window.engine.ctx, p = ctx.get('player'), t = ctx.get('terrain');
  p.freefly = false;
  ctx.input.pointerLocked = true;
  ctx.clock.hour = 11;
  let best = null;
  for (let x = -400; x <= 400; x += 80) {
    for (let z = -400; z <= 400; z += 80) {
      const h = t.heightAt(x, z);
      if (h < 2 || h > 60) continue;
      const n = t.normalAt(x, z);
      if (!best || n.y > best.flat) best = { x, z, flat: n.y };
    }
  }
  p.teleport(best.x, best.z, 0.2);
  p.setLook(0.7, -0.06);
  await new Promise((r) => setTimeout(r, 1200));
});

// The probe rig, installed once and reused for every pose.
await page.evaluate(() => {
  const T = window.RENDER_THREE, ctx = window.engine.ctx;
  const scene = new T.Scene();
  scene.background = new T.Color(0x33343a);
  scene.add(new T.HemisphereLight(0xdfe4ee, 0x30302c, 1.6));
  const key = new T.DirectionalLight(0xfff2e0, 2.6);
  key.position.set(1.2, 1.6, 0.8);
  scene.add(key);
  const rim = new T.DirectionalLight(0xa8c0ff, 0.9);
  rim.position.set(-1, 0.3, -1.2);
  scene.add(rim);
  const cam = new T.PerspectiveCamera(28, 1, 0.05, 20);
  const holder = new T.Group();
  scene.add(holder);
  const SZ = 1000;
  const rt = new T.WebGLRenderTarget(SZ, SZ, { colorSpace: T.SRGBColorSpace });
  const cv = document.createElement('canvas');
  cv.width = SZ; cv.height = SZ;
  window.__iso = { scene, cam, holder, T, rt, cv, SZ };
});

const shoot = async (name, mode) => {
  const info = await page.evaluate((mode) => {
    const { scene, cam, holder, T } = window.__iso;
    const ctx = window.engine.ctx;
    const vm = ctx.scene.getObjectByName('viewmodel');
    for (const c of holder.children) c.geometry.dispose();
    holder.clear();
    const plain = new T.MeshStandardMaterial({ color: 0x8e8894, roughness: 0.88, metalness: 0, vertexColors: false });
    const box = new T.Box3();
    vm.traverseVisible((o) => {
      if (!o.isMesh) return;
      if (o.name === 'vm-hand-strap' || o.name.startsWith('vm-fist-l') || o.name === 'vm-hand-l') return;
      // Bake the world transform into a throwaway copy: everything in the probe
      // scene then lives in world space, exactly like the swept forearm does.
      o.updateWorldMatrix(true, false);
      const m = new T.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), plain);
      m.name = o.name || 'anon';
      m.frustumCulled = false;
      holder.add(m);
    });
    // The weapon comes along for the hand close-ups: fingers that float off a
    // hilt or sink into it is the failure this view exists to catch.
    if (mode.startsWith('hand')) {
      let w = null;
      ctx.scene.traverseVisible((o) => { if (o.name && o.name.startsWith('weapon:')) w = o; });
      if (w !== null) {
        w.traverseVisible((o) => {
          if (!o.isMesh) return;
          o.updateWorldMatrix(true, false);
          const m = new T.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), plain);
          m.name = 'weapon';
          m.frustumCulled = false;
          holder.add(m);
        });
      }
    }
    // Right arm only: drop anything a long way from the right forearm.
    const fore = vm.getObjectByName('vm-fore-r');
    const fp = fore.geometry.getAttribute('position');
    const n = fp.count;
    const elbow = new T.Vector3(fp.getX(n - 2), fp.getY(n - 2), fp.getZ(n - 2));
    const wrist = new T.Vector3(fp.getX(n - 1), fp.getY(n - 1), fp.getZ(n - 1));
    const diag = [];
    for (const c of [...holder.children]) {
      box.setFromObject(c, true);
      const ctr = box.getCenter(new T.Vector3());
      diag.push([c.name, +ctr.distanceTo(wrist).toFixed(2), ctr.toArray().map((v) => +v.toFixed(1)).join(',')]);
      const reach = mode.startsWith('hand') ? 0.16 : 0.55;
      if (c.name !== 'weapon' && ctr.distanceTo(wrist) > reach) holder.remove(c);
    }
    window.__diag = diag;
    const kept = holder.children.map((c) => c.name);

    // Aim basis, exactly as combat builds it.
    const fwd = new T.Vector3();
    ctx.camera.getWorldDirection(fwd);
    const right = fwd.clone().cross(new T.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(fwd).normalize();
    const rel = (p) => ({
      r: +p.clone().sub(ctx.camera.position).dot(right).toFixed(3),
      u: +p.clone().sub(ctx.camera.position).dot(up).toFixed(3),
      f: +p.clone().sub(ctx.camera.position).dot(fwd).toFixed(3),
    });

    const framed = new T.Box3();
    for (const c of holder.children) {
      if (mode.startsWith('hand') && c.name === 'weapon') continue;
      framed.union(box.setFromObject(c, true));
    }
    const centre = framed.getCenter(new T.Vector3());
    const radius = framed.getSize(new T.Vector3()).length() * 0.5;
    const dist = radius / Math.tan((28 * Math.PI) / 360) * 1.15;
    // SIDE: look along +right, so forward is to the left of frame and up is up.
    // TOP: look along -up.
    const dir = mode === 'top' || mode === 'hand-top'
      ? up.clone()
      : mode === 'hand-front'
        ? fwd.clone().negate()
        : right.clone();
    cam.position.copy(centre).addScaledVector(dir, dist);
    cam.up.copy(mode === 'top' || mode === 'hand-top' ? fwd.clone().negate() : up);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();

    const { rt, cv, SZ } = window.__iso;
    const prevTone = ctx.renderer.toneMapping;
    ctx.renderer.toneMapping = T.NoToneMapping;
    ctx.renderer.setRenderTarget(rt);
    ctx.renderer.clear();
    ctx.renderer.render(scene, cam);
    const buf = new Uint8Array(SZ * SZ * 4);
    ctx.renderer.readRenderTargetPixels(rt, 0, 0, SZ, SZ, buf);
    ctx.renderer.setRenderTarget(null);
    ctx.renderer.toneMapping = prevTone;
    // readRenderTargetPixels is bottom-up; flip into the 2D canvas.
    const g2 = cv.getContext('2d');
    const img = g2.createImageData(SZ, SZ);
    for (let y = 0; y < SZ; y++) {
      const src = (SZ - 1 - y) * SZ * 4;
      img.data.set(buf.subarray(src, src + SZ * 4), y * SZ * 4);
    }
    g2.putImageData(img, 0, 0);

    const e = rel(elbow), w = rel(wrist);
    return {
      png: cv.toDataURL('image/png'), kept, diag,
      elbow: e, wrist: w,
      below: +(w.u - e.u).toFixed(3),
      behind: +(w.f - e.f).toFixed(3),
      len: +elbow.distanceTo(wrist).toFixed(3),
    };
  }, mode);
  await writeFile(`${OUT}/${name}.png`, Buffer.from(info.png.split(',')[1], 'base64'));
  delete info.png;
  console.log(name.padEnd(22), JSON.stringify(info));
};

const setWeapon = (i) => page.evaluate((i) => { window.engine.ctx.get('combat').equip(i); }, i);
const press = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.add(b); }, b);
const release = (b) => page.evaluate((b) => { window.engine.ctx.input.buttons.delete(b); }, b);

for (const [idx, label] of [[0, 'sword'], [2, 'hammer'], [6, 'fists']]) {
  await setWeapon(idx);
  await sleep(600);
  await shoot(`${label}-rest-side`, 'side');
  await shoot(`${label}-rest-top`, 'top');
  await shoot(`${label}-hand-side`, 'hand-side');
  await shoot(`${label}-hand-top`, 'hand-top');
  await shoot(`${label}-hand-front`, 'hand-front');
}
await setWeapon(0);
await sleep(400);
await press(0); await sleep(450);
await shoot('wind-side', 'side');
await release(0);
await sleep(90);
await shoot('swing-side', 'side');
await sleep(900);
await press(2); await sleep(700);
await shoot('block-side', 'side');
await release(2);
await sleep(500);
// Every direction the player can look, because the elbow must survive all of them.
for (const [yaw, pitch, tag] of [[0.7, 0.9, 'lookup'], [0.7, -1.15, 'lookdown'], [2.9, -0.06, 'yawed']]) {
  await page.evaluate(([y, p]) => window.engine.ctx.get('player').setLook(y, p), [yaw, pitch]);
  await sleep(500);
  await shoot(`${tag}-side`, 'side');
}
await browser.close();
vite?.kill();
