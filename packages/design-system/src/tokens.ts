/**
 * @parsbank/design-system — the canonical token catalogue.
 *
 * This file is the single source of truth for every visual decision in BANK PARS:
 * colour, typography, spacing, radii, elevation, icon sizes, container widths,
 * component dimensions and the artwork palette. The applications do not contain
 * literal values; they consume `var(--prs-…)` custom properties that are generated
 * from this catalogue and overlaid by the *published* theme version from the CMS.
 *
 * Editing a token here is a code change (reviewed like any other code). Editing it
 * in the CMS is a content change (draft → preview → publish → rollback). Both end
 * up in the same rows, which is what makes the design system auditable.
 */

export type TokenCategory =
  | 'color'
  | 'typography'
  | 'font'
  | 'spacing'
  | 'radius'
  | 'border'
  | 'shadow'
  | 'icon'
  | 'container'
  | 'component'
  | 'card'
  | 'banknote'
  | 'logo'
  | 'asset'
  | 'motion';

export interface DesignTokenDefinition {
  key: string;
  category: TokenCategory;
  value: string;
  valueType: 'color' | 'length' | 'number' | 'font' | 'shadow' | 'string' | 'gradient';
  descriptionFa: string;
  groupKey?: string;
  sortOrder: number;
  /** locked tokens may be viewed but never edited from the CMS */
  isLocked?: boolean;
}

const t = (
  key: string,
  category: TokenCategory,
  value: string,
  valueType: DesignTokenDefinition['valueType'],
  descriptionFa: string,
  sortOrder: number,
  extra: { groupKey?: string; isLocked?: boolean } = {},
): DesignTokenDefinition => ({
  key,
  category,
  value,
  valueType,
  descriptionFa,
  sortOrder,
  ...extra,
});

/* -------------------------------------------------------------------------- */
/* Palette — blue primary, red accent, white neutral (per identity brief)      */
/* -------------------------------------------------------------------------- */

const PRIMARY: Record<string, string> = {
  '50': '#F2F6FC',
  '100': '#E2EAF7',
  '200': '#C6D6EE',
  '300': '#9DB8E0',
  '400': '#6690CC',
  '500': '#2F63B5',
  '600': '#1D4E9B',
  '700': '#173F7E',
  '800': '#123161',
  '900': '#0C2244',
};

const ACCENT: Record<string, string> = {
  '50': '#FDF4F3',
  '100': '#FBE5E3',
  '200': '#F6C7C4',
  '300': '#EE9E99',
  '400': '#E06E67',
  '500': '#C93B33',
  '600': '#A82E27',
  '700': '#8A2621',
  '800': '#6B1D19',
  '900': '#491411',
};

const NEUTRAL: Record<string, string> = {
  '0': '#FFFFFF',
  '50': '#F8FAFC',
  '100': '#F1F4F8',
  '200': '#E4E9F0',
  '300': '#CFD7E2',
  '400': '#A8B4C4',
  '500': '#7C8A9E',
  '600': '#55637A',
  '700': '#3A4658',
  '800': '#232C3A',
  '900': '#141A24',
};

