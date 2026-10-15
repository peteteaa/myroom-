// Minimal Bedrock / Blockbench entity loader + animation player for three.js.
//
// Conventions (matching Blockbench's three.js preview):
//  - units are pixels, 16 px = 1 m
//  - Bedrock X is mirrored: x_three = -x_bedrock (positions, pivots, origins)
//  - rotations (degrees, Euler order ZYX) become (-rx, -ry, +rz); the same goes for
//    animation rotations, which are added to the rest rotation component-wise
//  - animation positions become (-x, y, z); scale is used as-is
//  - the model faces -Z
import * as THREE from "three";

const SCALE = 1 / 16;
const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ Molang */

const MOLANG_FN = {
  sin: (x) => Math.sin(x * D2R),
  cos: (x) => Math.cos(x * D2R),
  tan: (x) => Math.tan(x * D2R),
  asin: (x) => Math.asin(x) / D2R,
  acos: (x) => Math.acos(x) / D2R,
  atan: (x) => Math.atan(x) / D2R,
  atan2: (y, x) => Math.atan2(y, x) / D2R,
  abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow, min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  exp: Math.exp, ln: Math.log,
  clamp: (v, a, b) => Math.min(Math.max(v, a), b),
  lerp: (a, b, t) => a + (b - a) * t,
  mod: (a, b) => a % b,
  random: () => 0.5,
};
const ZERO = () => 0;
const TOKEN = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)|([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)|(<=|>=|==|!=|&&|\|\||[-+*/(),<>?:!]))/iy;
const unsupported = new Set();

/** Compile a Molang expression (or number) to (animTime) => number, once. */
function compileMolang(expr) {
  if (typeof expr === "number") return () => expr;
  const src = String(expr).trim().replace(/;\s*$/, "").replace(/^return\s+/, "");
  const n = Number(src);
  if (src !== "" && Number.isFinite(n)) return () => n;
  let out = "";
  let pos = 0;
  TOKEN.lastIndex = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break;
      unsupported.add(src);
      return ZERO;
    }
    pos = TOKEN.lastIndex;
    if (m[1] !== undefined) out += m[1];
    else if (m[3] !== undefined) out += m[3];
    else {
      const id = m[2].toLowerCase();
      const next = src.slice(pos).match(/^\s*\(/);
      if (id === "q.anim_time" || id === "query.anim_time") out += "T";
      else if (id === "math.pi") out += "Math.PI";
      else if (id.startsWith("math.") && next) {
        const f = id.slice(5);
        if (MOLANG_FN[f]) out += `F.${f}`;
        else { unsupported.add(id); out += "Z"; }
      } else if (next) { unsupported.add(id); out += "Z"; }
      else out += "0"; // unknown query/variable -> 0
    }
  }
  try {
    // Source consists only of whitelisted tokens built above.
    const fn = new Function("F", "Z", `return function(T){return (${out || "0"});}`)(MOLANG_FN, ZERO);
    return (t) => { const v = fn(t); return Number.isFinite(v) ? v : 0; };
  } catch {
    unsupported.add(src);
    return ZERO;
  }
}

/* --------------------------------------------------------------- Animation */

const compileVec = (v) => (Array.isArray(v) ? v : [v, v, v]).map(compileMolang);
const evalVec = (fns, t) => [fns[0](t), fns[1](t), fns[2](t)];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** A channel: constant/molang vector or sorted keyframes. Returns {sample(t, out), maxTime}. */
function compileChannel(def) {
  if (Array.isArray(def) || typeof def === "number" || typeof def === "string") {
    const fns = compileVec(def);
    return { maxTime: 0, sample: (t, o) => { o[0] = fns[0](t); o[1] = fns[1](t); o[2] = fns[2](t); } };
  }
  const keys = Object.keys(def).map(Number).filter(Number.isFinite).sort((a, b) => a - b).map((time) => {
    const raw = def[Object.keys(def).find((k) => Number(k) === time)];
    if (Array.isArray(raw) || typeof raw !== "object") {
      const f = compileVec(raw);
      return { time, pre: f, post: f, cr: false };
    }
    const post = raw.post !== undefined ? compileVec(raw.post) : compileVec(raw.pre);
    const pre = raw.pre !== undefined ? compileVec(raw.pre) : post;
    return { time, pre, post, cr: raw.lerp_mode === "catmullrom" };
  });
  const maxTime = keys.length ? keys[keys.length - 1].time : 0;
  return {
    maxTime,
    sample(t, o) {
      if (!keys.length) { o[0] = o[1] = o[2] = 0; return; }
      if (t <= keys[0].time) { const v = evalVec(keys[0].post, t); o[0] = v[0]; o[1] = v[1]; o[2] = v[2]; return; }
      const last = keys[keys.length - 1];
      if (t >= last.time) { const v = evalVec(last.pre, t); o[0] = v[0]; o[1] = v[1]; o[2] = v[2]; return; }
      let i = 0;
      while (i < keys.length - 2 && keys[i + 1].time <= t) i++;
      const a = keys[i], b = keys[i + 1];
      const f = (t - a.time) / (b.time - a.time);
      const va = evalVec(a.post, t), vb = evalVec(b.pre, t);
      if (a.cr || b.cr) {
        const pa = keys[i - 1] ? evalVec(keys[i - 1].post, t) : va;
        const pb = keys[i + 2] ? evalVec(keys[i + 2].pre, t) : vb;
        for (let k = 0; k < 3; k++) o[k] = catmull(pa[k], va[k], vb[k], pb[k], f);
      } else {
        for (let k = 0; k < 3; k++) o[k] = va[k] + (vb[k] - va[k]) * f;
      }
    },
  };
}

