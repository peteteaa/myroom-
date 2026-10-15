import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createPokemon } from "./pokemon.js";
import { createLook, shadowify } from "./look.js";

const ROOM_URL = "../blender/my_room.glb";

// ---- Renderer, camera, controls ------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;   // evening-ish room; screens and the LCD stand out
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d12);

// Standing in the room just inside the door, at eye height, looking towards the window wall.
// Room coords: Blender (x, y, z) -> three.js (x, z, -y); floor at y = 0, door wall at z = 0, window wall at z = -4.6.
const EYE = new THREE.Vector3(1.7, 1.55, -1.0);
const LOOK_AT = new THREE.Vector3(1.25, 0.95, -3.5);   // turned a little left so the desk (3DS, polaroids) is in view
const FOV = { start: 60, min: 30, max: 70 };
const camera = new THREE.PerspectiveCamera(FOV.start, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.copy(EYE);

// Look-around: orbit a target a hair in front of the eye, so dragging turns the head instead of circling the room
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(EYE).addScaledVector(LOOK_AT.clone().sub(EYE).normalize(), 0.01);
controls.enableZoom = false;
controls.enablePan = false;
controls.enableDamping = true;
controls.rotateSpeed = 0.35;
controls.minPolarAngle = THREE.MathUtils.degToRad(30);    // look down at most 60°
controls.maxPolarAngle = THREE.MathUtils.degToRad(110);   // look up at most 20°
controls.update();

// Scroll / pinch zooms the lens instead (things on the far desk are small)
renderer.domElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.03, FOV.min, FOV.max);
  camera.updateProjectionMatrix();
}, { passive: false });

// Soft image-based light so glossy things (the SDAT's clearcoat, chrome) reflect a room instead of one hard light
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xfff1dd, 0x2a2430, 0.65));
const sun = new THREE.DirectionalLight(0xffd9a8, 2.1);   // warm afternoon sun through the window wall (placed in look.js)
scene.add(sun);
const ceilingLight = new THREE.PointLight(0xffe8cc, 6, 0, 1.4);
ceilingLight.position.set(1.9, 2.45, -2.3);
scene.add(ceilingLight);

// The diorama has no ceiling (the Blender previews look in from above), so add one here.
// It faces down only, so it never blocks a view from above.
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 4.6),
  new THREE.MeshStandardMaterial({ color: 0x8a847a, emissive: 0x2e2b27, roughness: 0.95 }));
ceiling.rotation.x = Math.PI / 2;
ceiling.position.set(1.9, 2.6, -2.3);
ceiling.receiveShadow = true;
scene.add(ceiling);

// Stylised look: soft sun shadows, AO, bloom, warm grade + tilt-shift (see look.js)
const look = createLook(renderer, scene, camera, sun);

// ---- Load the room -------------------------------------------------------------------
new GLTFLoader().load(ROOM_URL, (gltf) => {
  scene.add(gltf.scene);
  shadowify(gltf.scene);
  scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    if (obj.userData.cassette) deck.tapes.push({ obj, home: { pos: obj.position.clone(), quat: obj.quaternion.clone() } });
    if (obj.userData.bay_position) deck.player = obj;
    if (obj.userData.etb) etb.box = obj;
  });
  deck.tapes.sort((a, b) => a.obj.userData.track_index - b.obj.userData.track_index);
  if (deck.player) deck.player.traverse((o) => { if (o.userData.hinge_axis) deck.lid = o; });
  if (etb.box) initEtb();
  initPhotos();
  buildPicker();
  document.getElementById("loading").remove();
});

// Pokémon hanging out in the room (their own models + animations, see pokemon.js)
const pokemon = new Map();   // kind -> { group, update, poke, label }
for (const kind of ["torchic", "ditto", "lucario", "umbreon"]) {
  createPokemon(kind, { camera }).then((p) => {
    pokemon.set(kind, p);
    scene.add(p.group);
    shadowify(p.group);
  }).catch((err) => console.warn(`${kind} failed to load`, err));
}

// ---- Picking --------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hint = document.getElementById("hint");

const isShown = (obj) => { for (let o = obj; o; o = o.parent) if (!o.visible) return false; return true; };