const paletteTokens: DesignTokenDefinition[] = [
  ...Object.entries(PRIMARY).map(([step, value], index) =>
    t(`color.primary.${step}`, 'color', value, 'color', `آبی اصلی، پله ${step}`, 100 + index, {
      groupKey: 'primary',
    }),
  ),
  ...Object.entries(ACCENT).map(([step, value], index) =>
    t(`color.accent.${step}`, 'color', value, 'color', `سرخ تأکیدی، پله ${step}`, 200 + index, {
      groupKey: 'accent',
    }),
  ),
  ...Object.entries(NEUTRAL).map(([step, value], index) =>
    t(`color.neutral.${step}`, 'color', value, 'color', `خاکستری بی‌طرف، پله ${step}`, 300 + index, {
      groupKey: 'neutral',
    }),
  ),

  // Semantic roles — the only colours components are allowed to reference directly.
  t('color.surface', 'color', 'var(--prs-color-neutral-0)', 'color', 'سطح اصلی', 400, { groupKey: 'semantic' }),
  t('color.surface-raised', 'color', 'var(--prs-color-neutral-50)', 'color', 'سطح برجسته', 401, { groupKey: 'semantic' }),
  t('color.surface-sunken', 'color', 'var(--prs-color-neutral-100)', 'color', 'سطح فرورفته', 402, { groupKey: 'semantic' }),
  t('color.text', 'color', 'var(--prs-color-neutral-900)', 'color', 'متن اصلی', 403, { groupKey: 'semantic' }),
  t('color.text-muted', 'color', 'var(--prs-color-neutral-600)', 'color', 'متن کم‌رنگ', 404, { groupKey: 'semantic' }),
  t('color.text-inverse', 'color', 'var(--prs-color-neutral-0)', 'color', 'متن روی زمینه تیره', 405, { groupKey: 'semantic' }),
  t('color.border', 'color', 'var(--prs-color-neutral-200)', 'color', 'خط جداکننده', 406, { groupKey: 'semantic' }),
  t('color.border-strong', 'color', 'var(--prs-color-neutral-300)', 'color', 'خط پررنگ', 407, { groupKey: 'semantic' }),
  t('color.focus-ring', 'color', '#2F63B559', 'color', 'هاله تمرکز', 408, { groupKey: 'semantic' }),
  t('color.positive', 'color', '#1E7A48', 'color', 'موفق / ورودی', 409, { groupKey: 'semantic' }),
  t('color.warning', 'color', '#B7791F', 'color', 'هشدار', 410, { groupKey: 'semantic' }),
  t('color.critical', 'color', 'var(--prs-color-accent-600)', 'color', 'بحرانی / خطا', 411, { groupKey: 'semantic' }),
  t('color.info', 'color', 'var(--prs-color-primary-500)', 'color', 'اطلاع‌رسانی', 412, { groupKey: 'semantic' }),
  t('color.overlay', 'color', '#101A2A73', 'color', 'پرده تیره پشت دیالوگ', 413, { groupKey: 'semantic' }),

  // Data-visualisation ramp — monochrome by design; money charts stay quiet.
  t('color.chart.supply', 'color', 'var(--prs-color-primary-600)', 'color', 'نمودار عرضه', 430, { groupKey: 'chart' }),
  t('color.chart.reserve', 'color', 'var(--prs-color-primary-300)', 'color', 'نمودار پشتوانه', 431, { groupKey: 'chart' }),
  t('color.chart.circulating', 'color', '#4A9C74', 'color', 'نمودار در گردش', 432, { groupKey: 'chart' }),
  t('color.chart.notes', 'color', 'var(--prs-color-neutral-400)', 'color', 'نمودار اسکناس', 433, { groupKey: 'chart' }),
];

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

const typographyTokens: DesignTokenDefinition[] = [
  t('font.family.fa', 'font', "'Vazirmatn', 'IRANSans', 'Segoe UI', Tahoma, sans-serif", 'font', 'قلم فارسی', 10, { groupKey: 'family' }),
  t('font.family.en', 'font', "'Inter', 'Helvetica Neue', Arial, sans-serif", 'font', 'قلم لاتین', 11, { groupKey: 'family' }),
  t('font.family.numeric', 'font', "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace", 'font', 'قلم شماره‌ها و سریال‌ها', 12, { groupKey: 'family', isLocked: true }),
  t('font.family.display', 'font', "var(--prs-font-family-fa)", 'font', 'قلم عنوان‌های بزرگ', 13, { groupKey: 'family' }),

  t('font.size.2xs', 'typography', '11px', 'length', 'اندازه ۲xs', 20, { groupKey: 'size' }),
  t('font.size.xs', 'typography', '12px', 'length', 'اندازه xs', 21, { groupKey: 'size' }),
  t('font.size.sm', 'typography', '13px', 'length', 'اندازه sm', 22, { groupKey: 'size' }),
  t('font.size.md', 'typography', '14px', 'length', 'اندازه پایه', 23, { groupKey: 'size' }),
  t('font.size.lg', 'typography', '16px', 'length', 'اندازه lg', 24, { groupKey: 'size' }),
  t('font.size.xl', 'typography', '20px', 'length', 'اندازه xl', 25, { groupKey: 'size' }),
  t('font.size.2xl', 'typography', '26px', 'length', 'اندازه ۲xl', 26, { groupKey: 'size' }),
  t('font.size.3xl', 'typography', '32px', 'length', 'اندازه ۳xl', 27, { groupKey: 'size' }),
  t('font.size.4xl', 'typography', '42px', 'length', 'اندازه ۴xl (موجودی)', 28, { groupKey: 'size' }),

  t('font.weight.light', 'typography', '300', 'number', 'وزن نازک', 30, { groupKey: 'weight' }),
  t('font.weight.regular', 'typography', '400', 'number', 'وزن معمولی', 31, { groupKey: 'weight' }),
  t('font.weight.medium', 'typography', '500', 'number', 'وزن متوسط', 32, { groupKey: 'weight' }),
  t('font.weight.semibold', 'typography', '600', 'number', 'وزن نیمه‌ضخیم', 33, { groupKey: 'weight' }),
  t('font.weight.bold', 'typography', '700', 'number', 'وزن ضخیم', 34, { groupKey: 'weight' }),

  // Persian text needs generous leading; numerals need tighter tracking.
  t('font.line.tight', 'typography', '1.35', 'number', 'ارتفاع خط فشرده', 40, { groupKey: 'line' }),
  t('font.line.normal', 'typography', '1.7', 'number', 'ارتفاع خط معمولی', 41, { groupKey: 'line' }),
  t('font.line.relaxed', 'typography', '1.95', 'number', 'ارتفاع خط باز', 42, { groupKey: 'line' }),
  t('font.line.heading', 'typography', '1.45', 'number', 'ارتفاع خط عنوان', 43, { groupKey: 'line' }),
  t('font.tracking.numeric', 'typography', '0.06em', 'string', 'فاصله حروف شماره‌ها', 44, { groupKey: 'tracking' }),
  t('font.tracking.serial', 'typography', '0.14em', 'string', 'فاصله حروف سریال اسکناس', 45, { groupKey: 'tracking' }),
];