function compileAnimation(name, def) {
  const bones = new Map();
  let maxTime = 0;
  for (const [bone, chans] of Object.entries(def.bones || {})) {
    const c = {};
    for (const k of ["rotation", "position", "scale"]) {
      if (chans[k] !== undefined) { c[k] = compileChannel(chans[k]); maxTime = Math.max(maxTime, c[k].maxTime); }
    }
    bones.set(bone, c);
  }
  const length = Number(def.animation_length) || maxTime || 0;
  return { name, loop: def.loop === true, length, bones };
}

/* ---------------------------------------------------------------- Geometry */

const FACE_NORMALS = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

/** uv rects (pixels) for each face of a cube; null = no face. */
function cubeFaceUVs(cube, bone, texW, texH) {
  const [sx, sy, sz] = cube.size;
  const mirror = cube.mirror ?? bone.mirror ?? false;
  const faces = {};
  if (Array.isArray(cube.uv)) {
    const [u, v] = cube.uv;
    const w = sx, h = sy, d = sz;
    // Box UV layout. "east" is the region at u (the face at max x in three space).
    faces.east = [u, v + d, d, h];
    faces.north = [u + d, v + d, w, h];
    faces.west = [u + d + w, v + d, d, h];
    faces.south = [u + 2 * d + w, v + d, w, h];
    faces.up = [u + d, v, w, d];
    faces.down = [u + d + w, v, w, d];
  } else if (cube.uv && typeof cube.uv === "object") {
    for (const [f, fd] of Object.entries(cube.uv)) {
      if (!FACE_NORMALS[f] || !fd || !fd.uv) continue;
      const size = fd.uv_size || [0, 0];
      faces[f] = [fd.uv[0], fd.uv[1], size[0], size[1]];
    }
  }
  if (mirror && Array.isArray(cube.uv)) {
    [faces.east, faces.west] = [faces.west, faces.east];
    for (const f of Object.keys(faces)) { const r = faces[f]; faces[f] = [r[0] + r[2], r[1], -r[2], r[3]]; }
  }
  return faces;
}

