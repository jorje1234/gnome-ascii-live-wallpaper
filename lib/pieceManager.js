import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const ASCII_MAGIC_BASE = 'https://www.ascii-magic.com/ascii/pieces/';

/**
 * Return the writable directory in ~/.config/ascii-wallpaper/pieces/
 * where downloaded and custom user pieces are stored across updates.
 */
export function getUserPiecesDir() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'ascii-wallpaper', 'pieces']);
}

/**
 * Ensure ~/.config/ascii-wallpaper/pieces exists and ~/.config/ascii-wallpaper/lib
 * symlinks to the extension's lib directory so `import ... from "../lib/kit.js"`
 * works identically for both built-in and user-imported pieces.
 */
export function ensureUserPiecesEnv(extDir) {
    const piecesPath = getUserPiecesDir();
    const piecesDir = Gio.File.new_for_path(piecesPath);
    if (!piecesDir.query_exists(null))
        piecesDir.make_directory_with_parents(null);

    if (extDir) {
        const configRoot = piecesDir.get_parent();
        const libLinkPath = GLib.build_filenamev([configRoot.get_path(), 'lib']);
        const libTargetPath = extDir.get_child('lib').get_path();
        const linkFile = Gio.File.new_for_path(libLinkPath);
        try {
            const info = linkFile.query_info('standard::symlink-target,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            if (info.get_file_type() === Gio.FileType.SYMBOLIC_LINK) {
                if (info.get_symlink_target() !== libTargetPath) {
                    linkFile.delete(null);
                    linkFile.make_symbolic_link(libTargetPath, null);
                }
            }
        } catch (_e) {
            try {
                linkFile.make_symbolic_link(libTargetPath, null);
            } catch (_e2) {}
        }
    }
    return piecesDir;
}

/**
 * Normalize a user input (full ascii-magic URL or bare slug) into a safe piece slug.
 */
export function parsePieceSlug(raw) {
    return String(raw || '')
        .trim()
        .replace(/^https?:\/\/[^/]+\/ascii\/(pieces\/)?/i, '')
        .replace(/\.js(\?.*)?$/i, '')
        .replace(/[^a-z0-9-]/gi, '')
        .toLowerCase();
}

/**
 * Sanitize filename base for local imports.
 */
