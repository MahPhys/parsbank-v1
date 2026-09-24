/**
 * Banknotes — the physical side of the currency.
 *
 * Three things live here: the notes the account holder carries, the deposit /
 * withdrawal pair that moves a note between the vault and a wallet (both are ledger
 * movements), and the public authenticity check that anyone can run on a note in
 * their hand. The registry — not the paper — decides what a note is.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Field,
  Loading,
  Panel,
  PanelBody,
  Select,
  Stat,
  TextInput,
  formatPrs,
  formatRelative,
  labelFa,
  statusTone,
  toPersianDigits,
} from '@parsbank/ui';
import { banknoteFront } from '@parsbank/design-system';
import { DENOMINATION_THEMES, DENOMINATIONS } from '@parsbank/config/constants';
import type { BanknoteDto, BanknoteVerificationResult, WalletSummary } from '@parsbank/types';
import { api, describeError } from '../lib/api.ts';
import { useAsync } from '../lib/hooks.ts';

export function Banknotes({ standalone }: { standalone?: boolean }) {
  const authed = !standalone;
  const notes = useAsync<{ items: BanknoteDto[] }>(
    () => (authed ? api.get<{ items: BanknoteDto[] }>('/me/banknotes') : Promise.resolve({ items: [] })),
    [authed],
  );
  const wallets = useAsync<{ items: WalletSummary[] }>(
    () => (authed ? api.get<{ items: WalletSummary[] }>('/me/wallets') : Promise.resolve({ items: [] })),
    [authed],
  );

  const [serial, setSerial] = useState('');
  const [walletRef, setWalletRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'critical' | 'info'; text: string } | null>(null);

  const [verifySerial, setVerifySerial] = useState('');
  const [verification, setVerification] = useState<BanknoteVerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const list = notes.data?.items ?? [];
  const walletList = wallets.data?.items ?? [];
  const selectedWallet = walletRef || walletList[0]?.publicRef || '';

  const move = async (direction: 'deposit' | 'withdraw') => {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/me/banknotes/${direction}`, { serialNumber: serial.trim(), walletRef: selectedWallet });
      setMessage({
        tone: 'success',
        text:
          direction === 'deposit'
            ? 'اسکناس واریز شد و ارزش آن به همین کیف پول منتقل گردید.'
            : 'اسکناس برداشت شد؛ ارزش آن از کیف پول کسر و به اسکناس در گردش منتقل شد.',
      });
      setSerial('');
      await Promise.all([notes.reload(), wallets.reload()]);
    } catch (caught) {
      setMessage({ tone: 'critical', text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setVerifyError(null);
    setVerification(null);
    try {
      const result = await api.post<BanknoteVerificationResult>('/banknotes/verify', { serialNumber: verifySerial.trim() }, { anonymous: true });
      setVerification(result);
    } catch (caught) {
      setVerifyError(describeError(caught));
    }
  };

  const heldByDenomination = DENOMINATIONS.map((denomination) => ({
    denomination,
    count: list.filter((note) => note.denominationMinor === denomination).length,
    value: list.filter((note) => note.denominationMinor === denomination).reduce((sum, note) => sum + note.denominationMinor, 0),
  })).filter((item) => item.count > 0);

  return (
    <div className="prs-container prs-container-wide prs-stack-6">
      <div className="prs-row prs-between prs-wrap">
        <div>
          <h1>{authed ? 'اسکناس‌های من' : 'بررسی اصالت اسکناس'}</h1>
          <p className="prs-small prs-muted">
            هر برگ اسکناس سریال یکتا دارد و در دفتر اسکناس ثبت می‌شود: تخصیص، تحویل، واریز، برداشت، بررسی،
            انسداد و ثبت مفقودی یا مسروقگی.
          </p>
        </div>
        <div className="prs-row-2">
          {authed ? (
            <Link className="prs-btn prs-btn--sm prs-btn--outline" to="/dashboard">
              نمای حساب
            </Link>
          ) : (
            <Link className="prs-btn prs-btn--sm prs-btn--primary" to="/login">
              ورود به حساب
            </Link>
          )}
        </div>
      </div>

      {authed ? (
        <>
          <section className="prs-grid prs-grid-4">
            <Stat label="اسکناس‌های نزد شما" value={`${toPersianDigits(list.length)} برگ`} hint="فقط اسکناس‌های تخصیص‌یافته به این حساب" icon="notes" />
            <Stat
              label="ارزش اسمی"
              value={`${formatPrs(list.reduce((sum, note) => sum + note.denominationMinor, 0), true)}`}
              hint="جمع رقم چاپ‌شده روی برگ‌ها"
              icon="chart"
            />
            <Stat label="آبشده (صادرشده)" value={`${toPersianDigits(list.filter((note) => note.status === 'DEPOSITED').length)} برگ`} hint="ارزش در کیف پول ثبت شده است" icon="wallet" />
            <Stat label="سری‌های موجود" value={`${toPersianDigits(heldByDenomination.length)} سری از ۷`} hint="هر رقم اسکناس، چهره و نقش‌مایهٔ خودش را دارد" icon="grid" />
          </section>

          {message ? <Alert tone={message.tone === 'success' ? 'success' : message.tone === 'critical' ? 'critical' : 'info'}>{message.text}</Alert> : null}

          <section className="prs-split">
            <Panel title="اسکناس‌های من" icon="notes">
              <PanelBody tight>
                {notes.loading && list.length === 0 ? (
                  <Loading />
                ) : (
                  <DataTable
                    compact
                    rows={list}
                    rowKey={(row) => row.id}
                    empty={<div className="prs-empty">هنوز اسکناسی به این حساب تخصیص نیافته است.</div>}
                    columns={[
                      { key: 'serial', header: 'سریال', numeric: true, render: (row) => <span className="prs-serial">{row.serialNumber}</span> },
                      { key: 'denomination', header: 'ارزش', numeric: true, render: (row) => <span className="prs-num">{formatPrs(row.denominationMinor)}</span> },
                      { key: 'series', header: 'سری', render: (row) => <span className="prs-small">{row.seriesLabel}</span> },
                      {
                        key: 'status',
                        header: 'وضعیت',
                        render: (row) => (
                          <Badge tone={statusTone(row.status)} dot>
                            {labelFa(row.status)}
                          </Badge>
                        ),
                      },
                      { key: 'holder', header: 'دارنده', render: (row) => <span className="prs-small">{row.holderNameFa ?? 'خزانه'}</span> },
                      { key: 'event', header: 'آخرین رویداد', render: (row) => <span className="prs-small prs-muted">{formatRelative(row.lastEventAt)}</span> },
                    ]}
                  />
                )}
              </PanelBody>
            </Panel>

            <div className="prs-stack-5">
              <Panel title="واریز یا برداشت اسکناس" subtitle="حرکت میان اسکناس و کیف پول، در دفتر کل" icon="exchange">
                <PanelBody>
                  <div className="prs-stack-4">
                    <Field label="سریال اسکناس" hint="سریال روی حاشیهٔ برگ چاپ شده است.">
                      <TextInput numeric value={serial} onChange={(event) => setSerial(event.target.value)} placeholder="PRS-100-0001-00001-H" />
                    </Field>
                    <Field label="کیف پول">
                      <Select value={selectedWallet} onChange={(event) => setWalletRef(event.target.value)}>
                        {walletList.map((wallet) => (
                          <option key={wallet.walletId} value={wallet.publicRef}>
                            {wallet.labelFa} — {formatPrs(wallet.balanceMinor, true)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="prs-row prs-wrap">
                      <Button variant="primary" icon="receive" loading={busy} disabled={serial.trim().length < 4} onClick={() => void move('deposit')}>
                        واریز به کیف پول
                      </Button>
                      <Button variant="outline" icon="send" loading={busy} disabled={serial.trim().length < 4} onClick={() => void move('withdraw')}>
                        برداشت از کیف پول
                      </Button>
                    </div>
                    <p className="prs-small prs-muted">
                      واریز: ارزش برگ از حساب اسکناس در گردش به کیف پول شما منتقل می‌شود. برداشت: برعکس.
                      در هر دو حالت، برگ نزد شما می‌ماند ولی وضعیت آن در دفتر اسکناس ثبت می‌شود.
                    </p>
                  </div>
                </PanelBody>
              </Panel>

              {heldByDenomination.length > 0 ? (
                <Panel title="ترکیب اسکناس‌ها" icon="chart">
                  <PanelBody>
                    <div className="prs-stack-3">
                      {heldByDenomination.map((item) => (
                        <div key={item.denomination} className="prs-row prs-between">
                          <span className="prs-num">{formatPrs(item.denomination, true)}</span>
                          <span className="prs-small prs-muted">
                            {toPersianDigits(item.count)} برگ · {formatPrs(item.value, true)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </PanelBody>
                </Panel>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      <Panel title="بررسی اصالت اسکناس" subtitle="سریال را از روی برگ وارد کنید — نیازی به ورود نیست" icon="seal">
        <PanelBody>
          <form className="prs-stack-4" onSubmit={verify}>
            <Field label="سریال اسکناس">
              <TextInput numeric value={verifySerial} onChange={(event) => setVerifySerial(event.target.value)} placeholder="PRS-050-0003-00012-A" />
            </Field>
            <Button type="submit" variant="primary" icon="search" disabled={verifySerial.trim().length < 4}>
              بررسی برگ
            </Button>
          </form>

          {verifyError ? <Alert tone="critical" title="بررسی انجام نشد">{verifyError}</Alert> : null}

          {verification ? (
            <div style={{ marginTop: 'var(--prs-space-5)' }}>
              <Alert
                tone={
                  verification.outcome === 'GENUINE'
                    ? 'success'
                    : verification.outcome === 'REPORTED_STOLEN' || verification.outcome === 'INVALID_CHECKSUM'
                      ? 'critical'
                      : 'warning'
                }
                title={verification.outcome === 'GENUINE' ? 'این برگ اصیل است' : verification.messageFa}
              >
                <dl className="prs-kv" style={{ marginTop: 'var(--prs-space-3)' }}>
                  <div style={{ display: 'contents' }}>
                    <dt>سریال</dt>
                    <dd className="prs-serial">{verification.serialNumber}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>ارزش</dt>
                    <dd className="prs-num">{verification.denominationMinor ? formatPrs(verification.denominationMinor, true) : '—'}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>سری</dt>
                    <dd>{verification.seriesLabel ?? '—'}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>وضعیت ثبت‌شده</dt>
                    <dd>
                      <Badge tone={statusTone(verification.status)}>{labelFa(verification.status)}</Badge>
                    </dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>کنترل رقم</dt>
                    <dd>{verification.checksumValid ? 'درست' : 'نادرست'}</dd>
                  </div>
                  <div style={{ display: 'contents' }}>
                    <dt>زمان بررسی</dt>
                    <dd>{formatRelative(verification.verifiedAt)}</dd>
                  </div>
                </dl>
              </Alert>
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel title="هفت رقم اسکناس پارسه" subtitle="هر برگ: یک چهره، یک نقش‌مایه، یک هویت بصری" icon="grid">
        <PanelBody>
          <div className="prs-note-strip">
            {DENOMINATIONS.map((denomination) => (
              <figure key={denomination} className="prs-note-thumb" style={{ margin: 0 }}>
                <div className="prs-note" role="img" aria-label={`اسکناس ${denomination} پارسه`} dangerouslySetInnerHTML={{ __html: banknoteFront(denomination) }} />
                <figcaption className="prs-note-thumb__denom">
                  {formatPrs(denomination, true)} · {DENOMINATION_THEMES[denomination]?.portraitFa ?? ''}
                </figcaption>
              </figure>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
