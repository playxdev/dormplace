import { back, page, route } from '../app';
import { Empty, Icon, Layout, PageHead } from '../ui/layout';
import { currentPeriod, id, num, shiftPeriod, str, thaiPeriod } from '../lib/util';
import type { Db } from '../lib/db';

const app = route();

interface MeterRow {
  room_id: string; number: string; floor: number; tenant_name: string | null;
  water_prev: number | null; water_now: number | null;
  elec_prev: number | null; elec_now: number | null;
  water_start: number; electric_start: number;
}

/**
 * Rows for the entry grid. The previous reading is the last recorded value from
 * any earlier period; when none exists we fall back to the contract's opening
 * reading so the first bill charges only what the tenant actually used.
 */
async function meterRows(db: Db, buildingId: string, period: string): Promise<MeterRow[]> {
  return db.all<MeterRow>(
    `SELECT r.id AS room_id, r.number, r.floor, t.name AS tenant_name,
            COALESCE(ct.water_start, 0)    AS water_start,
            COALESCE(ct.electric_start, 0) AS electric_start,
            (SELECT m.value FROM meter_readings m
              WHERE m.room_id = r.id AND m.kind = 'water' AND m.period < ?2
              ORDER BY m.period DESC LIMIT 1) AS water_prev,
            (SELECT m.value FROM meter_readings m
              WHERE m.room_id = r.id AND m.kind = 'water' AND m.period = ?2) AS water_now,
            (SELECT m.value FROM meter_readings m
              WHERE m.room_id = r.id AND m.kind = 'electric' AND m.period < ?2
              ORDER BY m.period DESC LIMIT 1) AS elec_prev,
            (SELECT m.value FROM meter_readings m
              WHERE m.room_id = r.id AND m.kind = 'electric' AND m.period = ?2) AS elec_now
       FROM rooms r
       LEFT JOIN contracts ct ON ct.room_id = r.id AND ct.status = 'active'
       LEFT JOIN tenants t ON t.id = ct.tenant_id
      WHERE r.building_id = ?1
      ORDER BY r.floor, r.number`,
    buildingId, period,
  );
}

app.get('/meters', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].id;
  const building = buildings.find((b) => b.id === buildingId) ?? buildings[0];
  const period = c.req.query('period') || currentPeriod();
  const rows = await meterRows(db, building.id, period);

  const onlyOccupied = c.req.query('all') !== '1';
  const shown = onlyOccupied ? rows.filter((r) => r.tenant_name) : rows;

  return c.html(
    <Layout {...page(c, t('meter.title'))}>
      <PageHead title={t('walk.office')} sub={`${building.name} · ${thaiPeriod(period)}`}>
        <a class="btn primary" href={`/walk?building=${building.id}&period=${period}`}>
          <span aria-hidden="true">{Icon.gauge({ size: 16 })}</span>{t('walk.title')}
        </a>
        <form method="get" action="/meters" class="btn-row">
          <select name="building">
            {buildings.map((b) => <option value={b.id} selected={b.id === building.id}>{b.name}</option>)}
          </select>
          <input type="month" name="period" value={period} />
          <label class="small" style="display:flex;align-items:center;gap:.3rem;margin:0">
            <input type="checkbox" name="all" value="1" checked={!onlyOccupied} /> {t('common.all')}
          </label>
          <button class="btn" type="submit">{t('common.view')}</button>
        </form>
        <a class="btn" href={`/meters?building=${building.id}&period=${shiftPeriod(period, -1)}`}>←</a>
        <a class="btn" href={`/billing?building=${building.id}&period=${period}`}>{t('nav.billing')}</a>
      </PageHead>

      {shown.length === 0 ? (
        <div class="card"><Empty text={t('common.none')} /></div>
      ) : (
        <form method="post" action="/meters" class="card">
          <input type="hidden" name="building_id" value={building.id} />
          <input type="hidden" name="period" value={period} />
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.name')}</th>
                  <th class="num">{t('meter.water')} {t('meter.prev')}</th>
                  <th class="num">{t('meter.water')} {t('meter.current')}</th>
                  <th class="num">{t('meter.electric')} {t('meter.prev')}</th>
                  <th class="num">{t('meter.electric')} {t('meter.current')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const wPrev = r.water_prev ?? r.water_start;
                  const ePrev = r.elec_prev ?? r.electric_start;
                  return (
                    <tr>
                      <td><strong>{r.number}</strong></td>
                      <td class="small">{r.tenant_name ?? <span class="muted">{t('room.vacant')}</span>}</td>
                      <td class="num">
                        <input name={`wp_${r.room_id}`} type="number" min="0" value={String(wPrev)} style="max-width:110px" />
                      </td>
                      <td class="num">
                        <input name={`w_${r.room_id}`} type="number" min="0" value={r.water_now ?? ''} style="max-width:110px"
                          placeholder={t('meter.missing')} />
                      </td>
                      <td class="num">
                        <input name={`ep_${r.room_id}`} type="number" min="0" value={String(ePrev)} style="max-width:110px" />
                      </td>
                      <td class="num">
                        <input name={`e_${r.room_id}`} type="number" min="0" value={r.elec_now ?? ''} style="max-width:110px"
                          placeholder={t('meter.missing')} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="btn-row" style="margin-top:.8rem">
            <button class="btn primary" type="submit">{t('meter.save')}</button>
            <span class="muted small">เว้นว่างไว้ = ยังไม่จด ระบบจะไม่คิดค่าน้ำ/ค่าไฟห้องนั้น</span>
          </div>
        </form>
      )}
    </Layout>,
  );
});

app.post('/meters', async (c) => {
  const db = c.get('db');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const period = str(f.get('period'));
  if (!buildingId || !period) return back(c, '/meters', 'missing', true);

  const stmts: D1PreparedStatement[] = [];
  for (const [key, raw] of f.entries()) {
    const m = /^(w|e)_(.+)$/.exec(key);
    if (!m) continue;
    const value = String(raw).trim();
    if (value === '') continue;
    const kind = m[1] === 'w' ? 'water' : 'electric';
    const roomId = m[2];
    const prev = Math.round(num(f.get(`${m[1]}p_${roomId}`)));
    stmts.push(db.prep(
      `INSERT INTO meter_readings (id, room_id, period, kind, prev_value, value)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(room_id, period, kind)
       DO UPDATE SET prev_value = excluded.prev_value, value = excluded.value, recorded_at = datetime('now')`,
      id('m_'), roomId, period, kind, prev, Math.round(num(raw)),
    ));
  }
  if (stmts.length) await db.batch(stmts);
  return back(c, `/meters?building=${buildingId}&period=${period}`, 'meters_saved');
});

export default app;