export function slugifyName(filename) {
    return String(filename || 'custom-art')
        .replace(/\.(js|txt|ansi)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'custom-art';
}

/**
 * Resolve the Gio.File for a piece slug, preferring user pieces over built-in pieces.
 */
export function resolvePieceFile(slug, extDir) {
    const clean = parsePieceSlug(slug) || 'spiral-galaxy';
    const userFile = Gio.File.new_for_path(GLib.build_filenamev([getUserPiecesDir(), `${clean}.js`]));
    if (userFile.query_exists(null))
        return { file: userFile, isUser: true };

    if (extDir) {
        const builtinFile = extDir.resolve_relative_path(`pieces/${clean}.js`);
        if (builtinFile.query_exists(null))
            return { file: builtinFile, isUser: false };
    }
    return null;
}

/**
 * Extract lightweight metadata from a piece JS source without importing it into the UI thread.
 */
export function extractPieceMetadata(source, fallbackSlug) {
    const strMatch = (key) => {
        const re = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`);
        const m = source.match(re);
        return m ? m[1] : null;
    };
    const slug = strMatch('slug') || fallbackSlug;
    const name = strMatch('name') || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const category = strMatch('category') || 'custom';
    const note = strMatch('note') || '';
    return { slug, name, category, note };
}

/**
 * List all available pieces (built-in + user pieces, deduplicated by slug with user overriding).
 */
export function listAllPieces(extDir) {
    const bySlug = new Map();

    const scanDir = (dirFile, isUser) => {
        if (!dirFile || !dirFile.query_exists(null))
            return;
        try {
            const en = dirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null)) !== null) {
                const fname = info.get_name();
                if (!fname.endsWith('.js'))
                    continue;
                const slug = fname.slice(0, -3);
                const child = dirFile.get_child(fname);
                try {
                    const [ok, bytes] = child.load_contents(null);
                    if (!ok)
                        continue;
                    const src = new TextDecoder().decode(bytes);
                    const meta = extractPieceMetadata(src, slug);
                    bySlug.set(slug, {
                        ...meta,
                        slug,
                        isUser,
                        path: child.get_path(),
                    });
                } catch (_e) {}
            }
        } catch (_e) {}
    };

    if (extDir)
        scanDir(extDir.get_child('pieces'), false);
    scanDir(Gio.File.new_for_path(getUserPiecesDir()), true);

    return Array.from(bySlug.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load curated catalog bundled with the extension.
 */
export function loadBundledCatalog(extDir) {
    try {
        const file = extDir.resolve_relative_path('lib/catalog.json');
        const [ok, bytes] = file.load_contents(null);
        if (ok)
            return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_e) {}
    return [];
}

/**
 * Rewrite relative kit imports in external .js pieces so they resolve cleanly
 * against the extension's lib/kit.js when stored in ~/.config/ascii-wallpaper/pieces/.
 */
export function normalizeJsPieceSource(source, extDir) {
    if (!source || !source.includes('export') || (!source.includes('meta') && !source.includes('default')))
        throw new Error('File does not look like a valid ASCII Magic piece module.');

    const kitUri = extDir ? extDir.resolve_relative_path('lib/kit.js').get_uri() : '../lib/kit.js';
    return source.replace(
        /from\s+["'](?:\.\.\/lib\/kit\.js|\.\/kit\.js|https?:\/\/[^"']*\/kit\.js)["']/g,
        `from "${kitUri}"`
    );
}

/**
 * Wrap any plain-text (.txt) ASCII art into an animated kit.js module
 * with optional shimmer/pulse/wave animation parameter.
 */
export function wrapTxtAsPiece(rawText, slug, displayName) {
    const cleanText = String(rawText || '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');
    const lines = cleanText.split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '')
        lines.pop();

    if (!lines.length)
        throw new Error('The selected text file is empty.');

    const rows = Math.min(80, lines.length);
    const trimmed = lines.slice(0, rows);
    const cols = Math.min(200, Math.max(10, ...trimmed.map(l => l.length)));
    const padded = trimmed.map(l => l.slice(0, cols).padEnd(cols, ' '));
    const escapedLines = JSON.stringify(padded);
    const safeName = JSON.stringify(displayName || slug);

    return `/* Custom ASCII art imported from text file */
import { Grid, palette, gradient, KEYS } from "../lib/kit.js";

const PAL = gradient(["#4c6ef5", "#74c0fc", "#ffffff", "#f783ac"], 12);

export const meta = {
  slug: ${JSON.stringify(slug)},
  name: ${safeName},
  category: "custom",
  note: "Imported custom ASCII text artwork.",
  tags: ["custom", "imported"],
  cols: ${cols},
  rows: ${rows},
  fps: 18,
  palette: palette(PAL),
  params: {
    motion: { label: "Ambient Motion", type: "select", options: ["shimmer", "wave", "static"], default: "shimmer" }
  }
};

const LINES = ${escapedLines};

export default function create(params = {}) {
  const { cols, rows } = meta;
  const g = new Grid(cols, rows);
  const motion = params.motion || "shimmer";

  return (t) => {
    g.clear();
    for (let y = 0; y < rows; y++) {
      const row = LINES[y] || "";
      const yShift = motion === "wave" ? Math.round(Math.sin(t * 2 + y * 0.35) * 1.2) : 0;
      for (let x = 0; x < cols; x++) {
        const ch = row[x];
        if (!ch || ch === " ") continue;
        const dx = (x + yShift + cols) % cols;
        const phase = motion === "static"
          ? (x / cols) * 0.8
          : 0.5 + 0.5 * Math.sin(t * 1.8 + x * 0.09 + y * 0.16);
        const ci = Math.min(PAL.length - 1, Math.floor(phase * PAL.length));
        g.set(dx, y, ch, KEYS[ci]);
      }
    }
    return g.frame();
  };
}
`;
}

/**
 * Save a piece source string into ~/.config/ascii-wallpaper/pieces/<slug>.js
 */
export function saveUserPiece(slug, source, extDir) {
    ensureUserPiecesEnv(extDir);
    const normalized = normalizeJsPieceSource(source, extDir);
    const target = Gio.File.new_for_path(GLib.build_filenamev([getUserPiecesDir(), `${slug}.js`]));
    target.replace_contents(
        new TextEncoder().encode(normalized),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null
    );
    return target;
}

/**
 * Delete a user-installed piece (built-in pieces cannot be deleted).
 */
export function deleteUserPiece(slug) {
    const clean = parsePieceSlug(slug);
    const target = Gio.File.new_for_path(GLib.build_filenamev([getUserPiecesDir(), `${clean}.js`]));
    if (target.query_exists(null))
        return target.delete(null);
    return false;
}

/**
 * Download a piece JS module asynchronously from ascii-magic.com using libsoup 3.0.
 */
export async function downloadFromAsciiMagic(rawInput, extDir) {
    const slug = parsePieceSlug(rawInput);
    if (!slug)
        throw new Error('Please enter a valid piece name or ascii-magic.com URL.');

    const Soup = (await import('gi://Soup?version=3.0')).default;
    const session = new Soup.Session();
    const url = `${ASCII_MAGIC_BASE}${slug}.js`;
    const msg = Soup.Message.new('GET', url);

    const bytes = await new Promise((resolve, reject) => {
        session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                const status = msg.get_status();
                const data = sess.send_and_read_finish(res);
                if (status < 200 || status >= 300) {
                    reject(new Error(`Piece "${slug}" was not found on ascii-magic.com (HTTP ${status}).`));
                    return;
                }
                resolve(data);
            } catch (e) {
                reject(e);
            }
        });
    });

    const source = new TextDecoder().decode(bytes.get_data());
    saveUserPiece(slug, source, extDir);
    return slug;
}
