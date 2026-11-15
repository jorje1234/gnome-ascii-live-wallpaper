# GNOME ASCII Live Wallpaper

![Spiral Galaxy in Halftone Dots](assets/demo.gif)

A lightweight, native **GNOME Shell (46–51)** animated ASCII art & **Halftone Dots** wallpaper extension for Wayland and X11.

Instead of spawning heavy video players (`mpv` / WebKit), it renders procedural ASCII animations directly inside GNOME Shell's `_backgroundGroup` layer using ~10–12 MB of RAM, and mirrors seamlessly into the Activities Overview.

---

## Features

- **1-Click ON / OFF Toggle:** Switch the live wallpaper on or off anytime from **GNOME Quick Settings** (top-right panel menu), `Super + Alt + A`, or the Preferences window — drops to **0% CPU** when turned off.
- **11 Visual Looks + Custom Characters:** Switch styles live from Quick Settings or Preferences:
  - **Geometric:** `dots` (Halftone Dots), `squares` (Halftone Squares), `blocks` (`░▒▓█`), `lines` (`╌─━═`), `dither`
  - **Text / Typography:** `ascii` (Classic), `dense` (High-detail), `letters`, `numbers`, `binary` (`0`/`1`), `original`, plus optional **custom character ramps** (e.g. `" .oO@*"`)
- **FPS & Resolution Controls:** Adjust **FPS (5–60)** and **Render Resolution Scale (35%–100%)** live from the GUI to trade quality for battery/CPU.
- **Built-in ASCII Magic Importer:** Paste any URL or slug from [ascii-magic.com](https://www.ascii-magic.com/ascii) or pick from the curated browser right inside Preferences.
- **Load Your Own Designs (`.js` or `.txt`):** Import custom `kit.js` animations or plain `.txt` ASCII art files via the file picker — `.txt` files are automatically wrapped into live color-shimmering wallpapers.
- **Smart Auto-Pause:** Automatically pauses at 0% CPU when a window is maximized/fullscreen, the screen is locked, or GNOME **Power Saver** mode is active.

---

## Where to Get Designs

1. **ASCII Magic Gallery (Animated `.js` pieces):** Browse hundreds of animated pieces at **[ascii-magic.com/ascii](https://www.ascii-magic.com/ascii)** — copy any piece URL (e.g. `https://www.ascii-magic.com/ascii/black-hole`) or name (`black-hole`), paste it in **Preferences → Designs → Download**, and click **Download**.
2. **ASCII Magic Studio (Create / Convert):** Create or convert your own artwork at **[ascii-magic.com/ascii/studio](https://www.ascii-magic.com/ascii/studio)** and import the exported `.js` file via **Browse...** in Preferences.
3. **Plain Text ASCII Art (`.txt`):** Grab any static ASCII art (from [asciiart.eu](https://www.asciiart.eu), `ascii-image-converter`, `jp2a`, or any text editor) and load the `.txt` file via **Preferences → Designs → Browse...** (or `ascii-wallpaper set ./my-art.txt`). It is automatically converted into an animated piece that works in Halftone Dots, Letters, Binary, etc.
4. **Write Your Own Procedural Animation:** See [CONTRIBUTING.md](CONTRIBUTING.md) for the 15-line `kit.js` template and how to share designs via Pull Request.

---

## Installation

```bash
git clone https://github.com/jorje1234/gnome-ascii-live-wallpaper.git
cd gnome-ascii-live-wallpaper
chmod +x install.sh
./install.sh
```

> **Note for Wayland users:** Log out and back in once after first install so GNOME Shell discovers the new extension.

---

## Usage

### Graphical Interface (Recommended)
1. Open **Quick Settings** (top-right corner) → click **ASCII Wallpaper** to toggle ON/OFF, or click its arrow `>` to switch designs, **Style (Look)**, **FPS**, or open **Settings & Designs...**.
2. Or run:
   ```bash
   gnome-extensions prefs gnome-ascii-live-wallpaper@github
   ```

### Optional CLI
```bash
ascii-wallpaper on | off | toggle
ascii-wallpaper set spiral-galaxy
ascii-wallpaper set https://www.ascii-magic.com/ascii/black-hole
ascii-wallpaper set ./my-art.txt
ascii-wallpaper look letters        # dots, squares, ascii, dense, letters, numbers, binary, blocks, lines, dither, original
ascii-wallpaper look ascii " .oO@"  # custom character ramp
ascii-wallpaper fps 30
ascii-wallpaper scale 0.65
ascii-wallpaper prefs
```

---

## Credits & License

- Built on the procedural ASCII toolkit (`kit.js`, `glyphs.js`) and MIT-licensed pieces from [ascii-magic.com](https://www.ascii-magic.com/ascii).
- Released under the [MIT License](LICENSE).
