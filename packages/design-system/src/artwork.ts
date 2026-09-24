/**
 * @parsbank/design-system — banknote and card artwork.
 *
 * Both artefacts are generated from the same token catalogue, which is what keeps
 * a 200-parsee note, a 1-parsee note and a card looking like they belong to one
 * institution. The portrait is a *constructed* medallion — guilloche ring, hatch
 * ground, stepped frame and a stylised silhouette — deliberately not a traced
 * engraving of the historical figure: the note honours the scholar, it does not
 * reproduce someone else's plate.
 *
 * Sizes follow real banknote proportions (mm, printed at the given aspect) and the
 * ID-1 card ratio, so the same artwork serves screen preview and print.
 */
import { DENOMINATIONS, DENOMINATION_THEMES } from '@parsbank/config/constants';
import { engraveLines, girih8, guilloche, rosette, svgToDataUri } from './patterns.ts';
import { defaultTokenValues } from './index.ts';

export interface BanknoteArtworkOptions {
  /** printed width in mm; the height follows the series ratio */
  widthMm?: number;
  /** render the microtext line (disabled for small on-screen thumbnails) */
  microtext?: boolean;
}

const MM_TO_UNITS = 4; // 1 mm ≈ 4 user units → a 160 mm note is 640 units wide

/** Series geometry: taller notes for higher denominations, as real issues do. */
function seriesGeometry(denomination: number): { widthMm: number; heightMm: number } {
  if (denomination <= 2) return { widthMm: 132, heightMm: 66 };
  if (denomination <= 10) return { widthMm: 140, heightMm: 70 };
  if (denomination <= 50) return { widthMm: 148, heightMm: 74 };
  return { widthMm: 160, heightMm: 80 };
}

const inkFor = (denomination: number): string => {
  const tokens = defaultTokenValues();
  return tokens[`banknote.engrave.${denomination}`] ?? tokens['banknote.engrave.1']!;
};

const paperFor = (): string => defaultTokenValues()['banknote.paper'] ?? '#F7F3E8';

