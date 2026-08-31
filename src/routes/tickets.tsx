import { back, page, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { id, str, thaiDate, today } from '../lib/util';

const app = route();

app.get('/tickets', async (c) => {
  const t = c.get('t');
  const status = c.req.query('status') || '';
  const rows = await c.get('db').ticketRows(status || undefined);
  return c.html(
    <Layout {...page(c, t('ticket.title'))}>
      <PageHead title={t('ticket.title')} sub={`${rows.length}`}>
        <form method="get" action="/tickets">
          <select name="status" onchange="this.form.submit()">
            <option value="">{t('common.all')}</option>
            {(['open', 'in_progress', 'done', 'cancelled'] as const).map((s) => (
              <option value={s} selected={s === status}>{t(`ticket.${s}` as 'ticket.open')}</option>
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
                    <td><a href={`/tickets/${k.id}`}>{k.title}</a><div class="small muted">{thaiDate(k.created_at.slice(0, 10))}</div></td>
                    <td>{k.building_name} {k.room_number}</td>
                    <td class="small">{k.tenant_name ?? '-'}</td>
                    <td><Tag kind={k.priority} label={t(`ticket.${k.priority}` as 'ticket.normal')} /></td>
                    <td><Tag kind={k.status} label={t(`ticket.${k.status}` as 'ticket.open')} /></td>
                    <td class="num"><a class="btn sm" href={`/tickets/${k.id}`}>{t('common.view')}</a></td>
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
  const db = c.get('db');
  const t = c.get('t');
  const rooms = await db.all<{ id: string; number: string; building_name: string; tenant_id: string | null; tenant_name: string | null }>(
    `SELECT r.id, r.number, b.name AS building_name, ct.tenant_id, tn.name AS tenant_name
       FROM rooms r JOIN buildings b ON b.id = r.building_id
       LEFT JOIN contracts ct ON ct.room_id = r.id AND ct.status = 'active'
       LEFT JOIN tenants tn ON tn.id = ct.tenant_id
      ORDER BY b.name, r.floor, r.number`,
  );
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
              <option value={r.id} selected={r.id === preRoom} data-tenant={r.tenant_id ?? ''}>
                {r.building_name} {r.number}{r.tenant_name ? ` · ${r.tenant_name}` : ''}
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
              <option value="low">{t('ticket.low')}</option>
              <option value="normal" selected>{t('ticket.normal')}</option>
              <option value="urgent">{t('ticket.urgent')}</option>
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
  const db = c.get('db');
  const f = await c.req.formData();
  const roomId = str(f.get('room_id'));
  const title = str(f.get('title'));
  if (!roomId || !title) return back(c, '/tickets/new', 'missing', true);

  const contract = await db.activeContractForRoom(roomId);
  let photoKey: string | null = null;
  const photo = f.get('photo');
  if (photo instanceof File && photo.size > 0) {
    photoKey = `tickets/${roomId}/${id('')}`;
    await c.env.FILES.put(photoKey, await photo.arrayBuffer(), {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });
  }

  const tid = id('k_');
  await db.run(
    'INSERT INTO tickets (id, room_id, tenant_id, title, detail, priority, photo_key) VALUES (?,?,?,?,?,?,?)',
    tid, roomId, contract?.tenant_id ?? null, title, str(f.get('detail')) || null,
    str(f.get('priority')) || 'normal', photoKey,
  );
  return back(c, `/tickets/${tid}`, 'saved');
});

app.get('/tickets/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const rows = await db.ticketRows();
  const k = rows.find((r) => r.id === c.req.param('id'));
  if (!k) return c.notFound();
  return c.html(
    <Layout {...page(c, k.title)}>
      <PageHead title={k.title} sub={`${k.building_name} ${k.room_number} · ${k.tenant_name ?? '-'}`}>
        <a class="btn" href="/tickets">{t('common.back')}</a>
      </PageHead>
      <div class="grid c2">
        <div class="card">
          <h2>{t('ticket.detail')}</h2>
          <p>{k.detail ?? <span class="muted">-</span>}</p>
          {k.photo_key ? <p><a href={`/files/${k.photo_key}`} target="_blank">📷 {t('common.view')}</a></p> : null}
          <p class="small muted">{thaiDate(k.created_at.slice(0, 10))}</p>
        </div>
        <form method="post" action={`/tickets/${k.id}`} class="card">
          <h2>{t('common.edit')}</h2>
          <div class="row">
            <div class="field">
              <label for="status">{t('room.status')}</label>
              <select id="status" name="status">
                {(['open', 'in_progress', 'done', 'cancelled'] as const).map((s) => (
                  <option value={s} selected={s === k.status}>{t(`ticket.${s}` as 'ticket.open')}</option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="priority">{t('ticket.priority')}</label>
              <select id="priority" name="priority">
                {(['low', 'normal', 'urgent'] as const).map((p) => (
                  <option value={p} selected={p === k.priority}>{t(`ticket.${p}` as 'ticket.normal')}</option>
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
  const tid = c.req.param('id');
  const f = await c.req.formData();
  const status = str(f.get('status')) || 'open';
  await c.get('db').run(
    'UPDATE tickets SET status = ?, priority = ?, closed_at = CASE WHEN ? IN (\'done\',\'cancelled\') THEN ? ELSE NULL END WHERE id = ?',
    status, str(f.get('priority')) || 'normal', status, today(), tid,
  );
  return back(c, `/tickets/${tid}`, 'saved');
});

export default app;
