/**
 * Generates the PWA icons and the Open Graph card from the brand tokens.
 *
 * These are the only binary assets in the repo, so this exists to say where
 * they came from and to make a palette change a one-command regeneration
 * rather than an afternoon in a design tool.
 *
 * Requires ImageMagick 7 (`magick`). Not part of `npm run build` — the outputs
 * are committed, and a build should not depend on a system tool that most CI
 * images lack.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Colours are the Aurora Ledger tokens from `frontend/src/styles.css`. If they
 * change there, change them here and re-run; nothing reads them automatically,
 * which is a deliberate trade against parsing CSS at build time.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const TEAL = '#2dd4bf';
const VIOLET = '#8b5cf6';
const INK = '#0a0e14';
const MUTED = '#9aa3b2';
const PAPER = '#e6e9ef';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'frontend/public');
const ICONS = join(PUBLIC, 'icons');
const WORK = join(tmpdir(), `actuo-brand-${process.pid}`);

const magick = (...args) => execFileSync('magick', args.map(String), { stdio: 'inherit' });

/** The "A": a solid wedge with a counter, drawn at a 512-unit scale. */
function glyph(scale, dx, dy) {
  const p = (x, y) => `${Math.round(x * scale + dx)},${Math.round(y * scale + dy)}`;
  return [
    '-draw',
    `polygon ${p(256, 126)} ${p(356, 386)} ${p(300, 386)} ${p(278, 326)} ` +
      `${p(234, 326)} ${p(212, 386)} ${p(156, 386)}`,
    '-draw',
    `rectangle ${p(244, 238)} ${p(268, 262)}`,
  ];
}

mkdirSync(ICONS, { recursive: true });
mkdirSync(WORK, { recursive: true });

const grad = join(WORK, 'grad.png');
const mask = join(WORK, 'mask.png');
const tile = join(WORK, 'tile.png');

// The aurora gradient, teal to violet on the diagonal (Design Doc §2.2).
magick('-size', '512x512', '-define', 'gradient:angle=135', `gradient:${TEAL}-${VIOLET}`, grad);
// A rounded-square alpha mask, corner radius matching the app's `rounded-lg` feel.
magick('-size', '512x512', 'xc:none', '-fill', 'white',
  '-draw', 'roundrectangle 0,0 511,511 112,112', mask);
magick(grad, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', tile);

// Regular icons: rounded, because the launcher shows them as-is.
const rounded = join(WORK, 'rounded.png');
magick(tile, '-fill', INK, ...glyph(1, 0, 0), rounded);
for (const size of [192, 512]) {
  magick(rounded, '-resize', `${size}x${size}`, join(ICONS, `icon-${size}.png`));
}
magick(rounded, '-resize', '180x180', join(ICONS, 'apple-touch-icon.png'));

/*
 * Maskable: full-bleed, no rounded corners — the platform applies its own mask,
 * and baking ours in leaves visible dark corners inside a circular cutout. The
 * glyph is scaled to 60% and centred so it survives the most aggressive crop
 * (the safe zone is the middle 80%).
 */
const inset = 512 * 0.2;
magick(grad, '-fill', INK, ...glyph(0.6, inset, inset), join(ICONS, 'icon-maskable-512.png'));

/*
 * Open Graph card, 1200x630 — the size every scraper crops to. Text is drawn
 * rather than laid out, so keep it short; anything long enough to need wrapping
 * belongs in the description meta tag instead.
 */
const og = join(PUBLIC, 'og.png');
const mark = join(WORK, 'mark-260.png');
magick(rounded, '-resize', '260x260', mark);
magick(
  '-size', '1200x630', `xc:${INK}`,
  mark, '-geometry', '+96+185', '-composite',
  '-font', 'Helvetica-Bold', '-pointsize', '92', '-fill', PAPER,
  '-annotate', '+412+300', 'Actuo',
  '-font', 'Helvetica', '-pointsize', '34', '-fill', MUTED,
  '-annotate', '+412+358', 'Expense management an AI agent can operate',
  '-font', 'Helvetica', '-pointsize', '30', '-fill', TEAL,
  '-annotate', '+412+424', 'A WebMCP reference implementation',
  og,
);

rmSync(WORK, { recursive: true, force: true });
console.log(`Wrote ${ICONS}/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png and ${og}`);