/** A stylised, drawn-from-geometry silhouette inside an oval medallion. */
function portraitMedallion(options: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  ink: string;
  seed: number;
}): string {
  const { cx, cy, rx, ry, ink, seed } = options;
  const parts: string[] = [];

  // Outer guilloche ring, phase-shifted per denomination so no two faces match.
  parts.push(
    `<g opacity="0.5">${guilloche({ size: Math.round(rx * 2.2), strands: 9, phase: 0.07 + seed * 0.01, color: ink }).replace(
      /^<svg[^>]*>|<\/svg>$/g,
      '',
    )
      .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '')
      .replace('<svg ', `<svg x="${(cx - rx * 1.1).toFixed(1)}" y="${(cy - ry * 1.1).toFixed(1)}" `)}</g>`,
  );

  // Hatch ground inside the oval.
  parts.push(
    `<g opacity="0.25"><clipPath id="pm-${seed}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath></g>`,
  );
  const hatch = engraveLines({ size: Math.round(ry * 2), spacing: 2.4, color: ink, opacity: 0.5 }).replace(
    /^<svg[^>]*>|<\/svg>$/g,
    '',
  );
  parts.push(
    `<g clip-path="url(#pm-${seed})" transform="translate(${(cx - ry).toFixed(1)} ${(cy - ry).toFixed(1)})">${hatch}</g>`,
  );

  // Stepped frame — two concentric ovals with a dashed band between them.
  parts.push(
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${ink}" stroke-width="1.6" fill="none"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * 0.9).toFixed(1)}" ry="${(ry * 0.9).toFixed(1)}" stroke="${ink}" stroke-width="0.8" stroke-dasharray="3 3" fill="none"/>`,
  );

  // The figure: shoulders + head, built from three curves. Abstract, symmetric,
  // and equal for every scholar.
  const headR = ry * 0.26;
  const headCy = cy - ry * 0.16;
  parts.push(
    `<path d="M${(cx - rx * 0.52).toFixed(1)} ${(cy + ry * 0.78).toFixed(1)} ` +
      `C${(cx - rx * 0.42).toFixed(1)} ${(cy + ry * 0.14).toFixed(1)}, ${(cx - rx * 0.3).toFixed(1)} ${(headCy + headR * 0.9).toFixed(1)}, ${cx} ${(headCy + headR * 0.95).toFixed(1)} ` +
      `C${(cx + rx * 0.3).toFixed(1)} ${(headCy + headR * 0.9).toFixed(1)}, ${(cx + rx * 0.42).toFixed(1)} ${(cy + ry * 0.14).toFixed(1)}, ${(cx + rx * 0.52).toFixed(1)} ${(cy + ry * 0.78).toFixed(1)}" ` +
      `stroke="${ink}" stroke-width="1.4" fill="none"/>`,
    `<circle cx="${cx.toFixed(1)}" cy="${headCy.toFixed(1)}" r="${headR.toFixed(1)}" stroke="${ink}" stroke-width="1.4" fill="none"/>`,
    `<path d="M${(cx - headR * 0.75).toFixed(1)} ${(headCy - headR * 0.55).toFixed(1)} Q${cx} ${(headCy - headR * 1.9).toFixed(1)} ${(cx + headR * 0.75).toFixed(1)} ${(headCy - headR * 0.55).toFixed(1)}" stroke="${ink}" stroke-width="1.2" fill="none"/>`,
  );

  // Lathe-guilloche halo.
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="${(rx * 1.06).toFixed(1)}" stroke="${ink}" stroke-width="0.6" stroke-dasharray="1 2" fill="none"/>`,
  );

  return `<g>${parts.join('')}</g>`;
}

/**
 * The obverse of a note: serial region (top right), denomination in Persian and
 * Latin numerals, the scholar's medallion, the motif band, and — optionally — the
 * microtext line that carries the anti-copying message.
 */
export function banknoteFront(denomination: number, options: BanknoteArtworkOptions = {}): string {
  const theme = DENOMINATION_THEMES[denomination];
  if (!theme) throw new Error(`unknown denomination ${denomination}`);
  const geometry = seriesGeometry(denomination);
  const ink = inkFor(denomination);
  const paper = paperFor();
  const width = Math.round((options.widthMm ?? geometry.widthMm) * MM_TO_UNITS);
  const height = Math.round(width * (geometry.heightMm / geometry.widthMm));
  const u = width / 100; // layout unit

  const serialFontSize = height * 0.055;
  const guillocheBlock = guilloche({ size: Math.round(height * 0.9), strands: 16, color: ink, opacity: 0.35 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '');
  const girihBlock = girih8({ size: Math.round(height * 0.5), color: ink, opacity: 0.3, strokeWidth: 0.6 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="اسکناس ${denomination} پارسه">` +
    `<defs>` +
    `<linearGradient id="paper-${denomination}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${paper}"/><stop offset="1" stop-color="#EFE8D6"/>` +
    `</linearGradient>` +
    `<clipPath id="note-${denomination}"><rect x="0" y="0" width="${width}" height="${height}" rx="${height * 0.03}"/></clipPath>` +
    `</defs>` +
    `<g clip-path="url(#note-${denomination})">` +
    // paper + security ground
    `<rect width="${width}" height="${height}" fill="url(#paper-${denomination})"/>` +
    `<g transform="translate(${(width * 0.52).toFixed(1)} ${(height * 0.06).toFixed(1)})" opacity="0.5">${guillocheBlock}</g>` +
    `<g transform="translate(${(width * 0.06).toFixed(1)} ${(height * 0.58).toFixed(1)})" opacity="0.6">${girihBlock}</g>` +
    // frame
    `<rect x="${u}" y="${(u * 0.62).toFixed(1)}" width="${width - u * 2}" height="${height - u * 1.24}" rx="${height * 0.02}" fill="none" stroke="${ink}" stroke-width="1.6"/>` +
    `<rect x="${u * 1.6}" y="${u * 1.6}" width="${width - u * 3.2}" height="${height - u * 3.2}" rx="${height * 0.015}" fill="none" stroke="${ink}" stroke-width="0.6" stroke-dasharray="4 3"/>` +
    // medallion
    portraitMedallion({
      cx: width * 0.31,
      cy: height * 0.5,
      rx: height * 0.3,
      ry: height * 0.36,
      ink,
      seed: denomination,
    }) +
    // denomination, Persian numerals first (right side)
    `<text x="${width * 0.85}" y="${height * 0.34}" text-anchor="middle" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.2).toFixed(1)}" font-weight="700" fill="${ink}">${toPersianDigits(denomination)}</text>` +
    `<text x="${width * 0.85}" y="${height * 0.48}" text-anchor="middle" font-family="'Inter', Arial, sans-serif" font-size="${(height * 0.11).toFixed(1)}" font-weight="600" fill="${ink}">${denomination}</text>` +
    `<text x="${width * 0.85}" y="${height * 0.585}" text-anchor="middle" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.055).toFixed(1)}" fill="${ink}">پارسه</text>` +
    `<text x="${width * 0.85}" y="${height * 0.645}" text-anchor="middle" font-family="'Inter', Arial, sans-serif" font-size="${(height * 0.045).toFixed(1)}" letter-spacing="0.14em" fill="${ink}">PRS</text>` +
    // scholar name + motif band
    `<text x="${width * 0.31}" y="${height * 0.9}" text-anchor="middle" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.06).toFixed(1)}" font-weight="600" fill="${ink}">${theme.portraitFa}</text>` +
    `<text x="${width * 0.31}" y="${height * 0.955}" text-anchor="middle" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.04).toFixed(1)}" fill="${ink}" opacity="0.8">${theme.motifFa} — ${theme.era}</text>` +
    // serial region (top-right, always the same box on every note)
    `<g transform="translate(${(width * 0.62).toFixed(1)} ${(height * 0.1).toFixed(1)})">` +
    `<text x="0" y="0" font-family="'IBM Plex Mono', monospace" font-size="${serialFontSize.toFixed(1)}" letter-spacing="0.14em" fill="${ink}" opacity="0.85">PRS-${String(denomination).padStart(3, '0')}-••••-•••••-•</text>` +
    `</g>` +
    // microtext
    (options.microtext === false
      ? ''
      : `<text x="${width * 0.5}" y="${height - u * 0.5}" text-anchor="middle" font-family="'IBM Plex Mono', monospace" font-size="${(height * 0.028).toFixed(1)}" letter-spacing="0.3em" fill="${ink}" opacity="0.7">BANK PARS · NOT LEGAL TENDER · CLOSED PRIVATE NETWORK</text>`) +
    `</g>` +
    `</svg>`;
}

