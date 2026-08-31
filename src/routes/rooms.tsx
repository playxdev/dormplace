import { back, page, route } from '../app';
import { Empty, Icon, Kpi, Layout, PageHead, RailStat, Tag } from '../ui/layout';
import { baht, fromSatang, id, num, str, toSatang } from '../lib/util';
import type { Room } from '../types';

const app = route();

type RoomRow = Room & { tenant_name: string | null; contract_id: string | null; due: number; tickets: number };

app.get('/rooms', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].id;
  const building = buildings.find((b) => b.id === buildingId) ?? buildings[0];
  const filter = c.req.query('status') ?? '';

  const rows = await db.all<RoomRow>(
    `SELECT r.*, t.name AS tenant_name, ct.id AS contract_id,
            COALESCE((SELECT SUM(i.total - i.paid_total) FROM invoices i
                       WHERE i.room_id = r.id AND i.status IN ('unpaid','partial')), 0) AS due,
            (SELECT COUNT(*) FROM tickets k
              WHERE k.room_id = r.id AND k.status IN ('open','in_progress')) AS tickets
       FROM rooms r
       LEFT JOIN contracts ct ON ct.room_id = r.id AND ct.status = 'active'
       LEFT JOIN tenants t ON t.id = ct.tenant_id
      WHERE r.building_id = ?
      ORDER BY r.floor, r.number`,
    building.id,
  );

  const shown = filter ? rows.filter((r) => r.status === filter) : rows;
  const floors = [...new Set(shown.map((r) => r.floor))].sort((a, b) => a - b);
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const occupied = count('occupied');
  const rate = rows.length ? Math.round((occupied / rows.length) * 100) : 0;
  const totalDue = rows.reduce((s, r) => s + r.due, 0);
  const potential = rows.reduce((s, r) => s + r.rent, 0);
  const actual = rows.filter((r) => r.contract_id).reduce((s, r) => s + r.rent, 0);

  const rail = (
    <>
      <div>
        <h2>{t('dash.summary')}</h2>
        <RailStat label={t('dash.occupancy')} value={`${rate}%`} bar={{ pct: rate, tone: 'green' }} />
        <RailStat label={t('contract.rent')} value={`฿${baht(actual)}`} />
        <RailStat label={t('dash.outstanding')} value={`฿${baht(totalDue)}`} />
      </div>
      <div>
        <h2>{t('room.status')}</h2>
        <div class="att">
          {(['occupied', 'vacant', 'maintenance'] as const).map((st) => (
            <a class="att-row" href={`/rooms?building=${building.id}&status=${st}`}>
              <span class={`dot ${st === 'occupied' ? 'ok' : st === 'vacant' ? 'warn' : 'bad'}`} aria-hidden="true">
                {Icon.door({ size: 14 })}
              </span>
              <span class="txt"><b>{t(`room.${st}` as 'room.vacant')}</b><span>{t('common.rooms')}</span></span>
              <span class="amt">{count(st)}</span>
            </a>
          ))}
        </div>
      </div>
      <div>
        <h2>{t('report.income')}</h2>
        <div class="small muted" style="margin-bottom:.5rem">
          ฿{baht(actual)} {t('common.of')} ฿{baht(potential)}
        </div>
        <div class="bar"><i style={`width:${potential ? (actual / potential) * 100 : 0}%`} /></div>
      </div>
    </>
  );

  return c.html(
    <Layout {...page(c, t('room.title'))} rail={rail}
      context={{ name: building.name, sub: `${rows.length} ${t('common.rooms')}`, href: `/buildings/${building.id}` }}>
      <PageHead title={t('room.title')} sub={`${building.name} · ${occupied}/${rows.length} ${t('room.occupied')}`}>
        {buildings.length > 1 ? (
          <form method="get" action="/rooms">
            <select name="building" onchange="this.form.submit()" aria-label={t('building.name')}>
              {buildings.map((b) => <option value={b.id} selected={b.id === building.id}>{b.name}</option>)}
            </select>
          </form>
        ) : null}
        <a class="btn" href={`/rooms/bulk?building=${building.id}`}>{t('room.bulk')}</a>
        <a class="btn primary" href={`/rooms/new?building=${building.id}`}>
          <span aria-hidden="true">{Icon.plus({ size: 16 })}</span>{t('room.new')}
        </a>
      </PageHead>

      <div class="card" style="margin-bottom:1rem">
        <div class="btn-row" style="justify-content:space-between">
          <div class="btn-row">
            <a class={`btn sm${filter === '' ? ' primary' : ''}`} href={`/rooms?building=${building.id}`}>
              {t('common.all')} {rows.length}
            </a>
            {(['occupied', 'vacant', 'maintenance'] as const).map((st) => (
              <a class={`btn sm${filter === st ? ' primary' : ''}`} href={`/rooms?building=${building.id}&status=${st}`}>
                {t(`room.${st}` as 'room.vacant')} {count(st)}
              </a>
            ))}
          </div>
          <div class="legend">
            <span class="occupied"><i />{t('room.occupied')}</span>
            <span class="vacant"><i />{t('room.vacant')}</span>
            <span class="maintenance"><i />{t('room.maintenance')}</span>
          </div>
        </div>
      </div>

      {shown.length === 0 ? (
        <div class="card">
          <Empty text={t('common.none')} icon="door"
            action={<a class="btn primary" href={`/rooms/new?building=${building.id}`}>{t('room.new')}</a>} />
        </div>
      ) : (
        floors.map((f) => (
          <>
            <div class="floor-head">
              <span class="lbl">{t('room.floor')} {f}</span>
              <span class="line" />
              <span class="lbl">{shown.filter((r) => r.floor === f).length} {t('common.rooms')}</span>
            </div>
            <div class="rooms">
              {shown.filter((r) => r.floor === f).map((r) => (
                <a class={`room ${r.status}`} href={`/rooms/${r.id}`}>
                  <div class="rt">
                    <span class="no">{r.number}</span>
                    {r.tickets > 0 ? <span class="flag" title={t('nav.tickets')} aria-label={t('nav.tickets')}>🔧</span> : null}
                  </div>
                  <div class="who">{r.tenant_name ?? t(`room.${r.status}` as 'room.vacant')}</div>
                  <div class="rb">
                    <span class="rent">฿{baht(r.rent)}</span>
                    {r.due > 0
                      ? <span class="due">฿{baht(r.due)}</span>
                      : <Tag kind={r.status} label={t(`room.${r.status}` as 'room.vacant')} plain />}
                  </div>
                </a>
              ))}
            </div>
          </>
        ))
      )}
    </Layout>,
  );
});

