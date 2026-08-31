import { back, page, route } from '../app';
import { Empty, Layout, PageHead } from '../ui/layout';
import { baht, fromSatang, id, num, str, toSatang } from '../lib/util';
import { normalizeTarget } from '../lib/promptpay';
import type { Building } from '../types';
import type { T } from '../lib/i18n';
import type { Ctx } from '../app';

const app = route();

function BuildingForm({ b, t }: { b: Building | null; t: T }) {
  const v = (n: number) => (n ? String(fromSatang(n)) : '0');
  return (
    <form method="post" action={b ? `/buildings/${b.id}` : '/buildings'}>
      <div class="card">
        <h2>{t('building.title')}</h2>
        <div class="row">
          <div class="field">
            <label for="name">{t('building.name')}</label>
            <input id="name" name="name" required value={b?.name ?? ''} />
          </div>
          <div class="field">
            <label for="tax_id">{t('building.tax_id')} <span class="muted">({t('common.optional')})</span></label>
            <input id="tax_id" name="tax_id" value={b?.tax_id ?? ''} inputmode="numeric" />
          </div>
        </div>
        <div class="field">
          <label for="address">{t('building.address')}</label>
          <textarea id="address" name="address" rows={2}>{b?.address ?? ''}</textarea>
        </div>
        <div class="row">
          <div class="field">
            <label for="promptpay_id">{t('building.promptpay')}</label>
            <input id="promptpay_id" name="promptpay_id" value={b?.promptpay_id ?? ''} inputmode="numeric"
              placeholder="0812345678" />
          </div>
          <div class="field">
            <label for="promptpay_name">{t('building.promptpay_name')}</label>
            <input id="promptpay_name" name="promptpay_name" value={b?.promptpay_name ?? ''} />
          </div>
        </div>
      </div>

      <div class="card">
        <h2>{t('meter.water')} / {t('meter.electric')}</h2>
        <div class="row">
          <div class="field">
            <label for="water_mode">{t('meter.water')}</label>
            <select id="water_mode" name="water_mode">
              <option value="meter" selected={b?.water_mode !== 'flat'}>{t('building.mode_meter')}</option>
              <option value="flat" selected={b?.water_mode === 'flat'}>{t('building.mode_flat')}</option>
            </select>
          </div>
          <div class="field">
            <label for="water_rate">{t('building.water_rate')}</label>
            <input id="water_rate" name="water_rate" inputmode="decimal" value={v(b?.water_rate ?? 1800)} />
          </div>
          <div class="field">
            <label for="water_flat">{t('building.water_flat')}</label>
            <input id="water_flat" name="water_flat" inputmode="decimal" value={v(b?.water_flat ?? 0)} />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="electric_mode">{t('meter.electric')}</label>
            <select id="electric_mode" name="electric_mode">
              <option value="meter" selected={b?.electric_mode !== 'flat'}>{t('building.mode_meter')}</option>
              <option value="flat" selected={b?.electric_mode === 'flat'}>{t('building.mode_flat')}</option>
            </select>
          </div>
          <div class="field">
            <label for="electric_rate">{t('building.electric_rate')}</label>
            <input id="electric_rate" name="electric_rate" inputmode="decimal" value={v(b?.electric_rate ?? 800)} />
          </div>
          <div class="field">
            <label for="electric_flat">{t('building.electric_flat')}</label>
            <input id="electric_flat" name="electric_flat" inputmode="decimal" value={v(b?.electric_flat ?? 0)} />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="common_fee">{t('building.common_fee')}</label>
            <input id="common_fee" name="common_fee" inputmode="decimal" value={v(b?.common_fee ?? 0)} />
          </div>
          <div class="field">
            <label for="due_day">{t('building.due_day')}</label>
            <input id="due_day" name="due_day" type="number" min="1" max="28" value={String(b?.due_day ?? 5)} />
          </div>
          <div class="field">
            <label for="late_fee_daily">{t('building.late_fee')}</label>
            <input id="late_fee_daily" name="late_fee_daily" inputmode="decimal" value={v(b?.late_fee_daily ?? 0)} />
          </div>
        </div>
        <div class="btn-row">
          <button class="btn primary" type="submit">{t('common.save')}</button>
          <a class="btn" href="/buildings">{t('common.cancel')}</a>
        </div>
      </div>
    </form>
  );
}

async function readForm(c: Ctx) {
  const f = await c.req.formData();
  const pp = str(f.get('promptpay_id'));
  return {
    name: str(f.get('name')),
    address: str(f.get('address')) || null,
    tax_id: str(f.get('tax_id')) || null,
    promptpay_id: pp || null,
    promptpay_name: str(f.get('promptpay_name')) || null,
    water_rate: toSatang(num(f.get('water_rate'))),
    water_mode: str(f.get('water_mode')) === 'flat' ? 'flat' : 'meter',
    water_flat: toSatang(num(f.get('water_flat'))),
    electric_rate: toSatang(num(f.get('electric_rate'))),
    electric_mode: str(f.get('electric_mode')) === 'flat' ? 'flat' : 'meter',
    electric_flat: toSatang(num(f.get('electric_flat'))),
    common_fee: toSatang(num(f.get('common_fee'))),
    late_fee_daily: toSatang(num(f.get('late_fee_daily'))),
    due_day: Math.min(28, Math.max(1, Math.round(num(f.get('due_day'), 5)))),
  };
}

