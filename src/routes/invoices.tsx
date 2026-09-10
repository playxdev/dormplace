import { back, page, requirePermission, route } from '../app';
import { Empty, Head, Icon, Kpi, Layout, PageHead, RailStat, Tag } from '../ui/layout';
import { baht, bahtText, currentPeriod, fromSatang, num, statusKey, str, thaiDate, thaiPeriod, today } from '../lib/util';
import { promptPayPayloadSatang } from '../lib/promptpay';
import { qrSvg } from '../lib/qr';
import { ulid } from '../lib/ulid';
import type { Building, Contract, Invoice, InvoiceItem, Payment, Room } from '../repo/types';
import type { Resident } from '../repo';
import type { T } from '../lib/i18n';
import type { Ctx } from '../app';

const app = route();

app.get('/invoices', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.invoice.read');
  const repos = c.get('repos');
  const period = c.req.query('period') || '';
  const status = c.req.query('status') || '';
  const now = today();
  const [all, periods, pending] = await Promise.all([
    repos.invoices.rows(tctx, { period: period || undefined }),
    repos.invoices.periods(tctx),
    repos.payments.pendingRows(tctx),
  ]);

  // The status filter runs over the effective status, not the stored one:
  // "overdue" and "partial" are not columns, so the database cannot filter them.
  const rows = status ? all.filter((r) => statusKey(r.effective_status) === status) : all;

  const totals = rows.reduce(
    (acc, r) => ({ billed: acc.billed + r.total, paid: acc.paid + r.paid }),
    { billed: 0, paid: 0 },
  );

  return c.html(
    <Layout {...page(c, t('nav.invoices'))}>
      <PageHead title={t('nav.invoices')} sub={period ? thaiPeriod(period) : t('common.all')}>
        <form method="get" action="/invoices" class="btn-row">
          <select name="period">
            <option value="">{t('common.all')}</option>
            {periods.map((p) => <option value={p} selected={p === period}>{thaiPeriod(p)}</option>)}
          </select>
          <select name="status">
            <option value="">{t('common.all')}</option>
            {(['unpaid', 'partial', 'paid', 'void'] as const).map((s) => (
              <option value={s} selected={s === status}>{t(`invoice.${s}` as 'invoice.paid')}</option>
            ))}
          </select>
          <button class="btn" type="submit">{t('common.search')}</button>
        </form>
        <a class="btn primary" href={`/billing?period=${period || currentPeriod()}`}>{t('nav.billing')}</a>
      </PageHead>

      {pending.length > 0 ? (
        <div class="card" style="margin-bottom:1rem">
          <h2>{t('payment.pending')} <Tag kind="overdue" label={String(pending.length)} /></h2>
          <p class="small muted">{t('payment.pending_hint')}</p>
          <table>
            <tbody>
              {pending.map((p) => (
                <tr>
                  <td><a href={`/invoices/${p.invoice_id}`}>{p.number}</a>
                    <div class="small muted">{p.room_number} · {p.tenant_name}</div></td>
                  <td class="small">{thaiDate(p.paid_at)}<div class="small muted">{p.ref ?? ''}</div></td>
                  <td class="num">฿{baht(p.amount)}</td>
                  <td class="num"><a class="btn sm" href={`/invoices/${p.invoice_id}`}>{t('payment.verify')}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div class="grid c3">
        <Kpi label={t('report.billed')} value={baht(totals.billed)} icon="receipt" tone="amber" currency
          meta={<>{rows.length} {t('invoice.title')}</>} />
        <Kpi label={t('report.collected')} value={baht(totals.paid)} icon="check" tone="green" currency
          meta={<>{totals.billed ? Math.round((totals.paid / totals.billed) * 100) : 0}% {t('report.rate')}</>} />
        <Kpi label={t('dash.outstanding')} value={baht(totals.billed - totals.paid)} icon="alert" tone="red" currency />
      </div>

      <div class="card flush" style="margin-top:1rem">
        {rows.length === 0 ? <Empty text={t('invoice.none')} icon="wallet" /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('invoice.number')}</th>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.name')}</th>
                  <th>{t('invoice.due_date')}</th>
                  <th class="num">{t('invoice.total')}</th>
                  <th class="num">{t('invoice.remaining')}</th>
                  <th class="num">{t('room.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusKey(r.effective_status);
                  return (
                    <tr>
                      <td><a href={`/invoices/${r.invoice_id}`}>{r.number}</a><div class="small muted">{thaiPeriod(r.period)}</div></td>
                      <td>{r.room_number}</td>
                      <td class="small">{r.party_name}</td>
                      <td class="small">{thaiDate(r.due_date)}</td>
                      <td class="num">฿{baht(r.total)}</td>
                      <td class="num">{r.total - r.paid > 0 ? `฿${baht(r.total - r.paid)}` : '-'}</td>
                      <td class="num"><Tag kind={st} label={t(`invoice.${st}` as 'invoice.paid')} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>,
  );
});

interface FullInvoice {
  invoice: Invoice; items: InvoiceItem[]; payments: Payment[];
  /** Verified payments only, and what is left. Neither is stored. */
  paid: number; remaining: number;
  room: Room; tenant: Resident; building: Building; contract: Contract | null;
}

async function loadInvoice(c: Ctx, invoiceId: string): Promise<FullInvoice> {
  const tctx = c.get('tctx');
  const repos = c.get('repos');
  const full = await repos.invoices.full(tctx, invoiceId);
  const [room, tenant, building, contract] = await Promise.all([
    repos.rooms.byId(tctx, full.invoice.room_id),
    repos.parties.resident(tctx, full.invoice.party_id),
    repos.buildings.byId(tctx, full.invoice.building_id),
    repos.contracts.findById(tctx, full.invoice.contract_id),
  ]);
  return { ...full, room, tenant, building, contract };
}

/** The printable A4 document, reused for both the invoice and the receipt. */
function Paper({ d, t, receipt }: { d: FullInvoice; t: T; receipt: boolean }) {
  const { invoice, items, building, room, tenant, payments, paid, remaining } = d;
  const payload = building.promptpay_id && remaining > 0
    ? promptPayPayloadSatang(building.promptpay_id, remaining)
    : null;

  return (
    <div class="paper">
      <div class="inv-head">
        <div>
          <div style="font-weight:700;font-size:1.05rem">{building.name}</div>
          <div class="small">{building.address ?? ''}</div>
          {building.tax_id ? <div class="small">เลขประจำตัวผู้เสียภาษี {building.tax_id}</div> : null}
        </div>
        <div style="text-align:right">
          <div class="inv-title">{receipt ? t('invoice.receipt') : t('invoice.title')}</div>
          <div class="small">{t('invoice.number')} {invoice.number}</div>
          <div class="small">{t('meter.period')} {thaiPeriod(invoice.period)}</div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;gap:1rem;margin-bottom:.8rem">
        <div>
          <div class="small muted">{t('invoice.bill_to')}</div>
          <div style="font-weight:600">{tenant.name}</div>
          <div class="small">{t('room.number')} {room.number} · {t('room.floor')} {room.floor}</div>
          {tenant.phone ? <div class="small">{tenant.phone}</div> : null}
        </div>
        <div style="text-align:right">
          <div class="small">{t('invoice.issue_date')}: {thaiDate(invoice.issue_date)}</div>
          <div class="small">{t('invoice.due_date')}: <strong>{thaiDate(invoice.due_date)}</strong></div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:45%">{t('invoice.item')}</th>
            <th class="num">{t('invoice.qty')}</th>
            <th class="num">{t('invoice.unit_price')}</th>
            <th class="num">{t('invoice.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr>
              <td>{it.label}{it.detail ? <div class="small muted">{it.detail}</div> : null}</td>
              <td class="num">{it.qty}{it.unit ? ` ${it.unit}` : ''}</td>
              <td class="num">{baht(it.unit_price)}</td>
              <td class="num">{baht(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table class="totals" style="margin-top:.6rem">
        <tbody>
          <tr><td>{t('invoice.subtotal')}</td><td class="num">{baht(invoice.subtotal)}</td></tr>
          {invoice.discount > 0 ? <tr><td>{t('invoice.discount')}</td><td class="num">-{baht(invoice.discount)}</td></tr> : null}
          <tr class="grand"><td>{t('invoice.total')}</td><td class="num">฿{baht(invoice.total)}</td></tr>
          {paid > 0 ? <tr><td>{t('invoice.paid')}</td><td class="num">-{baht(paid)}</td></tr> : null}
          {remaining > 0 ? <tr class="grand"><td>{t('invoice.remaining')}</td><td class="num">฿{baht(remaining)}</td></tr> : null}
        </tbody>
      </table>

      <div class="small" style="text-align:right;margin-top:.2rem">
        ({bahtText(receipt ? paid : invoice.total)})
      </div>

      {receipt ? (
        <div style="margin-top:1.2rem">
          <div class="small muted">{t('payment.title')}</div>
          <table>
            <tbody>
              {payments.map((p) => (
                <tr>
                  <td>{thaiDate(p.paid_at)}</td>
                  <td>{t(`payment.${p.method}` as 'payment.cash')}</td>
                  <td>{p.ref ?? ''}</td>
                  <td class="num">{baht(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style="margin-top:2.5rem;text-align:right">
            <div style="border-top:1px solid #000;display:inline-block;padding-top:.3rem;min-width:200px;text-align:center">
              ผู้รับเงิน
            </div>
          </div>
        </div>
      ) : payload ? (
        <div class="qr-box">
          <div dangerouslySetInnerHTML={{ __html: qrSvg(payload, 150) }} />
          <div>
            <div style="font-weight:600">{t('invoice.scan_to_pay')}</div>
            <div class="small">พร้อมเพย์ · {building.promptpay_name ?? building.name}</div>
            <div style="font-size:1.3rem;font-weight:700">฿{baht(remaining)}</div>
            <div class="small muted">สแกนด้วยแอปธนาคารใดก็ได้ · Thai QR Payment</div>
          </div>
        </div>
      ) : (
        <p class="small muted" style="margin-top:1rem">ยังไม่ได้ตั้งค่าพร้อมเพย์ในข้อมูลอาคาร</p>
      )}
    </div>
  );
}

app.get('/invoices/:id', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.invoice.read');
  const d = await loadInvoice(c, c.req.param('id'));
  const { invoice, paid, remaining } = d;
  const st = statusKey(c.get('repos').invoices.effectiveStatus(invoice, paid, today()));
  const pending = d.payments.filter((p) => p.status === 'REPORTED');
  const settled = d.payments.filter((p) => p.status === 'VERIFIED');

  return c.html(
    <Layout {...page(c, invoice.number)}>
      <PageHead title={invoice.number} sub={`${d.building.name} ${d.room.number} · ${d.tenant.display_name ?? ''}`}>
        <a class="btn" href="/invoices">{t('common.back')}</a>
        <a class="btn" href={`/invoices/${invoice.invoice_id}/print`} target="_blank">{t('invoice.print')}</a>
        {paid > 0
          ? <a class="btn" href={`/invoices/${invoice.invoice_id}/receipt`} target="_blank">{t('invoice.receipt')}</a>
          : null}
      </PageHead>

      <div class="grid c2">
        <div>
          <Paper d={d} t={t} receipt={false} />
        </div>

        <div>
          <div class="card">
            <h2>{t('payment.record')} <Tag kind={st} label={t(`invoice.${st}` as 'invoice.paid')} /></h2>
            {remaining > 0 && invoice.status !== 'VOID' ? (
              <form method="post" action={`/invoices/${invoice.invoice_id}/payments`} enctype="multipart/form-data">
                <div class="row">
                  <div class="field">
                    <label for="amount">{t('payment.amount')}</label>
                    <input id="amount" name="amount" inputmode="decimal" required value={String(fromSatang(remaining))} />
                  </div>
                  <div class="field">
                    <label for="paid_at">{t('payment.date')}</label>
                    <input id="paid_at" name="paid_at" type="date" value={today()} required />
                  </div>
                </div>
                <div class="row">
                  <div class="field">
                    <label for="method">{t('payment.method')}</label>
                    <select id="method" name="method">
                      <option value="promptpay">{t('payment.promptpay')}</option>
                      <option value="transfer">{t('payment.transfer')}</option>
                      <option value="cash">{t('payment.cash')}</option>
                      <option value="card">{t('payment.card')}</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="ref">{t('payment.ref')}</label>
                    <input id="ref" name="ref" />
                  </div>
                </div>
                <div class="field">
                  <label for="slip">{t('payment.slip')} <span class="muted">({t('common.optional')})</span></label>
                  <input id="slip" name="slip" type="file" accept="image/*" />
                </div>
                <button class="btn primary" type="submit">{t('payment.record')}</button>
              </form>
            ) : (
              <p class="muted">{invoice.status === 'VOID' ? t('invoice.void') : t('invoice.paid')}</p>
            )}
          </div>

          {pending.length > 0 ? (
            <div class="card">
              <h2>{t('payment.pending')} <Tag kind="overdue" label={String(pending.length)} /></h2>
              <p class="small muted">{t('payment.pending_hint')}</p>
              <table>
                <tbody>
                  {pending.map((p) => (
                    <tr>
                      <td>{thaiDate(p.paid_at)}<div class="small muted">{t(`payment.${p.method}` as 'payment.cash')}</div></td>
                      <td class="small">{p.ref ?? ''}
                        {p.slip_key ? <div><a href={`/files/${p.slip_key}`} target="_blank">{t('payment.slip')}</a></div> : null}
                      </td>
                      <td class="num">฿{baht(p.amount)}</td>
                      <td class="num">
                        <div class="btn-row">
                          <form method="post" action={`/payments/${p.id}/verify`}
                            onsubmit={`return confirm('${t('payment.verify_confirm')}')`}>
                            <button class="btn sm primary" type="submit">{t('payment.verify')}</button>
                          </form>
                          <form method="post" action={`/payments/${p.id}/delete`}
                            onsubmit={`return confirm('${t('payment.reject_confirm')}')`}>
                            <button class="btn sm danger" type="submit">{t('payment.reject')}</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div class="card">
            <h2>{t('payment.title')}</h2>
            {settled.length === 0 ? <Empty text={t('payment.none')} /> : (
              <table>
                <tbody>
                  {settled.map((p) => (
                    <tr>
                      <td>{thaiDate(p.paid_at)}<div class="small muted">{t(`payment.${p.method}` as 'payment.cash')}</div></td>
                      <td class="small">{p.ref ?? ''}
                        {p.slip_key ? <div><a href={`/files/${p.slip_key}`} target="_blank">{t('payment.slip')}</a></div> : null}
                        {p.reported_by_user_id ? <div class="small muted">{t('payment.by_tenant')}</div> : null}
                      </td>
                      <td class="num">฿{baht(p.amount)}</td>
                      <td class="num">
                        <form method="post" action={`/payments/${p.id}/delete`}
                          onsubmit={`return confirm('${t('common.confirm_delete')}')`}>
                          <button class="btn sm danger" type="submit">{t('common.delete')}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {invoice.status !== 'VOID' && paid === 0 ? (
            <form method="post" action={`/invoices/${invoice.invoice_id}/void`} class="card"
              onsubmit={`return confirm('${t('common.confirm_delete')}')`}>
              {/* Required: an invoice cancelled for no recorded reason is the
                  shape internal fraud takes in this business. */}
              <div class="field">
                <label for="void_reason">{t('invoice.void_reason')}</label>
                <input id="void_reason" name="reason" required />
              </div>
              <button class="btn danger" type="submit">{t('invoice.void')}</button>
            </form>
          ) : null}
        </div>
      </div>
    </Layout>,
  );
});

function printable(d: FullInvoice, t: T, receipt: boolean) {
  return (
    <html lang="th">
      <head>
        <Head title={`${receipt ? t('invoice.receipt') : t('invoice.title')} ${d.invoice.number}`} />
      </head>
      <body>
        <div style="padding:1rem">
          <div class="btn-row no-print" style="max-width:210mm;margin:0 auto 1rem">
            <button class="btn primary" onclick="window.print()">{t('invoice.print')}</button>
            <a class="btn" href={`/invoices/${d.invoice.id}`}>{t('common.back')}</a>
          </div>
          <Paper d={d} t={t} receipt={receipt} />
        </div>
      </body>
    </html>
  );
}

app.get('/invoices/:id/print', async (c) => {
  const d = await loadInvoice(c, c.req.param('id'));
  if (!d) return c.notFound();
  return c.html(printable(d, c.get('t'), false));
});

app.get('/invoices/:id/receipt', async (c) => {
  const d = await loadInvoice(c, c.req.param('id'));
  if (!d) return c.notFound();
  return c.html(printable(d, c.get('t'), true));
});

/* ---------- payments ---------- */

app.post('/invoices/:id/payments', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.payment.record');
  const repos = c.get('repos');
  const invoiceId = c.req.param('id');
  await repos.invoices.byId(tctx, invoiceId);

  const f = await c.req.formData();
  const amount = Math.round(num(f.get('amount')) * 100);
  if (amount <= 0) return back(c, `/invoices/${invoiceId}`, 'amount_invalid', true);

  let slipKey: string | null = null;
  const slip = f.get('slip');
  if (slip instanceof File && slip.size > 0) {
    slipKey = `t/${tctx.tenantId}/slips/${invoiceId}/${ulid()}`;
    await c.env.FILES.put(slipKey, await slip.arrayBuffer(), {
      httpMetadata: { contentType: slip.type || 'application/octet-stream' },
    });
  }

  const method = str(f.get('method')).toUpperCase() || 'PROMPTPAY';
  const payment = await repos.payments.insert(tctx, {
    invoice_id: invoiceId,
    amount,
    paid_at: str(f.get('paid_at')) || today(),
    method: method as 'PROMPTPAY',
    ref: str(f.get('ref')) || null,
    slip_key: slipKey,
  });
  // Staff taking money at the desk *is* the verification step. Left as
  // REPORTED it would sit in their own queue and the resident would keep
  // seeing a balance the office considers settled.
  await repos.payments.decide(tctx, payment.payment_id, 'VERIFIED');
  return back(c, `/invoices/${invoiceId}`, 'paid');
});

/* A tenant-submitted notice the owner has matched against their bank statement.
   Only now does the money become real to the rest of the system. */
app.post('/payments/:id/verify', async (c) => {
  const tctx = c.get('tctx');
  const repos = c.get('repos');
  const payment = await repos.payments.byId(tctx, c.req.param('id'));
  // decide() guards on status = 'REPORTED', so verifying twice changes nothing
  // and writes no second audit row.
  await repos.payments.decide(tctx, payment.payment_id, 'VERIFIED');
  return back(c, `/invoices/${payment.invoice_id}`, 'verified');
});

app.post('/payments/:id/reject', async (c) => {
  const tctx = c.get('tctx');
  const repos = c.get('repos');
  const payment = await repos.payments.byId(tctx, c.req.param('id'));
  const reason = str((await c.req.formData()).get('reason'));
  if (!reason) return back(c, `/invoices/${payment.invoice_id}`, 'missing', true);
  // The reason is shown to the resident verbatim. "Rejected" with nothing after
  // it is how someone who really did pay ends up phoning the office.
  await repos.payments.decide(tctx, payment.payment_id, 'REJECTED', reason);
  return back(c, `/invoices/${payment.invoice_id}`, 'saved');
});

app.post('/payments/:id/delete', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.payment.verify');
  const repos = c.get('repos');
  const payment = await repos.payments.byId(tctx, c.req.param('id'));
  // Soft delete, and the balance follows automatically: it is derived from the
  // payments still visible, so there is no total to correct and nothing to get
  // wrong. The slip stays in R2 as evidence of what was submitted.
  await repos.payments.softDelete(tctx, payment.payment_id);
  return back(c, `/invoices/${payment.invoice_id}`, 'deleted');
});

app.post('/invoices/:id/void', async (c) => {
  const tctx = c.get('tctx');
  const invoiceId = c.req.param('id');
  const reason = str((await c.req.formData()).get('reason'));
  if (!reason) return back(c, `/invoices/${invoiceId}`, 'missing', true);
  // OWNER only, reason required, audited — checked inside void().
  await c.get('repos').invoices.void(tctx, invoiceId, reason);
  return back(c, `/invoices/${invoiceId}`, 'voided');
});

/* ---------- slip images ---------- */

app.get('/files/*', async (c) => {
  const key = new URL(c.req.url).pathname.replace(/^\/files\//, '');
  const obj = await c.env.FILES.get(key);
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
});

export default app;
