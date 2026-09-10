import { back, page, requirePermission, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { baht, fromSatang, num, statusKey, str, thaiDate, today, toSatang } from '../lib/util';

const app = route();

app.get('/contracts', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.read');
  const status = c.req.query('status') === 'ended' ? 'ended' : 'active';
  // "Active" means anything still running, which includes a lease under notice.
  const rows = await c.get('repos').contracts.rows(
    tctx, status === 'ended' ? ['ENDED'] : ['DRAFT', 'ACTIVE', 'ENDING'],
  );
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
                    <td><a href={`/residents/${r.party_id}`}>{r.party_name}</a><div class="small muted">{r.phone_masked ?? ''}</div></td>
                    <td>{thaiDate(r.start_date)}</td>
                    <td>{r.end_date ? thaiDate(r.end_date) : <span class="muted">-</span>}</td>
                    <td class="num">฿{baht(r.rent)}</td>
                    <td class="num"><a class="btn sm" href={`/contracts/${r.contract_id}`}>{t('common.view')}</a></td>
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
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.create');
  const repos = c.get('repos');
  const [vacant, residents] = await Promise.all([
    repos.rooms.vacant(tctx),
    repos.parties.all(tctx, { limit: 1000 }),
  ]);
  const preRoom = c.req.query('room') ?? '';
  const preResident = c.req.query('resident') ?? '';

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
        <a class="btn" href="/residents/new?next=contract">{t('tenant.new')}</a>
      </PageHead>
      <form method="post" action="/contracts" class="card" style="max-width:760px">
        <div class="row">
          <div class="field">
            <label for="room_id">{t('room.title')}</label>
            <select id="room_id" name="room_id" required>
              {vacant.map((r) => (
                <option value={r.room_id} selected={r.room_id === preRoom}
                  data-rent={String(fromSatang(r.rent))} data-deposit={String(fromSatang(r.deposit))}>
                  {r.building_name} · {r.number} · ฿{baht(r.rent)}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <label for="party_id">{t('tenant.title')}</label>
            <select id="party_id" name="party_id" required>
              <option value="">{t('common.select')}…</option>
              {residents.map((rp) => (
                <option value={rp.party_id} selected={rp.party_id === preResident}>
                  {rp.display_name} {rp.phone_masked ? `· ${rp.phone_masked}` : ''}
                </option>
              ))}
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
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.create');
  const repos = c.get('repos');
  const f = await c.req.formData();
  const roomId = str(f.get('room_id'));
  const partyId = str(f.get('party_id'));
  const startDate = str(f.get('start_date'));
  if (!roomId || !partyId || !startDate) return back(c, '/contracts/new', 'missing', true);

  // Both ids arrived in a form. byId() proves each belongs to this tenant
  // before either is written as a foreign key.
  const room = await repos.rooms.byId(tctx, roomId);
  await repos.parties.byId(tctx, partyId);

  const live = await repos.contracts.activeForRoom(tctx, roomId);
  if (live.length) return back(c, '/contracts/new', 'room_taken', true);

  const contract = await repos.contracts.insert(tctx, {
    room_id: roomId,
    party_id: partyId,
    start_date: startDate,
    end_date: str(f.get('end_date')) || null,
    rent: toSatang(num(f.get('rent'), fromSatang(room.rent))),
    deposit: toSatang(num(f.get('deposit'), fromSatang(room.deposit))),
    deposit_paid: toSatang(num(f.get('deposit_paid'))),
    water_start: Math.round(num(f.get('water_start'))),
    electric_start: Math.round(num(f.get('electric_start'))),
  });
  // The lease is signed on paper at the desk, so it is live and the room is
  // occupied now. The resident confirming it in the app later is a separate
  // step that records what they agreed to; it is not what starts the tenancy.
  await repos.contracts.activate(tctx, contract.contract_id);
  return back(c, `/contracts/${contract.contract_id}`, 'saved');
});

app.get('/contracts/:id', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.read');
  const repos = c.get('repos');
  const contract = await repos.contracts.byId(tctx, c.req.param('id'));
  const [room, resident, invoices] = await Promise.all([
    repos.rooms.byId(tctx, contract.room_id),
    repos.parties.byId(tctx, contract.party_id),
    repos.invoices.rows(tctx, { contractId: contract.contract_id }),
  ]);
  const building = await repos.buildings.byId(tctx, room.building_id);
  const live = contract.status === 'ACTIVE' || contract.status === 'ENDING';

  return c.html(
    <Layout {...page(c, t('contract.title'))}>
      <PageHead title={`${building.name} ${room.number}`} sub={resident.display_name ?? ''}>
        <a class="btn" href="/contracts">{t('common.back')}</a>
        <a class="btn" href={`/contracts/${contract.contract_id}/print`} target="_blank">{t('invoice.print')}</a>
        {live
          ? <a class="btn primary" href={`/contracts/${contract.contract_id}/invite`}>{t('invite.title')}</a>
          : null}
      </PageHead>

      <div class="grid c2">
        <form method="post" action={`/contracts/${contract.contract_id}`} class="card">
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
            <Tag kind={statusKey(contract.status)}
              label={t(`contract.${statusKey(contract.status)}` as 'contract.active')} />
            {contract.confirmed_at
              ? <span class="small muted">{t('contract.confirmed')} {thaiDate(contract.confirmed_at)}</span>
              : <span class="small muted">{t('contract.unconfirmed')}</span>}
          </div>
        </form>

        <div>
          {live ? (
            <form method="post" action={`/contracts/${contract.contract_id}/checkout`} class="card"
              onsubmit={`return confirm('${t('contract.checkout_confirm')}')`}>
              <h2>{t('contract.checkout')}</h2>
              <div class="field">
                <label for="moved_out_at">{t('contract.checkout')}</label>
                <input id="moved_out_at" name="moved_out_at" type="date" value={today()} required />
              </div>
              {/* Required, and it goes into the audit row. A lease that ended
                  for no recorded reason is a dispute nobody can settle later. */}
              <div class="field">
                <label for="reason">{t('contract.end_reason')}</label>
                <input id="reason" name="reason" required placeholder="ย้ายออกตามกำหนด" />
              </div>
              <p class="small muted">{t('contract.checkout_confirm')}</p>
              <button class="btn danger" type="submit">{t('contract.checkout')}</button>
            </form>
          ) : (
            <div class="card">
              <h2>{t('contract.ended')}</h2>
              <p>{thaiDate(contract.ended_at)}</p>
              {contract.ending_reason ? <p class="small muted">{contract.ending_reason}</p> : null}
              {/* Seven days from hand-back, written by the system when the
                  lease ended. */}
              {contract.deposit_return_due_at ? (
                <p class="small">
                  {t('contract.deposit_return_due')} <strong>{thaiDate(contract.deposit_return_due_at)}</strong>
                </p>
              ) : null}
            </div>
          )}

          <div class="card">
            <h2>{t('nav.invoices')}</h2>
            {invoices.length === 0 ? <Empty text={t('invoice.none')} /> : (
              <table>
                <tbody>
                  {invoices.map((i) => (
                    <tr>
                      <td><a href={`/invoices/${i.invoice_id}`}>{i.number}</a></td>
                      <td class="num">฿{baht(i.total)}</td>
                      <td class="num"><Tag kind={statusKey(i.effective_status)}
                        label={t(`invoice.${statusKey(i.effective_status)}` as 'invoice.paid')} /></td>
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
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.amend');
  const cid = c.req.param('id');
  const f = await c.req.formData();
  // Amending the rent moves `rent`. It does not move `agreed_rent`, which is
  // not writable and records what the resident accepted.
  await c.get('repos').contracts.update(tctx, cid, {
    start_date: str(f.get('start_date')),
    end_date: str(f.get('end_date')) || null,
    rent: toSatang(num(f.get('rent'))),
    deposit: toSatang(num(f.get('deposit'))),
    deposit_paid: toSatang(num(f.get('deposit_paid'))),
    water_start: Math.round(num(f.get('water_start'))),
    electric_start: Math.round(num(f.get('electric_start'))),
    note: str(f.get('note')) || null,
  });
  return back(c, `/contracts/${cid}`, 'saved');
});

app.post('/contracts/:id/checkout', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.end');
  const cid = c.req.param('id');
  const f = await c.req.formData();
  const reason = str(f.get('reason'));
  if (!reason) return back(c, `/contracts/${cid}`, 'missing', true);
  // end() frees the room and sets the deposit-return date in the same batch as
  // the audit row.
  await c.get('repos').contracts.end(tctx, cid, reason, str(f.get('moved_out_at')) || today());
  return back(c, `/contracts/${cid}`, 'checked_out');
});

export default app;
