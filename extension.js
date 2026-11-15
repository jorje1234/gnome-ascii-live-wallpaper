import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { WorkspaceBackground } from 'resource:///org/gnome/shell/ui/workspace.js';
import { WorkspaceBackground as AnimWorkspaceBackground } from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { renderFrame, withParams } from './lib/renderer.js';
import { ensureUserPiecesEnv, resolvePieceFile } from './lib/pieceManager.js';
import { AsciiWallpaperIndicator } from './lib/quickToggle.js';

function getOverviewCloneClass() {
    if (globalThis.__AsciiOverviewWallpaperClone)
        return globalThis.__AsciiOverviewWallpaperClone;

    if (Clutter.Clone?.$gtype) {
        globalThis.__AsciiOverviewWallpaperClone = GObject.registerClass(
        class AsciiOverviewWallpaperClone extends Clutter.Clone {
            vfunc_get_preferred_width(_forHeight) {
                return [0, 0];
            }

            vfunc_get_preferred_height(_forWidth) {
                return [0, 0];
            }
        });
    } else {
        globalThis.__AsciiOverviewWallpaperClone = class AsciiOverviewWallpaperClone extends Clutter.Clone {};
    }
    return globalThis.__AsciiOverviewWallpaperClone;
}

export default class AsciiLiveWallpaperExtension extends Extension {
    enable() {
        this._actors = [];
        this._overviewClones = [];
        this._timerId = 0;
        this._reloadDebounceId = 0;
        this._elapsed = 0;
        this._lastTickUs = GLib.get_monotonic_time();
        this._drawFn = null;
        this._meta = null;
        this._currentFrame = null;
        this._origWbInit = null;
        this._origAnimWbCreateBg = null;
        this._overviewChildAddedId = 0;
        this._uiChildAddedId = 0;
        this._overviewShowingId = 0;
        this._settingsIds = [];

        this._settings = this.getSettings();
        this._powerMonitor = Gio.PowerProfileMonitor.dup_default();
        this._powerSaverId = this._powerMonitor.connect('notify::power-saver-enabled', () => {
            this._onPowerOrPauseChanged();
        });

        ensureUserPiecesEnv(this.dir);
        this._setupPiecesMonitor();

        this._indicator = new AsciiWallpaperIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                const cur = this._settings.get_boolean('enabled');
                this._settings.set_boolean('enabled', !cur);
            }
        );

        this._connectSettings();

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            if (this._isEnabled()) {
                this._rebuildActors();
                this._queueAllRepaints();
            }
        });

        this._bgChildAddedId = Main.layoutManager._backgroundGroup.connect('child-added', (_, child) => {
            if (!this._actors.includes(child)) {
                for (const actor of this._actors) {
                    if (actor.get_parent() === Main.layoutManager._backgroundGroup)
                        Main.layoutManager._backgroundGroup.set_child_above_sibling(actor, null);
                }
            }
        });

        if (this._isEnabled())
            this._activateWallpaper();
    }

    disable() {
        this._deactivateWallpaper();

        Main.wm.removeKeybinding('toggle-shortcut');

        if (this._reloadDebounceId) {
            GLib.source_remove(this._reloadDebounceId);
            this._reloadDebounceId = 0;
        }
        if (this._piecesMonitor) {
            this._piecesMonitor.cancel();
            this._piecesMonitor = null;
        }
        if (this._powerMonitor && this._powerSaverId) {
            this._powerMonitor.disconnect(this._powerSaverId);
            this._powerSaverId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._bgChildAddedId) {
            Main.layoutManager._backgroundGroup.disconnect(this._bgChildAddedId);
            this._bgChildAddedId = 0;
        }
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }

    _isEnabled() {
        return this._settings?.get_boolean('enabled') ?? false;
    }

    _readConfig() {
        const s = this._settings;
        let allParams = {};
        try {
            allParams = JSON.parse(s.get_string('piece-params') || '{}');
        } catch (_e) {}
        const slug = s.get_string('piece') || 'spiral-galaxy';

        return {
            piece: slug,
            look: s.get_string('look') || 'dots',
            chars: s.get_string('custom-chars') || '',
            fps: s.get_int('fps') || 30,
            renderScale: s.get_double('render-scale') || 0.65,
            speed: s.get_double('speed') || 1.0,
            fit: s.get_string('fit') || 'cover',
            bg: s.get_string('bg') || '#040406',
            ink: s.get_string('ink') || '#e4e4e7',
            dotSize: s.get_double('dot-size') || 0.51,
            density: s.get_double('density') || 1.31,
            contrast: s.get_int('contrast') || 0,
            mono: s.get_boolean('mono'),
            all: s.get_boolean('all-glyphs'),
            pauseWhenMaximized: s.get_boolean('pause-when-maximized'),
            pauseOnPowerSaver: s.get_boolean('pause-on-power-saver'),
            params: allParams[slug] || {},
        };
    }

    _connectSettings() {
        const s = this._settings;
        const on = (key, fn) => this._settingsIds.push(s.connect(`changed::${key}`, fn));

        on('enabled', () => {
            if (this._isEnabled())
                this._activateWallpaper();
            else
                this._deactivateWallpaper();
        });

        on('piece', () => {
            if (!this._isEnabled())
                return;
            this._loadPiece().then(() => {
                this._stepFrame(0);
                this._restartLoop();
            }).catch(e => console.error('[ascii-live-wallpaper] piece change error:', e));
        });

        on('piece-params', () => {
            if (!this._isEnabled())
                return;
            this._loadPiece().then(() => {
                this._stepFrame(0);
            }).catch(e => console.error('[ascii-live-wallpaper] params change error:', e));
        });

        on('fps', () => {
            if (!this._isEnabled())
                return;
            this._config = this._readConfig();
            this._restartLoop();
        });

        on('render-scale', () => {
            if (!this._isEnabled())
                return;
            this._config = this._readConfig();
            this._rebuildActors();
            this._queueAllRepaints();
        });

        for (const key of ['look', 'custom-chars', 'speed', 'fit', 'bg', 'ink', 'dot-size', 'density', 'contrast', 'mono', 'all-glyphs']) {
            on(key, () => {
                if (!this._isEnabled())
                    return;
                this._config = this._readConfig();
                this._queueAllRepaints();
            });
        }

        for (const key of ['pause-when-maximized', 'pause-on-power-saver']) {
            on(key, () => this._onPowerOrPauseChanged());
        }
    }

    _onPowerOrPauseChanged() {
        if (!this._isEnabled())
            return;
        this._config = this._readConfig();
        this._queueAllRepaints();
    }

    _setupPiecesMonitor() {
        try {
            const dir = ensureUserPiecesEnv(this.dir);
            this._piecesMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._piecesMonitor.connect('changed', (_mon, file, _other, eventType) => {
                if (!file || !file.get_basename().endsWith('.js'))
                    return;
                if (
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    eventType === Gio.FileMonitorEvent.DELETED
                ) {
                    if (this._reloadDebounceId)
                        GLib.source_remove(this._reloadDebounceId);
                    this._reloadDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                        this._reloadDebounceId = 0;
                        this._indicator?.refreshPieces();
                        const activeSlug = this._settings?.get_string('piece');
                        if (this._isEnabled() && file.get_basename() === `${activeSlug}.js`) {
                            this._loadPiece().then(() => this._stepFrame(0)).catch(console.error);
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        } catch (e) {
            console.error('[ascii-live-wallpaper] pieces monitor error:', e);
        }
    }

    _activateWallpaper() {
        this._config = this._readConfig();
        this._loadPiece().then(() => {
            if (!this._isEnabled())
                return;
            this._rebuildActors();
            this._patchWorkspaceBackground();
            this._startLoop();
        }).catch(e => console.error('[ascii-live-wallpaper] activate error:', e));
    }

    _deactivateWallpaper() {
        this._stopLoop();
        this._unpatchWorkspaceBackground();
        this._destroyActors();
        this._currentFrame = null;
        this._drawFn = null;
        this._meta = null;
    }

    async _loadPiece() {
        this._config = this._readConfig();
        const resolved = resolvePieceFile(this._config.piece, this.dir) || resolvePieceFile('spiral-galaxy', this.dir);
        if (!resolved) {
            console.error(`[ascii-live-wallpaper] Piece not found: ${this._config.piece}`);
            return;
        }
        const mod = await import(`${resolved.file.get_uri()}?v=${Date.now()}`);
        const wrapped = withParams(mod, this._config.params || {});
        this._meta = wrapped.meta;
        this._drawFn = wrapped.default();
    }

    _rebuildActors() {
        this._destroyActors();
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (!bgGroup)
            return;

        const scale = Math.max(0.35, Math.min(1.0, Number(this._config?.renderScale) || 0.65));

        for (const monitor of Main.layoutManager.monitors) {
            const surfW = Math.max(320, Math.round(monitor.width * scale));
            const surfH = Math.max(200, Math.round(monitor.height * scale));
            const sx = monitor.width / surfW;
            const sy = monitor.height / surfH;

            const area = new St.DrawingArea({
                name: `ascii-wallpaper-monitor-${monitor.index}`,
                x: monitor.x,
                y: monitor.y,
                width: surfW,
                height: surfH,
                scale_x: sx,
                scale_y: sy,
                reactive: false,
                can_focus: false,
            });
            area._monitor = monitor;
            area._surfW = surfW;
            area._surfH = surfH;
            area.connect('repaint', (a) => this._onRepaint(a));

            bgGroup.add_child(area);
            bgGroup.set_child_above_sibling(area, null);
            this._actors.push(area);
        }
        this._attachOverviewClones();
    }

    _destroyActors() {
        for (const clone of [...this._overviewClones]) {
            try {
                clone.destroy();
            } catch (_e) {}
        }
        this._overviewClones = [];

        for (const actor of this._actors) {
            try {
                actor.destroy();
            } catch (_e) {}
        }
        this._actors = [];
    }

    _queueAllRepaints() {
        for (const actor of this._actors)
            actor.queue_repaint();
    }

    _patchWorkspaceBackground() {
        const ext = this;

        if (!this._origWbInit) {
            const proto = WorkspaceBackground.prototype;
            this._origWbInit = proto._init;
            proto._init = function (...args) {
                ext._origWbInit.apply(this, args);
                ext._addCloneToWorkspaceBg(this);
            };
        }

        if (!this._origAnimWbCreateBg) {
            const animProto = AnimWorkspaceBackground.prototype;
            this._origAnimWbCreateBg = animProto._createBackground;
            animProto._createBackground = function (...args) {
                ext._origAnimWbCreateBg.apply(this, args);
                const container = this._bgManager?._container || this._bgManager?.container;
                ext._addCloneToBgContainer(container, this._monitor?.index, true);
            };
        }

        if (!this._overviewChildAddedId && Main.layoutManager.overviewGroup?.connect) {
            this._overviewChildAddedId = Main.layoutManager.overviewGroup.connect('child-added', (_g, child) => {
                this._attachBmsClones(child);
            });
        }
        if (!this._uiChildAddedId && Main.uiGroup?.connect) {
            this._uiChildAddedId = Main.uiGroup.connect('child-added', (_g, child) => {
                if (child?.name === 'bms-animation-backgroundgroup')
                    this._attachBmsClones(child);
            });
        }
        if (!this._overviewShowingId && Main.overview?.connect) {
            this._overviewShowingId = Main.overview.connect('showing', () => {
                this._attachBmsClones(Main.layoutManager.overviewGroup);
            });
        }

        this._attachOverviewClones();
    }

    _unpatchWorkspaceBackground() {
        if (this._origWbInit) {
            WorkspaceBackground.prototype._init = this._origWbInit;
            this._origWbInit = null;
        }
        if (this._origAnimWbCreateBg) {
            AnimWorkspaceBackground.prototype._createBackground = this._origAnimWbCreateBg;
            this._origAnimWbCreateBg = null;
        }
        if (this._overviewChildAddedId && Main.layoutManager.overviewGroup?.disconnect) {
            Main.layoutManager.overviewGroup.disconnect(this._overviewChildAddedId);
            this._overviewChildAddedId = 0;
        }
        if (this._uiChildAddedId && Main.uiGroup?.disconnect) {
            Main.uiGroup.disconnect(this._uiChildAddedId);
            this._uiChildAddedId = 0;
        }
        if (this._overviewShowingId && Main.overview?.disconnect) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
        }
    }

    _findWorkspaceBackgrounds(actor = Main.layoutManager.overviewGroup) {
        if (!actor)
            return [];
        if (actor instanceof WorkspaceBackground)
            return [actor];
        return (actor.get_children?.() ?? []).flatMap(c => this._findWorkspaceBackgrounds(c));
    }

    _addCloneToWorkspaceBg(wb) {
        if (!wb || !wb._backgroundGroup)
            return;
        this._addCloneToBgContainer(wb._backgroundGroup, wb._monitorIndex, false);
    }

    _addCloneToBgContainer(container, monitorIndex, fixedSize = false) {
        try {
            if (!container)
                return;
            const monitorActor = this._actors.find(a => a._monitor.index === monitorIndex) || this._actors[0];
            if (!monitorActor)
                return;

            const existing = container.get_children().find(c => c.name === 'ascii-overview-clone');
            if (existing)
                existing.destroy();

            const cloneProps = {
                name: 'ascii-overview-clone',
                source: monitorActor,
            };
            if (fixedSize) {
                cloneProps.x = 0;
                cloneProps.y = 0;
                cloneProps.width = monitorActor._monitor.width;
                cloneProps.height = monitorActor._monitor.height;
            } else {
                cloneProps.x_expand = true;
                cloneProps.y_expand = true;
            }

            const CloneCtor = fixedSize ? Clutter.Clone : getOverviewCloneClass();
            const clone = new CloneCtor(cloneProps);
            clone.connect('destroy', () => {
                const idx = this._overviewClones.indexOf(clone);
                if (idx !== -1)
                    this._overviewClones.splice(idx, 1);
            });
            container.add_child(clone);
            container.set_child_above_sibling(clone, null);
            this._overviewClones.push(clone);
        } catch (e) {
            console.error('[ascii-live-wallpaper] overview clone error:', e);
        }
    }

    _findBmsSources(actor) {
        if (!actor)
            return [];
        if (
            actor.name === 'bms-overview-blurred-widget-source' ||
            actor.name === 'bms-animation-blurred-widget-source'
        ) {
            return [actor];
        }
        return (actor.get_children?.() ?? []).flatMap(c => this._findBmsSources(c));
    }

    _attachBmsClones(root) {
        for (const source of this._findBmsSources(root)) {
            const bgChild = source.get_children().find(c => c.monitor !== undefined);
            const monitorIndex = bgChild ? bgChild.monitor : 0;
            const monitorActor = this._actors.find(a => a._monitor.index === monitorIndex) || this._actors[0];
            if (!monitorActor)
                continue;

            const existing = source.get_children().find(c => c.name === 'ascii-overview-clone');
            if (existing && existing.source === monitorActor) {
                source.set_child_above_sibling(existing, null);
                continue;
            }
            this._addCloneToBgContainer(source, monitorIndex, true);
        }
    }

    _attachOverviewClones() {
        for (const wb of this._findWorkspaceBackgrounds())
            this._addCloneToWorkspaceBg(wb);
        this._attachBmsClones(Main.layoutManager.overviewGroup);
        this._attachBmsClones(Main.uiGroup);
    }

    _onRepaint(area) {
        const cr = area.get_context();
        try {
            if (!this._currentFrame || !this._meta)
                return;
            const w = area._surfW || area.width;
            const h = area._surfH || area.height;
            renderFrame(cr, this._currentFrame, this._meta, {
                ...this._config,
                width: w,
                height: h,
            });
        } catch (e) {
            console.error('[ascii-live-wallpaper] repaint error:', e);
        } finally {
            cr.$dispose();
        }
    }

    _shouldPause() {
        if (Main.sessionMode?.isLocked)
            return true;
        if (this._config?.pauseOnPowerSaver && this._powerMonitor?.get_power_saver_enabled())
            return true;
        if (!this._config?.pauseWhenMaximized)
            return false;
        if (Main.overview.visible)
            return false;

        const ws = global.workspace_manager.get_active_workspace();
        if (!ws)
            return false;

        for (const win of ws.list_windows()) {
            if (!win.showing_on_its_workspace() || win.minimized)
                continue;
            if (win.get_window_type() !== Meta.WindowType.NORMAL)
                continue;
            if (
                win.is_fullscreen?.() ||
                win.is_maximized?.() ||
                (win.maximized_horizontally && win.maximized_vertically)
            ) {
                return true;
            }
        }
        return false;
    }

    _stepFrame(dtSec) {
        if (!this._drawFn || !this._meta)
            return;
        const speed = Number(this._config?.speed) || 1.0;
        this._elapsed += dtSec * speed;
        try {
            this._currentFrame = this._drawFn(this._elapsed);
        } catch (e) {
            console.error('[ascii-live-wallpaper] drawFn error:', e);
            return;
        }
        this._queueAllRepaints();
    }

    _startLoop() {
        this._stopLoop();
        if (!this._isEnabled())
            return;
        const fps = Math.max(5, Math.min(60, Number(this._config?.fps) || 30));
        const intervalMs = Math.round(1000 / fps);
        this._lastTickUs = GLib.get_monotonic_time();

        this._stepFrame(0);

        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            const nowUs = GLib.get_monotonic_time();
            const dtSec = Math.min(0.25, (nowUs - this._lastTickUs) / 1e6);
            this._lastTickUs = nowUs;

            if (!this._shouldPause())
                this._stepFrame(dtSec);

            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopLoop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _restartLoop() {
        this._startLoop();
    }
}
