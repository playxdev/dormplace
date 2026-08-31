import { back, page, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { baht, fromSatang, id, num, str, thaiDate, today, toSatang } from '../lib/util';

const app = route();

app.get('/contracts', async (c) => {
  const t = c.get('t');
  const status = (c.req.query('status') as 'active' | 'ended' | undefined) ?? 'active';
  const rows = await c.get('db').contractRows(status);
  return c.html(
    <Layout {...page(c, t('contract.title'))}>
      <PageHead title={t('contract.title')} sub={`${rows.length}`}>
        <form method="get" action="/contracts">
          <select name="status" onchange="this.form.submit()">
            <option value="active" selected={status === 'active'}>{t('contract.active')}</option>
            <option value="ended" selected={status === 'ended'}>{t('contract.ended')}</option>
          </select>
        </form>
        <a class="btn primary" href="/contracts/new">{t('contract.new')}</a>
      </PageHead>
      <div class="card">
        {rows.length === 0 ? <Empty text={t('common.none')} /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.name')}</th>
                  <th>{t('contract.start')}</th>
                  <th>{t('contract.end')}</th>
                  <th class="num">{t('contract.rent')}</th>
                  <th class="num">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr>
                    <td><a href={`/rooms/${r.room_id}`}>{r.building_name} {r.room_number}</a></td>
                    <td><a href={`/tenants/${r.tenant_id}`}>{r.tenant_name}</a><div class="small muted">{r.tenant_phone ?? ''}</div></td>
                    <td>{thaiDate(r.start_date)}</td>
                    <td>{r.end_date ? thaiDate(r.end_date) : <span class="muted">-</span>}</td>
                    <td class="num">฿{baht(r.rent)}</td>
                    <td class="num"><a class="btn sm" href={`/contracts/${r.id}`}>{t('common.view')}</a></td>
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

app.get('/contracts/new', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const [vacant, tenants] = await Promise.all([
    db.all<{ id: string; number: string; floor: number; rent: number; deposit: number; building_name: string }>(
      `SELECT r.id, r.number, r.floor, r.rent, r.deposit, b.name AS building_name
         FROM rooms r JOIN buildings b ON b.id = r.building_id
        WHERE r.status = 'vacant' ORDER BY b.name, r.floor, r.number`,
    ),
    db.tenants(),
  ]);
  const preRoom = c.req.query('room') ?? '';
  const preTenant = c.req.query('tenant') ?? '';

  if (vacant.length === 0) {
    return c.html(
      <Layout {...page(c, t('contract.new'))}>
        <PageHead title={t('contract.new')} />
        <div class="card"><Empty text="ไม่มีห้องว่าง" /><div class="btn-row" style="justify-content:center"><a class="btn" href="/rooms">{t('nav.rooms')}</a></div></div>
      </Layout>,
    );
  }

  return c.html(
    <Layout {...page(c, t('contract.new'))}>
      <PageHead title={t('contract.new')}>
        <a class="btn" href="/contracts">{t('common.back')}</a>
        <a class="btn" href="/tenants/new?next=contract">{t('tenant.new')}</a>
      </PageHead>
      <form method="post" action="/contracts" class="card" style="max-width:760px">
        <div class="row">
          <div class="field">
            <label for="room_id">{t('room.title')}</label>
            <select id="room_id" name="room_id" required>
              {vacant.map((r) => (
                <option value={r.id} selected={r.id === preRoom} data-rent={String(fromSatang(r.rent))} data-deposit={String(fromSatang(r.deposit))}>
                  {r.building_name} · {r.number} · ฿{baht(r.rent)}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="tenant_id">{t('tenant.title')}</label>
            <select id="tenant_id" name="tenant_id" required>
              <option value="">{t('common.select')}…</option>
              {tenants.map((tn) => <option value={tn.id} selected={tn.id === preTenant}>{tn.name} {tn.phone ? `· ${tn.phone}` : ''}</option>)}
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="start_date">{t('contract.start')}</label>
            <input id="start_date" name="start_date" type="date" value={today()} required />
          </div>
          <div class="field">
            <label for="end_date">{t('contract.end')} <span class="muted">({t('common.optional')})</span></label>
            <input id="end_date" name="end_date" type="date" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="rent">{t('contract.rent')}</label>
            <input id="rent" name="rent" inputmode="decimal" required />
          </div>
          <div class="field">
            <label for="deposit">{t('contract.deposit')}</label>
            <input id="deposit" name="deposit" inputmode="decimal" />
          </div>
          <div class="field">
            <label for="deposit_paid">{t('payment.record')} — {t('contract.deposit')}</label>
            <input id="deposit_paid" name="deposit_paid" inputmode="decimal" value="0" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="water_start">{t('contract.water_start')}</label>
            <input id="water_start" name="water_start" type="number" min="0" value="0" />
          </div>
          <div class="field">
            <label for="electric_start">{t('contract.electric_start')}</label>
            <input id="electric_start" name="electric_start" type="number" min="0" value="0" />
          </div>
        </div>
        <div class="btn-row">
          <button class="btn primary" type="submit">{t('common.save')}</button>
          <a class="btn" href="/contracts">{t('common.cancel')}</a>
        </div>
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function () {
            var room = document.getElementById('room_id');
            var rent = document.getElementById('rent');
            var dep = document.getElementById('deposit');
            function sync() {
              var o = room.options[room.selectedIndex];
              if (!o) return;
              if (!rent.dataset.touched) rent.value = o.dataset.rent || '';
              if (!dep.dataset.touched) dep.value = o.dataset.deposit || '';
            }
            rent.addEventListener('input', function () { rent.dataset.touched = '1'; });
            dep.addEventListener('input', function () { dep.dataset.touched = '1'; });
            room.addEventListener('change', sync);
            sync();
          })();`,
        }}
      />
    </Layout>,
  );
});

app.post('/contracts', async (c) => {
  const db = c.get('db');
  const f = await c.req.formData();
  const roomId = str(f.get('room_id'));
  const tenantId = str(f.get('tenant_id'));
  const startDate = str(f.get('start_date'));
  if (!roomId || !tenantId || !startDate) return back(c, '/contracts/new', 'missing', true);

  const existing = await db.activeContractForRoom(roomId);
  if (existing) return back(c, '/contracts/new', 'room_taken', true);

  const room = await db.room(roomId);
  if (!room) return c.notFound();

  const cid = id('c_');
  await db.batch([
    db.prep(
      `INSERT INTO contracts (id, room_id, tenant_id, start_date, end_date, rent, deposit, deposit_paid,
         water_start, electric_start) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      cid, roomId, tenantId, startDate, str(f.get('end_date')) || null,
      toSatang(num(f.get('rent'), fromSatang(room.rent))),
      toSatang(num(f.get('deposit'), fromSatang(room.deposit))),
      toSatang(num(f.get('deposit_paid'))),
      Math.round(num(f.get('water_start'))), Math.round(num(f.get('electric_start'))),
    ),
    db.prep("UPDATE rooms SET status = 'occupied' WHERE id = ?", roomId),
  ]);
  return back(c, `/contracts/${cid}`, 'saved');
});

app.get('/contracts/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const contract = await db.contract(c.req.param('id'));
  if (!contract) return c.notFound();
  const [room, tenant, invoices] = await Promise.all([
    db.room(contract.room_id),
    db.tenant(contract.tenant_id),
    db.all<{ id: string; number: string; period: string; total: number; paid_total: number; status: string }>(
      'SELECT id, number, period, total, paid_total, status FROM invoices WHERE contract_id = ? ORDER BY period DESC',
      contract.id,
    ),
  ]);
  const building = room ? await db.building(room.building_id) : null;

  return c.html(
    <Layout {...page(c, t('contract.title'))}>
      <PageHead title={`${building?.name ?? ''} ${room?.number ?? ''}`} sub={tenant?.name}>
        <a class="btn" href="/contracts">{t('common.back')}</a>
        <a class="btn" href={`/contracts/${contract.id}/print`} target="_blank">{t('invoice.print')}</a>
      </PageHead>

      <div class="grid c2">
        <form method="post" action={`/contracts/${contract.id}`} class="card">
          <h2>{t('contract.title')}</h2>
          <div class="row">
            <div class="field">
              <label for="start_date">{t('contract.start')}</label>
              <input id="start_date" name="start_date" type="date" value={contract.start_date} required />
            </div>
            <div class="field">
              <label for="end_date">{t('contract.end')}</label>
              <input id="end_date" name="end_date" type="date" value={contract.end_date ?? ''} />
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="rent">{t('contract.rent')}</label>
              <input id="rent" name="rent" inputmode="decimal" value={String(fromSatang(contract.rent))} />
            </div>
            <div class="field">
              <label for="deposit">{t('contract.deposit')}</label>
              <input id="deposit" name="deposit" inputmode="decimal" value={String(fromSatang(contract.deposit))} />
            </div>
            <div class="field">
              <label for="deposit_paid">{t('invoice.paid')}</label>
              <input id="deposit_paid" name="deposit_paid" inputmode="decimal" value={String(fromSatang(contract.deposit_paid))} />
            </div>
          </div>
          <div class="row">
            <div class="field">
              <label for="water_start">{t('contract.water_start')}</label>
              <input id="water_start" name="water_start" type="number" value={String(contract.water_start)} />
            </div>
            <div class="field">
              <label for="electric_start">{t('contract.electric_start')}</label>
              <input id="electric_start" name="electric_start" type="number" value={String(contract.electric_start)} />
            </div>
          </div>
          <div class="field">
            <label for="note">{t('common.optional')}</label>
            <textarea id="note" name="note" rows={2}>{contract.note ?? ''}</textarea>
          </div>
          <div class="btn-row">
            <button class="btn primary" type="submit">{t('common.save')}</button>
            <Tag kind={contract.status} label={t(`contract.${contract.status}` as 'contract.active')} />
          </div>
        </form>

        <div>
          {contract.status === 'active' ? (
            <form method="post" action={`/contracts/${contract.id}/checkout`} class="card"
              onsubmit={`return confirm('${t('contract.checkout_confirm')}')`}>
              <h2>{t('contract.checkout')}</h2>
              <div class="field">
                <label for="moved_out_at">{t('contract.checkout')}</label>
                <input id="moved_out_at" name="moved_out_at" type="date" value={today()} required />
              </div>
              <p class="small muted">{t('contract.checkout_confirm')}</p>
              <button class="btn danger" type="submit">{t('contract.checkout')}</button>
            </form>
          ) : (
            <div class="card">
              <h2>{t('contract.ended')}</h2>
              <p>{thaiDate(contract.moved_out_at)}</p>
            </div>
          )}

          <div class="card">
            <h2>{t('nav.invoices')}</h2>
            {invoices.length === 0 ? <Empty text={t('invoice.none')} /> : (
              <table>
                <tbody>
                  {invoices.map((i) => (
                    <tr>
                      <td><a href={`/invoices/${i.id}`}>{i.number}</a></td>
                      <td class="num">฿{baht(i.total)}</td>
                      <td class="num"><Tag kind={i.status} label={t(`invoice.${i.status}` as 'invoice.paid')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>,
  );
});

app.post('/contracts/:id', async (c) => {
  const cid = c.req.param('id');
  const f = await c.req.formData();
  await c.get('db').run(
    `UPDATE contracts SET start_date=?, end_date=?, rent=?, deposit=?, deposit_paid=?,
       water_start=?, electric_start=?, note=? WHERE id=?`,
    str(f.get('start_date')), str(f.get('end_date')) || null,
    toSatang(num(f.get('rent'))), toSatang(num(f.get('deposit'))), toSatang(num(f.get('deposit_paid'))),
    Math.round(num(f.get('water_start'))), Math.round(num(f.get('electric_start'))),
    str(f.get('note')) || null, cid,
  );
  return back(c, `/contracts/${cid}`, 'saved');
});

app.post('/contracts/:id/checkout', async (c) => {
  const db = c.get('db');
  const cid = c.req.param('id');
  const contract = await db.contract(cid);
  if (!contract) return c.notFound();
  const f = await c.req.formData();
  const movedOut = str(f.get('moved_out_at')) || today();
  await db.batch([
    db.prep("UPDATE contracts SET status = 'ended', moved_out_at = ? WHERE id = ?", movedOut, cid),
    db.prep("UPDATE rooms SET status = 'vacant' WHERE id = ?", contract.room_id),
  ]);
  return back(c, `/contracts/${cid}`, 'checked_out');
});

export default app;
