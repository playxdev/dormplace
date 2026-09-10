import { back, page, requirePermission, route } from '../app';
import { Empty, Icon, Layout, PageHead, RailStat, Tag } from '../ui/layout';
import { baht, fromSatang, num, statusKey, str, toSatang } from '../lib/util';

const app = route();

/** Statuses in the order the filter bar shows them, database spelling. */
const STATUSES = ['OCCUPIED', 'VACANT', 'MAINTENANCE'] as const;

app.get('/rooms', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.read');
  const repos = c.get('repos');
  const buildings = await repos.buildings.all(tctx);
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].building_id;
  const building = buildings.find((b) => b.building_id === buildingId) ?? buildings[0];
  // The query parameter is a filter over rows already scoped to this tenant,
  // never a scope of its own — grid() takes the tenant from tctx.
  const filter = (c.req.query('status') ?? '').toUpperCase();

  const rows = await repos.rooms.grid(tctx, building.building_id);

  const shown = filter ? rows.filter((r) => r.status === filter) : rows;
  const floors = [...new Set(shown.map((r) => r.floor))].sort((a, b) => a - b);
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const occupied = count('OCCUPIED');
  const rate = rows.length ? Math.round((occupied / rows.length) * 100) : 0;
  const totalDue = rows.reduce((s, r) => s + r.due, 0);
  const potential = rows.reduce((s, r) => s + r.rent, 0);
  const actual = rows.filter((r) => r.contract_id).reduce((s, r) => s + r.rent, 0);
  const href = (extra = '') => `/rooms?building=${building.building_id}${extra}`;

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
          {STATUSES.map((st) => (
            <a class="att-row" href={href(`&status=${statusKey(st)}`)}>
              <span class={`dot ${st === 'OCCUPIED' ? 'ok' : st === 'VACANT' ? 'warn' : 'bad'}`} aria-hidden="true">
                {Icon.door({ size: 14 })}
              </span>
              <span class="txt"><b>{t(`room.${statusKey(st)}` as 'room.vacant')}</b><span>{t('common.rooms')}</span></span>
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
      context={{ name: building.name, sub: `${rows.length} ${t('common.rooms')}`, href: `/buildings/${building.building_id}` }}>
      <PageHead title={t('room.title')} sub={`${building.name} · ${occupied}/${rows.length} ${t('room.occupied')}`}>
        {buildings.length > 1 ? (
          <form method="get" action="/rooms">
            <select name="building" onchange="this.form.submit()" aria-label={t('building.name')}>
              {buildings.map((b) => (
                <option value={b.building_id} selected={b.building_id === building.building_id}>{b.name}</option>
              ))}
            </select>
          </form>
        ) : null}
        <a class="btn" href={`/rooms/bulk?building=${building.building_id}`}>{t('room.bulk')}</a>
        <a class="btn primary" href={`/rooms/new?building=${building.building_id}`}>
          <span aria-hidden="true">{Icon.plus({ size: 16 })}</span>{t('room.new')}
        </a>
      </PageHead>

      <div class="card" style="margin-bottom:1rem">
        <div class="btn-row" style="justify-content:space-between">
          <div class="btn-row">
            <a class={`btn sm${filter === '' ? ' primary' : ''}`} href={href()}>
              {t('common.all')} {rows.length}
            </a>
            {STATUSES.map((st) => (
              <a class={`btn sm${filter === st ? ' primary' : ''}`} href={href(`&status=${statusKey(st)}`)}>
                {t(`room.${statusKey(st)}` as 'room.vacant')} {count(st)}
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
            action={<a class="btn primary" href={`/rooms/new?building=${building.building_id}`}>{t('room.new')}</a>} />
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
                <a class={`room ${statusKey(r.status)}`} href={`/rooms/${r.room_id}`}>
                  <div class="rt">
                    <span class="no">{r.number}</span>
                    {r.open_tickets > 0 ? <span class="flag" title={t('nav.tickets')} aria-label={t('nav.tickets')}>🔧</span> : null}
                  </div>
                  <div class="who">{r.party_name ?? t(`room.${statusKey(r.status)}` as 'room.vacant')}</div>
                  <div class="rb">
                    <span class="rent">฿{baht(r.rent)}</span>
                    {r.due > 0
                      ? <span class="due">฿{baht(r.due)}</span>
                      : <Tag kind={statusKey(r.status)} label={t(`room.${statusKey(r.status)}` as 'room.vacant')} plain />}
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
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.manage');
  const buildings = await c.get('repos').buildings.all(tctx);
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].building_id;
  return c.html(
    <Layout {...page(c, t('room.new'))}>
      <PageHead title={t('room.new')}>
        <a class="btn" href="/rooms">{t('common.back')}</a>
      </PageHead>
      <form method="post" action="/rooms" class="card" style="max-width:640px">
        <div class="field">
          <label for="building_id">{t('building.name')}</label>
          <select id="building_id" name="building_id" required>
            {buildings.map((b) => (
              <option value={b.building_id} selected={b.building_id === buildingId}>{b.name}</option>
            ))}
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
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.manage');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const number = str(f.get('number'));
  if (!buildingId || !number) return back(c, '/rooms/new', 'missing', true);
  // The building id is checked against this tenant before it is used as a
  // foreign key; a posted id from elsewhere throws NotFound here.
  await c.get('repos').buildings.byId(tctx, buildingId);
  try {
    await c.get('repos').rooms.insert(tctx, {
      building_id: buildingId,
      floor: Math.max(1, Math.round(num(f.get('floor'), 1))),
      number,
      room_type: str(f.get('room_type')) || null,
      rent: toSatang(num(f.get('rent'))),
      deposit: toSatang(num(f.get('deposit'))),
    });
  } catch {
    // The partial unique index on (tenant_id, building_id, number).
    return back(c, `/rooms/new?building=${buildingId}`, 'duplicate', true);
  }
  return back(c, `/rooms?building=${buildingId}`, 'saved');
});

/** Bulk create: floors x rooms-per-floor, numbered <floor><nn>. */
app.get('/rooms/bulk', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.manage');
  const buildings = await c.get('repos').buildings.all(tctx);
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].building_id;
  return c.html(
    <Layout {...page(c, t('room.bulk'))}>
      <PageHead title={t('room.bulk')} sub="เช่น ชั้น 1–4 ชั้นละ 10 ห้อง จะได้ 101–110, 201–210 …">
        <a class="btn" href={`/rooms?building=${buildingId}`}>{t('common.back')}</a>
      </PageHead>
      <form method="post" action="/rooms/bulk" class="card" style="max-width:640px">
        <div class="field">
          <label for="building_id">{t('building.name')}</label>
          <select id="building_id" name="building_id" required>
            {buildings.map((b) => (
              <option value={b.building_id} selected={b.building_id === buildingId}>{b.name}</option>
            ))}
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
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.manage');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  if (!buildingId) return back(c, '/rooms/bulk', 'missing', true);
  await c.get('repos').buildings.byId(tctx, buildingId);

  const from = Math.max(1, Math.round(num(f.get('from_floor'), 1)));
  await c.get('repos').rooms.bulkCreate(tctx, {
    buildingId,
    fromFloor: from,
    toFloor: Math.max(from, Math.round(num(f.get('to_floor'), from))),
    perFloor: Math.min(99, Math.max(1, Math.round(num(f.get('per_floor'), 10)))),
    rent: toSatang(num(f.get('rent'))),
    deposit: toSatang(num(f.get('deposit'))),
    roomType: str(f.get('room_type')) || null,
  });
  return back(c, `/rooms?building=${buildingId}`, 'saved');
});

app.get('/rooms/:id', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.read');
  const repos = c.get('repos');
  const room = await repos.rooms.byId(tctx, c.req.param('id'));
  const [building, live, invoices, tickets] = await Promise.all([
    repos.buildings.byId(tctx, room.building_id),
    repos.contracts.activeForRoom(tctx, room.room_id),
    repos.invoices.rows(tctx, { roomId: room.room_id, limit: 12 }),
    repos.tickets.all(tctx, {
      where: [['room_id', '=', room.room_id]],
      orderBy: [['created_at', 'DESC']],
      limit: 6,
    }),
  ]);
  const contract = live[0] ?? null;
  const resident = contract ? await repos.parties.byId(tctx, contract.party_id) : null;

  return c.html(
    <Layout {...page(c, `${t('room.number')} ${room.number}`)}>
      <PageHead title={`${t('room.number')} ${room.number}`} sub={building?.name}>
        <a class="btn" href={`/rooms?building=${room.building_id}`}>{t('common.back')}</a>
        {contract
          ? <a class="btn" href={`/contracts/${contract.contract_id}`}>{t('contract.title')}</a>
          : <a class="btn primary" href={`/contracts/new?room=${room.room_id}`}>{t('contract.new')}</a>}
      </PageHead>

      <div class="grid c2">
        <form method="post" action={`/rooms/${room.room_id}`} class="card">
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
              {STATUSES.map((st) => (
                <option value={st} selected={room.status === st}>
                  {t(`room.${statusKey(st)}` as 'room.vacant')}
                </option>
              ))}
            </select>
            {contract ? <div class="small muted">สถานะถูกกำหนดโดยสัญญาเช่าที่ยังใช้งานอยู่</div> : null}
          </div>
          <button class="btn primary" type="submit">{t('common.save')}</button>
        </form>

        <div>
          <div class="card">
            <h2>{t('contract.title')}</h2>
            {contract && resident ? (
              <>
                <p>
                  <strong><a href={`/residents/${resident.party_id}`}>{resident.display_name}</a></strong>
                  <div class="small muted">{resident.phone_masked ?? ''}</div>
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
                      <td><a href={`/invoices/${i.invoice_id}`}>{i.period}</a></td>
                      <td class="num">฿{baht(i.total)}</td>
                      <td class="num"><Tag kind={statusKey(i.effective_status)}
                        label={t(`invoice.${statusKey(i.effective_status)}` as 'invoice.paid')} /></td>
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
                      <td><a href={`/tickets/${k.ticket_id}`}>{k.title}</a></td>
                      <td class="num"><Tag kind={statusKey(k.status)}
                        label={t(`ticket.${statusKey(k.status)}` as 'ticket.open')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <a class="btn sm" href={`/tickets/new?room=${room.room_id}`} style="margin-top:.5rem">{t('ticket.new')}</a>
          </div>
        </div>
      </div>
    </Layout>,
  );
});

app.post('/rooms/:id', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.room.manage');
  const repos = c.get('repos');
  const rid = c.req.param('id');
  const room = await repos.rooms.byId(tctx, rid);
  const f = await c.req.formData();

  // A live lease owns the occupancy status, so a posted one is ignored rather
  // than trusted: the form disables the control, and a disabled control is a
  // hint to the person, not a constraint on the request.
  const live = await repos.contracts.activeForRoom(tctx, rid);
  const posted = str(f.get('status')).toUpperCase();
  const status = live.length
    ? 'OCCUPIED'
    : ((STATUSES as readonly string[]).includes(posted) ? posted : room.status);

  await repos.rooms.update(tctx, rid, {
    number: str(f.get('number')) || room.number,
    floor: Math.max(1, Math.round(num(f.get('floor'), room.floor))),
    room_type: str(f.get('room_type')) || null,
    rent: toSatang(num(f.get('rent'))),
    deposit: toSatang(num(f.get('deposit'))),
    status: status as typeof room.status,
  });
  return back(c, `/rooms/${rid}`, 'saved');
});

export default app;
