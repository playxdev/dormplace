import { back, page, route } from '../app';
import { Empty, Icon, Kpi, Layout, PageHead, RailStat } from '../ui/layout';
import { baht, currentPeriod, id, periodBounds, str, thaiPeriod, today } from '../lib/util';
import { buildDraft, dueDateFor, invoiceNumber, isBillable, type Draft } from '../lib/billing';
import type { Contract, MeterReading, Room } from '../types';
import type { Ctx } from '../app';
import type { T } from '../lib/i18n';

const app = route();

interface Candidate {
  contract: Contract;
  room: Room;
  tenantName: string;
  draft: Draft;
  existingInvoiceId: string | null;
}

/** Collects everything billable for a building/period and computes each draft. */
async function collect(c: Ctx, buildingId: string, period: string): Promise<Candidate[]> {
  const db = c.get('db');
  const building = await db.building(buildingId);
  if (!building) return [];

  const [contracts, readings, existing] = await Promise.all([
    db.all<Contract & { tenant_name: string }>(
      `SELECT ct.*, t.name AS tenant_name
         FROM contracts ct
         JOIN rooms r ON r.id = ct.room_id
         JOIN tenants t ON t.id = ct.tenant_id
        WHERE r.building_id = ?`,
      buildingId,
    ),
    db.readingsForPeriod(buildingId, period),
    db.all<{ id: string; contract_id: string }>(
      'SELECT id, contract_id FROM invoices WHERE period = ? AND building_id = ?', period, buildingId,
    ),
  ]);

  const rooms = new Map((await db.rooms(buildingId)).map((r) => [r.id, r]));
  const byRoom = new Map<string, { water?: MeterReading; electric?: MeterReading }>();
  for (const m of readings) {
    const slot = byRoom.get(m.room_id) ?? {};
    slot[m.kind] = m;
    byRoom.set(m.room_id, slot);
  }
  const invoiced = new Map(existing.map((e) => [e.contract_id, e.id]));

  const out: Candidate[] = [];
  for (const contract of contracts) {
    if (!isBillable(contract, period)) continue;
    const room = rooms.get(contract.room_id);
    if (!room) continue;
    const meters = byRoom.get(room.id) ?? {};
    out.push({
      contract,
      room,
      tenantName: contract.tenant_name,
      draft: buildDraft({ building, room, contract, water: meters.water, electric: meters.electric }, period),
      existingInvoiceId: invoiced.get(contract.id) ?? null,
    });
  }
  out.sort((a, b) => a.room.floor - b.room.floor || a.room.number.localeCompare(b.room.number, 'th'));
  return out;
}

/** The billing run shown as one guided path rather than scattered pages. */
function Steps({ t, at }: { t: T; at: number }) {
  const labels = ['billing.step_meters', 'billing.step_review', 'billing.step_generate', 'billing.step_send', 'billing.step_collect'] as const;
  return (
    <div class="steps">
      {labels.map((k, i) => (
        <>
          {i > 0 ? <span class="step-line" /> : null}
          <span class={`step ${i < at ? 'done' : i === at ? 'now' : ''}`}>
            <span class="n">{i < at ? '\u2713' : i + 1}</span>
            <span class="t">{t(k)}</span>
          </span>
        </>
      ))}
    </div>
  );
}

