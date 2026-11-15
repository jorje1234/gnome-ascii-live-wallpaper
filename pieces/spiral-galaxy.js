/* spiral-galaxy: a tilted two-armed spiral galaxy turning slowly, with a warm core, blue arms and pink star nurseries. */
import { Grid, palette, gradient, KEYS, fbm, rng, clamp, TAU } from "../lib/kit.js";

const all = [], G = {};
const add = (n, c) => { G[n] = all.length; all.push(...c); };
add("bg", gradient(["#020309", "#060a1c", "#0e1230", "#181a40"], 6));
add("core", gradient(["#3a2410", "#8a5a24", "#d8a050", "#f6d898", "#fff4dc", "#ffffff"], 10));
add("arm", gradient(["#0a1030", "#1c2c6a", "#3456a8", "#6488d8", "#a8c0f4", "#e8f0ff"], 12));
add("pink", ["#8a2a6a", "#d4509a", "#ff9ccc"]);
add("star", ["#8fa0e0", "#ffffff"]);

export const meta = {
  slug: "spiral-galaxy",
  name: "Spiral Galaxy",
  category: "cosmos",
  note: "A tilted spiral galaxy turns slowly, its golden core feeding two blue arms dotted with pink star nurseries.",
  tags: ["galaxy", "stars", "spiral", "wallpaper", "hero"],
  cols: 104, rows: 40, fps: 30,
  palette: palette(all),
};

const K = (n, i) => KEYS[G[n] + i];
const SH = "░▒▓█";

