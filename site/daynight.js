import * as THREE from "three";

// Time of day for the room: moves the sun (moon at night) across the window wall, tints and dims the light, turns the
// window panes from bright day to dusky blue, switches the desk lamp on after dark and warms / cools the grade.
// setTime(hours) jumps there; update(dt) runs the clock when `speed` (game hours per real second) isn't 0.

const AFTERNOON = 15.5;
const C = (hex) => new THREE.Color(hex);
const COLORS = {
  sunDay: C(0xffd9a8), sunSet: C(0xff8a3d), moon: C(0x8fa8ff),
  skyDay: C(0xfff1dd), skyNight: C(0x2b3a6b), groundDay: C(0x2a2430), groundNight: C(0x0b0d18),
  paneDay: C(0xfff2d9), paneSet: C(0xff9a55), paneNight: C(0x1d2a55),
};

export function createDayNight({ scene, sun, hemi, ceilingLight, look, room }) {
  const roomCentre = new THREE.Vector3(1.9, 0.4, -2.3);
  const base = {
    sun: sun.intensity, hemi: hemi.intensity, env: scene.environmentIntensity, ceiling: ceilingLight.intensity,
    warmth: look.grade.warmth.value, vignette: look.grade.vignette.value,
    bloomStrength: look.bloom.strength, bloomThreshold: look.bloom.threshold,
  };

  // Window panes ("daylight" material) and the desk lamp bulb from the room model
  const mats = new Map();
  room.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) if (m?.name) mats.set(m.name, m);
  });
  const pane = mats.get("daylight"), bulb = mats.get("bulb");
  const paneBase = pane ? { intensity: pane.emissiveIntensity } : null;
  const bulbBase = bulb ? bulb.emissiveIntensity : 0;

  // the desk lamp's own light, only on after dark
  const lamp = new THREE.PointLight(0xffc98a, 0, 3.5, 1.6);
  lamp.position.set(0.28, 1.12, -4.02);
  scene.add(lamp);

  const clock = { hours: AFTERNOON, speed: 0, target: null };

  function setTime(h) {
    clock.hours = ((h % 24) + 24) % 24;
    const angle = ((clock.hours - 6) / 12) * Math.PI;   // 0 at sunrise, PI at sunset
    const elevation = Math.sin(angle);
    const day = THREE.MathUtils.smoothstep(elevation, -0.12, 0.28);
    const sunset = Math.exp(-(((elevation - 0.08) / 0.13) ** 2));   // near the horizon, morning and evening

    // the sun (or the moon, opposite it) always comes in through the window wall, sweeping side to side
    const up = day > 0.02 ? Math.max(elevation, 0.12) : Math.max(-elevation, 0.25);
    const sweep = Math.cos(day > 0.02 ? angle : angle - Math.PI) * 2.2;
    sun.position.copy(roomCentre).add(new THREE.Vector3(sweep, 1.2 + up * 4, -4.2));
    sun.color.copy(COLORS.moon).lerp(COLORS.sunDay.clone().lerp(COLORS.sunSet, sunset), day);
    sun.intensity = THREE.MathUtils.lerp(0.35, base.sun * (1 - 0.25 * sunset), day);

    hemi.color.copy(COLORS.skyNight).lerp(COLORS.skyDay, day);
    hemi.groundColor.copy(COLORS.groundNight).lerp(COLORS.groundDay, day);
    hemi.intensity = THREE.MathUtils.lerp(0.14, base.hemi, day);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.07, base.env, day);
    ceilingLight.intensity = THREE.MathUtils.lerp(0.4, base.ceiling, day);

    const night = 1 - day;
    lamp.intensity = 2.6 * THREE.MathUtils.smoothstep(night, 0.35, 0.8);
    if (bulb) bulb.emissiveIntensity = bulbBase * (0.25 + 0.75 * night);
    if (pane) {
      pane.emissive.copy(COLORS.paneNight).lerp(COLORS.paneDay.clone().lerp(COLORS.paneSet, sunset), day);
      pane.emissiveIntensity = THREE.MathUtils.lerp(0.25, paneBase.intensity, day);
    }

    look.grade.warmth.value = base.warmth + 0.09 * sunset - 0.11 * night;
    look.grade.vignette.value = base.vignette + 0.16 * night;
    look.bloom.strength = THREE.MathUtils.lerp(0.65, base.bloomStrength, day);
    look.bloom.threshold = THREE.MathUtils.lerp(0.55, base.bloomThreshold, day);
  }

  // hours like 19.6 -> "7:36 PM"
  const label = () => {
    const h = Math.floor(clock.hours), m = Math.floor((clock.hours - h) * 60);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };

  function update(dt) {
    if (clock.speed) setTime(clock.hours + clock.speed * dt);
    else if (clock.target !== null) {
      // ease the short way round the clock to the target time
      const d = ((clock.target - clock.hours + 36) % 24) - 12;
      if (Math.abs(d) < 0.02) { setTime(clock.target); clock.target = null; }
      else setTime(clock.hours + Math.sign(d) * Math.min(Math.abs(d), Math.max(0.6, Math.abs(d) * 1.5) * dt));
    }
  }

  setTime(AFTERNOON);
  return {
    clock, label, setTime, update,
    timelapse(on, hoursPerSecond = 0.6) {   // 24 h in 40 s
      clock.speed = on ? hoursPerSecond : 0;
      clock.target = on ? null : AFTERNOON;
    },
  };
}
