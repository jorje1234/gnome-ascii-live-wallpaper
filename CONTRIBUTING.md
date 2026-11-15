# Creating & Sharing Custom Designs

Anyone can load their own animated or static ASCII wallpaper in **GNOME ASCII Live Wallpaper** without touching system folders.

## Option 1: Plain `.txt` ASCII Art (No Coding)

1. Save any ASCII art text file (e.g. `my-art.txt`).
2. Open Extension Preferences -> **Designs** -> **Load Local File (.js or .txt)**.
3. Pick `my-art.txt` — the extension wraps it automatically into a live piece with gentle color shimmer and makes it work in **Halftone Dots**, **Blocks**, **ASCII**, etc.

## Option 2: Procedural Animated `.js` Piece

Create a small ES module using `../lib/kit.js` (`Grid`, `palette`, `gradient`, `KEYS`, `fbm`, `rng`, `clamp`, `TAU`):

```js
import { Grid, palette, gradient, KEYS } from "../lib/kit.js";

const PAL = gradient(["#0b1026", "#3b82f6", "#e0f2fe"], 10);

export const meta = {
  slug: "blue-pulse",
  name: "Blue Pulse",
  category: "demoscene",
  note: "Minimal radial pulse.",
  cols: 100,
  rows: 40,
  fps: 30,
  palette: palette(PAL),
};

export default function create() {
  const { cols, rows } = meta;
  const g = new Grid(cols, rows);
  const cx = cols / 2, cy = rows / 2;

  return (t) => {
    g.clear();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x - cx, (y - cy) * 2);
        const v = 0.5 + 0.5 * Math.sin(d * 0.35 - t * 2.5);
        const ci = Math.min(PAL.length - 1, Math.floor(v * PAL.length));
        g.set(x, y, "▓", KEYS[ci]);
      }
    }
    return g.frame();
  };
}
```

Load it via **Browse...** in Preferences or drop it into `~/.config/ascii-wallpaper/pieces/`.

## Sharing Your Piece with the Community

Want to include your animation in the default repository?
1. Fork the repository.
2. Add your `.js` file under `pieces/` (keeping it self-contained with `../lib/kit.js`).
3. Open a Pull Request!
