/**
 * @parsbank/design-system — original geometric ornament.
 *
 * Every pattern here is generated from first principles (tessellations, rosettes
 * and parametric curves) so that the identity is genuinely ours: no scan, trace or
 * imitation of an existing note, card or bank mark. The vocabulary is Persian —
 * گره‌چینی (girih), اسلیمی (islimi), مقرنس (muqarnas) — but the construction,
 * proportions and colour are specific to BANK PARS.
 *
 * The functions are pure string builders: they run in the browser, in the build
 * and on the server (for print-quality banknote artwork), and they depend on no
 * rendering engine.
 */

export interface OrnamentOptions {
  /** nominal box, in user units */
  size?: number;
  /** ink colour; patterns are always drawn in a single ink */
  color?: string;
  /** 0..1 */
  opacity?: number;
  strokeWidth?: number;
  /** extra rotation in degrees, used to break the grid on large surfaces */
  rotate?: number;
}

const attrs = (options: OrnamentOptions, extra: string): string => {
  const { size = 96, color = 'currentColor', opacity = 1, strokeWidth = 1 } = options;
  return [
    `xmlns="http://www.w3.org/2000/svg"`,
    `viewBox="0 0 ${size} ${size}"`,
    `width="${size}"`,
    `height="${size}"`,
    `fill="none"`,
    `stroke="${color}"`,
    `stroke-width="${strokeWidth}"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
    `opacity="${opacity}"`,
    extra,
  ].join(' ');
};

/**
 * Girih-8: an eight-fold star grid. The stars are drawn on a √2 lattice; the
 * connectors are the short radii that the star points "hand" to their neighbours.
 * Original construction: star polygons + hexadecagon hubs, no traced template.
 */
export function girih8(options: OrnamentOptions = {}): string {
  const size = options.size ?? 96;
  const c = size / 2;
  const outer = c * 0.92;
  const inner = outer * 0.62;
  const path: string[] = [];

  const star = (cx: number, cy: number, rO: number, rI: number, points = 8): string => {
    const commands: string[] = [];
    for (let i = 0; i < points * 2; i += 1) {
      const radius = i % 2 === 0 ? rO : rI;
      const angle = (Math.PI * i) / points - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      commands.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return `${commands.join(' ')} Z`;
  };

  path.push(star(c, c, outer, inner));
  // Four half-stars at the corners create the interlocking field.
  const offset = c;
  path.push(star(0, 0, outer * 0.62, inner * 0.62, 8));
  path.push(star(size, 0, outer * 0.62, inner * 0.62, 8));
  path.push(star(0, size, outer * 0.62, inner * 0.62, 8));
  path.push(star(size, size, outer * 0.62, inner * 0.62, 8));

  // Straight connectors between star points — the "hand" that makes the knot read.
  const connector = (angle: number): string => {
    const a = (Math.PI * angle) / 4 - Math.PI / 2;
    const x1 = c + inner * Math.cos(a);
    const y1 = c + inner * Math.sin(a);
    const x2 = c + offset * Math.cos(a);
    const y2 = c + offset * Math.sin(a);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  for (let i = 0; i < 8; i += 1) path.push(connector(i));

  // Centre rosette.
  path.push(`M${(c - inner * 0.28).toFixed(2)} ${c} a${(inner * 0.28).toFixed(2)} ${(inner * 0.28).toFixed(2)} 0 1 0 ${(inner * 0.56).toFixed(2)} 0 a${(inner * 0.28).toFixed(2)} ${(inner * 0.28).toFixed(2)} 0 1 0 ${(-inner * 0.56).toFixed(2)} 0`);

  const extra = options.rotate ? `transform="rotate(${options.rotate} ${c} ${c})"` : '';
  return `<svg ${attrs(options, extra)}>${path.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

/**
 * Islimi: a scrolling arabesque built from two mirrored cubic chains. The
 * asymmetry of the two arcs is what makes it read as foliage rather than a wave.
 */
export function islimi(options: OrnamentOptions = {}): string {
  const size = options.size ?? 96;
  const w = size;
  const h = size;
  const top = [`M0 ${h * 0.68}`];
  for (let i = 0; i < 4; i += 1) {
    const x = (w / 4) * i;
    top.push(
      `C${(x + w * 0.05).toFixed(2)} ${(h * 0.44).toFixed(2)}, ${(x + w * 0.18).toFixed(2)} ${(h * 0.2).toFixed(2)}, ${(x + w * 0.25).toFixed(2)} ${(h * 0.34).toFixed(2)}`,
    );
    top.push(
      `C${(x + w * 0.31).toFixed(2)} ${(h * 0.46).toFixed(2)}, ${(x + w * 0.2).toFixed(2)} ${(h * 0.6).toFixed(2)}, ${(x + w * 0.25).toFixed(2)} ${(h * 0.68).toFixed(2)}`,
    );
  }
  const bottom = [`M0 ${h * 0.32}`];
  for (let i = 0; i < 4; i += 1) {
    const x = (w / 4) * i;
    bottom.push(
      `C${(x + w * 0.05).toFixed(2)} ${(h * 0.56).toFixed(2)}, ${(x + w * 0.18).toFixed(2)} ${(h * 0.8).toFixed(2)}, ${(x + w * 0.25).toFixed(2)} ${(h * 0.66).toFixed(2)}`,
    );
    bottom.push(
      `C${(x + w * 0.31).toFixed(2)} ${(h * 0.54).toFixed(2)}, ${(x + w * 0.2).toFixed(2)} ${(h * 0.4).toFixed(2)}, ${(x + w * 0.25).toFixed(2)} ${(h * 0.32).toFixed(2)}`,
    );
  }
  // Leaf nodes at the crests.
  const leaves = [0.25, 0.5, 0.75].map(
    (fraction) =>
      `M${(w * fraction).toFixed(2)} ${(h * 0.26).toFixed(2)} q${(w * 0.03).toFixed(2)} ${(-h * 0.06).toFixed(2)} ${(w * 0.06).toFixed(2)} ${(h * 0.02).toFixed(2)} q${(-w * 0.02).toFixed(2)} ${(h * 0.04).toFixed(2)} ${(-w * 0.06).toFixed(2)} ${(-h * 0.02).toFixed(2)}`,
  );
  return `<svg ${attrs(options, '')}>${[...top, ...bottom, ...leaves].map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

/**
 * Muqarnas: stacked corbelled niches. Depth comes from reducing each course by a
 * fixed ratio and offsetting it by half, which is how the real geometry steps in.
 */
export function muqarnas(options: OrnamentOptions = {}): string {
  const size = options.size ?? 96;
  const paths: string[] = [];
  const courses = 5;
  for (let course = 0; course < courses; course += 1) {
    const y = (size / courses) * course;
    const inset = (size * 0.06) * course;
    const height = size / courses;
    const width = size - inset * 2;
    paths.push(
      `M${inset.toFixed(2)} ${(y + height).toFixed(2)} ` +
        `Q${(inset + width / 2).toFixed(2)} ${(y + height * 0.28).toFixed(2)} ${(inset + width).toFixed(2)} ${(y + height).toFixed(2)}`,
    );
    paths.push(
      `M${(inset + width * 0.24).toFixed(2)} ${(y + height).toFixed(2)} ` +
        `L${(inset + width * 0.24).toFixed(2)} ${(y + height * 0.46).toFixed(2)} ` +
        `M${(inset + width * 0.76).toFixed(2)} ${(y + height).toFixed(2)} ` +
        `L${(inset + width * 0.76).toFixed(2)} ${(y + height * 0.46).toFixed(2)}`,
    );
  }
  return `<svg ${attrs(options, '')}>${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}

export interface GuillocheOptions extends OrnamentOptions {
  /** number of parametric strands */
  strands?: number;
  /** phase increment between strands, in radians */
  phase?: number;
  /** inner/outer ratio of the rosette */
  ratio?: number;
}

/**
 * Guilloche: the machine-drawn rosette found on security print. Each strand is a
 * closed hypotrochoid; drawing several with a small phase offset produces the
 * moiré that makes the pattern hard to photocopy. Equations are standard
 * spirograph maths, the parameters are ours.
 */
export function guilloche(options: GuillocheOptions = {}): string {
  const size = options.size ?? 200;
  const strands = options.strands ?? 14;
  const phaseStep = options.phase ?? 0.11;
  const ratio = options.ratio ?? 0.34;
  const c = size / 2;
  const outer = c * 0.94;
  const steps = 360;

  const paths: string[] = [];
  for (let strand = 0; strand < strands; strand += 1) {
    const phase = strand * phaseStep;
    const points: string[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const theta = (i / steps) * Math.PI * 2;
      const r = outer * (1 - ratio + ratio * Math.cos(9 * theta + phase));
      const x = c + r * Math.cos(theta);
      const y = c + r * Math.sin(theta);
      points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    paths.push(`${points.join(' ')} Z`);
  }
  return `<svg ${attrs(options, '')}>${paths.map((d) => `<path d="${d}" stroke-width="0.5"/>`).join('')}</svg>`;
}

/** Fine parallel hatching — the "engraved" ground used behind portraits. */
export function engraveLines(options: OrnamentOptions & { spacing?: number; skew?: number } = {}): string {
  const size = options.size ?? 120;
  const spacing = options.spacing ?? 3;
  const skew = options.skew ?? 0.34;
  const lines: string[] = [];
  for (let x = -size; x < size * 2; x += spacing) {
    lines.push(`M${x.toFixed(2)} 0 L${(x + size * skew).toFixed(2)} ${size}`);
  }
  return `<svg ${attrs(options, '')}>${lines.map((d) => `<path d="${d}" stroke-width="0.4"/>`).join('')}</svg>`;
}

/** Rosette used as the watermark panel on the reverse of each note. */
export function rosette(options: OrnamentOptions & { petals?: number } = {}): string {
  const size = options.size ?? 120;
  const petals = options.petals ?? 12;
  const c = size / 2;
  const paths: string[] = [];
  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * 360;
    paths.push(
      `<ellipse cx="${c}" cy="${(c * 0.52).toFixed(2)}" rx="${(c * 0.16).toFixed(2)}" ry="${(c * 0.38).toFixed(2)}" transform="rotate(${angle.toFixed(1)} ${c} ${c})"/>`,
    );
  }
  paths.push(`<circle cx="${c}" cy="${c}" r="${(c * 0.16).toFixed(2)}"/>`);
  return `<svg ${attrs(options, '')}>${paths.join('')}</svg>`;
}

export type OrnamentName = 'girih-8' | 'islimi' | 'muqarnas' | 'guilloche' | 'engrave-lines' | 'rosette';

const REGISTRY: Record<OrnamentName, (options?: never) => string> = {
  'girih-8': girih8 as unknown as (options?: never) => string,
  islimi: islimi as unknown as (options?: never) => string,
  muqarnas: muqarnas as unknown as (options?: never) => string,
  guilloche: guilloche as unknown as (options?: never) => string,
  'engrave-lines': engraveLines as unknown as (options?: never) => string,
  rosette: rosette as unknown as (options?: never) => string,
};

export function ornament(name: OrnamentName, options: OrnamentOptions = {}): string {
  return REGISTRY[name](options as never);
}

/** Inline SVG → data URI, for CSS backgrounds. Pure string work, no Buffer. */
export function svgToDataUri(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').trim();
  const encoded = compact
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, "'")
    .replace(/\s/g, '%20');
  return `url("data:image/svg+xml,${encoded}")`;
}

/** Seamlessly tileable pattern block for large surfaces. */
export function patternBlock(name: OrnamentName, options: OrnamentOptions = {}): string {
  return svgToDataUri(ornament(name, options));
}
