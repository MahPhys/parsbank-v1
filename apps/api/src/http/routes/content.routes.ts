/**
 * BANK PARS — public content routes (CMS read side).
 *
 * Only PUBLISHED content is ever served here: drafts and previews live behind the
 * design plane in /api/v1/admin. The design tokens returned are the published
 * theme version, so the public site can never render an unpublished design.
 */
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/types.ts';
import {
  getPublishedPage,
  listNavigation,
  listPublishedContent,
  publicTheme,
} from '../../services/design.service.ts';
import {
  BRAND,
  CURRENCY_CODE,
  CURRENCY_NAME_FA,
  CURRENCY_NAME_EN,
  DENOMINATIONS,
  DENOMINATION_THEMES,
} from '@parsbank/config/constants';

export async function registerContentRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get('/content/branding', async () => ({
    brand: BRAND,
    currency: { code: CURRENCY_CODE, nameFa: CURRENCY_NAME_FA, nameEn: CURRENCY_NAME_EN },
    denominations: DENOMINATIONS.map((denomination) => ({
      denominationMinor: denomination,
      figureFa: DENOMINATION_THEMES[denomination]?.portraitFa ?? null,
      motifFa: DENOMINATION_THEMES[denomination]?.motifFa ?? null,
    })),
  }));

  app.get('/content/theme', async () => publicTheme(db));

  app.get('/content/blocks', async (request) => {
    const { kind } = request.query as { kind?: string };
    return { items: await listPublishedContent(db, kind) };
  });

  app.get('/content/pages/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const page = await getPublishedPage(db, slug);
    if (!page) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', messageFa: 'این صفحه یافت نشد.' } });
    }
    return page;
  });

  app.get('/content/navigation', async (request) => {
    const { location } = request.query as { location?: string };
    return { items: await listNavigation(db, location) };
  });
}