// What's under the pointer: a link object (the 3DS, the SDAT player: userData.link, lid child with hinge_axis /
// open_angle), one of the SDAT's cassettes (userData.cassette), or the 151 box / one of its cards
function pickAt(event) {
  pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find((h) => isShown(h.object));
  for (let o = hit?.object; o; o = o.parent) {
    if (o.userData.pokemon) return { pokemon: pokemon.get(o.userData.pokemon) };
    if (o.userData.cassette) return { tape: deck.tapes.find((t) => t.obj === o) };
    if (o.userData.etb_card && etb.open) return { card: etb.cards.find((c) => c.obj === o) };
    if (o.userData.etb) return { etb: o };
    if (o.userData.polaroid !== undefined) return { photo: o.userData.polaroid };
    if (o.userData.link) return { link: o };
  }
  return null;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  if (opening) return;
  const pick = pickAt(event);
  const text = pick?.link ? `Open ${new URL(pick.link.userData.link).host}`
    : pick?.tape ? `♪ ${pick.tape.obj.userData.track_title}`
    : pick?.pokemon ? pick.pokemon.label
    : pick?.card ? pick.card.obj.userData.card_name
    : pick?.etb ? (etb.open ? "Put the lid back" : "Open the 151 box")
    : pick?.photo !== undefined ? (photos.open ? "Next photo" : "Look at the photos") : "";
  renderer.domElement.style.cursor = text ? "pointer" : "";
  hint.textContent = text;
  hint.style.opacity = text ? 1 : 0;
  hint.style.left = `${event.clientX}px`;
  hint.style.top = `${event.clientY}px`;
});

// A click is a press + release without dragging the camera
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", (event) => {
  if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5 || opening) return;
  const pick = pickAt(event);
  if (pick?.link && !deck.busy) {
    picker.hidden = true;
    deck.focused = false;
    openDevice(pick.link);
  } else if (pick?.tape) {
    if (!deck.focused) focusDeck();
    else loadTape(pick.tape);
  } else if (pick?.pokemon) {
    pick.pokemon.poke();
  } else if (pick?.card) {
    toggleCard(pick.card);
  } else if (pick?.etb) {
    if (etb.open) closeEtb();
    else openEtb();
  } else if (pick?.photo !== undefined) {
    if (photos.open) showPhoto(photos.index + 1);
    else openPhotos();
  }
});

// ---- Open animation: fly up to the camera, swing the lid open, fade into the site ---------
const FLY = 1.1, OPEN_START = 0.85, OPEN = 0.9, DIVE_START = 1.85, DIVE = 0.55;   // seconds
const FRAMING = 1.7;           // view distance in bounding-sphere radii (fits the 3DS once opened)
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

let opening = null;
const fade = document.getElementById("fade");

function openDevice(device) {
  const link = device.userData.link;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.location.assign(link);
    return;
  }
  let lid = null;
  device.traverse((o) => { if (!lid && o.userData.hinge_axis) lid = o; });
  const hingeAxis = new THREE.Vector3(...lid.userData.hinge_axis);
  const openAngle = lid.userData.open_angle;
  // Clamshells (3DS, lid opens past 120°) end with the lid screen facing you, so the base tilts back by what's
  // left of 180°. Top-loaders (SDAT) are shown from 45° above so you can see into the open bay.
  const tilt = Math.abs(openAngle) > THREE.MathUtils.degToRad(120) ? Math.PI - Math.abs(openAngle) : Math.PI / 4;
  const radius = new THREE.Box3().setFromObject(device).getBoundingSphere(new THREE.Sphere()).radius;
  const viewDistance = (FRAMING * radius) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  // Device axes in its own space: right = hinge axis, up = +Y, front (towards the player) = right x up
  const right0 = hingeAxis.clone().normalize();
  const up0 = new THREE.Vector3(0, 1, 0);
  const front0 = right0.clone().cross(up0);
  const deviceBasis = new THREE.Matrix4().makeBasis(right0, up0, front0);

  // Target axes: facing the camera, base tilted back by `tilt`, front edge pointing down
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const toCam = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  const up = toCam.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(camUp, Math.sin(tilt));
  const front = camRight.clone().cross(up);
  const targetBasis = new THREE.Matrix4().makeBasis(camRight, up, front);
  const endQuat = new THREE.Quaternion().setFromRotationMatrix(targetBasis.multiply(deviceBasis.invert()));

  // Put the hinge (the middle of the opened device) on the view axis
  const hingeOffset = lid.position.clone().multiply(device.scale).applyQuaternion(endQuat);
  const viewPoint = camera.position.clone().addScaledVector(toCam, -viewDistance);
  const endPos = viewPoint.sub(hingeOffset);

  scene.attach(device);   // animate in world space
  opening = {
    device, lid, link, hingeAxis, viewDistance,
    angle: openAngle,
    startPos: device.position.clone(), startQuat: device.quaternion.clone(),
    endPos, endQuat, toCam,
    startTime: performance.now(),
  };
  controls.enabled = false;
  hint.style.opacity = 0;
  renderer.domElement.style.cursor = "";
}

