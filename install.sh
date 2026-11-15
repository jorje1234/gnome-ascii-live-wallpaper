#!/usr/bin/env bash
set -euo pipefail

UUID="gnome-ascii-live-wallpaper@github"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
BIN_DIR="$HOME/.local/bin"
USER_CONFIG="$HOME/.config/ascii-wallpaper"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing GNOME ASCII Live Wallpaper ($UUID)..."

mkdir -p "$DEST" "$BIN_DIR" "$USER_CONFIG/pieces"

# Copy extension files
cp "$ROOT/metadata.json" "$ROOT/extension.js" "$ROOT/prefs.js" "$DEST/"
rm -rf "$DEST/lib" "$DEST/pieces" "$DEST/schemas"
cp -r "$ROOT/lib" "$ROOT/pieces" "$ROOT/schemas" "$DEST/"

# Compile GSettings schemas
glib-compile-schemas "$DEST/schemas"

# Link lib for user pieces in ~/.config/ascii-wallpaper/pieces
ln -sfn "$DEST/lib" "$USER_CONFIG/lib"

# Install CLI helper
install -m 755 "$ROOT/cli/ascii-wallpaper" "$BIN_DIR/ascii-wallpaper"

# Disable legacy prototype UUID if present
if gnome-extensions info ascii-wallpaper@papu >/dev/null 2>&1; then
  gnome-extensions disable ascii-wallpaper@papu >/dev/null 2>&1 || true
fi

# Enable extension (if Wayland hasn't rescanned yet, register in GSettings for next login)
if ! gnome-extensions enable "$UUID" >/dev/null 2>&1; then
  if command -v gsettings >/dev/null 2>&1; then
    current=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "[]")
    updated=$(python3 -c "import ast, sys; arr = ast.literal_eval(sys.argv[1]); arr.append('$UUID') if '$UUID' not in arr else None; print(arr)" "$current" 2>/dev/null || echo "")
    [[ -n "$updated" ]] && gsettings set org.gnome.shell enabled-extensions "$updated" >/dev/null 2>&1 || true
  fi
fi

echo ""
echo "Done!"
echo "- On Wayland, log out and log back in (or reboot) once so GNOME Shell detects the new extension."
echo "- Then toggle it anytime from Quick Settings, Super+Alt+A, 'gnome-extensions prefs $UUID', or 'ascii-wallpaper'."
