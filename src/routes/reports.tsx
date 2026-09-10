import { page, requirePermission, route } from '../app';
import { Empty, Layout, PageHead } from '../ui/layout';
import { baht, currentPeriod, daysBetween, shiftPeriod, thaiDate, thaiPeriod, today } from '../lib/util';

const app = route();

interface MonthRow { period: string; billed: number; collected: number; count: number }

app.get('/reports', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.report.read');
  const repos = c.get('repos');
  const now = today();
  const from = shiftPeriod(currentPeriod(), -11);

  const [months, allInvoices, byKind] = await Promise.all([
    repos.stats.monthly(tctx, from),
    repos.invoices.rows(tctx, { limit: 1000 }),
    repos.stats.byKind(tctx, from),
  ]);

  // Aged receivables: what is still owed, oldest first. `paid` counts verified
  // payments only, so a slip awaiting a decision keeps the debt on the list —
  // which is where the operator needs to see it.
  const aging = allInvoices
    .filter((r) => r.status === 'UNPAID' && r.total > r.paid)
    .map((r) => ({ ...r, daysLate: Math.max(0, daysBetween(r.due_date, now)) }))
    .sort((a, b) => b.daysLate - a.daysLate);

  const buckets = [
    { label: '1–7 วัน', min: 1, max: 7 },
    { label: '8–30 วัน', min: 8, max: 30 },
    { label: '31–60 วัน', min: 31, max: 60 },
    { label: '60+ วัน', min: 61, max: 100000 },
  ].map((b) => {
    const rows = aging.filter((a) => a.daysLate >= b.min && a.daysLate <= b.max);
    return { ...b, count: rows.length, amount: rows.reduce((s, r) => s + (r.total - r.paid), 0) };
  });
  const notDue = aging.filter((a) => a.daysLate === 0);
  const maxBilled = Math.max(1, ...months.map((m) => m.billed));

  return c.html(
    <Layout {...page(c, t('report.title'))}>
      <PageHead title={t('report.title')} sub="12 เดือนล่าสุด">
        <a class="btn" href="/reports/export.csv">{t('report.export')}</a>
      </PageHead>

      <div class="card">
        <h2>{t('report.income')}</h2>
        {months.length === 0 ? <Empty text={t('common.none')} /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('report.month')}</th>
                  <th class="num">{t('invoice.title')}</th>
                  <th class="num">{t('report.billed')}</th>
                  <th class="num">{t('report.collected')}</th>
                  <th class="num">{t('dash.outstanding')}</th>
                  <th class="num">{t('report.rate')}</th>
                  <th style="width:26%"></th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const rate = m.billed ? Math.round((m.collected / m.billed) * 100) : 0;
                  return (
                    <tr>
                      <td><a href={`/invoices?period=${m.period}`}>{thaiPeriod(m.period)}</a></td>
                      <td class="num">{m.count}</td>
                      <td class="num">฿{baht(m.billed)}</td>
                      <td class="num" style="color:var(--success)">฿{baht(m.collected)}</td>
                      <td class="num" style="color:var(--danger)">฿{baht(m.billed - m.collected)}</td>
                      <td class="num">{rate}%</td>
                      <td>
                        <div style="background:var(--surface-2);border-radius:4px;height:12px;position:relative;overflow:hidden">
                          <div style={`background:var(--border-strong);height:100%;width:${(m.billed / maxBilled) * 100}%`} />
                          <div style={`background:var(--success);height:100%;width:${(m.collected / maxBilled) * 100}%;position:absolute;top:0;left:0`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div class="grid c2" style="margin-top:1rem">
        <div class="card">
          <h2>{t('report.aging')}</h2>
          <table>
            <thead><tr><th>{t('report.aging')}</th><th class="num">{t('invoice.title')}</th><th class="num">{t('invoice.remaining')}</th></tr></thead>
            <tbody>
              <tr>
                <td>ยังไม่ครบกำหนด</td>
                <td class="num">{notDue.length}</td>
                <td class="num">฿{baht(notDue.reduce((s, r) => s + (r.total - r.paid), 0))}</td>
              </tr>
              {buckets.map((b) => (
                <tr>
                  <td>{b.label}</td>
                  <td class="num">{b.count}</td>
                  <td class="num" style={b.amount ? 'color:var(--danger)' : ''}>฿{baht(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>{t('report.income')} — {t('invoice.item')}</h2>
          <table>
            <tbody>
              {byKind.map((k) => (
                <tr>
                  <td>{t(`invoice.${k.kind}` as 'invoice.rent')}</td>
                  <td class="num">฿{baht(k.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <h2>{t('report.receivable')}</h2>
        {aging.length === 0 ? <Empty text={t('common.none')} /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('invoice.number')}</th>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.name')}</th>
                  <th>{t('invoice.due_date')}</th>
                  <th class="num">{t('common.days')}</th>
                  <th class="num">{t('invoice.remaining')}</th>
                </tr>
              </thead>
              <tbody>
                {aging.slice(0, 60).map((r) => (
                  <tr>
                    <td><a href={`/invoices/${r.invoice_id}`}>{r.number}</a></td>
                    <td>{r.room_number}</td>
                    <td class="small">{r.party_name}</td>
                    <td class="small">{thaiDate(r.due_date)}</td>
                    <td class="num" style={r.daysLate > 30 ? 'color:var(--danger);font-weight:600' : ''}>{r.daysLate || '-'}</td>
                    <td class="num">฿{baht(r.total - r.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>,
  );
});

/** CSV for the owner's accountant: one row per invoice, UTF-8 BOM so Excel reads Thai. */
app.get('/reports/export.csv', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.report.export');
  const rows = await c.get('repos').invoices.rows(tctx, { limit: 1000 });
  const header = ['invoice_no', 'period', 'building', 'room', 'tenant', 'issue_date', 'due_date', 'subtotal', 'discount', 'total', 'paid', 'outstanding', 'status'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.number, r.period, r.building_name, r.room_number, r.party_name, r.issue_date, r.due_date,
      (r.subtotal / 100).toFixed(2), (r.discount / 100).toFixed(2), (r.total / 100).toFixed(2),
      (r.paid / 100).toFixed(2), ((r.total - r.paid) / 100).toFixed(2), r.effective_status,
    ].map((v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  return new Response('﻿' + lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="invoices-${today()}.csv"`,
    },
  });
});

export default app;