function animateOpening(now) {
  const o = opening;
  const t = (now - o.startTime) / 1000;

  const fly = easeInOut(clamp01(t / FLY));
  o.device.position.lerpVectors(o.startPos, o.endPos, fly);
  o.device.position.y += Math.sin(Math.PI * fly) * 0.15;   // little arc up off the desk
  o.device.quaternion.slerpQuaternions(o.startQuat, o.endQuat, fly);

  const open = easeInOut(clamp01((t - OPEN_START) / OPEN));
  o.lid.quaternion.setFromAxisAngle(o.hingeAxis, o.angle * open);

  // Push towards the screen and fade out, then go to the site
  const dive = easeInOut(clamp01((t - DIVE_START) / DIVE));
  o.device.position.addScaledVector(o.toCam, dive * o.viewDistance * 0.6);
  fade.style.opacity = dive;
  if (t >= DIVE_START + DIVE && !o.navigated) {
    o.navigated = true;
    window.location.assign(o.link);
  }
}

// Coming back with the browser's back button can restore this page mid-animation: put the device back
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !opening) return;
  const o = opening;
  o.device.position.copy(o.startPos);
  o.device.quaternion.copy(o.startQuat);
  o.lid.quaternion.identity();
  fade.style.opacity = 0;
  controls.enabled = true;
  opening = null;
});

// ---- Tweens: promise-based, eased, stepped by the render loop ---------------------------
const tweens = new Set();
function tween(seconds, step) {
  return new Promise((resolve) => tweens.add({ start: performance.now(), seconds, step, resolve }));
}
function runTweens(now) {
  for (const tw of tweens) {
    const t = clamp01((now - tw.start) / 1000 / tw.seconds);
    tw.step(easeInOut(t));
    if (t >= 1) {
      tweens.delete(tw);
      tw.resolve();
    }
  }
}

// ---- SDAT cassette deck: pick a tape from the stack, it drops into the player and plays ------------------
const deck = { player: null, lid: null, tapes: [], loaded: null, audio: null, busy: false, focused: false };
const picker = document.getElementById("picker");
const nowPlaying = document.getElementById("now-playing");
const FOCUS = { distance: 0.75, height: 0.4, fov: 45 };   // where to stand when choosing a tape

function buildPicker() {
  const list = picker.querySelector("ol");
  for (const tape of deck.tapes) {
    const { track_title: title, track_subtitle: subtitle } = tape.obj.userData;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = title;
    button.querySelector("span").textContent = subtitle;
    button.addEventListener("click", () => loadTape(tape));
    button.addEventListener("pointerenter", () => liftInStack(tape, true));
    button.addEventListener("pointerleave", () => liftInStack(tape, false));
    item.append(button);
    list.append(item);
  }
  picker.querySelector(".close").addEventListener("click", hidePicker);
  nowPlaying.querySelector(".toggle").addEventListener("click", togglePause);
  nowPlaying.querySelector(".eject").addEventListener("click", () => ejectTape());
}

// Walk the eye from its pose to (eye, lookAt, fov), keeping the look-around target a hair in front of it
function walkTo(eye, lookAt, fov, seconds) {
  const eye0 = camera.position.clone(), dir0 = controls.target.clone().sub(eye0).normalize(), fov0 = camera.fov;
  const dir1 = lookAt.clone().sub(eye).normalize();
  controls.enabled = false;
  return tween(seconds, (k) => {
    camera.position.lerpVectors(eye0, eye, k);
    controls.target.copy(camera.position).addScaledVector(dir0.clone().lerp(dir1, k).normalize(), 0.01);
    camera.fov = THREE.MathUtils.lerp(fov0, fov, k);
    camera.updateProjectionMatrix();
    controls.update();
  }).then(() => { controls.enabled = true; });
}

// Step up to something (from wherever we stand, on the side we're on) and later back to where we started
let standBack = null;   // eye + look target to return to
// eye: optional spot to stand (when the straight line from here would put you inside furniture)
function approach(box, eye = null) {
  standBack ??= { eye: camera.position.clone(), look: controls.target.clone() };
  const center = box.getCenter(new THREE.Vector3());
  const away = camera.position.clone().sub(center).setY(0).normalize();
  eye ??= center.clone().addScaledVector(away, FOCUS.distance).setY(center.y + FOCUS.height);
  return walkTo(eye, center, FOCUS.fov, 1.1);
}
function stepBack() {
  if (!standBack || deck.focused || etb.open || photos.open) return;
  const look = standBack.look.clone().sub(standBack.eye).multiplyScalar(100).add(standBack.eye);
  walkTo(standBack.eye, look, FOV.start, 1.0);
  standBack = null;
}

