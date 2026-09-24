/**
 * Console navigation.
 *
 * One entry per administrable section — the same eighteen sections the domain module
 * authorises — plus the approvals queue, which is not a section but a capability:
 * only roles that may file or decide an approval see it.
 *
 * The label, icon and grouping live here so a section file never has to think about
 * the shell.
 */
import { allowedSections, can, type AdminSection, type Permission } from '@parsbank/domain';
import type { AdminNavSection, IconName } from '@parsbank/ui';

export interface ConsoleEntry {
  key: string;
  /** `null` for entries that are capability-gated rather than section-gated. */
  section: AdminSection | null;
  /** When set, this permission (not the section list) decides visibility. */
  permission: Permission | null;
  path: string;
  labelFa: string;
  groupFa: string;
  icon: IconName;
  descriptionFa: string;
}

export const CONSOLE_ENTRIES: readonly ConsoleEntry[] = [
  { key: 'overview', section: 'overview', permission: null, path: '/', labelFa: 'نمای کل', groupFa: 'نظارت', icon: 'grid', descriptionFa: 'تصویر لحظه‌ای عرضه، پشتوانه، نرخ مرجع و صف تأیید' },
  { key: 'users', section: 'users', permission: null, path: '/users', labelFa: 'کاربران', groupFa: 'نظارت', icon: 'user', descriptionFa: 'شناسه‌ها، نقش‌ها، وضعیت حساب و تغییرهای نیازمند تأیید دوم' },
  { key: 'wallets', section: 'wallets', permission: null, path: '/wallets', labelFa: 'کیف پول‌ها', groupFa: 'نظارت', icon: 'wallet', descriptionFa: 'موجودی هر کیف پول از دفتر کل، همراه با امکان انجماد' },
  { key: 'cards', section: 'cards', permission: null, path: '/cards', labelFa: 'کارت‌ها', groupFa: 'نظارت', icon: 'card', descriptionFa: 'کارت‌های دوازده‌رقمی، وضعیت، انجماد و صدور کارت تازه' },
  { key: 'transactions', section: 'transactions', permission: null, path: '/transactions', labelFa: 'تراکنش‌ها', groupFa: 'نظارت', icon: 'history', descriptionFa: 'دفتر تراکنش‌ها با رسید و شماره توالی دفتر کل' },
  { key: 'treasury', section: 'treasury', permission: null, path: '/treasury', labelFa: 'خزانه', groupFa: 'پول', icon: 'treasury', descriptionFa: 'وضعیت پولی، سقف انتشار، پشتوانه واجد شرایط و نسبت پوشش' },
  { key: 'issuance', section: 'issuance', permission: null, path: '/issuance', labelFa: 'انتشار', groupFa: 'پول', icon: 'plus', descriptionFa: 'صدور پارسه تازه با صورت‌جلسه و تأیید دوم' },
  { key: 'burning', section: 'burning', permission: null, path: '/burning', labelFa: 'امحا و بازخرید', groupFa: 'پول', icon: 'ban', descriptionFa: 'خروج پارسه از گردش به‌صورت دفتری یا فیزیکی' },
  { key: 'banknotes', section: 'banknotes', permission: null, path: '/banknotes', labelFa: 'اسکناس‌ها', groupFa: 'پول', icon: 'notes', descriptionFa: 'دفتر ثبت برگ‌ها، سری‌ها، رویدادها و تطبیق با دفتر کل' },
  { key: 'rates', section: 'exchange-rates', permission: null, path: '/rates', labelFa: 'نرخ مرجع', groupFa: 'پول', icon: 'exchange', descriptionFa: 'نرخ پارسه بر پایهٔ پشتوانه واجد شرایط، همراه با تاریخ ارزیابی‌ها' },
  { key: 'reserve', section: 'reserve', permission: null, path: '/reserve', labelFa: 'پشتوانه', groupFa: 'پول', icon: 'scale', descriptionFa: 'دارایی‌های پشتوانه، کسر قیمت و ارزیابی دوره‌ای' },
  { key: 'approvals', section: null, permission: 'admin.approvals.request', path: '/approvals', labelFa: 'صف تأیید', groupFa: 'پول', icon: 'seal', descriptionFa: 'درخواست‌های دوعضوی: ثبت، تأیید، رد و اجرا' },
  { key: 'audit', section: 'audit', permission: null, path: '/audit', labelFa: 'حسابرسی', groupFa: 'حاکمیت', icon: 'search', descriptionFa: 'گزارش رخدادها و حسابرسی دفتر کل' },
  { key: 'security', section: 'security', permission: null, path: '/security', labelFa: 'امنیت', groupFa: 'حاکمیت', icon: 'shield', descriptionFa: 'نشست‌ها، تلاش‌های ورود و حساب‌های قفل‌شده' },
  { key: 'health', section: 'system-health', permission: null, path: '/system-health', labelFa: 'سلامت سامانه', groupFa: 'حاکمیت', icon: 'pulse', descriptionFa: 'بررسی‌های فنی، یافته‌های یکپارچگی و وضعیت پایگاه داده' },
  { key: 'flags', section: 'feature-flags', permission: null, path: '/feature-flags', labelFa: 'پرچم‌ها و تنظیمات', groupFa: 'حاکمیت', icon: 'flag', descriptionFa: 'تنظیمات سامانه و پرچم‌های عملیاتی، با تفکیک حیاتی و عادی' },
  { key: 'cms', section: 'cms', permission: null, path: '/cms', labelFa: 'محتوای عمومی', groupFa: 'ظاهر', icon: 'copy', descriptionFa: 'متن‌ها، صفحه‌ها و ناوبری سایت عمومی' },
  { key: 'design', section: 'design-system', permission: null, path: '/design-system', labelFa: 'سیستم طراحی', groupFa: 'ظاهر', icon: 'palette', descriptionFa: 'توکن‌های طراحی، نسخه‌های پوسته و انتشار' },
  { key: 'assets', section: 'assets', permission: null, path: '/assets', labelFa: 'دارایی‌های بصری', groupFa: 'ظاهر', icon: 'eye', descriptionFa: 'کتابخانهٔ نشان‌ها، نقش‌مایه‌ها و تصاویر اسکناس' },
] as const;

type Role = Parameters<typeof can>[0];

export function visibleEntries(role: Role, allowed: readonly AdminSection[] = allowedSections(role)): ConsoleEntry[] {
  return CONSOLE_ENTRIES.filter((entry) =>
    entry.permission ? can(role, entry.permission) : entry.section !== null && allowed.includes(entry.section),
  );
}

export function navForRole(role: Role, allowed: readonly AdminSection[] = allowedSections(role)): AdminNavSection[] {
  return visibleEntries(role, allowed).map((entry) => ({
    id: entry.key,
    href: `/admin${entry.path}`,
    labelFa: entry.labelFa,
    groupFa: entry.groupFa,
    iconKey: entry.icon,
  }));
}

/** Alias kept for the shell: the entry matching the current URL. */
export const navEntryForPath = currentEntry;

export function currentEntry(pathname: string): ConsoleEntry | null {
  const relative = pathname.replace(/^\/admin/, '') || '/';
  const exact = CONSOLE_ENTRIES.find((entry) => entry.path === relative);
  if (exact) return exact;
  return CONSOLE_ENTRIES.filter((entry) => entry.path !== '/').find((entry) => relative.startsWith(entry.path)) ?? null;
}
