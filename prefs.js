import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    deleteUserPiece,
    downloadFromAsciiMagic,
    ensureUserPiecesEnv,
    listAllPieces,
    loadBundledCatalog,
    saveUserPiece,
    slugifyName,
    wrapTxtAsPiece,
} from './lib/pieceManager.js';

const LOOK_OPTIONS = [
    ['dots', 'Halftone Dots'],
    ['squares', 'Halftone Squares'],
    ['original', 'Original Glyphs'],
    ['blocks', 'Shade Blocks'],
    ['ascii', 'Classic ASCII'],
    ['dense', 'Dense ASCII'],
    ['lines', 'Lines'],
    ['dither', 'Dither'],
    ['numbers', 'Numbers'],
    ['binary', 'Binary (0/1)'],
    ['letters', 'Letters'],
];

const FIT_OPTIONS = [
    ['cover', 'Cover (Fill Screen)'],
    ['contain', 'Contain (Fit Inside)'],
];

function createSliderRow({ title, subtitle, min, max, step, digits, formatValue, value, onChanged }) {
    const row = new Adw.ActionRow({ title, subtitle });
    const valueLabel = new Gtk.Label({
        label: formatValue(value),
        width_chars: 8,
        xalign: 1,
        css_classes: ['dim-label', 'numeric'],
    });

    const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, min, max, step);
    scale.set_draw_value(false);
    scale.set_digits(digits);
    scale.set_size_request(180, -1);
    scale.set_valign(Gtk.Align.CENTER);
    scale.set_value(value);

    scale.connect('value-changed', () => {
        const v = scale.get_value();
        valueLabel.label = formatValue(v);
        onChanged(v);
    });

    row.add_suffix(scale);
    row.add_suffix(valueLabel);
    row._scale = scale;
    return row;
}

function createComboRow({ title, subtitle, options, selectedValue, onChanged }) {
    const model = new Gtk.StringList();
    for (const [, label] of options)
        model.append(label);

    const row = new Adw.ComboRow({ title, subtitle, model });
    const idx = Math.max(0, options.findIndex(([val]) => val === selectedValue));
    row.set_selected(idx);

    row.connect('notify::selected', () => {
        const i = row.get_selected();
        if (i >= 0 && i < options.length)
            onChanged(options[i][0]);
    });
    return row;
}

function createColorRow({ title, subtitle, hex, onChanged }) {
    const row = new Adw.ActionRow({ title, subtitle });
    const rgba = new Gdk.RGBA();
    rgba.parse(hex || '#040406');

    const dialog = new Gtk.ColorDialog({ with_alpha: false });
    const btn = new Gtk.ColorDialogButton({
        dialog,
        rgba,
        valign: Gtk.Align.CENTER,
    });

    btn.connect('notify::rgba', () => {
        const c = btn.get_rgba();
        const toHex = (f) => Math.round(Math.max(0, Math.min(1, f)) * 255).toString(16).padStart(2, '0');
        onChanged(`#${toHex(c.red)}${toHex(c.green)}${toHex(c.blue)}`);
    });

    row.add_suffix(btn);
    return row;
}

export default class AsciiLiveWallpaperPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(680, 720);
        const settings = this.getSettings();
        ensureUserPiecesEnv(this.dir);

        const toast = (msg) => {
            window.add_toast(new Adw.Toast({ title: msg, timeout: 3 }));
        };

        /* ── Page 1: Designs ──────────────────────────────────────── */
        const designsPage = new Adw.PreferencesPage({
            title: 'Designs',
            icon_name: 'applications-graphics-symbolic',
        });

        const statusGroup = new Adw.PreferencesGroup();
        const enableRow = new Adw.SwitchRow({
            title: 'Enable Live Wallpaper',
            subtitle: 'Toggle ON/OFF anytime from Quick Settings or Super+Alt+A',
        });
        settings.bind('enabled', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        statusGroup.add(enableRow);
        designsPage.add(statusGroup);

        const importGroup = new Adw.PreferencesGroup({
            title: 'Add New Design',
            description: 'Download directly from ascii-magic.com or load your own .js / .txt ASCII art',
        });

        const urlRow = new Adw.EntryRow({
            title: 'URL or slug (e.g. black-hole)',
        });
        const downloadBtn = new Gtk.Button({
            label: 'Download',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        urlRow.add_suffix(downloadBtn);

        let installedGroup = null;
        const doDownload = async (input) => {
            if (!input.trim())
                return;
            downloadBtn.sensitive = false;
            downloadBtn.label = 'Loading...';
            try {
                const slug = await downloadFromAsciiMagic(input, this.dir);
                settings.set_string('piece', slug);
                settings.set_boolean('enabled', true);
                urlRow.text = '';
                rebuildInstalledList();
                toast(`Installed & activated "${slug}"`);
            } catch (e) {
                toast(e.message || 'Failed to download piece');
            } finally {
                downloadBtn.sensitive = true;
                downloadBtn.label = 'Download';
            }
        };
        downloadBtn.connect('clicked', () => doDownload(urlRow.text));
        urlRow.connect('entry-activated', () => doDownload(urlRow.text));
        importGroup.add(urlRow);

        const localFileRow = new Adw.ActionRow({
            title: 'Load Local File (.js or .txt)',
            subtitle: 'Supports ascii-magic .js modules or plain .txt ASCII art',
        });
        const browseBtn = new Gtk.Button({
            label: 'Browse...',
            valign: Gtk.Align.CENTER,
        });
        browseBtn.connect('clicked', () => {
            const filter = new Gtk.FileFilter();
            filter.set_name('ASCII Pieces (*.js, *.txt)');
            filter.add_pattern('*.js');
            filter.add_pattern('*.txt');
            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);

            const dialog = new Gtk.FileDialog({
                title: 'Select ASCII Art (.js or .txt)',
                filters,
            });
            dialog.open(window, null, (_dlg, res) => {
                try {
                    const file = dialog.open_finish(res);
                    if (!file)
                        return;
                    const [ok, bytes] = file.load_contents(null);
                    if (!ok)
                        return;
                    const text = new TextDecoder().decode(bytes);
                    const base = file.get_basename();
                    const slug = slugifyName(base);

                    if (base.toLowerCase().endsWith('.txt')) {
                        const wrapped = wrapTxtAsPiece(text, slug, base.replace(/\.txt$/i, ''));
                        saveUserPiece(slug, wrapped, this.dir);
                    } else {
                        saveUserPiece(slug, text, this.dir);
                    }
                    settings.set_string('piece', slug);
                    settings.set_boolean('enabled', true);
                    rebuildInstalledList();
                    toast(`Loaded "${slug}"`);
                } catch (e) {
                    if (!String(e.message || '').includes('Dismissed'))
                        toast(`Import error: ${e.message}`);
                }
            });
        });
        localFileRow.add_suffix(browseBtn);
        importGroup.add(localFileRow);

        const catalogExpander = new Adw.ExpanderRow({
            title: 'Browse Popular ASCII Magic Pieces',
            subtitle: 'One-click install from the curated online catalog',
        });
        const catalog = loadBundledCatalog(this.dir);
        for (const item of catalog) {
            const row = new Adw.ActionRow({
                title: item.name,
                subtitle: `${item.category} · ${item.note}`,
            });
            const installBtn = new Gtk.Button({
                label: 'Use',
                valign: Gtk.Align.CENTER,
            });
            installBtn.connect('clicked', () => doDownload(item.slug));
            row.add_suffix(installBtn);
            catalogExpander.add_row(row);
        }
        importGroup.add(catalogExpander);
        designsPage.add(importGroup);

        installedGroup = new Adw.PreferencesGroup({
            title: 'Installed Designs',
            description: 'Click any design to apply it immediately',
        });
        let installedRows = [];
        const rebuildInstalledList = () => {
            for (const r of installedRows)
                installedGroup.remove(r);
            installedRows = [];

            const activeSlug = settings.get_string('piece');
            const pieces = listAllPieces(this.dir);
            for (const p of pieces) {
                const isActive = p.slug === activeSlug;
                const row = new Adw.ActionRow({
                    title: p.name,
                    subtitle: `${p.isUser ? 'Custom / Downloaded' : 'Built-in'} · ${p.category}`,
                    activatable: true,
                });

                if (isActive) {
                    const check = new Gtk.Image({
                        icon_name: 'object-select-symbolic',
                        css_classes: ['accent'],
                    });
                    row.add_suffix(check);
                }

                if (p.isUser) {
                    const delBtn = new Gtk.Button({
                        icon_name: 'user-trash-symbolic',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['flat'],
                        tooltip_text: 'Remove custom design',
                    });
                    delBtn.connect('clicked', () => {
                        deleteUserPiece(p.slug);
                        if (settings.get_string('piece') === p.slug)
                            settings.set_string('piece', 'spiral-galaxy');
                        rebuildInstalledList();
                        toast(`Removed "${p.slug}"`);
                    });
                    row.add_suffix(delBtn);
                }

                row.connect('activated', () => {
                    settings.set_string('piece', p.slug);
                    if (!settings.get_boolean('enabled'))
                        settings.set_boolean('enabled', true);
                    rebuildInstalledList();
                });

                installedGroup.add(row);
                installedRows.push(row);
            }
        };
        rebuildInstalledList();
        const pieceChangedId = settings.connect('changed::piece', () => rebuildInstalledList());
        designsPage.add(installedGroup);

        /* ── Page 2: Style ────────────────────────────────────────── */
        const stylePage = new Adw.PreferencesPage({
            title: 'Style',
            icon_name: 'preferences-color-symbolic',
        });

        const lookGroup = new Adw.PreferencesGroup({ title: 'Visual Look' });
        lookGroup.add(createComboRow({
            title: 'Render Style',
            subtitle: 'Halftone dots render crisp geometric circles at any resolution',
            options: LOOK_OPTIONS,
            selectedValue: settings.get_string('look'),
            onChanged: (v) => settings.set_string('look', v),
        }));
        lookGroup.add(createComboRow({
            title: 'Screen Fit',
            subtitle: 'Cover fills the whole monitor; Contain shows the entire frame',
            options: FIT_OPTIONS,
            selectedValue: settings.get_string('fit'),
            onChanged: (v) => settings.set_string('fit', v),
        }));

        const monoRow = new Adw.SwitchRow({
            title: 'Monochrome Mode',
            subtitle: 'Use a single ink color instead of the piece palette',
        });
        settings.bind('mono', monoRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        lookGroup.add(monoRow);

        const allGlyphsRow = new Adw.SwitchRow({
            title: 'Dot-Convert All Characters',
            subtitle: 'Render stars and punctuation as dots too instead of text glyphs',
        });
        settings.bind('all-glyphs', allGlyphsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        lookGroup.add(allGlyphsRow);
        stylePage.add(lookGroup);

        const tuningGroup = new Adw.PreferencesGroup({ title: 'Halftone &amp; Colors' });
        tuningGroup.add(createSliderRow({
            title: 'Dot Size',
            subtitle: 'Diameter multiplier of halftone dots',
            min: 0.20, max: 1.20, step: 0.02, digits: 2,
            value: settings.get_double('dot-size'),
            formatValue: (v) => v.toFixed(2),
            onChanged: (v) => settings.set_double('dot-size', v),
        }));
        tuningGroup.add(createSliderRow({
            title: 'Grid Density',
            subtitle: 'Higher values create a finer dot matrix',
            min: 0.50, max: 2.00, step: 0.05, digits: 2,
            value: settings.get_double('density'),
            formatValue: (v) => v.toFixed(2),
            onChanged: (v) => settings.set_double('density', v),
        }));
        tuningGroup.add(createSliderRow({
            title: 'Contrast',
            subtitle: 'Tone curve contrast (-50 to +50)',
            min: -50, max: 50, step: 1, digits: 0,
            value: settings.get_int('contrast'),
            formatValue: (v) => `${Math.round(v)}`,
            onChanged: (v) => settings.set_int('contrast', Math.round(v)),
        }));
        tuningGroup.add(createColorRow({
            title: 'Background Color',
            subtitle: 'Backdrop fill behind the ASCII canvas',
            hex: settings.get_string('bg'),
            onChanged: (hex) => settings.set_string('bg', hex),
        }));
        tuningGroup.add(createColorRow({
            title: 'Ink Color',
            subtitle: 'Fallback and monochrome foreground color',
            hex: settings.get_string('ink'),
            onChanged: (hex) => settings.set_string('ink', hex),
        }));
        stylePage.add(tuningGroup);

        /* ── Page 3: Performance ──────────────────────────────────── */
        const perfPage = new Adw.PreferencesPage({
            title: 'Performance',
            icon_name: 'preferences-system-symbolic',
        });

        const renderGroup = new Adw.PreferencesGroup({
            title: 'FPS &amp; Resolution',
            description: 'Balance visual smoothness against CPU usage',
        });

        const fpsRow = createSliderRow({
            title: 'Frame Rate (FPS)',
            subtitle: 'Lower values save CPU and battery; 24–30 is smooth for most pieces',
            min: 5, max: 60, step: 1, digits: 0,
            value: settings.get_int('fps'),
            formatValue: (v) => `${Math.round(v)} FPS`,
            onChanged: (v) => settings.set_int('fps', Math.round(v)),
        });
        renderGroup.add(fpsRow);

        const fpsPresetRow = new Adw.ActionRow({
            title: 'FPS Quick Presets',
            subtitle: 'One-click frame rate targets',
        });
        const fpsBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        for (const p of [15, 24, 30, 60]) {
            const b = new Gtk.Button({ label: `${p}` });
            b.connect('clicked', () => fpsRow._scale.set_value(p));
            fpsBox.append(b);
        }
        fpsPresetRow.add_suffix(fpsBox);
        renderGroup.add(fpsPresetRow);

        const scaleRow = createSliderRow({
            title: 'Render Resolution Scale',
            subtitle: 'Internal canvas scale upscaled by GPU (0.5x–0.7x saves ~2x–4x CPU)',
            min: 0.35, max: 1.00, step: 0.05, digits: 2,
            value: settings.get_double('render-scale'),
            formatValue: (v) => `${Math.round(v * 100)}%`,
            onChanged: (v) => settings.set_double('render-scale', Number(v.toFixed(2))),
        });
        renderGroup.add(scaleRow);

        const scalePresetRow = new Adw.ActionRow({
            title: 'Resolution Presets',
            subtitle: 'Recommended presets for 1080p / 1440p / 4K displays',
        });
        const scaleBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        for (const [val, label] of [[0.50, 'Low (50%)'], [0.65, 'Balanced (65%)'], [1.00, 'Native (100%)']]) {
            const b = new Gtk.Button({ label });
            b.connect('clicked', () => scaleRow._scale.set_value(val));
            scaleBox.append(b);
        }
        scalePresetRow.add_suffix(scaleBox);
        renderGroup.add(scalePresetRow);

        renderGroup.add(createSliderRow({
            title: 'Animation Speed',
            subtitle: 'Time playback multiplier',
            min: 0.2, max: 2.5, step: 0.05, digits: 2,
            value: settings.get_double('speed'),
            formatValue: (v) => `${v.toFixed(2)}x`,
            onChanged: (v) => settings.set_double('speed', Number(v.toFixed(2))),
        }));
        perfPage.add(renderGroup);

        const powerGroup = new Adw.PreferencesGroup({ title: 'Smart Power Saving' });
        const maxPauseRow = new Adw.SwitchRow({
            title: 'Pause When Windows Cover Desktop',
            subtitle: 'Automatically pauses at 0% CPU when a window is maximized or screen is locked',
        });
        settings.bind('pause-when-maximized', maxPauseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        powerGroup.add(maxPauseRow);

        const saverPauseRow = new Adw.SwitchRow({
            title: 'Pause in Power Saver Mode',
            subtitle: 'Automatically pauses when GNOME Power Saver profile is active',
        });
        settings.bind('pause-on-power-saver', saverPauseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        powerGroup.add(saverPauseRow);

        const infoRow = new Adw.ActionRow({
            title: 'Custom Designs Folder',
            subtitle: GLib.build_filenamev([GLib.get_user_config_dir(), 'ascii-wallpaper', 'pieces']),
        });
        powerGroup.add(infoRow);
        perfPage.add(powerGroup);

        window.add(designsPage);
        window.add(stylePage);
        window.add(perfPage);

        window.connect('close-request', () => {
            settings.disconnect(pieceChangedId);
            return false;
        });
    }
}
