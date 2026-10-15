import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// The "cozy miniature" look (after worawork.vercel.app): soft sun shadows, ambient occlusion in the corners and under
// things, a soft glow on lights and screens, then a warm grade, tilt-shift blur at the top and bottom of the frame,
// a vignette and a little grain.

export const LOOK = {
  ao: { radius: 0.35, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, blend: 0.9 },
  bloom: { strength: 0.35, radius: 0.6, threshold: 0.82 },
  grade: { warmth: 0.07, saturation: 1.08, contrast: 1.05, lift: 0.025 },
  tiltShift: { band: 0.28, blur: 2.2 },   // in-focus half-height (0..0.5 of the screen) and max blur (px per tap)
  vignette: 0.32,
  grain: 0.035,
};

// Warm grade, tilt-shift, vignette and grain, in display space (after tone mapping)
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    warmth: { value: LOOK.grade.warmth },
    saturation: { value: LOOK.grade.saturation },
    contrast: { value: LOOK.grade.contrast },
    lift: { value: LOOK.grade.lift },
    band: { value: LOOK.tiltShift.band },
    blur: { value: LOOK.tiltShift.blur },
    vignette: { value: LOOK.vignette },
    grain: { value: LOOK.grain },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time, warmth, saturation, contrast, lift, band, blur, vignette, grain;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // tilt-shift: blur grows outside a horizontal band through the middle of the frame
      float d = max(abs(vUv.y - 0.5) - band, 0.0) / max(0.5 - band, 1e-3);
      float r = blur * smoothstep(0.0, 1.0, d);
      vec3 col = vec3(0.0);
      float total = 0.0;
      for (int i = -3; i <= 3; i++) {
        for (int j = -3; j <= 3; j++) {
          vec2 o = vec2(float(i), float(j));
          float w = exp(-dot(o, o) / 8.0);
          col += texture2D(tDiffuse, vUv + o * r / resolution).rgb * w;
          total += w;
        }
      }
      col /= total;

      // warm, slightly richer grade: lift the shadows warm, push saturation and contrast a touch
      col += lift * vec3(1.0, 0.75, 0.5);
      col *= vec3(1.0 + warmth, 1.0 + warmth * 0.35, 1.0 - warmth * 0.6);
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, saturation);
      col = (col - 0.5) * contrast + 0.5;

      // vignette and grain
      vec2 c = vUv - 0.5;
      c.x *= resolution.x / resolution.y;
      col *= 1.0 - vignette * smoothstep(0.35, 1.05, length(c));
      col += (hash(vUv * resolution + time) - 0.5) * grain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// Shadows: everything casts and receives, except the room shell (walls, floor, glass, window light) which only
// receives, so the sun comes in through the window wall and the blinds stripe the floor.
const RECEIVE_ONLY = /^(wall_(far|left|right|near|corner)(_baseboard)?|floor|foam_mat_.*|.*_glass|.*_daylight|ceiling)$/;
export function shadowify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    let named = o;
    while (named && !named.name) named = named.parent;   // multi-material meshes are children of the named node
    const name = named?.name ?? "";
    o.receiveShadow = true;
    o.castShadow = !RECEIVE_ONLY.test(name) && !/_glass|_daylight/.test(o.name);
  });
}

export function createLook(renderer, scene, camera, sun) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // sun through the window wall, coming down at a slant across the desk and mats
  const roomCentre = new THREE.Vector3(1.9, 0.4, -2.3);
  sun.position.copy(roomCentre).add(new THREE.Vector3(-1.2, 4.5, -4.2));
  sun.target.position.copy(roomCentre);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3.6, right: 3.6, top: 3.6, bottom: -3.6, near: 0.5, far: 14 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.015;
  sun.shadow.radius = 4;

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));

  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.updateGtaoMaterial({ radius: LOOK.ao.radius, distanceExponent: LOOK.ao.distanceExponent,
    thickness: LOOK.ao.thickness, scale: LOOK.ao.scale, samples: 16 });
  ao.blendIntensity = LOOK.ao.blend;
  composer.addPass(ao);

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), LOOK.bloom.strength, LOOK.bloom.radius, LOOK.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());   // tone mapping + sRGB

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const setSize = (w, h) => {
    composer.setSize(w, h);
    const pr = composer._pixelRatio ?? 1;
    grade.uniforms.resolution.value.set(w * pr, h * pr);
  };
  setSize(size.x, size.y);

  return {
    composer,
    setSize,
    render(now) {
      grade.uniforms.time.value = (now % 10000) / 1000;
      composer.render();
    },
  };
}
