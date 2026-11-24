import type { DesignState } from './core/render';
import { cleanSettings, type DeepPartial } from './state';

/* The user's saved presets, kept in localStorage next to the autosave, plus the file format used to share them.
   Every mutation re-reads storage first and applies the change by id, so two open tabs don't erase each other's work. */

export interface UserPreset {
  id: string;
  name: string;
  /** Stored as written. Only cleaned when applied, so an older tab re-saving the list can't strip newer fields. */
  settings: DeepPartial<DesignState>;
}

const KEY = 'warp-and-shear:presets:v1';
const BACKUP_KEY = 'warp-and-shear:presets:backup';
const VERSION = 1;
const APP = 'warp-and-shear';
export const NAME_MAX = 60;

let presets: UserPreset[] = [];
/** Set when stored data exists but couldn't be read: writing would replace it, so saving is blocked instead. */
let unreadable = false;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function cleanName(name: unknown, fallback = 'Untitled'): string {
  const s = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
  return s || fallback;
}

function read(): UserPreset[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return presets; // storage blocked: keep working in memory for this session
  }
  if (!raw) {
    unreadable = false;
    return [];
  }
  try {
    const data = JSON.parse(raw) as { version?: unknown; presets?: unknown };
    if (data.version !== VERSION || !Array.isArray(data.presets)) throw new Error('unknown format');
    unreadable = false;
    return data.presets.flatMap((p: Partial<UserPreset>) =>
      p && typeof p === 'object' && typeof p.id === 'string' && p.settings && typeof p.settings === 'object'
        ? [{ id: p.id, name: cleanName(p.name), settings: p.settings }]
        : [],
    );
  } catch {
    unreadable = true;
    return presets;
  }
}

/** Re-read, apply `fn`, write back. Returns an error message, or null on success. */
function mutate(fn: (list: UserPreset[]) => void): string | null {
  presets = read();
  if (unreadable) return "Saved presets in this browser couldn't be read, so they weren't changed.";
  fn(presets);
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, presets }));
    return null;
  } catch {
    return 'Browser storage is unavailable: presets will last only until you close this tab.';
  }
}

export function loadLibrary(): { presets: UserPreset[]; error: string | null } {
  presets = read();
  return {
    presets,
    error: unreadable ? "Saved presets in this browser couldn't be read. They're left untouched." : null,
  };
}

export const list = () => presets;

/** Way out of an unreadable library: keep the old data under a backup key, then start an empty one. */
export function startFresh(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) localStorage.setItem(BACKUP_KEY, raw);
    localStorage.removeItem(KEY);
  } catch {
    return 'Browser storage is unavailable.';
  }
  unreadable = false;
  presets = [];
  return null;
}

/** "Name", or "Name (2)", "Name (3)"… if taken (case-insensitive). */
export function uniqueName(name: string, taken = presets.map((p) => p.name)): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const base = name.replace(/\s\(\d+\)$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, NAME_MAX - 5)} (${i})`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

export function addPreset(name: string, settings: unknown): { preset: UserPreset | null; error: string | null } {
  let preset: UserPreset | null = null;
  const error = mutate((l) => {
    const p = { id: newId(), name: uniqueName(cleanName(name), l.map((x) => x.name)), settings: cleanSettings(settings) };
    l.push(p);
    preset = p;
  });
  return { preset, error };
}

export function renamePreset(id: string, name: string): string | null {
  return mutate((l) => {
    const p = l.find((x) => x.id === id);
    if (!p) return;
    const clean = cleanName(name, p.name);
    if (clean !== p.name) p.name = uniqueName(clean, l.filter((x) => x.id !== id).map((x) => x.name));
  });
}

export function deletePreset(id: string): { removed: UserPreset | null; index: number; error: string | null } {
  let removed: UserPreset | null = null;
  let index = -1;
  const error = mutate((l) => {
    index = l.findIndex((x) => x.id === id);
    if (index >= 0) removed = l.splice(index, 1)[0];
  });
  return { removed, index, error };
}

/** Undo a delete: put it back where it was, unless it's already there (another tab may have changed the list). */
export function restorePreset(preset: UserPreset, index: number): string | null {
  return mutate((l) => {
    if (l.some((x) => x.id === preset.id)) return;
    l.splice(Math.max(0, Math.min(index, l.length)), 0, preset);
  });
}

/* ---------------- files ---------------- */

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'preset'
  );
}

export function presetFile(p: UserPreset): string {
  return JSON.stringify({ app: APP, kind: 'preset', version: VERSION, name: p.name, settings: p.settings }, null, 2);
}

export function libraryFile(): string {
  return JSON.stringify(
    { app: APP, kind: 'presets', version: VERSION, presets: presets.map((p) => ({ name: p.name, settings: p.settings })) },
    null,
    2,
  );
}

/**
 * Read a preset file: one preset, a whole library, or a settings file from before presets existed
 * (a bare design state, as the old "Save settings" wrote). Throws with a readable message otherwise.
 */
export function parseFile(text: string, fileName: string): { name: string; settings: DesignState }[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("it isn't valid JSON");
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error("it isn't a Warp & Shear file");
  const d = data as Record<string, unknown>;
  const fallback = cleanName(fileName.replace(/\.json$/i, ''), 'Imported');

  if ('kind' in d || 'app' in d) {
    if (d.app !== APP) throw new Error("it isn't a Warp & Shear file");
    if (typeof d.version !== 'number' || d.version > VERSION)
      throw new Error('it was made by a newer version of Warp & Shear');
    const entry = (e: unknown) => {
      const r = e as { name?: unknown; settings?: unknown } | null;
      return r && typeof r.settings === 'object' && r.settings
        ? [{ name: cleanName(r.name, fallback), settings: cleanSettings(r.settings) }]
        : [];
    };
    if (d.kind === 'preset') {
      const one = entry(d);
      if (!one.length) throw new Error('the preset in it is empty');
      return one;
    }
    if (d.kind === 'presets' && Array.isArray(d.presets)) return d.presets.flatMap(entry);
    throw new Error("it isn't a preset file");
  }

  if (['text', 'type', 'color', 'effects', 'output'].some((k) => k in d)) {
    return [{ name: fallback, settings: cleanSettings(d) }];
  }
  throw new Error("it isn't a Warp & Shear file");
}

/** Add imported presets, skipping exact duplicates (same name and settings) so restoring a backup twice is harmless. */
export function importPresets(entries: { name: string; settings: DesignState }[]): {
  added: UserPreset[];
  skipped: number;
  error: string | null;
} {
  const added: UserPreset[] = [];
  let skipped = 0;
  const error = mutate((l) => {
    for (const e of entries) {
      const json = JSON.stringify(e.settings);
      if (l.some((p) => p.name === e.name && JSON.stringify(cleanSettings(p.settings)) === json)) {
        skipped++;
        continue;
      }
      const p = { id: newId(), name: uniqueName(e.name, l.map((x) => x.name)), settings: e.settings };
      l.push(p);
      added.push(p);
    }
  });
  return { added, skipped, error };
}