/* -------------------------------------------------------------------------- */
/* Space, borders, radii, elevation                                            */
/* -------------------------------------------------------------------------- */

const spaceTokens: DesignTokenDefinition[] = [
  t('space.0', 'spacing', '0', 'length', 'بدون فاصله', 10, { groupKey: 'scale' }),
  t('space.1', 'spacing', '4px', 'length', 'فاصله ۱', 11, { groupKey: 'scale' }),
  t('space.2', 'spacing', '8px', 'length', 'فاصله ۲', 12, { groupKey: 'scale' }),
  t('space.3', 'spacing', '12px', 'length', 'فاصله ۳', 13, { groupKey: 'scale' }),
  t('space.4', 'spacing', '16px', 'length', 'فاصله ۴', 14, { groupKey: 'scale' }),
  t('space.5', 'spacing', '20px', 'length', 'فاصله ۵', 15, { groupKey: 'scale' }),
  t('space.6', 'spacing', '24px', 'length', 'فاصله ۶', 16, { groupKey: 'scale' }),
  t('space.8', 'spacing', '32px', 'length', 'فاصله ۸', 17, { groupKey: 'scale' }),
  t('space.10', 'spacing', '40px', 'length', 'فاصله ۱۰', 18, { groupKey: 'scale' }),
  t('space.12', 'spacing', '48px', 'length', 'فاصله ۱۲', 19, { groupKey: 'scale' }),
  t('space.16', 'spacing', '64px', 'length', 'فاصله ۱۶', 20, { groupKey: 'scale' }),
  t('space.20', 'spacing', '80px', 'length', 'فاصله ۲۰', 21, { groupKey: 'scale' }),
  t('space.24', 'spacing', '96px', 'length', 'فاصله ۲۴', 22, { groupKey: 'scale' }),
];

