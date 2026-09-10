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
  const t = c.get('t');
  const tctx = c.get('tctx');
  const repos = c.get('repos');
  const period = currentPeriod();
  const prev = shiftPeriod(period, -1);
  const now = today();

  const building = await repos.buildings.first(tctx);

  const [occ, thisMonth, lastMonth, collectedToday, invoiceRows, recent, tickets, expiring, meterState] =
    await Promise.all([
      repos.stats.occupancy(tctx),
      repos.stats.collected(tctx, { period }),
      repos.stats.collected(tctx, { period: prev }),
      repos.stats.collected(tctx, { day: now }),
      repos.invoices.rows(tctx, { limit: 400 }),
      repos.stats.recentPayments(tctx),
      repos.stats.openTickets(tctx),
      repos.stats.expiringLeases(tctx),
      building
        ? repos.stats.meterProgress(tctx, building.building_id, period)
        : Promise.resolve({ due: 0, got: 0 }),
    ]);

  const total = occ.total ?? 0;
  const occupied = occ.occupied ?? 0;
  const rate = total ? Math.round((occupied / total) * 100) : 0;

  const trend = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 0;

  // Overdue and outstanding both come from the effective status, so a job that
  // did not run cannot make the dashboard look calmer than the data is.
  const unpaid = invoiceRows.filter((r) => r.status === 'UNPAID' && r.total > r.paid);
  const overdue = unpaid.filter((r) => r.due_date < now);
  const outstandingTotal = unpaid.reduce((s, r) => s + (r.total - r.paid), 0);

  const periodBilled = invoiceRows.filter((r) => r.period === period && r.status !== 'VOID');
  const periodTotal = periodBilled.reduce((s, r) => s + r.total, 0);
  const periodPaid = periodBilled.reduce((s, r) => s + r.paid, 0);
  const collectRate = periodTotal ? Math.round((periodPaid / periodTotal) * 100) : 0;
  const billedThisPeriod = periodBilled.length;

  const dueRooms = meterState.due ?? 0;
  const metered = meterState.got ?? 0;
  const missingMeters = Math.max(0, dueRooms - metered);
  const alreadyBilled = billedThisPeriod;
  const openTickets = tickets;
  const expiringSoon = expiring;

  const attention = [
    missingMeters > 0 && { tone: 'warn', icon: 'gauge' as const, title: t('dash.missing_meters', { n: missingMeters }), sub: thaiPeriod(period), href: '/walk' },
    overdue.length > 0 && { tone: 'bad', icon: 'alert' as const, title: t('dash.overdue_count', { n: overdue.length }), sub: `฿${baht(overdue.reduce((s, r) => s + (r.total - r.paid), 0))}`, href: '/invoices?status=unpaid' },
    openTickets > 0 && { tone: 'info', icon: 'wrench' as const, title: `${t('nav.tickets')} ${openTickets}`, sub: t('ticket.open'), href: '/tickets?status=open' },
    expiringSoon > 0 && { tone: 'warn', icon: 'contract' as const, title: t('dash.contracts_expiring', { n: expiringSoon }), sub: '45 ' + t('common.days'), href: '/contracts' },
  ].filter(Boolean) as { tone: string; icon: 'gauge' | 'alert' | 'wrench' | 'contract'; title: string; sub: string; href: string }[];

  const rail = (
    <>
      <div>
        <h2>{t('dash.summary')}</h2>
        <RailStat label={t('dash.occupancy')} value={`${rate}%`} bar={{ pct: rate, tone: 'green' }} />
        <RailStat label={t('dash.collected_today')} value={`฿${baht(collectedToday)}`} />
        <RailStat label={t('report.rate')} value={`${collectRate}%`} bar={{ pct: collectRate }} />
        <RailStat label={t('dash.outstanding')} value={`฿${baht(outstandingTotal)}`} />
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
                  <span>{p.party_name} · {thaiDate(p.paid_at)}</span>
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
      context={building ? { name: building.name, sub: `${total} ${t('common.rooms')}`, href: `/buildings/${building.building_id}` } : undefined}
    >
      <PageHead greet title={t(greetKey(), { name: c.get('account').display_name ?? '' })} sub={t('dash.greet_sub')}>
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
        <Kpi label={t('dash.outstanding')} value={baht(outstandingTotal)} icon="alert" tone="red" currency
          meta={<>{unpaid.length} {t('invoice.title')} · {overdue.length} {t('invoice.overdue')}</>} />
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
                      <td>{r.party_name}</td>
                      <td class="small">{thaiDate(r.due_date)}</td>
                      <td class="num"><Tag kind={late > 30 ? 'overdue' : 'unpaid'} label={String(late)} plain /></td>
                      <td class="num strong">฿{baht(r.total - r.paid)}</td>
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