/**
 * The reverse: the institution's wordmark panel, the rosette watermark, the
 * declaration of purpose and the verification legend (how a holder checks the
 * note, and what "not legal tender" means in this network).
 */
export function banknoteReverse(denomination: number, options: BanknoteArtworkOptions = {}): string {
  const theme = DENOMINATION_THEMES[denomination];
  if (!theme) throw new Error(`unknown denomination ${denomination}`);
  const geometry = seriesGeometry(denomination);
  const ink = inkFor(denomination);
  const paper = paperFor();
  const width = Math.round((options.widthMm ?? geometry.widthMm) * MM_TO_UNITS);
  const height = Math.round(width * (geometry.heightMm / geometry.widthMm));
  const u = width / 100;

  const rosetteBlock = rosette({ size: Math.round(height * 0.66), petals: 10 + (denomination % 4) * 2, color: ink, opacity: 0.4 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '');
  const islimiBlock = girih8({ size: Math.round(height * 0.34), color: ink, opacity: 0.25, strokeWidth: 0.5 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="پشت اسکناس ${denomination} پارسه">` +
    `<defs><clipPath id="rev-${denomination}"><rect x="0" y="0" width="${width}" height="${height}" rx="${height * 0.03}"/></clipPath></defs>` +
    `<g clip-path="url(#rev-${denomination})">` +
    `<rect width="${width}" height="${height}" fill="${paper}"/>` +
    `<g transform="translate(${(width * 0.5).toFixed(1)} ${(height * 0.5).toFixed(1)}) translate(${(-height * 0.33).toFixed(1)} ${(-height * 0.33).toFixed(1)})">${rosetteBlock}</g>` +
    `<g transform="translate(${(width * 0.07).toFixed(1)} ${(height * 0.14).toFixed(1)})">${islimiBlock}</g>` +
    `<g transform="translate(${(width * 0.78).toFixed(1)} ${(height * 0.14).toFixed(1)})">${islimiBlock}</g>` +
    // left panel: wordmark (RTL → visually right, but the geometry is symmetric)
    `<g transform="translate(${(width * 0.5).toFixed(1)} ${(height * 0.22).toFixed(1)})" text-anchor="middle">` +
    `<text x="0" y="0" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.115).toFixed(1)}" font-weight="700" fill="${ink}">بانک پارس</text>` +
    `<text x="0" y="${(height * 0.075).toFixed(1)}" font-family="'Inter', Arial, sans-serif" font-size="${(height * 0.05).toFixed(1)}" letter-spacing="0.3em" fill="${ink}">BANK PARS</text>` +
    `</g>` +
    // declaration
    `<g transform="translate(${(width * 0.5).toFixed(1)} ${(height * 0.47).toFixed(1)})" text-anchor="middle">` +
    `<text x="0" y="0" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.042).toFixed(1)}" fill="${ink}">این اسکناس در شبکه خصوصی پارس جریان دارد</text>` +
    `<text x="0" y="${(height * 0.062).toFixed(1)}" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.038).toFixed(1)}" fill="${ink}">و پول قانونی نیست.</text>` +
    `<text x="0" y="${(height * 0.128).toFixed(1)}" font-family="'Inter', Arial, sans-serif" font-size="${(height * 0.032).toFixed(1)}" fill="${ink}" opacity="0.85">This note circulates inside the closed PARS network</text>` +
    `<text x="0" y="${(height * 0.16).toFixed(1)}" font-family="'Inter', Arial, sans-serif" font-size="${(height * 0.032).toFixed(1)}" fill="${ink}" opacity="0.85">and is not legal tender.</text>` +
    `</g>` +
    // verification legend
    `<g transform="translate(${(width * 0.5).toFixed(1)} ${(height * 0.78).toFixed(1)})" text-anchor="middle">` +
    `<text x="0" y="0" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.038).toFixed(1)}" fill="${ink}">اصالت: سریال را در «اعتبارسنجی اسکناس» سامانه ثبت کنید</text>` +
    `<text x="0" y="${(height * 0.058).toFixed(1)}" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="${(height * 0.036).toFixed(1)}" fill="${ink}">موضوع اثر: ${theme.motifFa}</text>` +
    `</g>` +
    `<rect x="${u}" y="${u}" width="${width - u * 2}" height="${height - u * 2}" rx="${height * 0.02}" fill="none" stroke="${ink}" stroke-width="1.2"/>` +
    `</g>` +
    `</svg>`;
}

/** Both sides of a series, as data URIs ready for `<img src>` or CSS. */
export function banknoteArtworkSet(denomination: number): { front: string; reverse: string } {
  return {
    front: svgToDataUri(banknoteFront(denomination, { widthMm: 40, microtext: false })),
    reverse: svgToDataUri(banknoteReverse(denomination, { widthMm: 40 })),
  };
}

export interface CardArtworkOptions {
  cardNumber: string;
  cardholderNameFa: string;
  expiry: string;
  networkLabel?: string;
  scheme?: string;
  series?: 'classic' | 'standard' | 'premium';
  masked?: boolean;
}

/**
 * The card face. Left half: chip, number, holder, expiry. Right: the brand mark
 * over the girih field. Nothing secret is ever drawn — the CVV is *not* on the
 * face (it lives in the account area), and the QR lives on the reverse.
 */
export function cardFace(options: CardArtworkOptions): string {
  const width = 384;
  const height = 242;
  const series = options.series ?? 'standard';
  const brand = series === 'premium' ? '#0A1B36' : '#123161';
  const accent = defaultTokenValues()['card.style.accent-bar'] ?? '#C93B33';
  const pattern = girih8({ size: 160, color: '#FFFFFF', opacity: 0.14, strokeWidth: 0.7 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '');

  const number = options.masked
    ? `${options.cardNumber.slice(0, 4)} •••• ${options.cardNumber.slice(-4)}`
    : options.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="کارت بانک پارس">` +
    `<defs>` +
    `<linearGradient id="card-face" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${brand}"/><stop offset="1" stop-color="#08132A"/>` +
    `</linearGradient>` +
    `<clipPath id="card-clip"><rect width="${width}" height="${height}" rx="18"/></clipPath>` +
    `</defs>` +
    `<g clip-path="url(#card-clip)">` +
    `<rect width="${width}" height="${height}" fill="url(#card-face)"/>` +
    `<g transform="translate(${(width * 0.52).toFixed(1)} ${(height * 0.1).toFixed(1)})" opacity="0.9">${pattern}</g>` +
    `<rect x="0" y="0" width="${width}" height="4" fill="${accent}"/>` +
    // chip
    `<g transform="translate(24 26)">` +
    `<rect width="46" height="34" rx="6" fill="none" stroke="#E9D9A8" stroke-width="1.4" opacity="0.9"/>` +
    `<path d="M0 12 H46 M0 22 H46 M15 0 V34 M31 0 V34" stroke="#E9D9A8" stroke-width="0.9" opacity="0.7" fill="none"/>` +
    `</g>` +
    // contactless glyph
    `<g transform="translate(300 30)" stroke="#FFFFFF" stroke-width="1.6" fill="none" opacity="0.85">` +
    `<path d="M4 4 q6 10 0 20"/><path d="M12 0 q10 14 0 28"/><path d="M20 -4 q14 18 0 36"/>` +
    `</g>` +
    // brand
    `<text x="24" y="96" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="17" font-weight="700" fill="#FFFFFF">بانک پارس</text>` +
    `<text x="24" y="113" font-family="'Inter', Arial, sans-serif" font-size="10" letter-spacing="0.28em" fill="#DCE6F6">BANK PARS</text>` +
    // number
    `<text x="24" y="160" font-family="'IBM Plex Mono', monospace" font-size="20" letter-spacing="0.12em" fill="#FFFFFF" direction="ltr">${number}</text>` +
    // holder + expiry
    `<text x="24" y="196" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="13" font-weight="600" fill="#FFFFFF">${options.cardholderNameFa}</text>` +
    `<text x="24" y="212" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="9" fill="#B9C8E4">دارنده کارت</text>` +
    `<text x="200" y="196" font-family="'IBM Plex Mono', monospace" font-size="13" fill="#FFFFFF">${options.expiry}</text>` +
    `<text x="200" y="212" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="9" fill="#B9C8E4">تاریخ انقضا</text>` +
    `<text x="${width - 24}" y="${height - 18}" text-anchor="end" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="10" fill="#B9C8E4">${options.networkLabel ?? 'شبکه پارس'} · ${options.scheme ?? 'PARS'}</text>` +
    `</g>` +
    `</svg>`;
}

/** The reverse of the card: magnetic stripe, signature panel, and the QR area. */
export function cardReverse(options: { qrTokenPrefix?: string | null } = {}): string {
  const width = 384;
  const height = 242;
  const pattern = girih8({ size: 120, color: '#123161', opacity: 0.08, strokeWidth: 0.6 })
    .replace(/^<svg[^>]*>|<\/svg>$/g, '')
    .replace(/width="[^"]*"|height="[^"]*"|viewBox="[^"]*"|xmlns="[^"]*"|fill="[^"]*"|stroke-linecap="[^"]*"|stroke-linejoin="[^"]*"|opacity="[^"]*"/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="پشت کارت">` +
    `<rect width="${width}" height="${height}" rx="18" fill="#F4F7FC"/>` +
    `<g transform="translate(${(width * 0.45).toFixed(1)} 20)">${pattern}</g>` +
    `<rect x="0" y="26" width="${width}" height="42" fill="#1B2433"/>` +
    `<rect x="24" y="86" width="188" height="34" rx="4" fill="#FFFFFF" stroke="#CFD7E2"/>` +
    `<path d="M32 112 q10 -14 20 0 q10 14 20 0 q10 -14 20 0 q10 14 20 0 q10 -14 20 0 q8 12 16 2" stroke="#8A97AC" stroke-width="1.2" fill="none"/>` +
    `<text x="24" y="136" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="9" fill="#55637A">امضای دارنده کارت</text>` +
    `<rect x="232" y="86" width="128" height="128" rx="10" fill="#FFFFFF" stroke="#CFD7E2"/>` +
    `<g transform="translate(244 98)">` +
    qrPlaceholder() +
    `</g>` +
    `<text x="296" y="228" text-anchor="middle" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="9" fill="#55637A">${options.qrTokenPrefix ? `رمز اسکن: ${options.qrTokenPrefix}…` : 'رمز اسکن صادر نشده'}</text>` +
    `<text x="24" y="168" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="9" fill="#55637A">این کارت فقط در شبکه خصوصی پارس</text>` +
    `<text x="24" y="182" font-family="'Vazirmatn', Tahoma, sans-serif" font-size="9" fill="#55637A">کاربرد دارد و پول قانونی نیست.</text>` +
    `<text x="24" y="206" font-family="'IBM Plex Mono', monospace" font-size="8" letter-spacing="0.2em" fill="#7C8A9E">BANK PARS · PRS</text>` +
    `</svg>`;
}

/**
 * A QR *frame* only. The real QR is rendered client-side from the opaque token;
 * this placeholder exists so the artwork itself never embeds a credential.
 */
function qrPlaceholder(): string {
  const cells = 21;
  const cell = 4.6;
  const parts: string[] = [];
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const inFinder =
        (x < 7 && y < 7) || (x >= cells - 7 && y < 7) || (x < 7 && y >= cells - 7);
      const on = inFinder
        ? (() => {
            const lx = x >= cells - 7 ? cells - 1 - x : x;
            const ly = y >= cells - 7 ? cells - 1 - y : y;
            return lx === 0 || ly === 0 || lx === 6 || ly === 6 || (lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4);
          })()
        : (x * 7 + y * 13) % 5 < 2;
      if (on) parts.push(`<rect x="${(x * cell).toFixed(1)}" y="${(y * cell).toFixed(1)}" width="${cell}" height="${cell}" fill="#1B2433"/>`);
    }
  }
  return parts.join('');
}

export const DENOMINATION_ARTWORK = DENOMINATIONS.map((denomination) => ({
  denomination,
  ...DENOMINATION_THEMES[denomination],
  front: banknoteFront(denomination),
  reverse: banknoteReverse(denomination),
}));

function toPersianDigits(value: number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!);
}