// Step up to the cabinet (it's across the room, behind the chair), then show the tape list
function focusDeck() {
  if (deck.focused || !deck.player) return;
  deck.focused = true;
  hint.style.opacity = 0;
  const box = new THREE.Box3().setFromObject(deck.player);
  for (const t of deck.tapes) box.expandByObject(t.obj);
  approach(box);
  picker.hidden = false;
}

function hidePicker() {
  if (!deck.focused) return;
  deck.focused = false;
  picker.hidden = true;
  stepBack();
}

function liftInStack(tape, up) {
  if (deck.busy || tape === deck.loaded) return;
  tape.obj.position.y = tape.home.pos.y + (up ? 0.02 : 0);
}

function setLid(open, seconds) {
  const { hinge_axis, open_angle } = deck.lid.userData;
  const axis = new THREE.Vector3(...hinge_axis);
  const from = deck.lid.userData.openness ?? 0;
  return tween(seconds, (k) => {
    deck.lid.userData.openness = THREE.MathUtils.lerp(from, open, k);
    deck.lid.quaternion.setFromAxisAngle(axis, open_angle * deck.lid.userData.openness);
  });
}

// Fly a tape (in world space) to a pose with a small hop, so it clears the stack and the player's walls
function moveTape(tape, to, seconds = 0.9) {
  scene.attach(tape.obj);
  const fromPos = tape.obj.position.clone(), fromQuat = tape.obj.quaternion.clone();
  return tween(seconds, (k) => {
    tape.obj.position.lerpVectors(fromPos, to.pos, k);
    tape.obj.position.y += Math.sin(Math.PI * k) * 0.12;
    tape.obj.quaternion.slerpQuaternions(fromQuat, to.quat, k);
  });
}

const bayPose = () => ({
  pos: new THREE.Vector3(...deck.player.userData.bay_position).applyMatrix4(deck.player.parent.matrixWorld),
  quat: new THREE.Quaternion(...deck.player.userData.bay_quaternion),
});

async function loadTape(tape) {
  if (deck.busy || opening || tape === deck.loaded) return;
  deck.busy = true;
  // Start the audio inside the click (muted) so Safari counts it as user-initiated; unmute once the tape is seated
  const audio = new Audio(tape.obj.userData.track_src);
  audio.loop = true;
  audio.muted = true;
  audio.play().catch(() => {});
  liftInStack(tape, false);
  await setLid(1, 0.45);
  if (deck.loaded) {
    stopAudio();
    const old = deck.loaded;
    deck.loaded = null;
    await moveTape(old, old.home, 0.8);
  }
  await moveTape(tape, bayPose());
  deck.player.attach(tape.obj);   // rides along if the player is clicked and flies off
  deck.loaded = tape;
  await setLid(0, 0.45);
  audio.currentTime = 0;
  audio.muted = false;
  audio.play().catch(() => {});
  deck.audio = audio;
  showNowPlaying(tape);
  deck.busy = false;
}

async function ejectTape() {
  if (deck.busy || !deck.loaded) return;
  deck.busy = true;
  stopAudio();
  await setLid(1, 0.45);
  const old = deck.loaded;
  deck.loaded = null;
  await moveTape(old, old.home, 0.8);
  await setLid(0, 0.45);
  deck.busy = false;
}

function stopAudio() {
  deck.audio?.pause();
  deck.audio = null;
  nowPlaying.hidden = true;
}

function togglePause() {
  if (!deck.audio) return;
  if (deck.audio.paused) deck.audio.play().catch(() => {});
  else deck.audio.pause();
  nowPlaying.querySelector(".toggle").textContent = deck.audio.paused ? "Play" : "Pause";
}

function showNowPlaying(tape) {
  nowPlaying.querySelector("strong").textContent = tape.obj.userData.track_title;
  nowPlaying.querySelector("span").textContent = tape.obj.userData.track_subtitle;
  nowPlaying.querySelector(".toggle").textContent = "Pause";
  nowPlaying.hidden = false;
}

// ---- Pokémon 151 Elite Trainer Box on the dresser: the lid comes off and the cards fan out ------------------
const etb = { box: null, lid: null, cards: [], open: false, busy: false, lidHome: null, zoomed: null, fanned: false };
const etbPanel = document.getElementById("etb-panel");
const CARD_FAN = { distance: 0.42, drop: 0.03, spread: 0.072, arc: THREE.MathUtils.degToRad(9) };

