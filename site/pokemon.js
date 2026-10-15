import * as THREE from "three";
import { loadBedrockEntity } from "./bedrock.js";

// Pokémon hanging out in the room (Cobblemon models + animations, CC BY-NC 3.0, loaded by bedrock.js).
// Walkers potter about the floor, the small ones now and then hop up onto the bed for a stroll on the blanket,
// and every so often they sit down for a rest. Poke one and it turns to you, looks up at the camera and reacts.

// Sitting: the models have no sit animation, so walkers reuse their sleep pose with the eyelids (and head) left
// alone so they sit awake; Umbreon gets a hand-made pose (Bedrock degrees / pixels).
const SIT_AWAKE = /eyelid|^head$|neck/;
const UMBREON_SIT = {
  body: { position: [0, -5, 0] }, waist: { rotation: [-35, 0, 0] }, front_legs: { rotation: [35, 0, 0] },
  back_legs: { rotation: [-45, 0, 0] }, knee_left: { rotation: [60, 0, 0] }, knee_right: { rotation: [60, 0, 0] },
  neck: { rotation: [15, 0, 0] },
};

export const SPECIES = {
  torchic: {
    label: "Torchic", folder: "torchic", geometry: "torchic_male.geo.json", texture: "torchic.png",
    height: 0.45, speed: 0.32, radius: 0.16, hops: true, start: [2.05, 1.9], poke: "cry",
    sit: { anim: "sleep", skip: SIT_AWAKE },
  },
  ditto: {
    label: "Ditto", folder: "ditto", geometry: "ditto.geo.json", texture: "ditto.png",
    height: 0.3, speed: 0.18, radius: 0.15, hops: true, start: [0.95, 1.55], poke: "happy",
    sit: { anim: "sleep", skip: /eye/ },   // squishes down into a blob
  },
  lucario: {
    label: "Lucario", folder: "lucario", geometry: "lucario.geo.json", texture: "lucario.png",
    height: 1.2, speed: 0.45, radius: 0.26, hops: false, start: [1.45, 2.4], poke: "cry",
    sit: { anim: "sleep", skip: SIT_AWAKE },   // sits on the floor, legs out
  },
  umbreon: {
    // No walk cycle in the model, so shiny Umbreon lounges on the foot of the bed; poked, its rings flare up
    label: "Shiny Umbreon", folder: "umbreon", geometry: "umbreon.geo.json", texture: "umbreon_shiny.png",
    emissive: "umbreon_shiny_emissive.png", height: 0.6, radius: 0.25, walks: false, start: [3.3, 2.05], onBed: true,
    poke: "glow", sit: { pose: UMBREON_SIT }, sitChance: 0.6,
  },
};

const TURN = 5;               // how quickly they turn towards where they're heading (1/s)
const LOOK_TIME = 3.2;        // seconds they keep looking at you after a poke
const SIT_CHANCE = 0.22;      // chance an idle spell ends with sitting down for a while
const SIT_TIME = [6, 14];     // seconds spent sitting

// Floor plan in Blender coordinates (x, y), metres: furniture footprints to walk around
const ROOM = { x0: 0.05, x1: 3.75, y0: 0.05, y1: 4.55 };
const OBSTACLES = [
  [0.0, 0.2, 0.5, 2.0],      // TV stand
  [0.0, 2.28, 0.62, 4.32],   // desk
  [0.62, 2.84, 1.47, 3.56],  // chair
  [1.88, 3.96, 2.39, 4.5],   // mini fridge + SDAT
  [2.38, 1.58, 3.8, 3.57],   // bed
  [3.28, 0.13, 3.8, 1.07],   // dresser
  [1.43, 0.0, 1.97, 0.47],   // laundry basket
];
const MATS = [[0.65, 2.5, 2.4, 4.45], [1.6, 0.6, 3.78, 2.5]];   // foam mats are 2 cm thick
const MAT_T = 0.02;