app.get('/rooms/new', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].id;
  return c.html(
    <Layout {...page(c, t('room.new'))}>
      <PageHead title={t('room.new')}>
        <a class="btn" href="/rooms">{t('common.back')}</a>
      </PageHead>
      <form method="post" action="/rooms" class="card" style="max-width:640px">
        <div class="field">
          <label for="building_id">{t('building.name')}</label>
          <select id="building_id" name="building_id" required>
            {buildings.map((b) => <option value={b.id} selected={b.id === buildingId}>{b.name}</option>)}
          </select>
        </div>
        <div class="row">
          <div class="field">
            <label for="number">{t('room.number')}</label>
            <input id="number" name="number" required />
          </div>
          <div class="field">
            <label for="floor">{t('room.floor')}</label>
            <input id="floor" name="floor" type="number" min="1" value="1" required />
          </div>
          <div class="field">
            <label for="room_type">{t('room.type')}</label>
            <input id="room_type" name="room_type" placeholder="แอร์ / พัดลม" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="rent">{t('room.rent')}</label>
            <input id="rent" name="rent" inputmode="decimal" required value="3500" />
          </div>
          <div class="field">
            <label for="deposit">{t('room.deposit')}</label>
            <input id="deposit" name="deposit" inputmode="decimal" value="7000" />
          </div>
        </div>
        <div class="btn-row">
          <button class="btn primary" type="submit">{t('common.save')}</button>
          <a class="btn" href={`/rooms?building=${buildingId}`}>{t('common.cancel')}</a>
        </div>
      </form>
    </Layout>,
  );
});

app.post('/rooms', async (c) => {
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const number = str(f.get('number'));
  if (!buildingId || !number) return back(c, '/rooms/new', 'missing', true);
  try {
    await c.get('db').run(
      'INSERT INTO rooms (id, building_id, floor, number, room_type, rent, deposit) VALUES (?,?,?,?,?,?,?)',
      id('r_'), buildingId, Math.max(1, Math.round(num(f.get('floor'), 1))), number,
      str(f.get('room_type')) || null, toSatang(num(f.get('rent'))), toSatang(num(f.get('deposit'))),
    );
  } catch {
    return back(c, `/rooms/new?building=${buildingId}`, 'duplicate', true);
  }
  return back(c, `/rooms?building=${buildingId}`, 'saved');
});

