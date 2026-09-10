import { back, page, requirePermission, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { statusKey, str, thaiDate, today } from '../lib/util';
import { ulid } from '../lib/ulid';

const app = route();

const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'URGENT'] as const;
/** Statuses that close a ticket, and so stamp closed_at. */
const CLOSED = new Set<string>(['DONE', 'CANCELLED']);

app.get('/tickets', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.ticket.read');
  const status = (c.req.query('status') || '').toUpperCase();
  const rows = await c.get('repos').tickets.rows(tctx, status || undefined);
  return c.html(
    <Layout {...page(c, t('ticket.title'))}>
      <PageHead title={t('ticket.title')} sub={`${rows.length}`}>
        <form method="get" action="/tickets">
          <select name="status" onchange="this.form.submit()">
            <option value="">{t('common.all')}</option>
            {STATUSES.map((s) => (
              <option value={statusKey(s)} selected={s === status}>
                {t(`ticket.${statusKey(s)}` as 'ticket.open')}
              </option>
            ))}
          </select>
        </form>
        <a class="btn primary" href="/tickets/new">{t('ticket.new')}</a>
      </PageHead>
      <div class="card">
        {rows.length === 0 ? <Empty text={t('common.none')} /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('ticket.subject')}</th>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.name')}</th>
                  <th>{t('ticket.priority')}</th>
                  <th>{t('room.status')}</th>
                  <th class="num">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => (
                  <tr>
                    <td><a href={`/tickets/${k.ticket_id}`}>{k.title}</a><div class="small muted">{thaiDate(k.created_at.slice(0, 10))}</div></td>
                    <td>{k.building_name} {k.room_number}</td>
                    <td class="small">{k.party_name ?? '-'}</td>
                    <td><Tag kind={statusKey(k.priority)} label={t(`ticket.${statusKey(k.priority)}` as 'ticket.normal')} /></td>
                    <td><Tag kind={statusKey(k.status)} label={t(`ticket.${statusKey(k.status)}` as 'ticket.open')} /></td>
                    <td class="num"><a class="btn sm" href={`/tickets/${k.ticket_id}`}>{t('common.view')}</a></td>
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

app.get('/tickets/new', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.ticket.manage');
  const repos = c.get('repos');
  const buildings = await repos.buildings.all(tctx);
  const grids = await Promise.all(buildings.map((b) => repos.rooms.grid(tctx, b.building_id)));
  const rooms = buildings.flatMap((b, i) => grids[i].map((r) => ({ ...r, building_name: b.name })));
  if (rooms.length === 0) return back(c, '/rooms', 'no_rooms', true);
  const preRoom = c.req.query('room') ?? '';
  return c.html(
    <Layout {...page(c, t('ticket.new'))}>
      <PageHead title={t('ticket.new')}>
        <a class="btn" href="/tickets">{t('common.back')}</a>
      </PageHead>
      <form method="post" action="/tickets" class="card" style="max-width:640px" enctype="multipart/form-data">
        <div class="field">
          <label for="room_id">{t('room.title')}</label>
          <select id="room_id" name="room_id" required>
            {rooms.map((r) => (
              <option value={r.room_id} selected={r.room_id === preRoom}>
                {r.building_name} {r.number}{r.party_name ? ` · ${r.party_name}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="title">{t('ticket.subject')}</label>
          <input id="title" name="title" required placeholder="แอร์ไม่เย็น / น้ำรั่ว" />
        </div>
        <div class="field">
          <label for="detail">{t('ticket.detail')}</label>
          <textarea id="detail" name="detail" rows={3}></textarea>
        </div>
        <div class="row">
          <div class="field">
            <label for="priority">{t('ticket.priority')}</label>
            <select id="priority" name="priority">
              {PRIORITIES.map((p) => (
                <option value={p} selected={p === 'NORMAL'}>{t(`ticket.${statusKey(p)}` as 'ticket.normal')}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="photo">{t('payment.slip')} <span class="muted">({t('common.optional')})</span></label>
            <input id="photo" name="photo" type="file" accept="image/*" />
          </div>
        </div>
        <button class="btn primary" type="submit">{t('common.save')}</button>
      </form>
    </Layout>,
  );
});

app.post('/tickets', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.ticket.manage');
  const repos = c.get('repos');
  const f = await c.req.formData();
  const roomId = str(f.get('room_id'));
  const title = str(f.get('title'));
  if (!roomId || !title) return back(c, '/tickets/new', 'missing', true);
  await repos.rooms.byId(tctx, roomId);

  const live = await repos.contracts.activeForRoom(tctx, roomId);
  let photoKey: string | null = null;
  const photo = f.get('photo');
  if (photo instanceof File && photo.size > 0) {
    // R2 keys are tenant-prefixed (STANDARD §9.6). Without the prefix one
    // operator's object path is guessable from another's.
    photoKey = `t/${tctx.tenantId}/tickets/${roomId}/${ulid()}`;
    await c.env.FILES.put(photoKey, await photo.arrayBuffer(), {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });
  }

  const priority = str(f.get('priority')).toUpperCase();
  const ticket = await repos.tickets.insert(tctx, {
    room_id: roomId,
    party_id: live[0]?.party_id ?? null,
    title,
    detail: str(f.get('detail')) || null,
    priority: ((PRIORITIES as readonly string[]).includes(priority) ? priority : 'NORMAL') as 'NORMAL',
    photo_key: photoKey,
  });
  return back(c, `/tickets/${ticket.ticket_id}`, 'saved');
});

app.get('/tickets/:id', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.ticket.read');
  const k = await c.get('repos').tickets.row(tctx, c.req.param('id'));
  return c.html(
    <Layout {...page(c, k.title)}>
      <PageHead title={k.title} sub={`${k.building_name} ${k.room_number} · ${k.party_name ?? '-'}`}>
        <a class="btn" href="/tickets">{t('common.back')}</a>
      </PageHead>
      <div class="grid c2">
        <div class="card">
          <h2>{t('ticket.detail')}</h2>
          <p>{k.detail ?? <span class="muted">-</span>}</p>
          {k.photo_key ? <p><a href={`/files/${k.photo_key}`} target="_blank">📷 {t('common.view')}</a></p> : null}
          <p class="small muted">{thaiDate(k.created_at.slice(0, 10))}</p>
        </div>
        <form method="post" action={`/tickets/${k.ticket_id}`} class="card">
          <h2>{t('common.edit')}</h2>
          <div class="row">
            <div class="field">
              <label for="status">{t('room.status')}</label>
              <select id="status" name="status">
                {STATUSES.map((s) => (
                  <option value={s} selected={s === k.status}>{t(`ticket.${statusKey(s)}` as 'ticket.open')}</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="priority">{t('ticket.priority')}</label>
              <select id="priority" name="priority">
                {PRIORITIES.map((p) => (
                  <option value={p} selected={p === k.priority}>{t(`ticket.${statusKey(p)}` as 'ticket.normal')}</option>
                ))}
              </select>
            </div>
          </div>
          <button class="btn primary" type="submit">{t('common.save')}</button>
        </form>
      </div>
    </Layout>,
  );
});

app.post('/tickets/:id', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.ticket.manage');
  const tid = c.req.param('id');
  const f = await c.req.formData();
  const posted = str(f.get('status')).toUpperCase();
  const priority = str(f.get('priority')).toUpperCase();
  const status = (STATUSES as readonly string[]).includes(posted) ? posted : 'OPEN';

  await c.get('repos').tickets.update(tctx, tid, {
    status: status as 'OPEN',
    priority: ((PRIORITIES as readonly string[]).includes(priority) ? priority : 'NORMAL') as 'NORMAL',
    // Reopening clears the closing date rather than leaving a stale one behind.
    closed_at: CLOSED.has(status) ? today() : null,
  });
  return back(c, `/tickets/${tid}`, 'saved');
});

export default app;