// The bed: walk on the blanket (top ~0.6 m), keep off the pillows at the head end
const BED = { x0: 2.45, x1: 3.73, y0: 1.67, y1: 3.0, top: 0.6 };
// Hop spots: floor point next to the bed -> landing point on it (Blender x, y)
const HOPS = [
  { floor: [2.17, 2.05], bed: [2.68, 2.05] },
  { floor: [2.17, 2.75], bed: [2.68, 2.7] },
  { floor: [2.75, 1.38], bed: [2.75, 1.9] },
  { floor: [3.35, 1.38], bed: [3.35, 1.9] },
];
const BED_CHANCE = 0.35;      // chance an idle spell on the floor ends with a trip to the bed
const HOP_TIME = 0.65;        // seconds in the air
const HOP_APEX = 0.28;        // how far above the higher end of the hop the arc peaks

const toThree = (x, y) => new THREE.Vector3(x, 0, -y);
const insideRect = (x, y, [x0, y0, x1, y1], pad = 0) => x > x0 - pad && x < x1 + pad && y > y0 - pad && y < y1 + pad;

// Everyone in the room, so they keep out of each other's way: { group, radius, onBed() }
const crowd = [];

// Clear of walls and furniture for a body of this radius (the fixed part of the floor plan)
function floorClear(x, y, radius) {
  if (x < ROOM.x0 + radius || x > ROOM.x1 - radius || y < ROOM.y0 + radius || y > ROOM.y1 - radius) return false;
  if (y > 4.6 - (x - 2.4) / 1.4 - radius * 1.5) return false;   // the angled corner (window wall)
  return !OBSTACLES.some((r) => insideRect(x, y, r, radius));
}

const VIEWER_SPACE = 0.45;   // personal space around where you stand, on top of the Pokémon's own radius
const nearViewer = (x, y, radius, avoid) => avoid && Math.hypot(x - avoid.x, y - avoid.y) < VIEWER_SPACE + radius;

function walkable(x, y, { radius, onBed, avoid = null, self = null, crowdless = false }) {
  if (onBed) {
    const pad = radius * 0.6;
    if (x < BED.x0 + pad || x > BED.x1 - pad || y < BED.y0 + pad || y > BED.y1 - pad) return false;
  } else if (!floorClear(x, y, radius) || nearViewer(x, y, radius, avoid)) return false;
  if (crowdless) return true;
  return crowd.every((o) => o === self || o.onBed() !== onBed
    || Math.hypot(x - o.group.position.x, y + o.group.position.z) > radius + o.radius + 0.04);
}

// A step from (fx, fy) to (tx, ty): blocked only if it walks *into* someone (or the viewer's feet), so two that
// ended up too close (one sat down next to the other, say) can always step apart
function stepFree(fx, fy, tx, ty, { radius, onBed, avoid = null, self = null }) {
  const closer = (cx, cy, need) => {
    const dNew = Math.hypot(tx - cx, ty - cy);
    return dNew < need && dNew < Math.hypot(fx - cx, fy - cy);
  };
  if (!onBed && avoid && closer(avoid.x, avoid.y, VIEWER_SPACE + radius)) return false;
  return crowd.every((o) => o === self || o.onBed() !== onBed
    || !closer(o.group.position.x, -o.group.position.z, radius + o.radius + 0.04));
}

function clearPath(a, b, opts) {
  const flat = (v) => new THREE.Vector3(v.x, 0, v.z);
  const steps = Math.ceil(flat(a).distanceTo(flat(b)) / 0.05);
  for (let i = 1; i <= steps; i++) {
    const p = flat(a).lerp(flat(b), i / steps);
    if (!walkable(p.x, -p.z, opts)) return false;
  }
  return true;
}

