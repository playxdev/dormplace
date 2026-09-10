import { back, page, requirePermission, route } from '../app';
import { Empty, Icon, Layout, PageHead } from '../ui/layout';
import { currentPeriod, num, shiftPeriod, str, thaiPeriod } from '../lib/util';

const app = route();

app.get('/meters', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.meter.read');
  const repos = c.get('repos');
  const buildings = await repos.buildings.all(tctx);
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);
  const buildingId = c.req.query('building') || buildings[0].building_id;
  const building = buildings.find((b) => b.building_id === buildingId) ?? buildings[0];
  const period = c.req.query('period') || currentPeriod();
  const rows = await repos.meterReadings.gridFor(tctx, building.building_id, period);

  const onlyOccupied = c.req.query('all') !== '1';
  const shown = onlyOccupied ? rows.filter((r) => r.party_name) : rows;

  return c.html(
    <Layout {...page(c, t('meter.title'))}>
      <PageHead title={t('walk.office')} sub={`${building.name} · ${thaiPeriod(period)}`}>
        <a class="btn primary" href={`/walk?building=${building.building_id}&period=${period}`}>
          <span aria-hidden="true">{Icon.gauge({ size: 16 })}</span>{t('walk.title')}
        </a>
        <form method="get" action="/meters" class="btn-row">
          <select name="building">
            {buildings.map((b) => <option value={b.building_id} selected={b.building_id === building.building_id}>{b.name}</option>)}
          </select>
          <input type="month" name="period" value={period} />
          <label class="small" style="display:flex;align-items:center;gap:.3rem;margin:0">
            <input type="checkbox" name="all" value="1" checked={!onlyOccupied} /> {t('common.all')}
          </label>
          <button class="btn" type="submit">{t('common.view')}</button>
        </form>
        <a class="btn" href={`/meters?building=${building.building_id}&period=${shiftPeriod(period, -1)}`}>←</a>
        <a class="btn" href={`/billing?building=${building.id}&period=${period}`}>{t('nav.billing')}</a>
      </PageHead>

      {shown.length === 0 ? (
        <div class="card"><Empty text={t('common.none')} /></div>
      ) : (
        <form method="post" action="/meters" class="card">
          <input type="hidden" name="building_id" value={building.building_id} />
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
                      <td class="small">{r.party_name ?? <span class="muted">{t('room.vacant')}</span>}</td>
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
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.meter.record');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const period = str(f.get('period'));
  if (!buildingId || !period) return back(c, '/meters', 'missing', true);

  // The form posts one field per room per meter. Room ids arrive in the field
  // names, so they are checked against this building before anything is
  // written — the alternative is trusting a name a request chose.
  const known = new Set((await c.get('repos').rooms.forBuilding(tctx, buildingId)).map((r) => r.room_id));

  const entries: { roomId: string; kind: 'WATER' | 'ELECTRIC'; prev: number; value: number }[] = [];
  for (const [key, raw] of f.entries()) {
    const m = /^(w|e)_(.+)$/.exec(key);
    if (!m) continue;
    if (String(raw).trim() === '') continue;   // blank means not walked, not zero
    if (!known.has(m[2])) continue;
    entries.push({
      roomId: m[2],
      kind: m[1] === 'w' ? 'WATER' : 'ELECTRIC',
      prev: Math.round(num(f.get(`${m[1]}p_${m[2]}`))),
      value: Math.round(num(raw)),
    });
  }
  await c.get('repos').meterReadings.saveMany(tctx, period, entries);
  return back(c, `/meters?building=${buildingId}&period=${period}`, 'meters_saved');
});

export default app;
