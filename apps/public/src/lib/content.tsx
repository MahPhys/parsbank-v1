/**
 * Content & design provider.
 *
 * Everything here is *published* content: the CMS theme, the navigation items, the
 * copy blocks and the public monetary snapshot. The provider never writes and never
 * falls back to unpublished drafts — the API would refuse anyway, and the loading
 * path should be identical to the failure path.
 *
 * When the CMS has no navigation rows yet, the built-in defaults are used so the
 * account holder is never left with an empty shell.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MonetarySnapshot } from '@parsbank/types';
import { api } from './api.ts';
import type { NavItem } from '@parsbank/ui';

export interface Branding {
  brand: Record<string, unknown>;
  currency: { code: string; nameFa: string; nameEn: string };
  denominations: Array<{ denominationMinor: number; figureFa: string | null; motifFa: string | null }>;
}

export interface ContentBlock {
  block_key: string;
  kind: string;
  title_fa: string | null;
  body_fa: string;
  body_en: string | null;
  data: Record<string, unknown> | null;
}

export interface ContentState {
  branding: Branding | null;
  theme: { versionNumber: number; name: string; tokens: Record<string, string>; publishedAt: string | null } | null;
  headerNav: NavItem[];
  appNav: NavItem[];
  blocks: Record<string, ContentBlock>;
  snapshot: MonetarySnapshot | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_HEADER_NAV: NavItem[] = [
  { labelFa: 'خانه', href: '/', iconKey: 'home' },
  { labelFa: 'حساب من', href: '/dashboard', iconKey: 'dashboard' },
  { labelFa: 'کیف پول', href: '/wallet', iconKey: 'wallet' },
  { labelFa: 'کارت', href: '/card', iconKey: 'card' },
  { labelFa: 'اسکناس‌ها', href: '/banknotes', iconKey: 'notes' },
  { labelFa: 'رهگیری رسید', href: '/receipts', iconKey: 'receipt' },
];

const DEFAULT_APP_NAV: NavItem[] = [
  { labelFa: 'نمای حساب', href: '/dashboard', iconKey: 'dashboard' },
  { labelFa: 'انتقال', href: '/send', iconKey: 'send' },
  { labelFa: 'دریافت', href: '/receive', iconKey: 'receive' },
  { labelFa: 'اسکن', href: '/scan', iconKey: 'scan' },
  { labelFa: 'تاریخچه', href: '/history', iconKey: 'history' },
  { labelFa: 'امنیت', href: '/security', iconKey: 'security' },
];

const ContentContext = createContext<ContentState | null>(null);

interface NavRow {
  label_fa: string;
  href: string;
  icon_key: string | null;
}

function toNav(rows: NavRow[], fallback: NavItem[]): NavItem[] {
  const mapped = rows.map((row) => ({ labelFa: row.label_fa, href: row.href, iconKey: row.icon_key }));
  return mapped.length > 0 ? mapped : fallback;
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [theme, setTheme] = useState<ContentState['theme']>(null);
  const [headerNav, setHeaderNav] = useState<NavItem[]>(DEFAULT_HEADER_NAV);
  const [appNav, setAppNav] = useState<NavItem[]>(DEFAULT_APP_NAV);
  const [blocks, setBlocks] = useState<Record<string, ContentBlock>>({});
  const [snapshot, setSnapshot] = useState<MonetarySnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      api.get<Branding>('/content/branding'),
      api.get<NonNullable<ContentState['theme']>>('/content/theme'),
      api.get<{ items: NavRow[] }>('/content/navigation?location=PUBLIC_HEADER'),
      api.get<{ items: NavRow[] }>('/content/navigation?location=PUBLIC_APP_NAV'),
      api.get<{ items: ContentBlock[] }>('/content/blocks'),
      api.get<MonetarySnapshot>('/monetary/snapshot'),
    ]);

    const [brandingResult, themeResult, headerResult, appResult, blocksResult, snapshotResult] = results;
    if (brandingResult.status === 'fulfilled') setBranding(brandingResult.value);
    if (themeResult.status === 'fulfilled') setTheme(themeResult.value);
    if (headerResult.status === 'fulfilled') setHeaderNav(toNav(headerResult.value.items ?? [], DEFAULT_HEADER_NAV));
    if (appResult.status === 'fulfilled') setAppNav(toNav(appResult.value.items ?? [], DEFAULT_APP_NAV));
    if (blocksResult.status === 'fulfilled') {
      const map: Record<string, ContentBlock> = {};
      for (const block of blocksResult.value.items ?? []) map[block.block_key] = block;
      setBlocks(map);
    }
    if (snapshotResult.status === 'fulfilled') setSnapshot(snapshotResult.value);

    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<ContentState>(
    () => ({ branding, theme, headerNav, appNav, blocks, snapshot, loading, refresh }),
    [branding, theme, headerNav, appNav, blocks, snapshot, loading, refresh],
  );

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContent(): ContentState {
  const value = useContext(ContentContext);
  if (!value) throw new Error('useContent must be used inside <ContentProvider>');
  return value;
}

/** Convenience: the Persian body of a CMS block, or a fallback sentence. */
export function useBlockText(key: string, fallback: string): { titleFa: string | null; bodyFa: string } {
  const { blocks } = useContent();
  const block = blocks[key];
  return { titleFa: block?.title_fa ?? null, bodyFa: block?.body_fa ?? fallback };
}