function initEtb() {
  etb.box.traverse((o) => {
    if (o.userData.etb_lid) etb.lid = o;
    if (o.userData.etb_card) etb.cards.push({ obj: o, home: null });
  });
  etb.cards.sort((a, b) => a.obj.userData.card_index - b.obj.userData.card_index);
  etb.lidHome = { pos: etb.lid.position.clone(), quat: etb.lid.quaternion.clone() };
  for (const c of etb.cards) c.home = { pos: c.obj.position.clone(), quat: c.obj.quaternion.clone() };
  etbPanel.querySelector(".layout").addEventListener("click", toggleFan);
  etbPanel.querySelector(".close").addEventListener("click", closeEtb);
}

// Move a child of the box to a pose given in the box's space, with an optional hop
function moveInBox(obj, to, seconds, hop = 0) {
  const fromPos = obj.position.clone(), fromQuat = obj.quaternion.clone();
  return tween(seconds, (k) => {
    obj.position.lerpVectors(fromPos, to.pos, k);
    obj.position.y += Math.sin(Math.PI * k) * hop;
    obj.quaternion.slerpQuaternions(fromQuat, to.quat, k);
  });
}

const toBoxSpace = (pos, quat) => {
  const inv = etb.box.matrixWorld.clone().invert();
  const boxQuat = etb.box.getWorldQuaternion(new THREE.Quaternion()).invert();
  return { pos: pos.clone().applyMatrix4(inv), quat: boxQuat.multiply(quat) };
};

// Card i of n held up in front of the camera: fanned like a hand of cards, or squared up in one neat stack
const layoutPose = (card) => {
  const i = etb.cards.indexOf(card), n = etb.cards.length;
  return etb.fanned ? fanPose(card, i, n) : stackPose(card, i, n);
};

function stackPose(card, i, n) {
  const wobble = THREE.MathUtils.degToRad([0, 2.5, -2, 3.5, -3][i % 5]);   // card 0 on top, the rest a bit askew
  return heldPose(card, new THREE.Vector3(0, 0, 0), wobble, (n - 1 - i) * 0.0025);
}

function fanPose(card, i, n) {
  const t = i - (n - 1) / 2;
  // outer cards dip like a held hand; later cards slightly in front
  return heldPose(card, new THREE.Vector3(t * CARD_FAN.spread, -t * t * 0.006, 0), -t * CARD_FAN.arc, i * 0.002);
}

// Stand a card up facing the camera, `offset` (camera right/up) from the middle of the view, rolled by `angle`
function heldPose(card, offset, angle, forward) {
  const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const toCam = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  const pos = camera.position.clone().addScaledVector(toCam, -CARD_FAN.distance + forward)
    .addScaledVector(camUp, -CARD_FAN.drop + offset.y).addScaledVector(camRight, offset.x);
  // card axes: face normal = card_normal (default face up), artwork top = card_up, right = up x normal
  const up0 = new THREE.Vector3(...card.obj.userData.card_up);
  const n0 = new THREE.Vector3(...(card.obj.userData.card_normal ?? [0, 1, 0]));
  const local = new THREE.Matrix4().makeBasis(up0.clone().cross(n0), up0, n0);
  const up = camUp.clone().applyAxisAngle(toCam, angle);
  const world = new THREE.Matrix4().makeBasis(up.clone().cross(toCam), up, toCam);
  const quat = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.invert()));
  return toBoxSpace(pos, quat);
}

// A card's home pose, raised just clear of the inner box
const aboveHome = (c) => ({ pos: c.home.pos.clone().add(new THREE.Vector3(0, etb.box.userData.lid_lift ?? 0.18, 0)),
  quat: c.home.quat.clone() });

async function openEtb() {
  if (etb.busy || etb.open || deck.busy) return;
  etb.busy = true;
  hint.style.opacity = 0;
  if (deck.focused) { deck.focused = false; picker.hidden = true; }
  await approach(new THREE.Box3().setFromObject(etb.box));
  // Lid (the whole printed outer box): straight up off the black inner box, then over to its spot on the dresser
  const lifted = { pos: etb.lidHome.pos.clone().add(new THREE.Vector3(0, etb.box.userData.lid_lift ?? 0.16, 0)),
    quat: etb.lidHome.quat.clone() };
  await moveInBox(etb.lid, lifted, 0.7);
  const rest = toBoxSpace(new THREE.Vector3(...etb.box.userData.lid_rest_position),
    new THREE.Quaternion(...etb.box.userData.lid_rest_quaternion));
  await moveInBox(etb.lid, rest, 0.7, 0.04);
  etb.open = true;
  // Cards slide straight up out of the box one after another and gather into one stack in front of you
  etb.fanned = false;
  await Promise.all(etb.cards.map((c, i) => new Promise((resolve) => setTimeout(resolve, i * 110))
    .then(() => moveInBox(c.obj, aboveHome(c), 0.45))
    .then(() => moveInBox(c.obj, layoutPose(c), 0.7))));
  etbPanel.querySelector(".layout").textContent = "Fan out";
  etbPanel.hidden = false;
  etb.busy = false;
}

