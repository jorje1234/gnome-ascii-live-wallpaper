# GNOME ASCII Live Wallpaper

A lightweight, native **GNOME Shell (46–51)** animated ASCII art & **Halftone Dots** wallpaper extension for Wayland and X11.

Instead of spawning heavy video players (`mpv` / WebKit), it renders procedural ASCII animations directly inside GNOME Shell's `_backgroundGroup` layer using ~10–12 MB of RAM, and mirrors seamlessly into the Activities Overview.

---

## Features

- **1-Click ON / OFF Toggle:** Switch the live wallpaper on or off anytime from **GNOME Quick Settings** (top-right panel menu), `Super + Alt + A`, or the Preferences window — drops to **0% CPU** when turned off.
- **Halftone Dots & 10 Visual Looks:** Render crisp geometric halftone circles (`dots`), `squares`, `blocks`, `ascii`, `dense`, `lines`, `dither`, `numbers`, `binary`, `letters`, or `original`.
- **FPS & Resolution Controls:** Adjust **FPS (5–60)** and **Render Resolution Scale (35%–100%)** live from the GUI to trade quality for battery/CPU.
- **Built-in ASCII Magic Importer:** Paste any URL or slug from [ascii-magic.com](https://www.ascii-magic.com/ascii) (e.g. `black-hole`) or pick from the curated browser right inside Preferences.
- **Load Your Own Designs (`.js` or `.txt`):** Import custom `kit.js` animations or plain `.txt` ASCII art files via the file picker — `.txt` files are automatically wrapped into live color-shimmering wallpapers.
- **Smart Auto-Pause:** Automatically pauses at 0% CPU when a window is maximized/fullscreen, the screen is locked, or GNOME **Power Saver** mode is active.

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
1. Open **Quick Settings** (top-right corner) -> click **ASCII Wallpaper** to toggle ON/OFF, or click its arrow `>` to switch designs, change FPS, or open **Settings & Designs...**.
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
ascii-wallpaper fps 30
ascii-wallpaper scale 0.65
ascii-wallpaper look dots
ascii-wallpaper prefs
```

---

## Credits & License

- Built on the procedural ASCII toolkit (`kit.js`, `glyphs.js`) and MIT-licensed pieces from [ascii-magic.com](https://www.ascii-magic.com/ascii).
- Released under the [MIT License](LICENSE).