/** Bulk create: floors x rooms-per-floor, numbered <floor><nn>. */
app.get('/rooms/bulk', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].id;
  return c.html(
    <Layout {...page(c, t('room.bulk'))}>
      <PageHead title={t('room.bulk')} sub="เช่น ชั้น 1–4 ชั้นละ 10 ห้อง จะได้ 101–110, 201–210 …">
        <a class="btn" href={`/rooms?building=${buildingId}`}>{t('common.back')}</a>
      </PageHead>
      <form method="post" action="/rooms/bulk" class="card" style="max-width:640px">
        <div class="field">
          <label for="building_id">{t('building.name')}</label>
          <select id="building_id" name="building_id" required>
            {buildings.map((b) => <option value={b.id} selected={b.id === buildingId}>{b.name}</option>)}
          </select>
        </div>
        <div class="row">
          <div class="field">
            <label for="from_floor">{t('room.floors_from')}</label>
            <input id="from_floor" name="from_floor" type="number" min="1" value="1" required />
          </div>
          <div class="field">
            <label for="to_floor">{t('room.floors_to')}</label>
            <input id="to_floor" name="to_floor" type="number" min="1" value="4" required />
          </div>
          <div class="field">
            <label for="per_floor">{t('room.per_floor')}</label>
            <input id="per_floor" name="per_floor" type="number" min="1" max="99" value="10" required />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="rent">{t('room.rent')}</label>
            <input id="rent" name="rent" inputmode="decimal" value="3500" required />
          </div>
          <div class="field">
            <label for="deposit">{t('room.deposit')}</label>
            <input id="deposit" name="deposit" inputmode="decimal" value="7000" />
          </div>
          <div class="field">
            <label for="room_type">{t('room.type')}</label>
            <input id="room_type" name="room_type" placeholder="แอร์" />
          </div>
        </div>
        <button class="btn primary" type="submit">{t('common.save')}</button>
      </form>
    </Layout>,
  );
});

app.post('/rooms/bulk', async (c) => {
  const db = c.get('db');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const from = Math.max(1, Math.round(num(f.get('from_floor'), 1)));
  const to = Math.max(from, Math.round(num(f.get('to_floor'), from)));
  const per = Math.min(99, Math.max(1, Math.round(num(f.get('per_floor'), 10))));
  const rent = toSatang(num(f.get('rent')));
  const deposit = toSatang(num(f.get('deposit')));
  const roomType = str(f.get('room_type')) || null;
  if (!buildingId) return back(c, '/rooms/bulk', 'missing', true);

  const existing = new Set((await db.rooms(buildingId)).map((r) => r.number));
  const stmts: D1PreparedStatement[] = [];
  for (let fl = from; fl <= to; fl++) {
    for (let n = 1; n <= per; n++) {
      const number = `${fl}${String(n).padStart(2, '0')}`;
      if (existing.has(number)) continue;
      stmts.push(db.prep(
        'INSERT INTO rooms (id, building_id, floor, number, room_type, rent, deposit) VALUES (?,?,?,?,?,?,?)',
        id('r_'), buildingId, fl, number, roomType, rent, deposit,
      ));
    }
  }
  if (stmts.length) await db.batch(stmts);
  return back(c, `/rooms?building=${buildingId}`, 'saved');
});

