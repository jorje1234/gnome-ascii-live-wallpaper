import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import { cover, shadeTester, restyle } from './glyphs.js';

export const CELL_W = 0.602;
const LV = {
    ' ': 0, '░': 0.25, '▒': 0.50, '▓': 0.75,
    '▁': 0.135, '▂': 0.257, '▃': 0.378, '▄': 0.51,
    '▅': 0.635, '▆': 0.757, '▇': 0.878, '█': 1,
};
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SIZES = [0.2, 0.5, 0.85, 1.32];

const rgbCache = new Map();
const lumCache = new Map();
const circleRectsCache = new Map();
let gridCache = null;
let powLutCache = { g: -1, lut: new Float32Array(256) };

function getPowLut(g) {
    if (Math.abs(powLutCache.g - g) < 1e-3)
        return powLutCache.lut;
    powLutCache.g = g;
    const lut = powLutCache.lut;
    for (let i = 0; i < 256; i++)
        lut[i] = Math.pow(i / 255, g) * 4 - 0.5;
    return lut;
}

export function parseRGB(hex, sat = 0) {
    if (!hex || hex[0] !== '#') hex = '#e4e4e7';
    const key = sat > 0 ? `${hex}:${sat}` : hex;
    let o = rgbCache.get(key);
    if (o) return o;
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    if (sat > 0) {
        const mx = Math.max(r, g, b, 1);
        const f = (255 / mx) * sat + (1 - sat);
        o = [Math.min(1, (r * f) / 255), Math.min(1, (g * f) / 255), Math.min(1, (b * f) / 255)];
    } else {
        o = [r / 255, g / 255, b / 255];
    }
    rgbCache.set(key, o);
    return o;
}

export function getLum(hex) {
    if (!hex) return 0.88;
    let v = lumCache.get(hex);
    if (v !== undefined) return v;
    const [r, g, b] = parseRGB(hex, 0);
    v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumCache.set(hex, v);
    return v;
}

function getCircleRects(d) {
    d = Math.max(1, Math.round(d));
    let cached = circleRectsCache.get(d);
    if (cached) return cached;
    if (d <= 3) {
        const h = d >> 1;
        cached = [[-h, -h, d, d]];
        circleRectsCache.set(d, cached);
        return cached;
    }
    const r = d / 2;
    const r2 = r * r;
    const spans = [];
    const halfFloor = Math.floor(r);
    for (let y = 0; y < d; y++) {
        const dy = (y + 0.5) - r;
        const dx = Math.sqrt(Math.max(0, r2 - dy * dy));
        const x0 = Math.round(r - dx);
        const x1 = Math.round(r + dx);
        if (x1 > x0)
            spans.push([y - halfFloor, x0 - halfFloor, x1 - x0]);
    }
    const rects = [];
    let i = 0;
    while (i < spans.length) {
        let j = i + 1;
        while (j < spans.length && spans[j][1] === spans[i][1] && spans[j][2] === spans[i][2])
            j++;
        rects.push([spans[i][1], spans[i][0], spans[i][2], j - i]);
        i = j;
    }
    circleRectsCache.set(d, rects);
    return rects;
}

