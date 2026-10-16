// Production build: bundles + minifies the site into dist/, Draco-compresses the room model
// and serves three.js and the Draco decoder from dist/ instead of the CDN.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { basename } from "node:path";

const OUT = "dist";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

// main.js and its imports (three included) into one hashed, minified module
const rewritePaths = {
  name: "rewrite-paths",
  setup(b) {
    b.onLoad({ filter: /site[\\/]main\.js$/ }, (args) => ({
      loader: "js",
      contents: readFileSync(args.path, "utf8")
        .replace('"../blender/my_room.glb"', '"./my_room.glb"')
        .replace(/setDecoderPath\("[^"]+"\)/, 'setDecoderPath("./draco/")'),
    }));
  },
};
const result = await build({
  entryPoints: ["site/main.js"],
  outdir: OUT,
  entryNames: "[name]-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  legalComments: "none",
  metafile: true,
  plugins: [rewritePaths],
});
const bundle = basename(Object.keys(result.metafile.outputs).find((f) => f.endsWith(".js")));

// index.html: drop the CDN import map, point at the bundle
let html = readFileSync("site/index.html", "utf8");
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "");
html = html.replace('src="./main.js"', `src="./${bundle}"`);
writeFileSync(`${OUT}/index.html`, html);

// Static assets, Draco decoder, compressed room
cpSync("site/assets", `${OUT}/assets`, { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
mkdirSync(`${OUT}/draco`);
for (const f of ["draco_decoder.wasm", "draco_wasm_wrapper.js", "draco_decoder.js"]) {
  cpSync(`node_modules/three/examples/jsm/libs/draco/gltf/${f}`, `${OUT}/draco/${f}`);
}
execFileSync("npx", ["gltf-transform", "draco", "blender/my_room.glb", `${OUT}/my_room.glb`], { stdio: "inherit" });

const mb = (f) => (statSync(f).size / 1e6).toFixed(2) + " MB";
console.log(`\nBuilt ${OUT}/  ·  ${bundle} ${mb(`${OUT}/${bundle}`)}  ·  my_room.glb ${mb("blender/my_room.glb")} → ${mb(`${OUT}/my_room.glb`)}`);