// ---- Path finding on the floor: A* over a 5 cm grid of spots clear of the furniture -------------------
// Straight lines get the bigger Pokémon boxed in between the desk, chair and fridge; paths walk them round.
const CELL = 0.05, GW = Math.ceil(ROOM.x1 / CELL) + 1, GH = Math.ceil(ROOM.y1 / CELL) + 1;
const grids = new Map();   // radius -> Uint8Array, 1 = clear
function floorGrid(radius) {
  if (!grids.has(radius)) {
    const g = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) g[j * GW + i] = floorClear((i + 0.5) * CELL, (j + 0.5) * CELL, radius) ? 1 : 0;
    grids.set(radius, g);
  }
  return grids.get(radius);
}
const cellOf = (x, y) => [THREE.MathUtils.clamp(Math.floor(x / CELL), 0, GW - 1), THREE.MathUtils.clamp(Math.floor(y / CELL), 0, GH - 1)];

function segmentClear(ax, ay, bx, by, radius, avoid) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.04);
  for (let k = 1; k <= steps; k++) {
    const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
    if (!floorClear(x, y, radius) || nearViewer(x, y, radius, avoid)) return false;
  }
  return true;
}

// Path from (ax, ay) to (bx, by) as THREE.Vector3 waypoints (Blender floor coords in, three.js out), or null
function findPath(ax, ay, bx, by, radius, avoid = null) {
  const g = floorGrid(radius);
  const open = (i, j) => i >= 0 && j >= 0 && i < GW && j < GH && g[j * GW + i]
    && !nearViewer((i + 0.5) * CELL, (j + 0.5) * CELL, radius, avoid);
  const [si, sj] = cellOf(ax, ay), [ti, tj] = cellOf(bx, by);
  if (!open(ti, tj)) return null;
  const start = sj * GW + si, goal = tj * GW + ti;
  const cost = new Float32Array(GW * GH).fill(Infinity), from = new Int32Array(GW * GH).fill(-1);
  const heap = [[0, start]];   // [f, cell], binary min-heap
  const push = (f, c) => {
    heap.push([f, c]);
    for (let k = heap.length - 1; k > 0;) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  while (heap.length) {
    const [, c] = pop();
    if (c === goal) break;
    const ci = c % GW, cj = (c - ci) / GW;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      // the start cell may be off-grid (e.g. nudged by someone); everything after must be clear, no corner cutting
      if (!open(ni, nj) || (di && dj && (!open(ci + di, cj) || !open(ci, cj + dj)))) continue;
      const n = nj * GW + ni, nc = cost[c] + (di && dj ? Math.SQRT2 : 1);
      if (nc < cost[n]) {
        cost[n] = nc;
        from[n] = c;
        push(nc + Math.hypot(ti - ni, tj - nj), n);
      }
    }
  }
  if (from[goal] < 0 && goal !== start) return null;
  const cells = [];
  for (let c = goal; c !== start && c >= 0; c = from[c]) cells.push(c);
  cells.reverse();
  // string-pull: keep only the corners we can't see past
  const pts = cells.map((c) => [((c % GW) + 0.5) * CELL, (Math.floor(c / GW) + 0.5) * CELL]);
  pts[pts.length - 1] = [bx, by];
  const out = [];
  let cur = [ax, ay];
  for (let k = 0; k < pts.length;) {
    let far = k;
    while (far + 1 < pts.length && segmentClear(cur[0], cur[1], pts[far + 1][0], pts[far + 1][1], radius, avoid)) far++;
    out.push(toThree(...pts[far]));
    cur = pts[far];
    k = far + 1;
  }
  return out;
}

