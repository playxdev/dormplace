import { page, route } from '../app';
import { Delta, Empty, Icon, Kpi, Layout, PageHead, QuickAction, RailStat, Tag } from '../ui/layout';
import { baht, currentPeriod, daysBetween, shiftPeriod, thaiDate, thaiPeriod, today } from '../lib/util';
import { dueDateFor } from '../lib/billing';

const app = route();

/** Local hour in Thailand (UTC+7) decides the greeting. */
function greetKey(): 'dash.greet_morning' | 'dash.greet_afternoon' | 'dash.greet_evening' {
  const h = (new Date().getUTCHours() + 7) % 24;
  return h < 12 ? 'dash.greet_morning' : h < 18 ? 'dash.greet_afternoon' : 'dash.greet_evening';
}

app.get('/', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const period = currentPeriod();
  const prev = shiftPeriod(period, -1);
  const now = today();

  const building = await db.firstBuilding();

  const [occ, collected, collectedPrev, collectedToday, outstanding, invoiceRows, recent, tickets, expiring, meterState, billedThis] =
    await Promise.all([
      db.one<{ total: number; occupied: number; vacant: number; maint: number }>(
        `SELECT COUNT(*) AS total,
                SUM(status = 'occupied')    AS occupied,
                SUM(status = 'vacant')      AS vacant,
                SUM(status = 'maintenance') AS maint
           FROM rooms`,
      ),
      db.one<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE substr(paid_at,1,7) = ?", period),
      db.one<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE substr(paid_at,1,7) = ?", prev),
      db.one<{ s: number }>("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE paid_at = ?", now),
      db.one<{ s: number; n: number }>(
        "SELECT COALESCE(SUM(total - paid_total),0) AS s, COUNT(*) AS n FROM invoices WHERE status IN ('unpaid','partial')",
      ),
      db.invoiceRows({ limit: 400 }),
      db.all<{ id: string; amount: number; paid_at: string; tenant_name: string; room_number: string }>(
        `SELECT p.id, p.amount, p.paid_at, t.name AS tenant_name, r.number AS room_number
           FROM payments p
           JOIN invoices i ON i.id = p.invoice_id
           JOIN tenants  t ON t.id = i.tenant_id
           JOIN rooms    r ON r.id = i.room_id
          ORDER BY p.paid_at DESC, p.created_at DESC LIMIT 6`,
      ),
      db.one<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE status IN ('open','in_progress')"),
      db.one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM contracts WHERE status = 'active' AND end_date IS NOT NULL AND end_date <= date('now', '+45 day')",
      ),
      building
        ? db.one<{ due: number; got: number }>(
            `SELECT COUNT(*) AS due,
                    SUM(EXISTS (SELECT 1 FROM meter_readings m
                                 WHERE m.room_id = r.id AND m.period = ?2 AND m.kind = 'electric')) AS got
               FROM rooms r
               JOIN contracts ct ON ct.room_id = r.id AND ct.status = 'active'
              WHERE r.building_id = ?1`,
            building.id, period,
          )
        : Promise.resolve(null),
      db.one<{ n: number }>('SELECT COUNT(*) AS n FROM invoices WHERE period = ?', period),
    ]);

  const total = occ?.total ?? 0;
  const occupied = occ?.occupied ?? 0;
  const rate = total ? Math.round((occupied / total) * 100) : 0;

  const thisMonth = collected?.s ?? 0;
  const lastMonth = collectedPrev?.s ?? 0;
  const trend = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;

  const overdue = invoiceRows.filter((r) => (r.status === 'unpaid' || r.status === 'partial') && r.due_date < now);
  const periodBilled = invoiceRows.filter((r) => r.period === period && r.status !== 'void');
  const periodTotal = periodBilled.reduce((s, r) => s + r.total, 0);
  const periodPaid = periodBilled.reduce((s, r) => s + r.paid_total, 0);
  const collectRate = periodTotal ? Math.round((periodPaid / periodTotal) * 100) : 0;

  const dueRooms = meterState?.due ?? 0;
  const metered = meterState?.got ?? 0;
  const missingMeters = Math.max(0, dueRooms - metered);
  const alreadyBilled = billedThis?.n ?? 0;
  const openTickets = tickets?.n ?? 0;
  const expiringSoon = expiring?.n ?? 0;

  const attention = [
    missingMeters > 0 && { tone: 'warn', icon: 'gauge' as const, title: t('dash.missing_meters', { n: missingMeters }), sub: thaiPeriod(period), href: '/walk' },
    overdue.length > 0 && { tone: 'bad', icon: 'alert' as const, title: t('dash.overdue_count', { n: overdue.length }), sub: `฿${baht(overdue.reduce((s, r) => s + (r.total - r.paid_total), 0))}`, href: '/invoices?status=unpaid' },
    openTickets > 0 && { tone: 'info', icon: 'wrench' as const, title: `${t('nav.tickets')} ${openTickets}`, sub: t('ticket.open'), href: '/tickets?status=open' },
    expiringSoon > 0 && { tone: 'warn', icon: 'contract' as const, title: t('dash.contracts_expiring', { n: expiringSoon }), sub: '45 ' + t('common.days'), href: '/contracts' },
  ].filter(Boolean) as { tone: string; icon: 'gauge' | 'alert' | 'wrench' | 'contract'; title: string; sub: string; href: string }[];

  const rail = (
    <>
      <div>
        <h2>{t('dash.summary')}</h2>
        <RailStat label={t('dash.occupancy')} value={`${rate}%`} bar={{ pct: rate, tone: 'green' }} />
        <RailStat label={t('dash.collected_today')} value={`฿${baht(collectedToday?.s ?? 0)}`} />
        <RailStat label={t('report.rate')} value={`${collectRate}%`} bar={{ pct: collectRate }} />
        <RailStat label={t('dash.outstanding')} value={`฿${baht(outstanding?.s ?? 0)}`} />
      </div>

      <div>
        <h2>{t('dash.attention')}</h2>
        {attention.length === 0 ? (
          <Empty text={t('dash.all_clear')} hint={t('dash.all_clear_hint')} icon="check" />
        ) : (
          <div class="att">
            {attention.map((a) => (
              <a class="att-row" href={a.href}>
                <span class={`dot ${a.tone}`} aria-hidden="true">{Icon[a.icon]({ size: 15 })}</span>
                <span class="txt"><b>{a.title}</b><span>{a.sub}</span></span>
                <span class="dim" aria-hidden="true">{Icon.arrowRight({ size: 14 })}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2>{t('dash.recent_payments')}</h2>
        {recent.length === 0 ? (
          <Empty text={t('payment.none')} icon="wallet" />
        ) : (
          <div class="att">
            {recent.map((p) => (
              <div class="att-row">
                <span class="dot ok" aria-hidden="true">{Icon.check({ size: 14 })}</span>
                <span class="txt">
                  <b>{t('room.number')} {p.room_number}</b>
                  <span>{p.tenant_name} · {thaiDate(p.paid_at)}</span>
                </span>
                <span class="amt">฿{baht(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return c.html(
    <Layout
      {...page(c, t('nav.dashboard'))}
      rail={rail}
      context={building ? { name: building.name, sub: `${total} ${t('common.rooms')}`, href: `/buildings/${building.id}` } : undefined}
    >
      <PageHead greet title={t(greetKey(), { name: c.get('user').name })} sub={t('dash.greet_sub')}>
        <a class="btn" href="/walk">
          <span aria-hidden="true">{Icon.gauge({ size: 16 })}</span>{t('walk.title')}
        </a>
        <a class="btn primary" href="/billing">
          <span aria-hidden="true">{Icon.receipt({ size: 16 })}</span>{t('billing.generate')}
        </a>
      </PageHead>

      {/* --- KPI row --- */}
      <div class="grid c4">
        <Kpi label={t('dash.occupancy')} value={`${rate}%`} icon="door" tone="amber"
          meta={<>{occupied} {t('common.of')} {total} {t('common.rooms')}</>} />
        <Kpi label={t('dash.income_month')} value={baht(thisMonth)} icon="wallet" tone="green" currency
          meta={<><Delta value={trend} /> <span>{thaiPeriod(period)}</span></>} />
        <Kpi label={t('report.collected')} value={`${collectRate}%`} icon="check" tone="blue"
          meta={<>฿{baht(periodPaid)} {t('common.of')} ฿{baht(periodTotal)}</>} />
        <Kpi label={t('dash.outstanding')} value={baht(outstanding?.s ?? 0)} icon="alert" tone="red" currency
          meta={<>{outstanding?.n ?? 0} {t('invoice.title')} · {overdue.length} {t('invoice.overdue')}</>} />
      </div>

      {/* --- billing hero: the one anchor that says "is this month ready?" --- */}
      <div style="margin-top:1rem">
        <section class="hero">
          <div class="eyebrow">{t('billing.title')}</div>
          <h2>{thaiPeriod(period)}</h2>
          <p class="lede">
            {alreadyBilled > 0
              ? t('dash.billed_already', { n: alreadyBilled })
              : t('dash.rooms_ready', { ready: metered, total: dueRooms })}
          </p>
          <div class="hero-stats">
            <div class="hs"><div class="n">{dueRooms - missingMeters}</div><div class="l">{t('billing.ready')}</div></div>
            <div class="hs"><div class="n">{missingMeters}</div><div class="l">{t('billing.no_meter')}</div></div>
            <div class="hs"><div class="n">{alreadyBilled}</div><div class="l">{t('nav.invoices')}</div></div>
            <div class="hs">
              <div class="n">{building ? thaiDate(dueDateFor(period, building.due_day)) : '—'}</div>
              <div class="l">{t('invoice.due_date')}</div>
            </div>
          </div>
          <div class="btn-row">
            <a class="btn on-hero lg" href="/billing">
              {t('dash.review_billing')}<span aria-hidden="true">{Icon.arrowRight({ size: 16 })}</span>
            </a>
            {missingMeters > 0
              ? <a class="btn ghost-hero lg" href="/meters">{t('dash.enter_meters')}</a>
              : null}
          </div>
        </section>
      </div>

      {/* --- field-work entry point (spec §3) --- */}
      {building ? (
        <a class="walk-cta" href={`/walk?building=${building.id}&period=${period}`} style="margin-top:1rem">
          <span class="ic" aria-hidden="true">{Icon.gauge({ size: 22 })}</span>
          <span class="tx">
            <b>{t('walk.title')}</b>
            <span>
              {t('walk.subtitle')} · {missingMeters > 0
                ? t('walk.waiting', { n: missingMeters })
                : t('walk.all_done_already')}
            </span>
          </span>
          <span class="btn primary">{missingMeters > 0 ? t('walk.start_short') : t('walk.view_summary')}</span>
        </a>
      ) : null}

      {/* --- quick actions --- */}
      <div class="card" style="margin-top:1rem">
        <h2>{t('dash.quick')}</h2>
        <div class="quick">
          <QuickAction href="/contracts/new" icon="users" label={t('contract.new')} />
          <QuickAction href="/tenants/new" icon="plus" label={t('tenant.new')} />
          <QuickAction href="/rooms/new" icon="door" label={t('room.new')} />
          <QuickAction href="/meters" icon="gauge" label={t('meter.save')} />
          <QuickAction href="/billing" icon="receipt" label={t('billing.generate')} />
          <QuickAction href="/tickets/new" icon="wrench" label={t('ticket.new')} />
        </div>
      </div>

      {/* --- overdue table --- */}
      <div class="card flush" style="margin-top:1rem">
        <h2>
          {t('dash.overdue_invoices')}
          <span class="grow" />
          <a class="btn sm ghost" href="/invoices?status=unpaid">{t('dash.view_all')}</a>
        </h2>
        {overdue.length === 0 ? (
          <Empty text={t('dash.all_clear')} hint={t('dash.all_clear_hint')} icon="check" />
        ) : (
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
                {overdue.slice(0, 8).map((r) => {
                  const late = daysBetween(r.due_date, now);
                  return (
                    <tr>
                      <td><a class="linkcell" href={`/invoices/${r.id}`}>{r.number}</a></td>
                      <td>{r.room_number}</td>
                      <td>{r.tenant_name}</td>
                      <td class="small">{thaiDate(r.due_date)}</td>
                      <td class="num"><Tag kind={late > 30 ? 'overdue' : 'unpaid'} label={String(late)} plain /></td>
                      <td class="num strong">฿{baht(r.total - r.paid_total)}</td>
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

export default app;