function buildBoneGeometry(bone, texW, texH) {
  const pos = [], nor = [], uv = [], idx = [];
  const pivotT = new THREE.Vector3(-bone.pivot[0], bone.pivot[1], bone.pivot[2]);
  const q = new THREE.Quaternion(), eul = new THREE.Euler(), mat = new THREE.Matrix4();
  const m3 = new THREE.Matrix3();
  for (const cube of bone.cubes || []) {
    const inf = cube.inflate ?? bone.inflate ?? 0;
    const [ox, oy, oz] = cube.origin, [sx, sy, sz] = cube.size;
    const x0 = -(ox + sx) - inf, x1 = -ox + inf; // xmin, xmax in three space
    const y0 = oy - inf, y1 = oy + sy + inf, z0 = oz - inf, z1 = oz + sz + inf;
    const faceUV = cubeFaceUVs(cube, bone, texW, texH);
    // Corners TL,TR,BR,BL as seen from outside (three space, right-handed).
    const C = {
      north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
      south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
      east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
      west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
      up: null,
      down: null,
    };
    C.up = [[x1, y1, z1], [x0, y1, z1], [x0, y1, z0], [x1, y1, z0]];
    C.down = [[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]];
    // Cube rotation about its own pivot.
    let rot = null;
    if (cube.rotation) {
      const cp = cube.pivot || bone.pivot;
      const pv = new THREE.Vector3(-cp[0], cp[1], cp[2]);
      eul.set(-cube.rotation[0] * D2R, -cube.rotation[1] * D2R, cube.rotation[2] * D2R, "ZYX");
      q.setFromEuler(eul);
      mat.makeTranslation(pv.x, pv.y, pv.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z));
      rot = mat.clone();
      m3.setFromMatrix4(rot);
    }
    // Skip duplicate faces on zero-thickness cubes, and zero-area faces.
    const flat = { x: sx === 0, y: sy === 0, z: sz === 0 };
    for (const f of Object.keys(C)) {
      const r = faceUV[f];
      if (!r) continue;
      if ((f === "south" && flat.z) || (f === "down" && flat.y) || (f === "west" && flat.x)) continue;
      const dims = f === "north" || f === "south" ? [sx, sy] : f === "east" || f === "west" ? [sz, sy] : [sx, sz];
      if (dims[0] === 0 || dims[1] === 0) continue;
      const n = new THREE.Vector3(...FACE_NORMALS[f]); n.x = -n.x;
      if (rot) n.applyMatrix3(m3).normalize();
      const base = pos.length / 3;
      const [u, v, uw, vh] = r;
      const uvs = [[u, v], [u + uw, v], [u + uw, v + vh], [u, v + vh]];
      C[f].forEach((c, i) => {
        const p = new THREE.Vector3(...c);
        if (rot) p.applyMatrix4(rot);
        p.sub(pivotT).multiplyScalar(SCALE);
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        uv.push(uvs[i][0] / texW, 1 - uvs[i][1] / texH);
      });
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const restEuler = (r) => [-(r?.[0] || 0) * D2R, -(r?.[1] || 0) * D2R, (r?.[2] || 0) * D2R];

/* ------------------------------------------------------------------ Loader */

const pixelTexture = (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  return tex;
};

// `emissive` (optional): a texture whose lit pixels glow (e.g. Umbreon's rings); `ent.material` is exposed so the
// caller can pulse `emissiveIntensity`.
export async function loadBedrockEntity({ geometry, texture, emissive, animations, prefix = "" }) {
  const [geoJson, animJson, tex, glow] = await Promise.all([
    fetch(geometry).then((r) => r.json()),
    animations ? fetch(animations).then((r) => r.json()) : { animations: {} },
    new THREE.TextureLoader().loadAsync(texture).then(pixelTexture),
    emissive ? new THREE.TextureLoader().loadAsync(emissive).then(pixelTexture) : null,
  ]);

  const geo = geoJson["minecraft:geometry"][0];
  const texW = geo.description.texture_width || 64, texH = geo.description.texture_height || 32;
  const material = new THREE.MeshStandardMaterial({
    map: tex, roughness: 1, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide,
    ...(glow ? { emissiveMap: glow, emissive: 0xffffff, emissiveIntensity: 0.6 } : {}),
  });

  const root = new THREE.Group();
  const bones = new Map();
  const info = new Map(); // name -> {restPos, restRot}
  const defs = new Map(geo.bones.map((b) => [b.name, b]));
  for (const b of geo.bones) {
    const obj = new THREE.Object3D();
    obj.name = b.name;
    bones.set(b.name, obj);
  }
  for (const b of geo.bones) {
    const obj = bones.get(b.name);
    const parentDef = b.parent ? defs.get(b.parent) : null;
    const pp = parentDef ? parentDef.pivot : [0, 0, 0];
    const restPos = [-(b.pivot[0] - pp[0]) * SCALE, (b.pivot[1] - pp[1]) * SCALE, (b.pivot[2] - pp[2]) * SCALE];
    const restRot = restEuler(b.rotation);
    info.set(b.name, { restPos, restRot });
    obj.rotation.order = "ZYX";
    obj.position.set(...restPos);
    obj.rotation.set(...restRot);
    (parentDef ? bones.get(b.parent) : root).add(obj);
    const g = buildBoneGeometry(b, texW, texH);
    if (g) {
      const mesh = new THREE.Mesh(g, material);
      mesh.name = b.name + "_mesh";
      obj.add(mesh);
    }
  }

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const height = box.max.y - box.min.y;

  /* Animations */
  const anims = new Map();
  for (const [full, def] of Object.entries(animJson.animations || {})) {
    if (prefix && !full.startsWith(prefix)) continue;
    anims.set(full.slice(prefix.length), compileAnimation(full, def));
  }

  const boneList = [...bones.keys()];
  const state = new Map(boneList.map((n) => [n, { rot: [0, 0, 0], pos: [0, 0, 0], scl: [1, 1, 1] }]));
  const tmp = [0, 0, 0];

  const base = []; // {anim, time, speed, weight, fade, w, out}
  const overlays = []; // {anim, time}

  function animTime(layer, anim) {
    if (anim.loop && anim.length > 0) return layer.time % anim.length;
    return layer.time;
  }

  function accumulate(anim, time, weight, skip = null) {
    if (weight <= 0) return;
    for (const [bone, ch] of anim.bones) {
      const s = state.get(bone);
      if (!s || skip?.test(bone)) continue;
      if (ch.rotation) { ch.rotation.sample(time, tmp); for (let k = 0; k < 3; k++) s.rot[k] += tmp[k] * weight; }
      if (ch.position) { ch.position.sample(time, tmp); for (let k = 0; k < 3; k++) s.pos[k] += tmp[k] * weight; }
      if (ch.scale) { ch.scale.sample(time, tmp); for (let k = 0; k < 3; k++) s.scl[k] += (tmp[k] - 1) * weight; }
    }
  }

  const ent = {
    root, bones, height, material,
    forward: new THREE.Vector3(0, 0, -1),
    animations: [...anims.keys()],

    // skip: optional RegExp of bone names this animation must leave alone (e.g. /eyelid/ to sit without sleeping)
    play(name, { weight = 1, speed = 1, fade = 0.25, skip = null } = {}) {
      const anim = anims.get(name);
      if (!anim) { console.warn("bedrock: unknown animation", name); return; }
      const cur = base.find((l) => !l.out && l.anim === anim);
      if (cur) { cur.speed = speed; cur.weight = weight; cur.skip = skip; return; }
      for (const l of base) { l.out = true; l.fade = Math.max(fade, 1e-4); }
      base.push({ anim, time: 0, speed, weight, skip, fade: Math.max(fade, 1e-4), w: fade > 0 ? 0 : 1, out: false });
    },

    // Register an extra animation in the same Bedrock JSON form (e.g. a hand-made pose: {loop: true, bones: {...}})
    addAnimation(name, def) {
      anims.set(name, compileAnimation(name, def));
      this.animations.push(name);
    },

    playOnce(name, { weight = 1, speed = 1 } = {}) {
      const anim = anims.get(name);
      if (!anim) { console.warn("bedrock: unknown animation", name); return; }
      overlays.push({ anim, time: 0, speed, weight });
    },

    update(dt) {
      for (const l of base) {
        l.time += dt * l.speed;
        l.w = l.out ? l.w - dt / l.fade : Math.min(1, l.w + dt / l.fade);
      }
      for (let i = base.length - 1; i >= 0; i--) if (base[i].out && base[i].w <= 0) base.splice(i, 1);
      for (const o of overlays) o.time += dt * o.speed;
      for (let i = overlays.length - 1; i >= 0; i--) {
        if (overlays[i].time >= overlays[i].anim.length) overlays.splice(i, 1);
      }

      for (const s of state.values()) { s.rot[0] = s.rot[1] = s.rot[2] = 0; s.pos[0] = s.pos[1] = s.pos[2] = 0; s.scl[0] = s.scl[1] = s.scl[2] = 1; }
      for (const l of base) accumulate(l.anim, animTime(l, l.anim), l.w * l.weight, l.skip);
      for (const o of overlays) {
        const t = Math.min(o.time, o.anim.length);
        accumulate(o.anim, t, o.weight);
      }

      for (const [name, obj] of bones) {
        const s = state.get(name), r = info.get(name);
        obj.rotation.set(r.restRot[0] - s.rot[0] * D2R, r.restRot[1] - s.rot[1] * D2R, r.restRot[2] + s.rot[2] * D2R);
        obj.position.set(r.restPos[0] - s.pos[0] * SCALE, r.restPos[1] + s.pos[1] * SCALE, r.restPos[2] + s.pos[2] * SCALE);
        obj.scale.set(s.scl[0], s.scl[1], s.scl[2]);
      }
    },
  };
  ent.unsupportedMolang = unsupported;
  ent.update(0);
  return ent;
}