const surfaceTokens: DesignTokenDefinition[] = [
  t('radius.none', 'radius', '0', 'length', 'بدون گردی', 10, { groupKey: 'radius' }),
  t('radius.xs', 'radius', '4px', 'length', 'گردی xs', 11, { groupKey: 'radius' }),
  t('radius.sm', 'radius', '6px', 'length', 'گردی sm', 12, { groupKey: 'radius' }),
  t('radius.md', 'radius', '10px', 'length', 'گردی md', 13, { groupKey: 'radius' }),
  t('radius.lg', 'radius', '14px', 'length', 'گردی lg', 14, { groupKey: 'radius' }),
  t('radius.xl', 'radius', '20px', 'length', 'گردی xl', 15, { groupKey: 'radius' }),
  t('radius.card', 'radius', '18px', 'length', 'گردی کارت بانکی', 16, { groupKey: 'radius', isLocked: true }),
  t('radius.pill', 'radius', '999px', 'length', 'گردی قرصی', 17, { groupKey: 'radius' }),

  t('border.width.hairline', 'border', '1px', 'length', 'خط مویی', 20, { groupKey: 'width' }),
  t('border.width.thick', 'border', '2px', 'length', 'خط ضخیم', 21, { groupKey: 'width' }),
  t('border.width.accent', 'border', '3px', 'length', 'خط تأکیدی', 22, { groupKey: 'width' }),
  t('border.color', 'border', 'var(--prs-color-border)', 'color', 'رنگ خط', 23, { groupKey: 'colour' }),

  t('shadow.1', 'shadow', '0 1px 2px rgba(16,26,44,.06)', 'shadow', 'سایه ۱', 30, { groupKey: 'elevation' }),
  t('shadow.2', 'shadow', '0 4px 12px rgba(16,26,44,.08)', 'shadow', 'سایه ۲ (کارت)', 31, { groupKey: 'elevation' }),
  t('shadow.3', 'shadow', '0 12px 32px rgba(16,26,44,.10)', 'shadow', 'سایه ۳ (پنل)', 32, { groupKey: 'elevation' }),
  t('shadow.4', 'shadow', '0 24px 64px rgba(16,26,44,.16)', 'shadow', 'سایه ۴ (کارت بانکی)', 33, { groupKey: 'elevation' }),
  t('shadow.focus', 'shadow', '0 0 0 3px var(--prs-color-focus-ring)', 'shadow', 'هاله تمرکز', 34, { groupKey: 'elevation', isLocked: true }),

  t('motion.duration.fast', 'motion', '120ms', 'string', 'مدت حرکت سریع', 40, { groupKey: 'duration' }),
  t('motion.duration.base', 'motion', '200ms', 'string', 'مدت حرکت پایه', 41, { groupKey: 'duration' }),
  t('motion.duration.slow', 'motion', '320ms', 'string', 'مدت حرکت آرام', 42, { groupKey: 'duration' }),
  t('motion.easing.standard', 'motion', 'cubic-bezier(.2,.6,.2,1)', 'string', 'شتاب استاندارد', 43, { groupKey: 'easing' }),
];

/* -------------------------------------------------------------------------- */
/* Layout, icon sizes, component dimensions                                    */
/* -------------------------------------------------------------------------- */

