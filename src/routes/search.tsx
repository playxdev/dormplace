import { page, route } from '../app';
import { Empty, Icon, Layout, PageHead, Tag } from '../ui/layout';
import { baht, str, thaiDate, thaiPeriod, today } from '../lib/util';

const app = route();

/**
 * One box over the four things an owner actually looks up: a room, a person,
 * an invoice, a maintenance ticket.
 */
app.get('/search', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const q = str(c.req.query('q'));
  const like = `%${q}%`;
  const now = today();

  const [rooms, tenants, invoices, tickets] = q
    ? await Promise.all([
        db.all<{ id: string; number: string; floor: number; status: string; building_name: string; tenant_name: string | null }>(
          `SELECT r.id, r.number, r.floor, r.status, b.name AS building_name, t.name AS tenant_name
             FROM rooms r
             JOIN buildings b ON b.id = r.building_id
             LEFT JOIN contracts ct ON ct.room_id = r.id AND ct.status = 'active'
             LEFT JOIN tenants t ON t.id = ct.tenant_id
            WHERE r.number LIKE ?1 OR b.name LIKE ?1
            ORDER BY r.floor, r.number LIMIT 12`,
          like,
        ),
        db.all<{ id: string; name: string; phone: string | null; room_number: string | null }>(
          `SELECT t.id, t.name, t.phone, r.number AS room_number
             FROM tenants t
             LEFT JOIN contracts ct ON ct.tenant_id = t.id AND ct.status = 'active'
             LEFT JOIN rooms r ON r.id = ct.room_id
            WHERE t.name LIKE ?1 OR t.phone LIKE ?1 OR t.id_card_no LIKE ?1 OR t.line_id LIKE ?1
            ORDER BY t.name LIMIT 12`,
          like,
        ),
        db.all<{ id: string; number: string; period: string; total: number; paid_total: number; status: string; due_date: string; room_number: string; tenant_name: string }>(
          `SELECT i.id, i.number, i.period, i.total, i.paid_total, i.status, i.due_date,
                  r.number AS room_number, t.name AS tenant_name
             FROM invoices i
             JOIN rooms r ON r.id = i.room_id
             JOIN tenants t ON t.id = i.tenant_id
            WHERE i.number LIKE ?1 OR r.number LIKE ?1 OR t.name LIKE ?1
            ORDER BY i.period DESC LIMIT 12`,
          like,
        ),
        db.all<{ id: string; title: string; status: string; room_number: string }>(
          `SELECT k.id, k.title, k.status, r.number AS room_number
             FROM tickets k JOIN rooms r ON r.id = k.room_id
            WHERE k.title LIKE ?1 OR k.detail LIKE ?1 OR r.number LIKE ?1
            ORDER BY k.created_at DESC LIMIT 8`,
          like,
        ),
      ])
    : [[], [], [], []];

  const found = rooms.length + tenants.length + invoices.length + tickets.length;

  return c.html(
    <Layout {...page(c, t('search.title'))}>
      <PageHead title={t('search.title')} sub={q ? t('search.results_for', { q }) : t('search.hint')}>
        <form method="get" action="/search" class="btn-row">
          <input name="q" value={q} placeholder={t('search.placeholder')} style="min-width:260px" autofocus />
          <button class="btn primary" type="submit">{t('common.search')}</button>
        </form>
      </PageHead>

      {!q || found === 0 ? (
        <div class="card">
          <Empty text={q ? t('search.empty') : t('search.title')} hint={t('search.hint')} icon="search" />
        </div>
      ) : (
        <div class="stack">
          {rooms.length > 0 ? (
            <div class="card flush">
              <h2>{t('room.title')} <span class="muted small">{rooms.length}</span></h2>
              <div class="table-wrap">
                <table class="responsive">
                  <thead><tr><th>{t('room.number')}</th><th>{t('building.name')}</th><th>{t('tenant.name')}</th><th class="num">{t('room.status')}</th></tr></thead>
                  <tbody>
                    {rooms.map((r) => (
                      <tr>
                        <td><a class="linkcell" href={`/rooms/${r.id}`}>{r.number}</a></td>
                        <td class="small">{r.building_name}</td>
                        <td class="small">{r.tenant_name ?? <span class="muted">—</span>}</td>
                        <td class="num"><Tag kind={r.status} label={t(`room.${r.status}` as 'room.vacant')} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tenants.length > 0 ? (
            <div class="card flush">
              <h2>{t('tenant.title')} <span class="muted small">{tenants.length}</span></h2>
              <div class="table-wrap">
                <table class="responsive">
                  <thead><tr><th>{t('tenant.name')}</th><th>{t('tenant.phone')}</th><th class="num">{t('room.number')}</th></tr></thead>
                  <tbody>
                    {tenants.map((r) => (
                      <tr>
                        <td><a class="linkcell" href={`/tenants/${r.id}`}>{r.name}</a></td>
                        <td class="small">{r.phone ?? '—'}</td>
                        <td class="num">{r.room_number ?? <span class="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {invoices.length > 0 ? (
            <div class="card flush">
              <h2>{t('nav.invoices')} <span class="muted small">{invoices.length}</span></h2>
              <div class="table-wrap">
                <table class="responsive">
                  <thead><tr><th>{t('invoice.number')}</th><th>{t('room.number')}</th><th>{t('tenant.name')}</th><th class="num">{t('invoice.total')}</th><th class="num">{t('room.status')}</th></tr></thead>
                  <tbody>
                    {invoices.map((r) => {
                      const st = r.status === 'unpaid' && r.due_date < now ? 'overdue' : r.status;
                      return (
                        <tr>
                          <td><a class="linkcell" href={`/invoices/${r.id}`}>{r.number}</a>
                            <div class="tiny muted">{thaiPeriod(r.period)}</div></td>
                          <td>{r.room_number}</td>
                          <td class="small">{r.tenant_name}</td>
                          <td class="num">฿{baht(r.total)}</td>
                          <td class="num"><Tag kind={st} label={t(`invoice.${st}` as 'invoice.paid')} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tickets.length > 0 ? (
            <div class="card flush">
              <h2>{t('ticket.title')} <span class="muted small">{tickets.length}</span></h2>
              <div class="table-wrap">
                <table class="responsive">
                  <thead><tr><th>{t('ticket.subject')}</th><th>{t('room.number')}</th><th class="num">{t('room.status')}</th></tr></thead>
                  <tbody>
                    {tickets.map((k) => (
                      <tr>
                        <td><a class="linkcell" href={`/tickets/${k.id}`}>{k.title}</a></td>
                        <td>{k.room_number}</td>
                        <td class="num"><Tag kind={k.status} label={t(`ticket.${k.status}` as 'ticket.open')} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Layout>,
  );
});

export default app;