app.get('/buildings', async (c) => {
  const t = c.get('t');
  const rows = await c.get('db').all<Building & { rooms: number }>(
    'SELECT b.*, (SELECT COUNT(*) FROM rooms r WHERE r.building_id = b.id) AS rooms FROM buildings b ORDER BY b.name',
  );
  return c.html(
    <Layout {...page(c, t('building.title'))}>
      <PageHead title={t('building.title')}>
        <a class="btn primary" href="/buildings/new">{t('building.new')}</a>
      </PageHead>
      <div class="card">
        {rows.length === 0 ? <Empty text={t('common.none')} /> : (
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('building.name')}</th>
                  <th class="num">{t('room.title')}</th>
                  <th class="num">{t('building.water_rate')}</th>
                  <th class="num">{t('building.electric_rate')}</th>
                  <th>{t('building.promptpay')}</th>
                  <th class="num">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr>
                    <td><strong>{b.name}</strong><div class="small muted">{b.address ?? ''}</div></td>
                    <td class="num">{b.rooms}</td>
                    <td class="num">{b.water_mode === 'flat' ? `${baht(b.water_flat)} /เดือน` : `${baht(b.water_rate)} /หน่วย`}</td>
                    <td class="num">{b.electric_mode === 'flat' ? `${baht(b.electric_flat)} /เดือน` : `${baht(b.electric_rate)} /หน่วย`}</td>
                    <td>{b.promptpay_id ? <span class="small">{b.promptpay_id}</span> : <span class="muted small">-</span>}</td>
                    <td class="num">
                      <a class="btn sm" href={`/buildings/${b.id}`}>{t('common.edit')}</a>{' '}
                      <a class="btn sm" href={`/rooms?building=${b.id}`}>{t('room.title')}</a>
                    </td>
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

app.get('/buildings/new', (c) => {
  const t = c.get('t');
  return c.html(
    <Layout {...page(c, t('building.new'))}>
      <PageHead title={t('building.new')} sub={t('app.tagline')} />
      <BuildingForm b={null} t={t} />
    </Layout>,
  );
});

app.post('/buildings', async (c) => {
  const d = await readForm(c);
  if (!d.name) return back(c, '/buildings/new', 'missing', true);
  if (d.promptpay_id && !normalizeTarget(d.promptpay_id)) return back(c, '/buildings/new', 'พร้อมเพย์ไม่ถูกต้อง', true);
  const bid = id('b_');
  await c.get('db').run(
    `INSERT INTO buildings (id, name, address, tax_id, promptpay_id, promptpay_name,
       water_rate, water_mode, water_flat, electric_rate, electric_mode, electric_flat,
       common_fee, late_fee_daily, due_day)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    bid, d.name, d.address, d.tax_id, d.promptpay_id, d.promptpay_name,
    d.water_rate, d.water_mode, d.water_flat, d.electric_rate, d.electric_mode, d.electric_flat,
    d.common_fee, d.late_fee_daily, d.due_day,
  );
  return back(c, `/rooms?building=${bid}`, 'saved');
});

app.get('/buildings/:id', async (c) => {
  const t = c.get('t');
  const b = await c.get('db').building(c.req.param('id'));
  if (!b) return c.notFound();
  return c.html(
    <Layout {...page(c, b.name)}>
      <PageHead title={b.name} sub={t('building.title')}>
        <a class="btn" href="/buildings">{t('common.back')}</a>
      </PageHead>
      <BuildingForm b={b} t={t} />
    </Layout>,
  );
});

app.post('/buildings/:id', async (c) => {
  const bid = c.req.param('id');
  const d = await readForm(c);
  if (!d.name) return back(c, `/buildings/${bid}`, 'missing', true);
  if (d.promptpay_id && !normalizeTarget(d.promptpay_id)) return back(c, `/buildings/${bid}`, 'พร้อมเพย์ไม่ถูกต้อง', true);
  await c.get('db').run(
    `UPDATE buildings SET name=?, address=?, tax_id=?, promptpay_id=?, promptpay_name=?,
       water_rate=?, water_mode=?, water_flat=?, electric_rate=?, electric_mode=?, electric_flat=?,
       common_fee=?, late_fee_daily=?, due_day=? WHERE id=?`,
    d.name, d.address, d.tax_id, d.promptpay_id, d.promptpay_name,
    d.water_rate, d.water_mode, d.water_flat, d.electric_rate, d.electric_mode, d.electric_flat,
    d.common_fee, d.late_fee_daily, d.due_day, bid,
  );
  return back(c, '/buildings', 'saved');
});

export default app;