app.get('/billing', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].id;
  const building = buildings.find((b) => b.id === buildingId) ?? buildings[0];
  const period = c.req.query('period') || currentPeriod();

  const rows = await collect(c, building.id, period);
  const pending = rows.filter((r) => !r.existingInvoiceId);
  const total = pending.reduce((s, r) => s + r.draft.subtotal, 0);
  const withWarnings = pending.filter((r) => r.draft.warnings.length > 0).length;
  const dueDate = dueDateFor(period, building.due_day);

  const rail = (
    <>
      <div>
        <h2>{t('dash.summary')}</h2>
        <RailStat label={t('billing.ready')} value={String(pending.length - withWarnings)}
          bar={{ pct: pending.length ? ((pending.length - withWarnings) / pending.length) * 100 : 0, tone: 'green' }} />
        <RailStat label={t('billing.exceptions')} value={String(withWarnings)} />
        <RailStat label={t('invoice.total')} value={`\u0e3f${baht(total)}`} />
        <RailStat label={t('invoice.due_date')} value={dueDate} />
      </div>
      <div>
        <h2>{t('dash.attention')}</h2>
        {withWarnings === 0 ? (
          <Empty text={t('dash.no_exception')} icon="check" />
        ) : (
          <div class="att">
            {pending.filter((r) => r.draft.warnings.length).slice(0, 8).map((r) => (
              <a class="att-row" href={`/meters?building=${building.id}&period=${period}`}>
                <span class="dot warn" aria-hidden="true">{Icon.gauge({ size: 14 })}</span>
                <span class="txt">
                  <b>{t('room.number')} {r.room.number}</b>
                  <span>{r.draft.warnings.join(', ')}</span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return c.html(
    <Layout {...page(c, t('billing.title'))} rail={rail}
      context={{ name: building.name, sub: thaiPeriod(period), href: `/buildings/${building.id}` }}>
      <PageHead title={t('billing.title')} sub={`${building.name} · ${thaiPeriod(period)}`}>
        <form method="get" action="/billing" class="btn-row">
          <select name="building" aria-label={t('building.name')}>
            {buildings.map((b) => <option value={b.id} selected={b.id === building.id}>{b.name}</option>)}
          </select>
          <input type="month" name="period" value={period} aria-label={t('meter.period')} />
          <button class="btn" type="submit">{t('billing.preview')}</button>
        </form>
        <a class="btn" href={`/meters?building=${building.id}&period=${period}`}>
          <span aria-hidden="true">{Icon.gauge({ size: 16 })}</span>{t('nav.meters')}
        </a>
      </PageHead>

      <Steps t={t} at={pending.length === 0 && rows.length > 0 ? 3 : withWarnings > 0 ? 0 : 1} />

      <section class="hero">
        <div class="eyebrow">{t('billing.title')}</div>
        <h2>{thaiPeriod(period)}</h2>
        <p class="lede">{t('dash.rooms_ready', { ready: pending.length - withWarnings, total: rows.length })}</p>
        <div class="hero-stats">
          <div class="hs"><div class="n">{pending.length - withWarnings}</div><div class="l">{t('billing.ready')}</div></div>
          <div class="hs"><div class="n">{withWarnings}</div><div class="l">{t('billing.exceptions')}</div></div>
          <div class="hs"><div class="n">{rows.length - pending.length}</div><div class="l">{t('billing.already')}</div></div>
          <div class="hs"><div class="n">฿{baht(total)}</div><div class="l">{t('invoice.total')}</div></div>
        </div>
        <form method="post" action="/billing" class="btn-row">
          <input type="hidden" name="building_id" value={building.id} />
          <input type="hidden" name="period" value={period} />
          <button class="btn on-hero lg" type="submit" disabled={pending.length === 0}>
            {t('billing.generate')} ({pending.length})
            <span aria-hidden="true">{Icon.arrowRight({ size: 16 })}</span>
          </button>
          {withWarnings > 0
            ? <a class="btn ghost-hero lg" href={`/meters?building=${building.id}&period=${period}`}>{t('dash.enter_meters')}</a>
            : null}
        </form>
      </section>

      <div class="card flush" style="margin-top:1rem">
        <h2>{t('billing.preview')}<span class="grow" /></h2>
        {rows.length === 0 ? (
          <Empty text={t('common.none')} icon="receipt"
            hint={t('billing.nothing_to_bill' as 'common.none')} />
        ) : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.name')}</th>
                  <th class="num">{t('invoice.rent')}</th>
                  <th class="num">{t('invoice.water')}</th>
                  <th class="num">{t('invoice.electric')}</th>
                  <th class="num">{t('invoice.other')}</th>
                  <th class="num">{t('invoice.total')}</th>
                  <th class="num">{t('room.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pick = (k: string) => r.draft.items.filter((i) => i.kind === k).reduce((s, i) => s + i.amount, 0);
                  const other = r.draft.items
                    .filter((i) => !['rent', 'water', 'electric'].includes(i.kind))
                    .reduce((s, i) => s + i.amount, 0);
                  return (
                    <tr>
                      <td class="strong">{r.room.number}</td>
                      <td class="small">
                        {r.tenantName}
                        {r.draft.chargedDays < r.draft.periodDays ? (
                          <div class="tiny muted">
                            {t('billing.prorate')} {r.draft.chargedDays}/{r.draft.periodDays} {t('common.days')}
                          </div>
                        ) : null}
                      </td>
                      <td class="num">{baht(pick('rent'))}</td>
                      <td class="num">{baht(pick('water'))}</td>
                      <td class="num">{baht(pick('electric'))}</td>
                      <td class="num">{baht(other)}</td>
                      <td class="num strong">฿{baht(r.draft.subtotal)}</td>
                      <td class="num">
                        {r.existingInvoiceId ? (
                          <a class="tag paid" href={`/invoices/${r.existingInvoiceId}`}>{t('billing.already')}</a>
                        ) : r.draft.warnings.length ? (
                          <span class="tag unpaid">{r.draft.warnings.join(', ')}</span>
                        ) : (
                          <span class="tag active">{t('billing.ready')}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div class="card-foot">
          <span class="muted small">ระบบจะข้ามห้องที่ออกบิลรอบนี้ไปแล้ว</span>
        </div>
      </div>
    </Layout>,
  );
});

app.post('/billing', async (c) => {
  const db = c.get('db');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const period = str(f.get('period'));
  if (!buildingId || !period) return back(c, '/billing', 'missing', true);

  const building = await db.building(buildingId);
  if (!building) return c.notFound();

  const rows = (await collect(c, buildingId, period)).filter((r) => !r.existingInvoiceId && r.draft.items.length > 0);
  if (rows.length === 0) return back(c, `/billing?building=${buildingId}&period=${period}`, 'nothing_to_bill', true);

  const issueDate = today();
  const dueDate = dueDateFor(period, building.due_day);
  const stmts: D1PreparedStatement[] = [];

  for (const r of rows) {
    const seq = await db.nextSeq(`invoice:${period}`);
    const invId = id('i_');
    stmts.push(db.prep(
      `INSERT INTO invoices (id, number, building_id, room_id, contract_id, tenant_id, period,
         issue_date, due_date, subtotal, discount, total, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,'unpaid')`,
      invId, invoiceNumber(period, seq), buildingId, r.room.id, r.contract.id, r.contract.tenant_id,
      period, issueDate, dueDate, r.draft.subtotal, r.draft.subtotal,
    ));
    r.draft.items.forEach((it, idx) => {
      stmts.push(db.prep(
        `INSERT INTO invoice_items (id, invoice_id, kind, label, detail, qty, unit, unit_price, amount, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id('it_'), invId, it.kind, it.label, it.detail, it.qty, it.unit, it.unit_price, it.amount, idx,
      ));
    });
    // Mark the deposit as invoiced so a later run never bills it twice.
    const dep = r.draft.items.find((i) => i.kind === 'deposit');
    if (dep) {
      stmts.push(db.prep(
        'UPDATE contracts SET deposit_invoiced = deposit_invoiced + ? WHERE id = ?', dep.amount, r.contract.id,
      ));
    }
  }

  await db.batch(stmts);
  return back(c, `/invoices?period=${period}&building=${buildingId}`, 'billed');
});

export default app;