const layoutTokens: DesignTokenDefinition[] = [
  t('icon.xs', 'icon', '14px', 'length', 'اندازه آیکون xs', 10, { groupKey: 'size' }),
  t('icon.sm', 'icon', '16px', 'length', 'اندازه آیکون sm', 11, { groupKey: 'size' }),
  t('icon.md', 'icon', '20px', 'length', 'اندازه آیکون md', 12, { groupKey: 'size' }),
  t('icon.lg', 'icon', '24px', 'length', 'اندازه آیکون lg', 13, { groupKey: 'size' }),
  t('icon.xl', 'icon', '32px', 'length', 'اندازه آیکون xl', 14, { groupKey: 'size' }),
  t('icon.2xl', 'icon', '48px', 'length', 'اندازه آیکون ۲xl', 15, { groupKey: 'size' }),

  t('container.narrow', 'container', '640px', 'length', 'عرض باریک (فرم ورود)', 20, { groupKey: 'width' }),
  t('container.content', 'container', '880px', 'length', 'عرض محتوا', 21, { groupKey: 'width' }),
  t('container.wide', 'container', '1160px', 'length', 'عرض گسترده', 22, { groupKey: 'width' }),
  t('container.dashboard', 'container', '1320px', 'length', 'عرض داشبورد', 23, { groupKey: 'width' }),
  t('container.app', 'container', '1440px', 'length', 'عرض کل برنامه', 24, { groupKey: 'width' }),
  t('container.admin', 'container', '1520px', 'length', 'عرض پنل مدیریت', 25, { groupKey: 'width' }),

  t('component.header.height', 'component', '68px', 'length', 'ارتفاع سرصفحه', 30, { groupKey: 'shell' }),
  t('component.sidebar.width', 'component', '264px', 'length', 'عرض نوار کنار', 31, { groupKey: 'shell' }),
  t('component.sidebar.width-collapsed', 'component', '72px', 'length', 'عرض نوار کنار جمع‌شده', 32, { groupKey: 'shell' }),
  t('component.footer.height', 'component', '96px', 'length', 'ارتفاع پاصفحه', 33, { groupKey: 'shell' }),

  t('component.button.height.sm', 'component', '32px', 'length', 'ارتفاع دکمه کوچک', 40, { groupKey: 'button' }),
  t('component.button.height.md', 'component', '40px', 'length', 'ارتفاع دکمه متوسط', 41, { groupKey: 'button' }),
  t('component.button.height.lg', 'component', '48px', 'length', 'ارتفاع دکمه بزرگ', 42, { groupKey: 'button' }),
  t('component.button.padding-x', 'component', '18px', 'length', 'فاصله افقی دکمه', 43, { groupKey: 'button' }),
  t('component.input.height', 'component', '44px', 'length', 'ارتفاع ورودی', 44, { groupKey: 'field' }),
  t('component.input.padding-x', 'component', '14px', 'length', 'فاصله افقی ورودی', 45, { groupKey: 'field' }),
  t('component.avatar.size', 'component', '40px', 'length', 'اندازه تصویر کاربر', 46, { groupKey: 'identity' }),
  t('component.table.row-height', 'component', '56px', 'length', 'ارتفاع سطر جدول', 47, { groupKey: 'table' }),
  t('component.modal.width', 'component', '560px', 'length', 'عرض دیالوگ', 48, { groupKey: 'overlay' }),
  t('component.badge.height', 'component', '22px', 'length', 'ارتفاع نشان وضعیت', 49, { groupKey: 'status' }),
  t('component.tab.height', 'component', '40px', 'length', 'ارتفاع زبانه', 50, { groupKey: 'navigation' }),

  // Card geometry: ID-1 ratio (85.6 × 54 mm) — 384 px wide is the dashboard size.
  t('card.width', 'card', '384px', 'length', 'عرض کارت (نسبت ID-1)', 60, { groupKey: 'geometry', isLocked: true }),
  t('card.height', 'card', '242px', 'length', 'ارتفاع کارت (نسبت ID-1)', 61, { groupKey: 'geometry', isLocked: true }),
  t('card.number.size', 'card', '20px', 'length', 'اندازه شماره کارت', 62, { groupKey: 'typography' }),
  t('card.number.letter-spacing', 'card', '0.12em', 'string', 'فاصله ارقام کارت', 63, { groupKey: 'typography' }),
  t('card.holder.size', 'card', '13px', 'length', 'اندازه نام دارنده', 64, { groupKey: 'typography' }),
  t('card.chip.width', 'card', '46px', 'length', 'عرض تراشه', 65, { groupKey: 'elements' }),
  t('card.chip.height', 'card', '34px', 'length', 'ارتفاع تراشه', 66, { groupKey: 'elements' }),
];

/* -------------------------------------------------------------------------- */
/* Card & banknote artwork palettes                                            */
/* -------------------------------------------------------------------------- */