function getGridCache(cols, rows, width, height, cw, ch, xOff, yOff, density) {
    const key = `${cols}x${rows}:${width}x${height}:${cw.toFixed(2)}:${density}`;
    if (gridCache && gridCache.key === key)
        return gridCache;

    const unit = Math.min(cw, ch);
    const step = unit / density;
    const W = cols * cw;
    const H = rows * ch;
    const gx = Math.max(1, Math.round(W / step));
    const gy = Math.max(1, Math.round(H / step));
    const sx = W / gx;
    const sy = H / gy;
    const maxPts = gx * gy;

    const screenX = new Int16Array(maxPts);
    const screenY = new Int16Array(maxPts);
    const i00 = new Int16Array(maxPts);
    const i10 = new Int16Array(maxPts);
    const i01 = new Int16Array(maxPts);
    const i11 = new Int16Array(maxPts);
    const ni = new Int16Array(maxPts);
    const w00 = new Float32Array(maxPts);
    const w10 = new Float32Array(maxPts);
    const w01 = new Float32Array(maxPts);
    const w11 = new Float32Array(maxPts);
    const bayer = new Float32Array(maxPts);

    let count = 0;
    for (let j = 0; j < gy; j++) {
        const py = (j + 0.5) * sy;
        const syScreen = Math.round(yOff + py);
        if (syScreen < -12 || syScreen > height + 12)
            continue;
        const fy = py / ch - 0.5;
        const r0 = Math.min(rows - 1, Math.max(0, Math.floor(fy)));
        const r1 = Math.min(rows - 1, r0 + 1);
        const ty = Math.min(1, Math.max(0, fy - r0));
        const nr = Math.min(rows - 1, Math.round(fy));

        for (let i = 0; i < gx; i++) {
            const px = (i + 0.5) * sx;
            const sxScreen = Math.round(xOff + px);
            if (sxScreen < -12 || sxScreen > width + 12)
                continue;
            const fx = px / cw - 0.5;
            const c0 = Math.min(cols - 1, Math.max(0, Math.floor(fx)));
            const c1 = Math.min(cols - 1, c0 + 1);
            const tx = Math.min(1, Math.max(0, fx - c0));
            const nc = Math.min(cols - 1, Math.round(fx));

            screenX[count] = sxScreen;
            screenY[count] = syScreen;
            i00[count] = r0 * cols + c0;
            i10[count] = r0 * cols + c1;
            i01[count] = r1 * cols + c0;
            i11[count] = r1 * cols + c1;
            ni[count] = nr * cols + nc;
            w00[count] = (1 - tx) * (1 - ty);
            w10[count] = tx * (1 - ty);
            w01[count] = (1 - tx) * ty;
            w11[count] = tx * ty;
            bayer[count] = (B4[(j & 3) * 4 + (i & 3)] + 0.5) / 16;
            count++;
        }
    }

    gridCache = {
        key, unit, count,
        screenX, screenY, i00, i10, i01, i11, ni,
        w00, w10, w01, w11, bayer,
        vals: new Float32Array(rows * cols),
        keys: new Array(rows * cols),
        hist: new Uint32Array(512),
    };
    return gridCache;
}

export function withParams(mod, values = {}) {
    const P = mod?.meta?.params;
    if (!P) return mod;
    const v = {};
    for (const [k, d] of Object.entries(P)) {
        const raw = values[k];
        if (d.type === 'number') {
            const n = Math.round(Number(raw));
            v[k] = Number.isFinite(n) && raw !== '' && raw !== null && raw !== undefined
                ? Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, n))
                : d.default;
        } else {
            const s = raw === undefined || raw === null
                ? d.default
                : String(raw).replace(/[^\x20-\x7e]/g, '').trim().slice(0, d.max || 40);
            v[k] = s || d.default;
        }
    }
    return { meta: mod.meta, default: () => mod.default(v), params: v };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s) => s.replace(/[&<>]/g, (c) => ESC[c]);

function frameToPango(frame, palette, ink = '#e4e4e7') {
    if (typeof frame === 'string')
        return `<span fgcolor="${ink}">${esc(frame)}</span>`;

    const T = frame.text.split('\n');
    const C = frame.color ? frame.color.split('\n') : null;
    let out = '';
    for (let y = 0; y < T.length; y++) {
        const t = [...T[y]];
        const c = C ? [...C[y]] : null;
        let run = '';
        let key = c ? c[0] : ' ';
        const flush = () => {
            if (!run) return;
            const hex = (key !== ' ' && palette && palette[key]) || ink;
            out += `<span fgcolor="${hex}">${esc(run)}</span>`;
            run = '';
        };
        for (let x = 0; x < t.length; x++) {
            const ck = c ? c[x] : ' ';
            if (ck !== key) {
                flush();
                key = ck;
            }
            run += t[x];
        }
        flush();
        if (y < T.length - 1) out += '\n';
    }
    return out;
}

export function renderFrame(cr, frame, meta, opts = {}) {
    const width = opts.width || 1920;
    const height = opts.height || 1080;
    const bg = opts.bg || '#040406';
    const ink = opts.ink || '#e4e4e7';
    const lookName = opts.look || 'dots';
    const fit = opts.fit || 'cover';

    const [bgR, bgG, bgB] = parseRGB(bg, 0);
    cr.setSourceRGB(bgR, bgG, bgB);
    cr.paint();

    const palette = frame.palette || meta.palette;
    const aspect = meta.cell === 'square' ? 1 : 1 / CELL_W;
    const cols = meta.cols || 104;
    const rows = meta.rows || 40;

    const margin = fit === 'cover' ? 1 : 0.90;
    const sx0 = (width * margin) / cols;
    const sy0 = (height * margin) / (rows * aspect);
    const cw = fit === 'cover' ? Math.max(sx0, sy0) : Math.min(sx0, sy0);
    const ch = cw * aspect;
    const xOff = (width - cols * cw) / 2;
    const yOff = (height - rows * ch) / 2;

    if (lookName === 'dots' || lookName === 'squares') {
        renderHalftoneFast(cr, frame, palette, {
            width, height, cols, rows, cw, ch, xOff, yOff, ink,
            isSquares: lookName === 'squares',
            dotSize: opts.dotSize ?? 0.51,
            density: opts.density ?? 1.31,
            contrast: opts.contrast ?? 0,
            mono: !!opts.mono,
            all: !!opts.all,
            tone: meta.dots || {},
        });
    } else {
        renderTextLook(cr, frame, palette, {
            width, height, cols, rows, cw, ch, xOff, yOff, ink,
            look: lookName,
            chars: opts.chars,
            mono: !!opts.mono,
            all: !!opts.all,
        });
    }
}

