/**
 * @parsbank/design-system — token catalogue, ornament and artwork, plus the
 * compiler that turns a token set into CSS custom properties.
 *
 * The applications never hard-code a colour, a radius or a size. They reference
 * `var(--prs-…)`, and the variables are produced from:
 *
 *   1. this catalogue (the shipped baseline), then
 *   2. the *published* theme version from the CMS (overrides, additive only).
 *
 * A design administrator can therefore restyle the product without being able to
 * touch a single line of monetary logic — the two planes meet only here, in a
 * dictionary of strings.
 */
export * from './tokens.ts';
export * from './patterns.ts';
export * from './artwork.ts';

import { DESIGN_TOKENS, type DesignTokenDefinition } from './tokens.ts';

/** `color.primary.600` → `--prs-color-primary-600` */
export function tokenCssVar(key: string): string {
  return `--prs-${key.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '')}`;
}

/** The shipped baseline, as a flat key → value map. */
export function defaultTokenValues(): Record<string, string> {
  return Object.fromEntries(DESIGN_TOKENS.map((token) => [token.key, token.value]));
}

export interface CompiledTheme {
  values: Record<string, string>;
  css: string;
  unknownKeys: string[];
}

/**
 * Compiles a theme: baseline ⊕ published overrides. Unknown keys from the CMS are
 * reported rather than silently injected, so a typo cannot smuggle an arbitrary
 * custom property (or a `url(...)`) into every page.
 */
export function compileTheme(overrides: Record<string, string> = {}): CompiledTheme {
  const values = defaultTokenValues();
  const unknownKeys: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in values)) {
      unknownKeys.push(key);
      continue;
    }
    values[key] = value;
  }

  // Custom properties may reference other custom properties; resolve one pass of
  // `var(--prs-…)` so a themed value inherits the themed parent, not the baseline.
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = value.replace(/var\((--prs-[a-z0-9-]+)\)/g, (_match, reference: string) => {
      const target = reference.replace(/^--prs-/, '').replace(/-/g, '.');
      const found = values[target];
      if (found !== undefined) return found;
      // fall back to a lookup by scanning keys (handles `.` inside key segments)
      const matchingKey = Object.keys(values).find((candidate) => tokenCssVar(candidate) === reference);
      return matchingKey ? values[matchingKey]! : reference;
    });
  }

  const css = `:root{\n${Object.entries(resolved)
    .map(([key, value]) => `  ${tokenCssVar(key)}:${value};`)
    .join('\n')}\n}`;

  return { values: resolved, css, unknownKeys };
}

/** JSON view used by the admin design inspector. */
export function tokenInspectorView(overrides: Record<string, string> = {}): DesignTokenDefinition[] {
  return DESIGN_TOKENS.map((token) => ({
    ...token,
    value: overrides[token.key] ?? token.value,
  }));
}

/** Media query breakpoints, shared by CSS and the layout components. */
export const BREAKPOINTS = {
  mobile: 0,
  tablet: 720,
  laptop: 1024,
  desktop: 1280,
  wide: 1520,
} as const;

/** Z-index scale — fixed, so stacking never becomes a negotiation. */
export const Z_INDEX = {
  base: 0,
  content: 10,
  header: 100,
  sidebar: 110,
  dropdown: 200,
  overlay: 900,
  modal: 1000,
  toast: 1100,
} as const;

/**
 * Density presets for the dashboard. "Comfortable" is the default; the
 * administrative plane uses "compact" because auditors read long tables.
 */
export const DENSITY = {
  comfortable: { rowHeight: '56px', fieldHeight: '44px', panelPadding: '24px' },
  compact: { rowHeight: '44px', fieldHeight: '38px', panelPadding: '16px' },
} as const;