const artworkTokens: DesignTokenDefinition[] = [
  // Three card series, each a quiet two-stop gradient of the institutional blue.
  t('card.style.classic', 'card', 'linear-gradient(135deg, var(--prs-color-primary-700), var(--prs-color-primary-900))', 'gradient', 'کارت کلاسیک', 70, { groupKey: 'style' }),
  t('card.style.standard', 'card', 'linear-gradient(135deg, var(--prs-color-primary-600), var(--prs-color-primary-800))', 'gradient', 'کارت استاندارد', 71, { groupKey: 'style' }),
  t('card.style.premium', 'card', 'linear-gradient(135deg, #12305F, #0A1B36 60%, #123161)', 'gradient', 'کارت ویژه', 72, { groupKey: 'style' }),
  t('card.style.overlay-pattern', 'card', 'girih-8', 'string', 'نقش زمینه کارت', 73, { groupKey: 'style' }),
  t('card.style.overlay-opacity', 'card', '0.14', 'number', 'شفافیت نقش کارت', 74, { groupKey: 'style' }),
  t('card.style.inverse-text', 'card', 'var(--prs-color-neutral-0)', 'color', 'رنگ متن کارت', 75, { groupKey: 'style' }),
  t('card.style.accent-bar', 'card', 'var(--prs-color-accent-500)', 'color', 'نوار تأکیدی کارت', 76, { groupKey: 'style' }),

  // Banknote series: one engraving-ink colour per denomination, all within the
  // same family so the seven notes read as one issue rather than seven designs.
  t('banknote.paper', 'banknote', '#F7F3E8', 'color', 'رنگ کاغذ اسکناس', 80, { groupKey: 'paper', isLocked: true }),
  t('banknote.paper-shade', 'banknote', '#EDE6D4', 'color', 'سایه کاغذ اسکناس', 81, { groupKey: 'paper' }),
  t('banknote.engrave.1', 'banknote', '#1F4A6E', 'color', 'مرکب سری ۱ پارسه', 82, { groupKey: 'ink' }),
  t('banknote.engrave.2', 'banknote', '#2C5A54', 'color', 'مرکب سری ۲ پارسه', 83, { groupKey: 'ink' }),
  t('banknote.engrave.5', 'banknote', '#6B4A1F', 'color', 'مرکب سری ۵ پارسه', 84, { groupKey: 'ink' }),
  t('banknote.engrave.10', 'banknote', '#5A3A63', 'color', 'مرکب سری ۱۰ پارسه', 85, { groupKey: 'ink' }),
  t('banknote.engrave.50', 'banknote', '#1E5C4A', 'color', 'مرکب سری ۵۰ پارسه', 86, { groupKey: 'ink' }),
  t('banknote.engrave.100', 'banknote', '#7A3030', 'color', 'مرکب سری ۱۰۰ پارسه', 87, { groupKey: 'ink' }),
  t('banknote.engrave.200', 'banknote', '#2A2F55', 'color', 'مرکب سری ۲۰۰ پارسه', 88, { groupKey: 'ink' }),
  t('banknote.guilloche.opacity', 'banknote', '0.22', 'number', 'شفافیت گیلوش', 89, { groupKey: 'security' }),
  t('banknote.microtext.size', 'banknote', '4px', 'length', 'اندازه ریزنوشته', 90, { groupKey: 'security' }),
  t('banknote.serial.region', 'banknote', 'right-top', 'string', 'جایگاه سریال', 91, { groupKey: 'layout', isLocked: true }),
  t('banknote.portrait.frame-radius', 'banknote', '6px', 'length', 'گردی قاب تصویر', 92, { groupKey: 'layout' }),

  // Logo variants and asset keys. The asset keys are rows in prs.assets.
  t('logo.primary', 'logo', 'asset://logo-wordmark-primary', 'string', 'نشان اصلی (زمینه روشن)', 95, { groupKey: 'variant' }),
  t('logo.inverse', 'logo', 'asset://logo-wordmark-inverse', 'string', 'نشان معکوس (زمینه تیره)', 96, { groupKey: 'variant' }),
  t('logo.mark', 'logo', 'asset://logo-mark', 'string', 'نشان نمادین', 97, { groupKey: 'variant' }),
  t('logo.monochrome', 'logo', 'asset://logo-mark-mono', 'string', 'نشان تک‌رنگ', 98, { groupKey: 'variant' }),

  t('asset.pattern.girih', 'asset', 'asset://pattern-girih-8', 'string', 'نقش گره‌چینی هشت', 100, { groupKey: 'pattern' }),
  t('asset.pattern.islimi', 'asset', 'asset://pattern-islimi', 'string', 'نقش اسلیمی', 101, { groupKey: 'pattern' }),
  t('asset.pattern.muqarnas', 'asset', 'asset://pattern-muqarnas', 'string', 'نقش مقرنس', 102, { groupKey: 'pattern' }),
  t('asset.texture.guilloche', 'asset', 'asset://texture-guilloche', 'string', 'بافت گیلوش', 103, { groupKey: 'texture' }),
  t('asset.texture.engrave', 'asset', 'asset://texture-engrave-lines', 'string', 'بافت خطوط حکاکی', 104, { groupKey: 'texture' }),
  t('asset.illustration.landing', 'asset', 'asset://illustration-landing', 'string', 'تصویر صفحه نخست', 105, { groupKey: 'illustration' }),
];

export const DESIGN_TOKENS: DesignTokenDefinition[] = [
  ...paletteTokens,
  ...typographyTokens,
  ...spaceTokens,
  ...surfaceTokens,
  ...layoutTokens,
  ...artworkTokens,
].sort((a, b) => (a.category === b.category ? a.sortOrder - b.sortOrder : a.category.localeCompare(b.category)));

export const TOKEN_CATEGORIES: TokenCategory[] = [
  'color',
  'typography',
  'font',
  'spacing',
  'radius',
  'border',
  'shadow',
  'icon',
  'container',
  'component',
  'card',
  'banknote',
  'logo',
  'asset',
  'motion',
];

export const DEFAULT_THEME_NAME_FA = 'پوسته پایه پارس';