async function closeEtb() {
  if (etb.busy || !etb.open) return;
  etb.busy = true;
  etb.zoomed = null;
  etbPanel.hidden = true;
  await Promise.all(etb.cards.map((c, i) => new Promise((resolve) => setTimeout(resolve, (etb.cards.length - 1 - i) * 90))
    .then(() => moveInBox(c.obj, aboveHome(c), 0.6))
    .then(() => moveInBox(c.obj, c.home, 0.35))));
  const lifted = { pos: etb.lidHome.pos.clone().add(new THREE.Vector3(0, etb.box.userData.lid_lift ?? 0.16, 0)),
    quat: etb.lidHome.quat.clone() };
  await moveInBox(etb.lid, lifted, 0.7, 0.04);
  await moveInBox(etb.lid, etb.lidHome, 0.5);
  etb.open = false;
  etb.busy = false;
  stepBack();
}

// Spread the stack into a fan, or square the fan back up into a stack
async function toggleFan() {
  if (etb.busy || !etb.open) return;
  etb.busy = true;
  etb.zoomed = null;
  etb.fanned = !etb.fanned;
  etbPanel.querySelector(".layout").textContent = etb.fanned ? "Stack" : "Fan out";
  await Promise.all(etb.cards.map((c, i) => new Promise((resolve) => setTimeout(resolve, i * 60))
    .then(() => moveInBox(c.obj, layoutPose(c), 0.55))));
  etb.busy = false;
}

// Click a card to hold it up close; click it (or another) again to put it back in the stack / fan
async function toggleCard(card) {
  if (etb.busy) return;
  etb.busy = true;
  const n = etb.cards.length;
  if (etb.zoomed && etb.zoomed !== card) moveInBox(etb.zoomed.obj, layoutPose(etb.zoomed), 0.5);
  if (etb.zoomed === card) {
    etb.zoomed = null;
    await moveInBox(card.obj, layoutPose(card), 0.5);
  } else {
    etb.zoomed = card;
    const toCam = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
    const near = camera.position.clone().addScaledVector(toCam, -0.22).applyMatrix4(etb.box.matrixWorld.clone().invert());
    const upright = fanPose(card, (n - 1) / 2, n).quat;   // the middle of the fan is upright
    await moveInBox(card.obj, { pos: near, quat: upright }, 0.5);
  }
  etb.busy = false;
}

// ---- Polaroids on the desk: lift the top one up to look at it, click / arrow through the stack ---------------
// Placeholder pictures for now: give an entry a `src` (e.g. "assets/photos/beach.jpg") to use a real photo.
const PHOTOS = [
  { caption: "summer '24", hue: 28 },
  { caption: "tkd belt test", hue: 210 },
  { caption: "hackathon!!", hue: 280 },
  { caption: "sf sunset", hue: 12 },
  { caption: "the crew", hue: 150 },
  { caption: "graduation", hue: 48 },
];
const PHOTO_SCALE = 1.6;   // bigger than a real Polaroid 600 so they read from across the room
const POLAROID = Object.fromEntries(Object.entries({ w: 0.088, h: 0.107, photo: 0.079, top: 0.0045 })
  .map(([k, v]) => [k, v * PHOTO_SCALE]).concat([["t", 0.0012]]));   // Polaroid 600 proportions, metres
// A flat pile in the empty corner of the desk behind the 3DS (three.js coords: desk top, between the 3DS and the wall)
const STACK_AT = new THREE.Vector3(0.22, 0.78, -2.47);
const PHOTO_EYE = new THREE.Vector3(1.0, 1.35, -2.1);   // stand in front of the desk's near end, clear of the chair
const HOLD = { distance: 0.24 * PHOTO_SCALE, drop: 0.012 };

const photos = { group: new THREE.Group(), items: [], open: false, busy: false, index: 0 };
const photoPanel = document.getElementById("photo-panel");

