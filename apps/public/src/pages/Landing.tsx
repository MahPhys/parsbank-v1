/**
 * Landing page.
 *
 * The first screen has to answer three questions without scrolling much: what this
 * is (a closed private currency), what backs it (a disclosed reserve and a public
 * coverage ratio), and how to get in (sign in with the card number).
 */
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  LinkButton,
  MonetaryStrip,
  NoteArt,
  Panel,
  PanelBody,
  Stat,
  formatPercent,
  formatRate,
  formatUsd,
} from '@parsbank/ui';
import { DENOMINATION_ARTWORK } from '@parsbank/design-system';
import { DENOMINATIONS } from '@parsbank/config/constants';
import { useContent } from '../lib/content.tsx';
import { useSession } from '../lib/session.tsx';

export function Landing() {
  const { snapshot, blocks } = useContent();
  const { status } = useSession();
  const intro = blocks['public.intro'];
  const disclaimer = blocks['app.disclaimer'];

  const coverage = snapshot?.reserveCoverageRatio ?? null;
  const reserveHealthy = coverage !== null && coverage >= 1;

  return (
    <div className="prs-container prs-container-wide prs-stack-6">
      <section className="prs-landing__grid">
        <div>
          <span className="prs-landing__eyebrow">
            شبکهٔ بستهٔ پولی خصوصی · واحد پول پارسه (PRS)
          </span>
          <h1 className="prs-landing__title">
            {intro?.title_fa ?? 'حساب پارسه، دفتری که همه‌چیز را ثبت می‌کند.'}
          </h1>
          <p className="prs-landing__lead">
            {intro?.body_fa ??
              'بانک پارس یک سامانهٔ پولی کوچک اما کامل است: دفتر کل دوطرفه، پشتوانهٔ اعلام‌شده، اسکناس فیزیکی با سریال یکتا و کنترل‌های دومّرحله‌ای. هیچ‌چیز اینجا به شبکه‌های پرداخت واقعی وصل نیست.'}
          </p>
          <div className="prs-row prs-wrap" style={{ marginTop: 'var(--prs-space-6)' }}>
            {status === 'authenticated' ? (
              <LinkButton href="/dashboard" variant="primary" icon="grid">
                ورود به نمای حساب
              </LinkButton>
            ) : (
              <LinkButton href="/login" variant="primary" icon="key">
                ورود با شماره کارت
              </LinkButton>
            )}
            <LinkButton href="/banknotes/verify" variant="outline" icon="notes">
              بررسی اصالت اسکناس
            </LinkButton>
            <LinkButton href="/receipts" variant="quiet" icon="receipt">
              رهگیری رسید
            </LinkButton>
          </div>
        </div>

        <div className="prs-stack-4">
          <div className="prs-statement">
            <div className="prs-row prs-between prs-wrap">
              <div>
                <div className="prs-small prs-muted">نسبت پوشش پشتوانه</div>
                <div style={{ fontSize: 'var(--prs-font-size-3xl)', fontWeight: 700 }}>
                  {coverage === null ? '—' : formatPercent(coverage)}
                </div>
              </div>
              <Badge tone={reserveHealthy ? 'positive' : 'warning'} dot>
                {reserveHealthy ? 'پشتوانه کافی' : 'نیازمند توجه'}
              </Badge>
            </div>
            <div className="prs-receipt__divider" />
            <dl className="prs-kv">
              <div style={{ display: 'contents' }}>
                <dt>پشتوانه واجد شرایط</dt>
                <dd className="prs-num">{formatUsd(snapshot?.eligibleReserveNavUsdMinor ?? 0)} دلار</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>نرخ مرجع</dt>
                <dd className="prs-num">
                  {snapshot ? `${formatRate(snapshot.referenceRatePrsPerUsd)} دلار برای هر پارسه` : '—'}
                </dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>عرضه در گردش</dt>
                <dd className="prs-num">{snapshot ? snapshot.circulatingSupplyMinor.toLocaleString('fa-IR') : '—'} پارسه</dd>
              </div>
              <div style={{ display: 'contents' }}>
                <dt>ارزش اسمی هر پارسه</dt>
                <dd>۱۰۰ سنت دلار (پایهٔ سنجش پوشش)</dd>
              </div>
            </dl>
            <p className="prs-small prs-muted" style={{ marginTop: 'var(--prs-space-4)' }}>
              این اعداد در سرور و از دفتر کل محاسبه و زمان‌مهر می‌شوند؛ رابط کاربری هیچ‌گاه آن‌ها را
              تغییر نمی‌دهد.
            </p>
          </div>

          <div className="prs-grid prs-grid-2">
            <Stat label="سقف عرضه" value={`${(snapshot?.maxSupplyMinor ?? 10000).toLocaleString('fa-IR')} پارسه`} hint="تغییر فقط با تأیید دوگانه" icon="chart" />
            <Stat
              label="عرضهٔ منتشرشده"
              value={`${(snapshot?.totalIssuedMinor ?? 0).toLocaleString('fa-IR')} پارسه`}
              hint="برابر حساب ۱۱۰۰ دفتر کل"
              icon="notes"
            />
          </div>
        </div>
      </section>

      {snapshot ? (
        <MonetaryStrip
          maxSupplyMinor={snapshot.maxSupplyMinor}
          totalIssuedMinor={snapshot.totalIssuedMinor}
          circulatingSupplyMinor={snapshot.circulatingSupplyMinor}
          eligibleNavUsdMinor={snapshot.eligibleReserveNavUsdMinor}
          coverageRatio={snapshot.reserveCoverageRatio}
          notesOutstandingMinor={null}
        />
      ) : null}

      <section className="prs-grid prs-grid-4">
        <Panel title="دفتر کل دوطرفه" subtitle="هیچ موجودی‌ای بدون سند ثبت نمی‌شود">
          <PanelBody>
            <p className="prs-small">
              هر عملیات با دو ثبت متوازن انجام می‌شود؛ جمع بدهکار و بستانکار همیشه برابر است و موجودی هر
              کیف پول از روی دفتر بازخوانی می‌شود، نه از یک عدد ذخیره‌شده.
            </p>
          </PanelBody>
        </Panel>
        <Panel title="پشتوانه و پوشش" subtitle="پشتوانه اعلام‌شده و ارزیابی‌شده">
          <PanelBody>
            <p className="prs-small">
              هر انتشار باید سهم پشتوانهٔ خود را همراه بیاورد؛ نسبت پوشش پس از هر رویداد پولی در سرور
              بازمحاسبه و به‌صورت تاریخ‌دار ثبت می‌شود.
            </p>
          </PanelBody>
        </Panel>
        <Panel title="اسکناس فیزیکی" subtitle="سریال، وضعیت، دارنده و تاریخچه">
          <PanelBody>
            <p className="prs-small">
              هر برگ اسکناس در دفتر اسکناس ثبت می‌شود: تخصیص، تحویل، واریز، برداشت، بررسی اصالت، انسداد و
              ثبت مفقودی/مسروقگی — همه با پیوند به دفتر کل.
            </p>
          </PanelBody>
        </Panel>
        <Panel title="کنترل دوگانه" subtitle="تصمیم‌های پولی با دو امضا">
          <PanelBody>
            <p className="prs-small">
              انتشار، امحا، تغییر سقف عرضه، تغییر قواعد پشتوانه و تغییر نقش‌های مدیریتی نیازمند درخواست و
              تأیید جداگانه‌اند.
            </p>
          </PanelBody>
        </Panel>
      </section>

      <Panel title="هفت اسکناس پارسه" subtitle="هر اسکناس: یک چهره، یک نقش‌مایه، یک هویت">
        <PanelBody>
          <div className="prs-note-strip">
            {DENOMINATION_ARTWORK.map((item) => (
              <NoteArt
                key={item.denomination}
                svg={item.front}
                denomination={item.denomination}
                figureFa={'portraitFa' in item ? (item.portraitFa as string) : undefined}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Alert tone="info" title="این سامانه ارز قانونی نیست">
        {disclaimer?.body_fa ??
          'پارسه یک واحد حساب داخلی برای یک گروه مورد اعتماد است. هیچ اتصالی به بانک، کارت‌شاپ یا شبکهٔ پرداخت عمومی وجود ندارد و هیچ مسیر کدی برای چنین اتصالی در سامانه پیاده‌سازی نشده است.'}
        <div style={{ marginTop: 'var(--prs-space-3)' }}>
          <Link to="/login" className="prs-btn prs-btn--outline prs-btn--sm">
            ورود به حساب
          </Link>
          <span style={{ marginInlineStart: 'var(--prs-space-3)' }} className="prs-small prs-muted">
            شعبه‌های اسکناس: {DENOMINATIONS.map((value) => value.toLocaleString('fa-IR')).join(' · ')}
          </span>
        </div>
      </Alert>

      <div className="prs-row prs-center" style={{ justifyContent: 'center' }}>
        <Button variant="quiet" icon="notes" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          بازگشت به بالای صفحه
        </Button>
      </div>
    </div>
  );
}
