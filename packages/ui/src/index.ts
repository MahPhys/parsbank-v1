/**
 * @parsbank/ui — the public surface of the component kit.
 *
 * Applications import from here only; the kit has no dependency on either app and
 * never imports from apps/*, which keeps the two frontends independently buildable.
 */
export * from './format.ts';
export * from './icons.tsx';
export * from './primitives.tsx';
export * from './chrome.tsx';