export default function create() {
  const { cols, rows } = meta;
  const g = new Grid(cols, rows);
  const cx = cols / 2, cy = rows / 2, S = 0.52, ROT = 0.32;
  const cr = Math.cos(ROT), sr = Math.sin(ROT);
  const PITCH = 0.36;
  const r = rng(17);
  const stars = Array.from({ length: 120 }, () => [
    Math.floor(r() * cols) + 0.5,
    Math.floor(r() * rows) + 0.5,
    r() * TAU,
    r(),
  ]);
  const dstars = Array.from({ length: 160 }, () => {
    const rad = 4 + r() * 40;
    const arm = r() < 0.5 ? 0 : Math.PI;
    const scatter = (r() - 0.5) * 0.7;
    return [rad, arm + Math.log(rad) / PITCH + scatter, r() * TAU];
  });

  const N = cols * rows;
  const rawVal = new Float32Array(N);
  const cellRad = new Float32Array(N);
  const cellBulge = new Float32Array(N);
  const cellDiskExp = new Float32Array(N);
  const cellLaneFactor = new Float32Array(N);
  const cosArmBase = new Float32Array(N);
  const sinArmBase = new Float32Array(N);
  const cosLaneBase = new Float32Array(N);
  const sinLaneBase = new Float32Array(N);
  const cellUx = new Float32Array(N);
  const cellUy = new Float32Array(N);
  const cellBgCh = new Array(N);
  const cellBgCo = new Array(N);
  const cellBgVal = new Float32Array(N);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * 2;
      const u = dx * cr + dy * sr, w = (-dx * sr + dy * cr) / S;
      const rad = Math.hypot(u, w) + 0.001;
      const th = Math.atan2(w, u);
      const basePh = 2 * (th - Math.log(rad) / PITCH);

      cellRad[idx] = rad;
      cellBulge[idx] = Math.exp(-rad / 6) * 1.4;
      cellDiskExp[idx] = Math.exp(-rad / 24);
      cellLaneFactor[idx] = 0.55 * clamp(rad / 8);

      cosArmBase[idx] = Math.cos(basePh);
      sinArmBase[idx] = Math.sin(basePh);
      cosLaneBase[idx] = Math.cos(basePh + 0.9);
      sinLaneBase[idx] = Math.sin(basePh + 0.9);
      cellUx[idx] = Math.cos(th) * rad * 0.18;
      cellUy[idx] = Math.sin(th) * rad * 0.18;

      const haze = fbm(x * 0.05, y * 0.12, 3, 2);
      const v = clamp(haze * 0.8 - 0.1);
      cellBgCh[idx] = v > 0.5 ? "▒" : "░";
      cellBgCo[idx] = K("bg", Math.min(5, Math.floor(v * 6)));
      cellBgVal[idx] = 0.25 + v * 0.25;
    }
  }

  const starHex0 = meta.palette[K("star", 0)];
  const starHex1 = meta.palette[K("star", 1)];

  return (t) => {
    g.clear();
    const spin = t * 0.18;
    const cosSpin = Math.cos(spin), sinSpin = Math.sin(spin);
    const cos2Spin = Math.cos(2 * spin), sin2Spin = Math.sin(2 * spin);

    for (let idx = 0; idx < N; idx++) {
      const bulge = cellBulge[idx];
      const diskExp = cellDiskExp[idx];
      if (bulge + diskExp * 1.97 < 0.07) {
        g.ch[idx] = cellBgCh[idx];
        g.co[idx] = cellBgCo[idx];
        rawVal[idx] = cellBgVal[idx];
        continue;
      }
      const c1 = 0.5 + 0.5 * (cosArmBase[idx] * cos2Spin + sinArmBase[idx] * sin2Spin);
      const arm = c1 * c1 * Math.sqrt(c1);
      const c2 = 0.5 + 0.5 * (cosLaneBase[idx] * cos2Spin + sinLaneBase[idx] * sin2Spin);
      const c2_2 = c2 * c2;
      const lane = c2_2 * c2_2 * c2_2;
      const gu = cellUx[idx] * cosSpin + cellUy[idx] * sinSpin + 40;
      const gw = cellUy[idx] * cosSpin - cellUx[idx] * sinSpin;
      const clump = fbm(gu, gw, 3, 5);
      const disk = diskExp * (0.22 + 1.25 * arm * (0.45 + clump)) * (1 - lane * cellLaneFactor[idx]);
      const I = clamp(bulge + disk);
      if (I < 0.07) {
        g.ch[idx] = cellBgCh[idx];
        g.co[idx] = cellBgCo[idx];
        rawVal[idx] = cellBgVal[idx];
        continue;
      }
      const ch = SH[Math.min(3, (I * 5) | 0)];
      const warm = clamp(bulge / (bulge + disk + 0.001) * 1.4 - 0.2);
      g.ch[idx] = ch;
      // Continuous unquantized brightness (0.25 .. 1.0) so halftone dots transition smoothly without 4-step snapping
      rawVal[idx] = 0.25 + 0.75 * Math.min(1, I * 1.15);
      if (warm > 0.5) g.co[idx] = K("core", Math.min(9, (I * 10) | 0));
      else if (arm > 0.6 && clump > 0.62 && cellRad[idx] > 9) g.co[idx] = K("pink", Math.min(2, ((clump - 0.62) * 14) | 0));
      else g.co[idx] = K("arm", Math.min(11, (1 + I * 14 + warm * 3) | 0));
    }

    const subStars = [];
    for (const [sx, sy, ph, b] of stars) {
      const cellIdx = (sy | 0) * cols + (sx | 0);
      if (g.ch[cellIdx] !== "░") continue;
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + ph);
      const stype = b > 0.85 && tw > 0.5 ? 2 : tw > 0.4 ? 1 : 0;
      subStars.push(sx, sy, stype, b > 0.5 ? starHex1 : starHex0);
    }
    for (const [rad, a0, ph] of dstars) {
      const a = a0 + spin * (1.4 - rad / 60);
      const u = Math.cos(a) * rad, w = Math.sin(a) * rad * S;
      const x = cx + u * cr - w * sr, y = cy + (u * sr + w * cr) / 2;
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const tw = Math.sin(t * 3 + ph);
      if (tw > -0.3) {
        subStars.push(x, y, tw > 0.6 ? 2 : 1, starHex1);
      }
    }

    const out = g.frame();
    out.rawVal = rawVal;
    out.subStars = subStars;
    return out;
  };
}