// One polaroid face drawn on a canvas: white frame, the picture (or a placeholder scene), and a handwritten caption
function polaroidFace(entry, i, onUpdate) {
  const W = 440, H = Math.round((W * POLAROID.h) / POLAROID.w), k = W / POLAROID.w;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const side = (POLAROID.w - POLAROID.photo) / 2 * k, top = POLAROID.top * k, size = POLAROID.photo * k;
  const draw = (img) => {
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, W, H);
    if (img) {
      const s = Math.min(img.width, img.height);   // centre-crop to square
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, side, top, size, size);
    } else {
      // placeholder: a little landscape in this photo's colour, plus a label
      const g = ctx.createLinearGradient(0, top, 0, top + size);
      g.addColorStop(0, `hsl(${entry.hue} 70% 72%)`);
      g.addColorStop(1, `hsl(${(entry.hue + 30) % 360} 60% 45%)`);
      ctx.fillStyle = g;
      ctx.fillRect(side, top, size, size);
      ctx.fillStyle = `hsl(${(entry.hue + 50) % 360} 90% 85%)`;
      ctx.beginPath();
      ctx.arc(side + size * 0.7, top + size * 0.32, size * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${entry.hue} 40% 25% / 0.85)`;
      ctx.beginPath();
      ctx.moveTo(side, top + size);
      ctx.lineTo(side, top + size * 0.72);
      ctx.lineTo(side + size * 0.3, top + size * 0.5);
      ctx.lineTo(side + size * 0.55, top + size * 0.7);
      ctx.lineTo(side + size * 0.78, top + size * 0.55);
      ctx.lineTo(side + size, top + size * 0.75);
      ctx.lineTo(side + size, top + size);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `600 ${Math.round(size * 0.07)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`PHOTO ${i + 1}`, side + size / 2, top + size * 0.93);
    }
    ctx.fillStyle = "#2a2a3a";
    ctx.font = `${Math.round((H - top - size) * 0.42)}px "Marker Felt", "Bradley Hand", "Comic Sans MS", cursive`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.caption ?? "", W / 2, top + size + (H - top - size) * 0.5);
  };
  draw(null);
  if (entry.src) {
    const img = new Image();
    img.onload = () => {
      draw(img);
      onUpdate?.();   // the texture already exists by the time a photo has loaded
    };
    img.src = entry.src;
  }
  return canvas;
}

function initPhotos() {
  const back = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.9 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
  photos.group.position.copy(STACK_AT);
  photos.group.userData.polaroids = true;
  scene.add(photos.group);
  shadowify(photos.group);
  PHOTOS.forEach((entry, i) => {
    const tex = new THREE.CanvasTexture(polaroidFace(entry, i, () => { tex.needsUpdate = true; }));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    // lying face up: box faces are +x,-x,+y,-y,+z,-z; the picture's top points to -z (towards the desk's back wall)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(POLAROID.w, POLAROID.t, POLAROID.h), [edge, edge, face, back, edge, edge]);
    mesh.userData.polaroid = i;
    // photo 0 on top; the ones underneath a little askew so their edges peek out. Picture tops point at the wall,
    // so the top one reads upright from the room.
    const yaw = Math.PI / 2 + THREE.MathUtils.degToRad([3, -7, 10, -4, 8, -11][i % 6]);
    const home = {
      pos: new THREE.Vector3((i % 2 ? 1 : -1) * 0.003 * Math.min(i, 3), (PHOTOS.length - i - 0.5) * POLAROID.t,
        (i % 3 - 1) * 0.003),
      quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    };
    mesh.position.copy(home.pos);
    mesh.quaternion.copy(home.quat);
    photos.group.add(mesh);
    photos.items.push({ mesh, home });
  });
  photoPanel.querySelector(".prev").addEventListener("click", () => showPhoto(photos.index - 1));
  photoPanel.querySelector(".next").addEventListener("click", () => showPhoto(photos.index + 1));
  photoPanel.querySelector(".close").addEventListener("click", closePhotos);
}

// Pose (in the stack's space) that holds a polaroid up in front of the camera, picture upright and facing you
function heldPhotoPose() {
  const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const toCam = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  const pos = camera.position.clone().addScaledVector(toCam, -HOLD.distance).addScaledVector(camUp, -HOLD.drop);
  // mesh axes: face normal +Y, picture top -Z, so right = (+X)
  const local = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
  const world = new THREE.Matrix4().makeBasis(camUp.clone().cross(toCam), camUp, toCam);
  const quat = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.invert()));
  const inv = photos.group.matrixWorld.clone().invert();
  return { pos: pos.applyMatrix4(inv), quat: photos.group.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(quat) };
}

