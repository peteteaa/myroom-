// Loading screen: a painted Your Name-style starfall (art made in VectorCraft, assets/loading/) with live effects
// on top. The big comet crosses the sky as the room downloads, splits halfway and flares when the room is ready.
// A classic script that runs before the main bundle, so the scene animates while three.js is still downloading.
(() => {
const NS = "http://www.w3.org/2000/svg";
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent?.appendChild(e); return e; };
const SPARKLE = "M0 -1Q0 0 1 0Q0 0 0 1Q0 0 -1 0Q0 0 0 -1Z";

function createStarfall(svg) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => svg.getElementById(id);
  const shootLayer = $("fx-shoot"), cometLayer = $("fx-comet"), fliesLayer = $("fx-flies"), flare = $("fx-flare"), dim = $("fx-dim");

  // a comet is a unit-length tail (pointing along -x) that gets translated, rotated and stretched each frame
  // a comet: a stretched tail with shimmering streaks, a breathing glow, a slowly turning double sparkle,
  // and a stream of glittering dust it sheds behind it
  const dustLayer = el("g", {}, cometLayer);
  let dust = [];
  function puff(x, y, vx, vy, colors, life, size) {
    const star = Math.random() < 0.3, c = colors[Math.floor(Math.random() * colors.length)];
    const node = star ? el("path", { d: SPARKLE, fill: c }, dustLayer) : el("circle", { r: 1, fill: c }, dustLayer);
    dust.push({ node, x, y, vx, vy, age: 0, life, size: size * (star ? 2.2 : 1), spin: Math.random() * 360 });
  }
  function makeComet(tailFill, colors) {
    const g = el("g", {}, cometLayer), tail = el("g", {}, g);
    // tail x runs 0 (head) to -1 (end) and is stretched to the tail's length; y is in scene units
    el("polygon", { points: "0,-1.4 -1,-36 -1,36 0,1.4", fill: tailFill }, tail);
    el("polygon", { points: "0,-1 -0.8,-11 -0.8,11 0,1", fill: tailFill }, tail);
    const streaks = Array.from({ length: 6 }, () => el("polygon", { points: "0,-0.5 -1,-2.4 -1,2.4 0,0.5", fill: "url(#fx-core)" }, g));
    el("polygon", { points: "0,-1 -0.45,0 0,1", fill: "url(#fx-core)" }, tail);
    const glow = el("circle", { r: 18, fill: "url(#fx-glow)" }, g);
    const spark = el("path", { d: SPARKLE, fill: "#fff" }, g), spark2 = el("path", { d: SPARKLE, fill: "#fff", opacity: 0.75 }, g);
    el("circle", { r: 2.6, fill: "#fff" }, g);
    let carry = 0;
    return (x, y, ang, L, a, t, dt) => {
      g.setAttribute("opacity", a.toFixed(3));
      g.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      const breathe = 1 + 0.06 * Math.sin(t * 2.1) + 0.03 * Math.sin(t * 5.3);
      tail.setAttribute("transform", `rotate(${ang.toFixed(2)}) scale(${(L * breathe).toFixed(1)} 1)`);
      streaks.forEach((st, i) => {   // thin ion streaks that flicker and stretch on their own
        const off = (i - 2.5) * 1.3 + Math.sin(t * 1.7 + i * 1.9) * 0.7;
        const len = L * (0.5 + 0.45 * Math.abs(Math.sin(t * 0.8 + i * 1.3)));
        st.setAttribute("transform", `rotate(${(ang + off).toFixed(2)}) scale(${len.toFixed(1)} 1)`);
        st.setAttribute("opacity", (0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * 3.1 + i * 2.2))).toFixed(3));
      });
      glow.setAttribute("r", (18 + Math.sin(t * 3) * 3.5 + Math.sin(t * 7.3) * 1.2).toFixed(1));
      const s = 11 + Math.sin(t * 4) * 2;
      spark.setAttribute("transform", `rotate(${(t * 22) % 360}) scale(${s.toFixed(2)})`);
      spark2.setAttribute("transform", `rotate(${(45 + t * 22) % 360}) scale(${(s * 0.55).toFixed(2)})`);
      if (reduced || a < 0.05) return;
      carry += dt * 55;                                  // shed glittering dust back along the tail
      const bx = -Math.cos(ang * Math.PI / 180), by = -Math.sin(ang * Math.PI / 180);   // tail direction
      while (carry >= 1) {
        carry -= 1;
        const sp = 40 + Math.random() * 110, side = (Math.random() - 0.5) * 50;
        puff(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6, bx * sp - by * side, by * sp + bx * side, colors, 0.7 + Math.random() * 1.1, 0.8 + Math.random() * 1.6);
      }
    };
  }
  const fragment = makeComet("url(#fx-tail-pink)", ["#ffe3ef", "#ffb3d1", "#ffffff"]);
  const main = makeComet("url(#fx-tail-blue)", ["#ffffff", "#d6f0ff", "#9fdcff", "#fff2c4"]);
  let burst = false;

  const flies = Array.from({ length: 20 }, () => ({
    x: Math.random() * 1600, y: 760 + Math.random() * 220, ph: Math.random() * 6.28, sp: 0.8 + Math.random() * 1.6, dr: 8 + Math.random() * 18,
    node: el("circle", { r: 7, fill: "url(#fx-fly)" }, fliesLayer) }));

  let target = 0, shown = 0, indeterminate = false, failed = false, finishAt = 0, raf = 0, shots = [], nextShot = 0;
  let start = performance.now(), last = start;

  function draw(now) {
    const t = (now - start) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (indeterminate && !finishAt) target = 0.92 * (1 - Math.exp(-t / 7));
    shown += (target - shown) * (reduced ? 1 : Math.min(1, dt * (finishAt ? 6 : 4)));
    const p = shown, dimA = failed ? 0.35 : 1;

    // the comet flies from the upper right toward the sea as the room downloads
    const sx = 1680, sy = 70, ex = 190, ey = 285, e = 1 - Math.pow(1 - p, 1.35);   // right to left across the whole sky
    const cx = sx + (ex - sx) * e, cy = sy + (ey - sy) * e;
    const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const ang = Math.atan2(-uy, -ux) * 180 / Math.PI + 180;   // tail points back along the flight path
    const wob = reduced ? 0 : Math.sin(t * 1.3) * 4 + Math.sin(t * 2.7) * 2;   // a gentle wobble in flight
    main(cx - uy * wob, cy + ux * wob, ang + wob * 0.25, 600, dimA, t, dt);
    const split = smooth(0.4, 1, p);                          // halfway there, a fragment breaks away
    if (split > 0) {
      const oe = 1 - Math.pow(0.6, 1.35), ox = sx + dx * oe, oy = sy + dy * oe, sep = 150 * split;
      const fx = cx + uy * sep - ux * sep * 0.3, fy = cy - ux * sep - uy * sep * 0.3;
      const fd = Math.hypot(fx - ox, fy - oy) || 1;
      fragment(fx, fy, Math.atan2(fy - oy, fx - ox) * 180 / Math.PI, fd + 140, split * 0.9 * dimA, t + 1.3, dt);
      if (!burst && !reduced && split > 0.02) {           // the moment it breaks away: a burst of sparkles
        burst = true;
        for (let i = 0; i < 46; i++) {
          const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 170;
          puff(fx, fy, Math.cos(a) * v, Math.sin(a) * v, ["#ffffff", "#ffd1e4", "#bfe6ff", "#fff2c4"], 0.8 + Math.random() * 0.9, 1 + Math.random() * 1.8);
        }
      }
    } else { fragment(cx, cy, ang, 1, 0, t, dt); if (p < 0.38) burst = false; }
    dust = dust.filter((d) => {
      d.age += dt; if (d.age > d.life) { d.node.remove(); return false; }
      d.vx *= 0.97; d.vy *= 0.97; d.vy += 6 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      const k = 1 - d.age / d.life, tw = 0.6 + 0.4 * Math.sin(d.age * 18 + d.spin);
      d.node.setAttribute("opacity", (k * tw * dimA).toFixed(3));
      d.node.setAttribute("transform", `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)}) rotate(${(d.spin + d.age * 90).toFixed(0)}) scale(${(d.size * (0.4 + 0.6 * k)).toFixed(2)})`);
      return true;
    });

    // shooting stars, streaking down behind the clouds
    if (!reduced && !failed && t > nextShot) {
      const a = 2.35 + (Math.random() - 0.5) * 0.35, v = 900 + Math.random() * 600;
      const g = el("g", {}, shootLayer);
      el("rect", { x: -1, y: -0.8, width: 1, height: 1.6, fill: "url(#fx-core)" }, g);
      el("circle", { r: 1.8, fill: "#fff" }, g);
      shots.push({ g, x: 300 + Math.random() * 1400, y: Math.random() * 220, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0,
                   life: 0.45 + Math.random() * 0.45, len: 110 + Math.random() * 160, ang: a * 180 / Math.PI });
      nextShot = t + 0.3 + Math.random() * 0.9;
    }
    shots = shots.filter((s) => {
      s.age += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.age > s.life) { s.g.remove(); return false; }
      const L = s.len * Math.min(1, s.age / 0.12);
      s.g.setAttribute("opacity", Math.sin(Math.PI * (s.age / s.life)).toFixed(3));
      s.g.setAttribute("transform", `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.ang.toFixed(1)})`);
      s.g.firstChild.setAttribute("transform", `scale(${L.toFixed(1)} 1)`);
      return true;
    });

    for (const f of flies) {
      const a = reduced ? 0.6 : Math.pow(Math.max(0, Math.sin(t * f.sp + f.ph)), 2);
      f.node.setAttribute("opacity", a.toFixed(3));
      f.node.setAttribute("cx", (f.x + Math.sin(t * 0.4 + f.ph) * f.dr).toFixed(1));
      f.node.setAttribute("cy", (f.y + Math.cos(t * 0.55 + f.ph * 1.3) * f.dr * 0.6).toFixed(1));
    }

    // ready: the comet flares and floods the sky with light
    const fl = finishAt ? clamp((now - finishAt - 250) / 1400) : 0;
    flare.setAttribute("cx", cx.toFixed(1)); flare.setAttribute("cy", cy.toFixed(1));
    flare.setAttribute("r", (30 + 2000 * (1 - Math.pow(1 - fl, 3))).toFixed(0));
    flare.setAttribute("opacity", (fl > 0 ? Math.sin(Math.PI * fl) : 0).toFixed(3));
    dim.setAttribute("opacity", failed ? 0.45 : 0);

    if (!reduced) raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  const redraw = () => { if (reduced) draw(performance.now()); };

  return {
    setProgress(v) { indeterminate = false; target = clamp(v); redraw(); },
    setIndeterminate() { indeterminate = true; redraw(); },
    finish() {   // resolves around the flare's peak, which is when to start fading the screen out
      target = 1; indeterminate = false; finishAt = performance.now(); redraw();
      return new Promise((res) => setTimeout(res, reduced ? 0 : 1000));
    },
    fail() { failed = true; target = shown; redraw(); },
    jump(v) { target = shown = clamp(v); redraw(); },
    reset() { target = shown = 0; failed = false; finishAt = 0; shots.forEach((s) => s.g.remove()); shots = []; dust.forEach((d) => d.node.remove()); dust = []; burst = false; nextShot = 0; start = last = performance.now(); redraw(); },
    destroy() { cancelAnimationFrame(raf); },
  };
}

