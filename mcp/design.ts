import opentype, { type Font } from 'opentype.js';
import { z } from 'zod';
import { AMOUNT_MAX, EFFECTS, type Control, type EffectId } from '../src/core/effects';
import { isEmptyBox } from '../src/core/geom';
import { buildScene, viewBox, type DesignState } from '../src/core/render';
import { parseText } from '../src/core/text';
import { assignDeep, cleanSettings, FONTS, fontFile, PRESETS, type FontId } from '../src/state';

const fontNames = Object.keys(FONTS) as FontId[];
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex color such as #ff5930');

const effects = Object.fromEntries(EFFECTS.map(({ id, label, controls }) => {
  const fields = Object.entries(controls as Record<string, Control>).map(([key, control]) => {
    const field = control.options
      ? z.enum(Object.values(control.options))
      : z.number().min(control.min ?? -1).max(control.max ?? 1);
    return [key, field.describe(control.label ?? key)];
  });
  return [id, z.strictObject({
    ...Object.fromEntries(fields),
    enabled: z.boolean().describe(`Enable ${label}`),
    scope: z.enum(['block', 'line', 'glyph']),
    amount: z.number().min(0).max(AMOUNT_MAX),
  }).partial().describe(label)];
}));

const settingsSchema = z.strictObject({
  type: z.strictObject({
    font: z.enum(fontNames),
    weight: z.number().int().min(400).max(1000),
    textCase: z.enum(['as-typed', 'upper', 'sentence', 'lower']),
    tracking: z.number().min(-0.2).max(0.5),
    leading: z.number().min(-0.5).max(0.5),
    leadingMode: z.enum(['optical', 'metric']),
    stretchX: z.number().min(0.4).max(1.8),
    align: z.enum(['left', 'center', 'right']),
    fit: z.number().min(0).max(1),
    stepRatio: z.number().min(1).max(2.5),
    detail: z.number().min(0.5).max(6).multipleOf(0.1),
  }).partial(),
  color: z.strictObject({ background: color, text: color, highlight: color }).partial(),
  effects: z.strictObject(effects).partial(),
  output: z.strictObject({
    aspect: z.enum(['fit', '1:1', '4:5', '3:4', '16:9', '9:16']),
    padding: z.number().min(0).max(0.5),
    transparent: z.boolean(),
  }).partial(),
}).partial();

const text = z.string().min(1).max(240).describe(
  'Up to 240 characters and 12 lines. Use *word* for highlights and prefix lines with ^ or ~ to change their size.',
);

export const renderInput = z.strictObject({
  text,
  preset: z.enum(Object.keys(PRESETS)).optional().describe('A built-in style from list_presets.'),
  settings: settingsSchema.optional().describe('Overrides for the preset or default style.'),
});

export function resolveDesign({ text, preset, settings }: z.infer<typeof renderInput>): DesignState {
  const state = cleanSettings(preset ? PRESETS[preset] : undefined);
  const font = settings?.type?.font;
  if (font && font !== state.type.font && settings?.type?.weight === undefined) {
    state.type.weight = FONTS[font].defaultWeight;
  }
  assignDeep(state, settings);
  state.text = text;
  return cleanSettings(state);
}

export function describePresets() {
  return Object.entries(PRESETS).map(([name, preset]) => {
    const design = cleanSettings(preset);
    return {
      name,
      font: FONTS[design.type.font as FontId].label,
      effects: EFFECTS.filter(({ id }) => design.effects[id as EffectId].enabled).map(({ label }) => label),
      colors: design.color,
    };
  });
}

export type LoadFont = (file: string) => Promise<ArrayBuffer>;

const fonts = new Map<string, Font>();

async function getFont(file: string, loadFont: LoadFont): Promise<Font> {
  let font = fonts.get(file);
  if (!font) {
    font = opentype.parse(await loadFont(file));
    fonts.set(file, font);
  }
  return font;
}

export class RenderError extends Error {}

export async function renderDesign(design: DesignState, loadFont: LoadFont) {
  const lines = parseText(design.text);
  if (lines.length > 12) throw new RenderError('Use at most 12 lines of text.');
  if (lines.some(({ step }) => Math.abs(step) > 6 || design.type.stepRatio ** Math.abs(step) > 8)) {
    throw new RenderError('Reduce the number of ^ or ~ marks on a line, or lower the step ratio.');
  }
  const font = await getFont(fontFile(design.type.font as FontId, design.type.weight), loadFont);
  const scene = buildScene(font, design);
  if (isEmptyBox(scene.ink)) throw new RenderError('Provide text with visible lettering.');
  if (scene.glyphs.some(({ contours }) => contours.some((points) => !points.every(Number.isFinite)))) {
    throw new RenderError('These settings distort the lettering too far. Try reducing the effect amounts.');
  }
  const box = viewBox(scene, design);
  const width = Math.round(box[2]);
  const height = Math.round(box[3]);
  if (!box.every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new RenderError('These settings produce an unusable canvas. Try increasing the padding or reducing the effect amounts.');
  }
  return { scene, width, height };
}