export async function createPokemon(kind, { camera, base = "./assets/" }) {
  const sp = SPECIES[kind];
  const dir = `${base}${sp.folder}/`;
  const ent = await loadBedrockEntity({
    geometry: dir + sp.geometry,
    texture: dir + sp.texture,
    emissive: sp.emissive && dir + sp.emissive,
    animations: `${dir}${sp.folder}.animation.json`,
    prefix: `animation.${sp.folder}.`,
  });
  const has = (name) => ent.animations.includes(name);
  if (sp.sit?.pose) ent.addAnimation("sit", { loop: true, bones: sp.sit.pose });
  const sitAnim = sp.sit?.pose ? "sit" : sp.sit?.anim;
  const group = new THREE.Group();
  group.name = kind;
  group.userData.pokemon = kind;
  group.userData.label = sp.label;
  ent.root.scale.multiplyScalar(sp.height / ent.height);
  const baseScale = ent.root.scale.clone();
  group.add(ent.root);

  const head = ent.bones.get("head");
  const faceYaw = Math.atan2(ent.forward.x, ent.forward.z);   // model's own front, so yaw = heading - faceYaw
  const viewer = () => ({ x: camera.position.x, y: -camera.position.z });
  const glowBase = ent.material.emissiveIntensity;

  let onBed = !!sp.onBed;
  const me = { group, radius: sp.radius, onBed: () => onBed };
  crowd.push(me);
  const opts = (extra = {}) => ({ radius: sp.radius, onBed, self: me, ...extra });

  group.position.copy(toThree(...sp.start)).setY(onBed ? BED.top : 0);
  // start facing the viewer's side of the room
  let heading = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
  let state = "idle", timer = THREE.MathUtils.randFloat(0.5, 2.5), target = null, look = 0, glow = 0, lookFor = 0;
  let blinkIn = THREE.MathUtils.randFloat(1, 4), then = null, hop = null, bedWalks = 0;   // then: what to do on arrival
  let path = [], blocked = 0;   // waypoints still to walk; seconds spent waiting for someone to move
  ent.play("ground_idle");

  const pathLength = (pts) => pts.reduce((sum, p, k) => sum + p.distanceTo(k ? pts[k - 1] : group.position.clone().setY(0)), 0);
  const here2d = () => [group.position.x, -group.position.z];

  // Somewhere to wander to: a straight stroll on the bed, a path round the furniture on the floor
  function pickTarget() {
    const here = group.position.clone().setY(0);
    const area = onBed ? BED : ROOM;
    for (let tries = 0; tries < 40; tries++) {
      const x = THREE.MathUtils.randFloat(area.x0, area.x1), y = THREE.MathUtils.randFloat(area.y0, area.y1);
      const p = toThree(x, y);
      const d = p.distanceTo(here);
      const o = opts({ avoid: viewer() });
      if (d < (onBed ? 0.25 : 0.6) || d > 2.8 || !walkable(x, y, o)) continue;
      if (onBed) { if (clearPath(here, p, o)) return [p]; continue; }
      const route = findPath(...here2d(), x, y, sp.radius, viewer());
      if (route?.length) return route;
    }
    return null;
  }

  // Closest hop spot by walking distance: its floor point (on the floor) or its bed point (on the bed)
  function pickHop() {
    const here = group.position.clone().setY(0);
    const options = HOPS.map((h) => {
      const [x, y] = onBed ? h.bed : h.floor;
      const route = onBed ? (clearPath(here, toThree(x, y), opts()) ? [toThree(x, y)] : null)
        : findPath(...here2d(), x, y, sp.radius, viewer());
      return route && { h, route, length: pathLength(route) };
    }).filter(Boolean).sort((a, b) => a.length - b.length);
    return options[0] ?? null;
  }

  function walkTo(route, next = null) {
    state = "walk";
    path = route.slice();
    target = path[0];
    then = next;
    blocked = 0;
    ent.play("ground_walk", { fade: 0.25 });
  }

  // Hop up onto / down off the bed along an arc
  function startHop(h) {
    const [from, to] = onBed ? [h.bed, h.floor] : [h.floor, h.bed];
    const fromY = onBed ? BED.top : group.position.y, toY = onBed ? 0 : BED.top;
    hop = { from: toThree(...from).setY(fromY), to: toThree(...to).setY(toY), t: -0.18, up: !onBed };
    state = "hop";
    ent.play("ground_idle", { fade: 0.15 });
  }

  function startIdle(seconds) {
    state = "idle";
    timer = seconds;
    target = null;
    then = null;
    ent.play("ground_idle", { fade: 0.3 });
  }

  function sitDown() {
    state = "sit";
    timer = THREE.MathUtils.randFloat(...SIT_TIME);
    target = null;
    ent.play(sitAnim, { fade: 0.6, skip: sp.sit.skip ?? null });
  }

  // Poked: turn to face the viewer, look up at them and react. Walkers stop where they are; a sitting one stays put.
  function poke() {
    if (state === "hop") return;   // mid-air
    lookFor = LOOK_TIME;
    if (state !== "sit") {
      state = "look";
      timer = LOOK_TIME;
      target = null;
      ent.play("ground_idle", { fade: 0.2 });
    }
    if (has(sp.poke)) ent.playOnce(sp.poke);
    if (sp.emissive) glow = 1;
  }

  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function lookAtViewer(weight) {
    if (!head || weight <= 0) return;
    group.updateMatrixWorld(true);
    const headPos = head.getWorldPosition(new THREE.Vector3());
    // direction to the camera in the model's (unscaled) root frame
    tmp.copy(camera.position).sub(headPos).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()).invert());
    const yaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z) - faceYaw, -1, 1);
    const pitch = THREE.MathUtils.clamp(Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)), -0.3, 1.0);
    const side = new THREE.Vector3().crossVectors(ent.forward, up).normalize();   // pitch axis (model's right/left)
    const q = new THREE.Quaternion().setFromAxisAngle(up, yaw * weight)
      .multiply(new THREE.Quaternion().setFromAxisAngle(side, pitch * weight));
    head.quaternion.premultiply(q);
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    timer -= dt;
    let desired = heading;
    lookFor -= dt;
    if (state === "idle" && timer <= 0 && sitAnim && Math.random() < (sp.sitChance ?? SIT_CHANCE)) sitDown();
    else if (state === "idle" && timer <= 0 && sp.walks === false) startIdle(THREE.MathUtils.randFloat(4, 9));
    if (state === "sit" && timer <= 0) startIdle(THREE.MathUtils.randFloat(0.8, 2));   // stand back up
    if (state === "sit" && lookFor > 0) {
      tmp.copy(camera.position).sub(group.position);
      desired = Math.atan2(tmp.x, tmp.z);
    }
    if (state === "idle" && timer <= 0 && sp.walks !== false) {
      // on the floor: sometimes head for the bed; on the bed: a few strolls, then hop back down
      const wantHop = sp.hops && (onBed ? bedWalks >= 2 + Math.floor(Math.random() * 2) : Math.random() < BED_CHANCE);
      const hopSpot = wantHop ? pickHop() : null;
      const p = hopSpot ? null : pickTarget();
      if (hopSpot) walkTo(hopSpot.route, hopSpot.h);
      else if (p) walkTo(p);
      else startIdle(1);
    }
    if (state === "walk") {
      let to = target.clone().sub(group.position).setY(0);
      let dist = to.length();
      if (dist < 0.04 && path.length > 1) {   // reached a corner of the path: on to the next one
        path.shift();
        target = path[0];
        to = target.clone().sub(group.position).setY(0);
        dist = to.length();
      }
      if (dist < 0.04) {
        if (then) {
          // face the hop direction first, then jump
          state = "aim";
          hop = { spot: then };
          then = null;
          ent.play("ground_idle", { fade: 0.2 });
        } else {
          if (onBed) bedWalks++;
          startIdle(THREE.MathUtils.randFloat(onBed ? 1 : 1.5, onBed ? 3 : 4.5));
        }
      } else {
        desired = Math.atan2(to.x, to.z);
        // walk forward once roughly facing the target
        const facing = Math.cos(desired - heading);
        const step = Math.min(dist, sp.speed * dt * Math.max(0, facing));
        const next = group.position.clone().addScaledVector(to.normalize(), step);
        // the path is clear of furniture; wait for anyone standing on it, and give up (re-plan) if they don't move.
        // If we somehow ended up inside a no-go zone, always let us walk out of it.
        const [fx, fy] = here2d(), tx = next.x, ty = -next.z;
        const surfaceOk = onBed ? walkable(tx, ty, { radius: sp.radius, onBed: true, self: me, crowdless: true })
          : floorClear(tx, ty, sp.radius) || !floorClear(fx, fy, sp.radius);
        if (surfaceOk && stepFree(fx, fy, tx, ty, opts({ avoid: viewer() }))) {
          group.position.set(next.x, group.position.y, next.z);
          blocked = 0;
        } else if ((blocked += dt) > 1.2) startIdle(THREE.MathUtils.randFloat(0.3, 1));
      }
    }
    if (state === "aim") {
      const h = hop.spot;
      const [fromXY, toXY] = onBed ? [h.bed, h.floor] : [h.floor, h.bed];
      const d = toThree(...toXY).sub(toThree(...fromXY));
      desired = Math.atan2(d.x, d.z);
      const aligned = Math.abs(Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading))) < 0.08;
      if (aligned) {
        // only jump if the landing spot is free
        if (walkable(...toXY, opts({ onBed: !onBed }))) startHop(h);
        else startIdle(1);
      }
    }
    if (state === "hop") {
      hop.t += dt / HOP_TIME;
      const k = THREE.MathUtils.clamp(hop.t, 0, 1);   // t < 0: a short crouch before take-off
      const apex = Math.max(hop.from.y, hop.to.y) + HOP_APEX;
      const xz = hop.from.clone().lerp(hop.to, k);
      // parabola through from.y -> apex -> to.y
      const y = (1 - k) * (1 - k) * hop.from.y + 2 * (1 - k) * k * (2 * apex - (hop.from.y + hop.to.y) / 2) + k * k * hop.to.y;
      group.position.set(xz.x, hop.t < 0 ? hop.from.y : y, xz.z);
      const squash = hop.t < 0 ? 1 - 0.12 * Math.sin(Math.PI * -hop.t / 0.18) : 1;
      ent.root.scale.copy(baseScale).multiply(new THREE.Vector3(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash)));
      if (hop.t >= 1) {
        onBed = hop.up;
        bedWalks = 0;
        ent.root.scale.copy(baseScale);
        startIdle(onBed ? 0.8 : 1.2);
      }
    }
    if (state === "look") {
      tmp.copy(camera.position).sub(group.position);
      desired = Math.atan2(tmp.x, tmp.z);
      if (timer <= 0) startIdle(0.8);
    }
    // turn smoothly (shortest way round)
    const diff = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
    heading += diff * Math.min(1, TURN * dt);
    group.rotation.y = heading - faceYaw;
    // stand on the blanket, or on the foam mats where there are some
    if (state !== "hop") {
      const onMat = MATS.some((r) => insideRect(group.position.x, -group.position.z, r));
      const ground = onBed ? BED.top : onMat ? MAT_T : 0;
      group.position.y = THREE.MathUtils.lerp(group.position.y, ground, Math.min(1, dt * 12));
    }

    blinkIn -= dt;
    if (blinkIn <= 0 && has("blink")) {
      ent.playOnce("blink");
      blinkIn = THREE.MathUtils.randFloat(2, 5);
    }
    if (sp.emissive) {   // rings flare on a poke and fade back
      glow = Math.max(0, glow - dt / 2);
      ent.material.emissiveIntensity = glowBase + 2.4 * Math.sin(Math.PI * (1 - glow));
    }
    ent.update(dt);
    look = THREE.MathUtils.lerp(look, lookFor > 0 ? 1 : 0, Math.min(1, dt * 5));
    lookAtViewer(look);
  }

  return { group, update, poke, label: sp.label };
}
