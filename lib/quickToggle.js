import GObject from 'gi://GObject';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { listAllPieces } from './pieceManager.js';

const FPS_PRESETS = [15, 24, 30, 60];
const QUICK_LOOKS = [
    ['dots', 'Halftone Dots'],
    ['squares', 'Halftone Squares'],
    ['ascii', 'Classic ASCII'],
    ['dense', 'Dense ASCII'],
    ['letters', 'Letters'],
    ['numbers', 'Numbers'],
    ['binary', 'Binary (0/1)'],
    ['blocks', 'Shade Blocks'],
    ['lines', 'Lines'],
    ['dither', 'Dither'],
    ['original', 'Original'],
];

const AsciiWallpaperToggle = GObject.registerClass(
class AsciiWallpaperToggle extends QuickSettings.QuickMenuToggle {
    _init(ext) {
        super._init({
            title: 'ASCII Wallpaper',
            iconName: 'utilities-terminal-symbolic',
            toggleMode: true,
        });

        this._ext = ext;
        this._settings = ext.getSettings();

        this.menu.setHeader('utilities-terminal-symbolic', 'GNOME ASCII Live Wallpaper');

        this._piecesSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._piecesSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._lookSubmenu = new PopupMenu.PopupSubMenuMenuItem('Style (Look)');
        this._lookItems = new Map();
        for (const [val, label] of QUICK_LOOKS) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                this._settings.set_string('look', val);
            });
            this._lookSubmenu.menu.addMenuItem(item);
            this._lookItems.set(val, item);
        }
        this.menu.addMenuItem(this._lookSubmenu);

        this._fpsSubmenu = new PopupMenu.PopupSubMenuMenuItem('Frame Rate (FPS)');
        this._fpsItems = new Map();
        for (const fps of FPS_PRESETS) {
            const item = new PopupMenu.PopupMenuItem(`${fps} FPS`);
            item.connect('activate', () => {
                this._settings.set_int('fps', fps);
            });
            this._fpsSubmenu.menu.addMenuItem(item);
            this._fpsItems.set(fps, item);
        }
        this.menu.addMenuItem(this._fpsSubmenu);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefsItem = new PopupMenu.PopupMenuItem('Settings & Designs...');
        prefsItem.connect('activate', () => {
            this.menu.close();
            this._ext.openPreferences();
        });
        this.menu.addMenuItem(prefsItem);

        this._syncing = false;
        this.connect('notify::checked', () => {
            if (this._syncing)
                return;
            this._settings.set_boolean('enabled', this.checked);
        });

        this._settingsIds = [
            this._settings.connect('changed::enabled', () => this.sync()),
            this._settings.connect('changed::piece', () => this.sync()),
            this._settings.connect('changed::look', () => this.sync()),
            this._settings.connect('changed::fps', () => this.sync()),
        ];

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._rebuildPieceMenu();
        });

        this._rebuildPieceMenu();
        this.sync();
    }

    _rebuildPieceMenu() {
        this._piecesSection.removeAll();
        const currentSlug = this._settings.get_string('piece');
        const pieces = listAllPieces(this._ext.dir);

        for (const p of pieces.slice(0, 14)) {
            const item = new PopupMenu.PopupMenuItem(p.name);
            item.setOrnament(p.slug === currentSlug ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', () => {
                this._settings.set_string('piece', p.slug);
                if (!this._settings.get_boolean('enabled'))
                    this._settings.set_boolean('enabled', true);
            });
            this._piecesSection.addMenuItem(item);
        }
    }

    sync() {
        const enabled = this._settings.get_boolean('enabled');
        const slug = this._settings.get_string('piece');
        const look = this._settings.get_string('look');
        const fps = this._settings.get_int('fps');

        this._syncing = true;
        this.checked = enabled;
        this._syncing = false;

        const niceName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        this.subtitle = enabled ? `${niceName} · ${fps} FPS` : 'Off';

        for (const [val, item] of this._lookItems)
            item.setOrnament(val === look ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        const lookEntry = QUICK_LOOKS.find(([v]) => v === look);
        this._lookSubmenu.label.text = `Style (${lookEntry ? lookEntry[1] : look})`;

        for (const [val, item] of this._fpsItems)
            item.setOrnament(val === fps ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
        this._fpsSubmenu.label.text = `Frame Rate (${fps} FPS)`;
    }

    destroy() {
        if (this._settingsIds) {
            for (const id of this._settingsIds)
                this._settings.disconnect(id);
            this._settingsIds = [];
        }
        super.destroy();
    }
});

export const AsciiWallpaperIndicator = GObject.registerClass(
class AsciiWallpaperIndicator extends QuickSettings.SystemIndicator {
    _init(ext) {
        super._init();
        this._toggle = new AsciiWallpaperToggle(ext);
        this.quickSettingsItems.push(this._toggle);
    }

    refreshPieces() {
        this._toggle?._rebuildPieceMenu();
        this._toggle?.sync();
    }

    destroy() {
        this._toggle?.destroy();
        this._toggle = null;
        super.destroy();
    }
});