function movePhoto(item, to, seconds, hop = 0.05) {
  const fromPos = item.mesh.position.clone(), fromQuat = item.mesh.quaternion.clone();
  return tween(seconds, (k) => {
    item.mesh.position.lerpVectors(fromPos, to.pos, k);
    item.mesh.position.y += Math.sin(Math.PI * k) * hop;
    item.mesh.quaternion.slerpQuaternions(fromQuat, to.quat, k);
  });
}

function updatePhotoPanel() {
  photoPanel.querySelector("span").textContent = `${photos.index + 1} / ${photos.items.length}`;
}

async function openPhotos() {
  if (photos.busy || photos.open || etb.busy || deck.busy) return;
  photos.busy = true;
  hint.style.opacity = 0;
  if (deck.focused) { deck.focused = false; picker.hidden = true; }
  if (etb.open) await closeEtb();
  await approach(new THREE.Box3().setFromObject(photos.group), PHOTO_EYE);
  photos.open = true;
  photos.index = 0;
  await movePhoto(photos.items[0], heldPhotoPose(), 0.7, 0.08);
  updatePhotoPanel();
  photoPanel.hidden = false;
  photos.busy = false;
}

// Put the held one back on the stack and lift photo i (wraps around)
async function showPhoto(i) {
  if (photos.busy || !photos.open) return;
  photos.busy = true;
  const n = photos.items.length;
  const next = ((i % n) + n) % n;
  const current = photos.items[photos.index];
  photos.index = next;
  updatePhotoPanel();
  await Promise.all([
    movePhoto(current, current.home, 0.5, 0.04),
    new Promise((r) => setTimeout(r, 120)).then(() => movePhoto(photos.items[next], heldPhotoPose(), 0.6, 0.07)),
  ]);
  photos.busy = false;
}

async function closePhotos() {
  if (photos.busy || !photos.open) return;
  photos.busy = true;
  photoPanel.hidden = true;
  const held = photos.items[photos.index];
  await movePhoto(held, held.home, 0.6, 0.05);
  photos.open = false;
  photos.busy = false;
  stepBack();
}

// Turn your head with A / D or the arrow keys (up / down to look up and down). While a polaroid is up, the left and
// right arrows flip photos instead, and the view holds still while something is held up in front of you.
const TURN_KEYS = { a: [1, 0], arrowleft: [1, 0], d: [-1, 0], arrowright: [-1, 0], arrowup: [0, 1], arrowdown: [0, -1] };
const heldKeys = new Set();
const TURN_SPEED = { yaw: 1.5, pitch: 0.9 };   // radians per second
window.addEventListener("keyup", (event) => heldKeys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => heldKeys.clear());
function turnHead(dt) {
  if (!heldKeys.size || !controls.enabled || opening || photos.open || etb.open) return;
  let yaw = 0, pitch = 0;
  for (const k of heldKeys) if (TURN_KEYS[k]) { yaw += TURN_KEYS[k][0]; pitch += TURN_KEYS[k][1]; }
  if (!yaw && !pitch) return;
  const dir = controls.target.clone().sub(camera.position).normalize();
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw * TURN_SPEED.yaw * dt);
  // pitch about the camera's right axis, kept inside the same limits as dragging
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const pitched = dir.clone().applyAxisAngle(right, pitch * TURN_SPEED.pitch * dt);
  const elevation = Math.asin(THREE.MathUtils.clamp(pitched.y, -1, 1));
  if (elevation > -THREE.MathUtils.degToRad(60) && elevation < THREE.MathUtils.degToRad(20)) dir.copy(pitched);
  controls.target.copy(camera.position).addScaledVector(dir, 0.01);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (photos.open && event.key === "ArrowRight") showPhoto(photos.index + 1);
  if (photos.open && event.key === "ArrowLeft") showPhoto(photos.index - 1);
  if (TURN_KEYS[key] && !event.metaKey && !event.ctrlKey && !event.altKey) {
    heldKeys.add(key);
    if (key.startsWith("arrow")) event.preventDefault();
  }
  if (event.key !== "Escape") return;
  hidePicker();
  closeEtb();
  closePhotos();
});

// ---- Loop --------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  look.setSize(window.innerWidth, window.innerHeight);
});

let lastFrame = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  for (const p of pokemon.values()) p.update(dt);
  turnHead(dt);
  runTweens(now);
  if (opening) animateOpening(now);
  else if (controls.enabled) controls.update();
  look.render(now);
});