function renderHalftoneFast(cr, frame, palette, opts) {
    const {
        width, height, cols, rows, cw, ch, xOff, yOff, ink,
        isSquares, dotSize, density, contrast, mono, all, tone,
    } = opts;

    const gc = getGridCache(cols, rows, width, height, cw, ch, xOff, yOff, Math.max(0.3, density || 1.31));
    const { unit, count, screenX, screenY, i00, i10, i01, i11, ni, w00, w10, w01, w11, bayer, vals, keys, hist } = gc;

    const str = typeof frame === 'string';
    const rawCh = frame.rawCh;
    const rawCo = frame.rawCo;
    const rawVal = frame.rawVal;
    const subStars = frame.subStars;
    const text = [];
    const nCells = rows * cols;
    const pictureLike = all || cw === ch;

    if (rawVal && rawCo) {
        for (let i = 0; i < nCells; i++) {
            const k = rawCo[i];
            const hx = (k && k !== ' ' && palette && palette[k]) || ink;
            vals[i] = rawVal[i] * getLum(hx);
            keys[i] = hx;
        }
    } else if (rawCh && rawCo) {
        for (let i = 0; i < nCells; i++) {
            const gch = rawCh[i];
            if (gch === ' ') {
                vals[i] = -1;
                continue;
            }
            const k = rawCo[i];
            const hx = (k && k !== ' ' && palette && palette[k]) || ink;
            const code = gch.charCodeAt(0);
            if (!pictureLike && (code < 0x2580 || code > 0x259f)) {
                vals[i] = -1;
                const r = (i / cols) | 0;
                const c = i - r * cols;
                text.push(r, c, gch, hx);
                continue;
            }
            vals[i] = (LV[gch] ?? cover(gch) / 100) * getLum(hx);
            keys[i] = hx;
        }
    } else {
        const T = (str ? frame : frame.text).split('\n');
        const C = str || !frame.color ? null : frame.color.split('\n');
        const shade = pictureLike ? null : shadeTester(T);
        for (let r = 0; r < rows; r++) {
            const row = T[r] || '';
            const colRow = C ? C[r] : null;
            for (let c = 0; c < cols; c++) {
                const gch = row[c] || ' ';
                const i = r * cols + c;
                if (gch === ' ') {
                    vals[i] = -1;
                    continue;
                }
                const k = colRow ? colRow[c] : ' ';
                const hx = (k && k !== ' ' && palette && palette[k]) || ink;
                if (!pictureLike && !shade(gch)) {
                    vals[i] = -1;
                    text.push(r, c, gch, hx);
                    continue;
                }
                vals[i] = (LV[gch] ?? cover(gch) / 100) * getLum(hx);
                keys[i] = hx;
            }
        }
    }

    let vmax = 0;
    let n = 0;
    for (let i = 0; i < nCells; i++) {
        if (vals[i] > vmax) vmax = vals[i];
    }
    hist.fill(0);
    const invMax = 512 / (vmax || 1);
    for (let i = 0; i < nCells; i++) {
        if (vals[i] >= 0) {
            hist[Math.min(511, (vals[i] * invMax) | 0)]++;
            n++;
        }
    }
    const P = (q) => {
        let acc = 0;
        const want = q * n;
        for (let k = 0; k < 512; k++) {
            acc += hist[k];
            if (acc >= want) return ((k + 0.5) / 512) * vmax;
        }
        return vmax;
    };

    const lo = tone.lo ?? 0.04;
    const hi = tone.hi ?? 0.985;
    const gamma = 0.35 + (contrast / 100) * 0.8;
    const g = (tone.curve ?? 1.1) * Math.max(1, gamma / 0.35);
    const powLut = getPowLut(g);
    const sat = tone.sat ?? 0.85;
    const a = P(lo);
    const b = Math.max(P(hi), a + 1e-4);
    const invSpan255 = 255 / (b - a);

    const byColor = new Map();
    for (let p = 0; p < count; p++) {
        const idx00 = i00[p];
        const idxNi = ni[p];
        const v00 = vals[idx00];
        const vni = vals[idxNi];
        if (vni < 0 && v00 < 0) continue;
        const hx = mono ? ink : (keys[idxNi] || keys[idx00]);
        if (!hx) continue;

        const v10 = vals[i10[p]];
        const v01 = vals[i01[p]];
        const v11 = vals[i11[p]];
        const val = (v00 < 0 ? 0 : v00) * w00[p] +
                    (v10 < 0 ? 0 : v10) * w10[p] +
                    (v01 < 0 ? 0 : v01) * w01[p] +
                    (v11 < 0 ? 0 : v11) * w11[p];
        const tIdx = ((val - a) * invSpan255) | 0;
        if (tIdx <= 0) continue;
        const scaled = powLut[tIdx > 255 ? 255 : tIdx];
        let lvl = scaled < 0 ? -1 : (scaled | 0);
        if (scaled - lvl > bayer[p]) lvl++;
        if (lvl < 0) continue;
        if (lvl > 3) lvl = 3;

        let arr = byColor.get(hx);
        if (!arr) {
            arr = [];
            byColor.set(hx, arr);
        }
        arr.push(screenX[p], screenY[p], lvl);
    }

    const size = (dotSize || 0.51) / 0.85;
    const templates = SIZES.map(s => {
        const d = Math.max(1, Math.round(unit * size * s));
        if (isSquares) {
            const h = d >> 1;
            return [[-h, -h, d, d]];
        }
        return getCircleRects(d);
    });

    for (const [hx, arr] of byColor) {
        const [r, gg, bb] = parseRGB(hx, mono ? 0 : sat);
        cr.setSourceRGB(r, gg, bb);
        for (let k = 0; k < arr.length; k += 3) {
            const x = arr[k];
            const y = arr[k + 1];
            const rects = templates[arr[k + 2]];
            for (let m = 0; m < rects.length; m++) {
                const rc = rects[m];
                cr.rectangle(x + rc[0], y + rc[1], rc[2], rc[3]);
            }
        }
        cr.fill();
    }

    if (subStars && subStars.length) {
        for (let k = 0; k < subStars.length; k += 4) {
            const sx = Math.round(xOff + subStars[k] * cw);
            const sy = Math.round(yOff + subStars[k + 1] * ch);
            const stype = subStars[k + 2];
            const hx = mono ? ink : subStars[k + 3];
            const [rr, gg, bb] = parseRGB(hx, 0);
            cr.setSourceRGB(rr, gg, bb);
            if (stype === 2) {
                // Bright cross star (+ / *)
                const arm = Math.max(2, Math.round(unit * 0.28));
                const thk = Math.max(1, Math.round(unit * 0.10));
                const h = thk >> 1;
                cr.rectangle(sx - arm, sy - h, arm * 2 + 1, thk);
                cr.rectangle(sx - h, sy - arm, thk, arm * 2 + 1);
            } else if (stype === 1) {
                const d = Math.max(2, Math.round(unit * 0.20));
                const h = d >> 1;
                cr.rectangle(sx - h, sy - h, d, d);
            } else {
                const d = Math.max(1, Math.round(unit * 0.12));
                cr.rectangle(sx, sy, d, d);
            }
            cr.fill();
        }
    } else if (text.length) {
        cr.selectFontFace('DejaVu Sans Mono', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
        cr.setFontSize(cw / CELL_W);
        for (let k = 0; k < text.length; k += 4) {
            const r = text[k];
            const c = text[k + 1];
            const gch = text[k + 2];
            const hx = text[k + 3];
            const [rr, gg, bb] = parseRGB(mono ? ink : hx, 0);
            cr.setSourceRGB(rr, gg, bb);
            cr.moveTo(xOff + c * cw, yOff + (r + 0.78) * ch);
            cr.showText(gch);
        }
    }
}

function renderTextLook(cr, frame, palette, opts) {
    const { cols, rows, cw, ch, xOff, yOff, ink, look, chars, mono, all } = opts;
    const restyled = (look && look !== 'original') || chars || mono
        ? restyle(frame, palette, { look, chars, mono, all })
        : frame;
    const pal = restyled.palette || palette;
    const markup = frameToPango(restyled, pal, ink);

    const layout = PangoCairo.create_layout(cr);
    const fontPx = Math.max(6, Math.round((cw / CELL_W) * 0.75));
    layout.set_font_description(Pango.FontDescription.from_string(`DejaVu Sans Mono ${fontPx}`));
    layout.set_markup(markup, -1);

    const [, logicalRect] = layout.get_pixel_extents();
    const lw = logicalRect.width || 1;
    const lh = logicalRect.height || 1;
    const targetW = cols * cw;
    const targetH = rows * ch;

    cr.save();
    cr.translate(xOff, yOff);
    cr.scale(targetW / lw, targetH / lh);
    PangoCairo.show_layout(cr, layout);
    cr.restore();
}