// ---------------------------------------------------------------------------------------------
// The loading screen's controller. main.js reports progress through window.roomLoader.
// ---------------------------------------------------------------------------------------------
const loading = document.getElementById("loading");
const cord = loading.querySelector(".cord i");
const label = loading.querySelector(".label"), pct = loading.querySelector(".pct");
const setStatus = (text, value = "") => { label.textContent = text; pct.textContent = value; };
const bg = loading.querySelector(".bg");
const showBg = () => bg.classList.add("ready");
bg.complete ? showBg() : bg.addEventListener("load", showBg, { once: true });
const sky = createStarfall(loading.querySelector(".fx"));
const t0 = performance.now();
let clock = 0;

window.roomLoader = {
  // bytes loaded so far; total is 0 when the server didn't send a size
  progress(loaded, total) {
    if (!total) {
      if (!clock) {
        loading.classList.add("indeterminate"); sky.setIndeterminate();
        clock = setInterval(() => setStatus("Loading room…", `${Math.floor((performance.now() - t0) / 1000)}s`), 500);
      }
      return;
    }
    const p = Math.min(1, loaded / total), n = Math.round(p * 100);
    cord.style.width = `${n}%`; sky.setProgress(p);
    setStatus(n < 100 ? "Loading room…" : "Unpacking…", `${n}%`);
  },
  settingUp() {
    clearInterval(clock); loading.classList.remove("indeterminate");
    cord.style.width = "100%"; sky.setProgress(1); setStatus("Setting up…", "100%");
  },
  fail() {
    clearInterval(clock); loading.classList.remove("indeterminate"); loading.classList.add("error");
    sky.fail(); setStatus("Couldn't load the room. Refresh to try again.");
  },
  // the comet flares, then the screen fades into the room
  async finish() {
    clearInterval(clock);
    await sky.finish();
    loading.classList.add("done");
    const remove = () => { sky.destroy(); loading.remove(); };
    loading.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 1200);   // reduced motion: no transition fires
  },
};
})();