app.get('/rooms/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const room = await db.room(c.req.param('id'));
  if (!room) return c.notFound();
  const [building, contract, invoices, tickets] = await Promise.all([
    db.building(room.building_id),
    db.activeContractForRoom(room.id),
    db.all<{ id: string; number: string; period: string; total: number; paid_total: number; status: string }>(
      'SELECT id, number, period, total, paid_total, status FROM invoices WHERE room_id = ? ORDER BY period DESC LIMIT 12',
      room.id,
    ),
    db.all<{ id: string; title: string; status: string; created_at: string }>(
      'SELECT id, title, status, created_at FROM tickets WHERE room_id = ? ORDER BY created_at DESC LIMIT 6', room.id,
    ),
  ]);
  const tenant = contract ? await db.tenant(contract.tenant_id) : null;

  return c.html(
    <Layout {...page(c, `${t('room.number')} ${room.number}`)}>
      <PageHead title={`${t('room.number')} ${room.number}`} sub={building?.name}>
        <a class="btn" href={`/rooms?building=${room.building_id}`}>{t('common.back')}</a>
        {contract
          ? <a class="btn" href={`/contracts/${contract.id}`}>{t('contract.title')}</a>
          : <a class="btn primary" href={`/contracts/new?room=${room.id}`}>{t('contract.new')}</a>}
      </PageHead>

      <div class="grid c2">
        <form method="post" action={`/rooms/${room.id}`} class="card">
          <h2>{t('room.title')}</h2>
          <div class="row">
            <div class="field">
              <label for="number">{t('room.number')}</label>
              <input id="number" name="number" value={room.number} required />
            </div>
            <div class="field">
              <label for="floor">{t('room.floor')}</label>
              <input id="floor" name="floor" type="number" min="1" value={String(room.floor)} required />
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="rent">{t('room.rent')}</label>
              <input id="rent" name="rent" inputmode="decimal" value={String(fromSatang(room.rent))} />
            </div>
            <div class="field">
              <label for="deposit">{t('room.deposit')}</label>
              <input id="deposit" name="deposit" inputmode="decimal" value={String(fromSatang(room.deposit))} />
            </div>
            <div class="field">
              <label for="room_type">{t('room.type')}</label>
              <input id="room_type" name="room_type" value={room.room_type ?? ''} />
            </div>
          </div>
          <div class="field">
            <label for="status">{t('room.status')}</label>
            <select id="status" name="status" disabled={!!contract}>
              <option value="vacant" selected={room.status === 'vacant'}>{t('room.vacant')}</option>
              <option value="occupied" selected={room.status === 'occupied'}>{t('room.occupied')}</option>
              <option value="maintenance" selected={room.status === 'maintenance'}>{t('room.maintenance')}</option>
            </select>
            {contract ? <div class="small muted">สถานะถูกกำหนดโดยสัญญาเช่าที่ยังใช้งานอยู่</div> : null}
          </div>
          <button class="btn primary" type="submit">{t('common.save')}</button>
        </form>

        <div>
          <div class="card">
            <h2>{t('contract.title')}</h2>
            {contract && tenant ? (
              <>
                <p>
                  <strong><a href={`/tenants/${tenant.id}`}>{tenant.name}</a></strong>
                  <div class="small muted">{tenant.phone ?? ''}</div>
                </p>
                <table>
                  <tbody>
                    <tr><td>{t('contract.start')}</td><td class="num">{contract.start_date}</td></tr>
                    <tr><td>{t('contract.rent')}</td><td class="num">฿{baht(contract.rent)}</td></tr>
                    <tr><td>{t('contract.deposit')}</td><td class="num">฿{baht(contract.deposit)}</td></tr>
                  </tbody>
                </table>
              </>
            ) : <Empty text={t('room.vacant')} />}
          </div>

          <div class="card">
            <h2>{t('nav.invoices')}</h2>
            {invoices.length === 0 ? <Empty text={t('invoice.none')} /> : (
              <table>
                <tbody>
                  {invoices.map((i) => (
                    <tr>
                      <td><a href={`/invoices/${i.id}`}>{i.period}</a></td>
                      <td class="num">฿{baht(i.total)}</td>
                      <td class="num"><Tag kind={i.status} label={t(`invoice.${i.status}` as 'invoice.paid')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div class="card">
            <h2>{t('ticket.title')}</h2>
            {tickets.length === 0 ? <Empty text={t('common.none')} /> : (
              <table>
                <tbody>
                  {tickets.map((k) => (
                    <tr>
                      <td><a href={`/tickets/${k.id}`}>{k.title}</a></td>
                      <td class="num"><Tag kind={k.status} label={t(`ticket.${k.status}` as 'ticket.open')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <a class="btn sm" href={`/tickets/new?room=${room.id}`} style="margin-top:.5rem">{t('ticket.new')}</a>
          </div>
        </div>
      </div>
    </Layout>,
  );
});

app.post('/rooms/:id', async (c) => {
  const db = c.get('db');
  const rid = c.req.param('id');
  const room = await db.room(rid);
  if (!room) return c.notFound();
  const f = await c.req.formData();
  const contract = await db.activeContractForRoom(rid);
  // An active contract owns the occupancy status; ignore any status posted then.
  const status = contract ? 'occupied' : (['vacant', 'occupied', 'maintenance'].includes(str(f.get('status'))) ? str(f.get('status')) : room.status);
  await db.run(
    'UPDATE rooms SET number=?, floor=?, room_type=?, rent=?, deposit=?, status=? WHERE id=?',
    str(f.get('number')) || room.number,
    Math.max(1, Math.round(num(f.get('floor'), room.floor))),
    str(f.get('room_type')) || null,
    toSatang(num(f.get('rent'))),
    toSatang(num(f.get('deposit'))),
    status, rid,
  );
  return back(c, `/rooms/${rid}`, 'saved');
});

export default app;
