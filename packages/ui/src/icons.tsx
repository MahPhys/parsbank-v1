/**
 * @parsbank/ui — icon set.
 *
 * Icons are drawn as strokes on a 24×24 grid so they stay legible at 16–24 px and
 * inherit `currentColor`. The motifs are geometric (girih, arch, radiating rosette)
 * rather than literal illustrations, to stay consistent with the engraved banknote
 * artwork without imitating any existing institution's iconography.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'wallet'
  | 'send'
  | 'receive'
  | 'scan'
  | 'card'
  | 'history'
  | 'receipt'
  | 'user'
  | 'shield'
  | 'bell'
  | 'chart'
  | 'notes'
  | 'lock'
  | 'plus'
  | 'check'
  | 'close'
  | 'alert'
  | 'search'
  | 'menu'
  | 'chevron-left'
  | 'chevron-right'
  | 'download'
  | 'print'
  | 'logout'
  | 'refresh'
  | 'eye'
  | 'ban'
  | 'list'
  | 'treasury'
  | 'scale'
  | 'palette'
  | 'flag'
  | 'settings'
  | 'pulse'
  | 'exchange'
  | 'clock'
  | 'grid'
  | 'seal'
  | 'copy'
  | 'key';

const PATHS: Record<IconName, string> = {
  wallet: 'M3.5 8.5A2.5 2.5 0 0 1 6 6h12a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 18H6a2.5 2.5 0 0 1-2.5-2.5zM16 12h2.5',
  send: 'M4 12 20 5l-3.2 14L12 14.4 4 12zm8 2.4L20 5',
  receive: 'M20 12 4 5l3.2 14L12 14.4 20 12zm-8 2.4L4 5',
  scan: 'M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2M4 12h16',
  card: 'M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5zM3 10.5h18M6.5 14.5h3',
  history: 'M12 7v5l3.2 1.8M3.6 12a8.4 8.4 0 1 0 2.6-6.1M3.5 4.5V9h4.4',
  receipt: 'M6 3.5h12v17l-3-1.6-3 1.6-3-1.6-3 1.6zM9.5 8h5M9.5 12h5',
  user: 'M12 12.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2zM4.8 20c.9-3.3 3.7-5 7.2-5s6.3 1.7 7.2 5',
  shield: 'M12 3.5 19 6v5.5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6zM9.2 12.2l2 2 3.6-4',
  bell: 'M7 10a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5H5.5S7 14 7 10zM10 19a2 2 0 0 0 4 0',
  chart: 'M4 20V4M4 20h16M8 20v-6M12 20V8M16 20v-9',
  notes: 'M6 4.5h12v15H6zM9 4.5v15M15 4.5v15M6 12h12',
  lock: 'M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M5.5 10.5h13v9h-13zM12 14v2.5',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4.5 20.5 19h-17zM12 10v4M12 16.6v.4',
  search: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6zM15.8 15.8 20 20',
  menu: 'M4 7h16M4 12h16M4 17h16',
  'chevron-left': 'M14 6l-6 6 6 6',
  'chevron-right': 'M10 6l6 6-6 6',
  download: 'M12 4v10M12 14l-4-4M12 14l4-4M5 18h14',
  print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M8 14h8v6H8z',
  logout: 'M15 5h3.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H15M11 8l-4 4 4 4M7 12h9',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4.5V9h-4.6',
  eye: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12zM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  ban: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM6 6l12 12',
  list: 'M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01',
  treasury: 'M4 20h16M5.5 20V9.5L12 4l6.5 5.5V20M9.5 20v-6h5v6',
  scale: 'M12 4v16M6 8h12M6 8 3.5 14h5zM18 8l-2.5 6h5z',
  palette: 'M12 20a8 8 0 1 1 8-8c0 2.4-2 3-3.4 3h-1.3c-1 0-1.8.8-1.8 1.8 0 .9.6 1.5.6 2.2 0 .6-.9 1-2.1 1zM8.5 10h.01M12 8h.01M15.5 10h.01',
  flag: 'M6 4v16M6 5h11l-1.8 3.5L17 12H6',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM12 3.5l1.2 2.2 2.5-.5.5 2.5 2.3 1.1-1.3 2.2 1.3 2.2-2.3 1.1-.5 2.5-2.5-.5L12 20.5l-1.2-2.2-2.5.5-.5-2.5-2.3-1.1 1.3-2.2L5.5 8.8 7.8 7.7l.5-2.5 2.5.5z',
  pulse: 'M3 12h4l2-5 3 10 2.5-5H21',
  exchange: 'M4 8h13l-3-3M20 16H7l3 3',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 1.8',
  grid: 'M4 4.5h6v6H4zM14 4.5h6v6h-6zM4 13.5h6v6H4zM14 13.5h6v6h-6z',
  seal: 'M12 3.5l2.4 1.7 2.9-.3 1 2.8 2.4 1.7-1 2.8 1 2.8-2.4 1.7-1 2.8-2.9-.3L12 20.5l-2.4-1.7-2.9.3-1-2.8L3.3 14.6l1-2.8-1-2.8 2.4-1.7 1-2.8 2.9.3zM9.3 12.2l1.9 1.9 3.5-4',
  copy: 'M9 9V5.5h10V15h-3.5M5 9h10v10H5z',
  key: 'M15 4.5a4.5 4.5 0 1 1-3.6 7.2L4 19.1V21h3.4l1.2-1.2 1.3 1.3 1.6-1.6-1.2-1.2 1.2-1.2 1.2 1.2 2-2-1.2-1.2 1.2-1.2',
};

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.6, className, style, title }: IconProps) {
  const path = PATHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className}
      style={style}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}

/** The brand mark: a girih rosette inside a square seal. Used in headers and print. */
export function BrandMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="نشان بانک پارس"
      focusable="false"
    >
      <defs>
        <linearGradient id="prs-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--prs-color-primary-800, #123161)" />
          <stop offset="100%" stopColor="var(--prs-color-primary-500, #2f63b5)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="48" height="48" rx="10" fill="url(#prs-mark-bg)" />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.92" strokeWidth="1.4">
        <path d="M24 7l5 8 8-5-2.5 9.5L43 24l-8.5 4.5L37 38l-8-5-5 8-5-8-8 5 2.5-9.5L6 24l8.5-4.5L12 10l8 5z" />
        <circle cx="24" cy="24" r="6" />
      </g>
      <circle cx="24" cy="24" r="2.2" fill="#ffffff" fillOpacity="0.95" />
    </svg>
  );
}
