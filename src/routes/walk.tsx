import { back, page, route, type Ctx } from '../app';
import { FieldShell, Icon } from '../ui/field';
import { Empty, Layout, PageHead } from '../ui/layout';
import { currentPeriod, id, num, str, thaiDate, thaiPeriod, today } from '../lib/util';
import type { T } from '../lib/i18n';
import type { FC } from 'hono/jsx';

const app = route();

/* ------------------------------------------------------------------ data --- */

interface WalkRoom {
  id: string; number: string; floor: number;
  tenant_id: string | null; tenant_name: string | null; moved_in: string | null;
  water_prev: number | null; water_now: number | null; water_status: string | null;
  elec_prev: number | null;  elec_now: number | null;  elec_status: string | null;
  /** Mean monthly usage over prior periods, used to flag a spike. */
  water_avg: number; elec_avg: number;
  contract_water_start: number; contract_electric_start: number;
}

/**
 * Every room of a building for one period, in walking order
 * (floor, then room number) with previous readings resolved.
 */
async function walkRooms(c: Ctx, buildingId: string, period: string): Promise<WalkRoom[]> {
  return c.get('db').all<WalkRoom>(
    `SELECT r.id, r.number, r.floor,
            ct.tenant_id, t.name AS tenant_name, ct.start_date AS moved_in,
            COALESCE(ct.water_start, 0)    AS contract_water_start,
            COALESCE(ct.electric_start, 0) AS contract_electric_start,
            (SELECT m.value  FROM meter_readings m WHERE m.room_id = r.id AND m.kind = 'water'
               AND m.period < ?2 AND m.status = 'recorded' ORDER BY m.period DESC LIMIT 1) AS water_prev,
            (SELECT m.value  FROM meter_readings m WHERE m.room_id = r.id AND m.kind = 'water'
               AND m.period = ?2) AS water_now,
            (SELECT m.status FROM meter_readings m WHERE m.room_id = r.id AND m.kind = 'water'
               AND m.period = ?2) AS water_status,
            (SELECT m.value  FROM meter_readings m WHERE m.room_id = r.id AND m.kind = 'electric'
               AND m.period < ?2 AND m.status = 'recorded' ORDER BY m.period DESC LIMIT 1) AS elec_prev,
            (SELECT m.value  FROM meter_readings m WHERE m.room_id = r.id AND m.kind = 'electric'
               AND m.period = ?2) AS elec_now,
            (SELECT m.status FROM meter_readings m WHERE m.room_id = r.id AND m.kind = 'electric'
               AND m.period = ?2) AS elec_status,
            COALESCE((SELECT AVG(m.value - m.prev_value) FROM meter_readings m
               WHERE m.room_id = r.id AND m.kind = 'water' AND m.period < ?2
                 AND m.status = 'recorded' AND m.value >= m.prev_value), 0) AS water_avg,
            COALESCE((SELECT AVG(m.value - m.prev_value) FROM meter_readings m
               WHERE m.room_id = r.id AND m.kind = 'electric' AND m.period < ?2
                 AND m.status = 'recorded' AND m.value >= m.prev_value), 0) AS elec_avg
       FROM rooms r
       LEFT JOIN contracts ct ON ct.room_id = r.id AND ct.status = 'active'
       LEFT JOIN tenants t ON t.id = ct.tenant_id
      WHERE r.building_id = ?1
      ORDER BY r.floor, r.number`,
    buildingId, period,
  );
}

type RoomState = 'done' | 'skipped' | 'todo';

/** A room counts as done only when both meters are in for the period. */
function stateOf(r: WalkRoom): RoomState {
  if (r.water_status === 'skipped' || r.elec_status === 'skipped') return 'skipped';
  return r.water_now !== null && r.elec_now !== null ? 'done' : 'todo';
}

const prevOf = (r: WalkRoom, kind: 'water' | 'electric') =>
  kind === 'water'
    ? (r.water_prev ?? r.contract_water_start)
    : (r.elec_prev ?? r.contract_electric_start);

function tally(rooms: WalkRoom[]) {
  let done = 0, skipped = 0, todo = 0;
  for (const r of rooms) {
    const s = stateOf(r);
    if (s === 'done') done++; else if (s === 'skipped') skipped++; else todo++;
  }
  const total = rooms.length;
  return { done, skipped, todo, total, pct: total ? Math.round(((done + skipped) / total) * 100) : 0 };
}

const walkBase = (b: string, p: string) => `/walk/${b}/${p}`;

/** Next room still needing a reading, starting after `afterId`. */
function nextTodo(rooms: WalkRoom[], afterId?: string): WalkRoom | null {
  const start = afterId ? rooms.findIndex((r) => r.id === afterId) + 1 : 0;
  for (let i = start; i < rooms.length; i++) if (stateOf(rooms[i]) === 'todo') return rooms[i];
  for (let i = 0; i < start; i++) if (stateOf(rooms[i]) === 'todo') return rooms[i];
  return null;
}

const SyncPill: FC<{ t: T }> = ({ t }) => (
  <span class="sync" data-state="ok"
    data-ok={t('walk.synced')} data-local={t('walk.saved_local')} data-offline={t('walk.offline')}>
    <i class="led" aria-hidden="true" /><span>{t('walk.synced')}</span>
  </span>
);
const ThemeTap: FC<{ t: T }> = ({ t }) => (
  <button class="tap theme-toggle" type="button" aria-label={t('theme.toggle')}>
    <span class="sun" aria-hidden="true">{Icon.sun({ size: 19 })}</span>
    <span class="moon" aria-hidden="true">{Icon.moon({ size: 19 })}</span>
  </button>
);

/* ------------------------------------------------------------ start screen --- */

app.get('/walk', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings/new', 'no_building', true);

  const buildingId = c.req.query('building') || buildings[0].id;
  const building = buildings.find((b) => b.id === buildingId) ?? buildings[0];
  const period = c.req.query('period') || currentPeriod();

  const rooms = await walkRooms(c, building.id, period);
  const st = tally(rooms);
  const resume = nextTodo(rooms);

  return c.html(
    <FieldShell t={t} title={t('walk.title')} locale={c.get('locale')} back="/" tabs action={<ThemeTap t={t} />}>
      <form method="get" action="/walk">
        <input type="hidden" name="period" value={period} />
        <label class="fselect" for="building">
          <span class="ic" aria-hidden="true">{Icon.building({ size: 20 })}</span>
          <span class="tx">
            <select id="building" name="building" onchange="this.form.submit()" aria-label={t('building.name')}>
              {buildings.map((b) => <option value={b.id} selected={b.id === building.id}>{b.name}</option>)}
            </select>
            <span>{thaiPeriod(period)} · {st.total} {t('common.rooms')}</span>
          </span>
          <span aria-hidden="true">{Icon.chevron({ size: 18 })}</span>
        </label>
      </form>

      <section class="fcard fprog">
        <div class="n">{st.done}<small> / {st.total} {t('common.rooms')}</small></div>
        <div class="barline">
          <div class="bar"><i class={st.pct === 100 ? 'green' : ''} style={`width:${st.pct}%`} /></div>
          <span class="pct">{st.pct}%</span>
        </div>
        <div class="fstats">
          <div class="fstat done">
            <span class="ic" aria-hidden="true">{Icon.check({ size: 17 })}</span>
            <div class="v">{st.done}</div><div class="l">{t('walk.rooms_done')}</div>
          </div>
          <div class="fstat todo">
            <span class="ic" aria-hidden="true">{Icon.clock({ size: 17 })}</span>
            <div class="v">{st.todo}</div><div class="l">{t('walk.rooms_todo')}</div>
          </div>
          <div class="fstat skip">
            <span class="ic" aria-hidden="true">{Icon.close({ size: 17 })}</span>
            <div class="v">{st.skipped}</div><div class="l">{t('walk.rooms_skipped')}</div>
          </div>
        </div>
      </section>

      <section class="fcard tight">
        <div style="display:flex;gap:.625rem">
          <span style="color:var(--primary-hover);flex:none" aria-hidden="true">{Icon.help({ size: 18 })}</span>
          <div>
            <b style="font-size:.875rem">{t('walk.howto')}</b>
            <ol class="small muted" style="margin:.375rem 0 0;padding-left:1.1rem;line-height:1.8">
              <li>{t('walk.howto_1')}</li>
              <li>{t('walk.howto_2')}</li>
              <li>{t('walk.howto_3')}</li>
            </ol>
          </div>
        </div>
      </section>

      <section class="fcard tight">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <span class="small muted">{t('walk.updated_at', { at: thaiDate(today()) })}</span>
          <SyncPill t={t} />
        </div>
      </section>

      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:.625rem">
        {resume ? (
          <a class="btn primary field-primary" href={`${walkBase(building.id, period)}/room/${resume.id}`}>
            <span aria-hidden="true">{Icon.arrowRight({ size: 18 })}</span>
            {st.done > 0 ? t('walk.continue') : t('walk.start')}
          </a>
        ) : (
          <a class="btn primary field-primary" href={`${walkBase(building.id, period)}/done`}>
            {t('walk.all_done_already')}
          </a>
        )}
        <a class="btn field-secondary" href={`${walkBase(building.id, period)}/rooms`}>
          <span aria-hidden="true">{Icon.receipt({ size: 17 })}</span>{t('walk.room_list')}
        </a>
        <a class="btn field-secondary ghost" href={`/meters?building=${building.id}&period=${period}`}>
          {t('walk.office')}
        </a>
      </div>
    </FieldShell>,
  );
});

/* -------------------------------------------------------------- room list --- */

app.get('/walk/:building/:period/rooms', async (c) => {
  const t = c.get('t');
  const buildingId = c.req.param('building');
  const period = c.req.param('period');
  const building = await c.get('db').building(buildingId);
  if (!building) return c.notFound();
  const rooms = await walkRooms(c, buildingId, period);
  const st = tally(rooms);
  const current = c.req.query('at');

  const label: Record<RoomState, string> = {
    done: t('walk.status_done'), skipped: t('walk.status_skipped'), todo: t('walk.status_todo'),
  };

  return c.html(
    <FieldShell t={t} title={t('walk.room_list')} locale={c.get('locale')}
      back={`/walk?building=${buildingId}&period=${period}`} action={<ThemeTap t={t} />}>
      <div class="fcard tight" style="margin-bottom:.875rem">
        <div class="barline" style="margin:0">
          <div class="bar"><i style={`width:${st.pct}%`} /></div>
          <span class="pct">{st.done}/{st.total}</span>
        </div>
      </div>

      <div class="fcard" style="padding:0;overflow:hidden">
        <div class="rlist">
          {rooms.map((r) => {
            const s = stateOf(r);
            return (
              <a href={`${walkBase(buildingId, period)}/room/${r.id}`} class={r.id === current ? 'now' : ''}>
                <span class="rno">{r.number}</span>
                <span class="rst">
                  <span class={`tag ${s === 'done' ? 'paid' : s === 'skipped' ? 'void' : 'unpaid'}`}>{label[s]}</span>
                </span>
                <span class="rv">
                  <i style="color:var(--info)" aria-hidden="true">{Icon.droplet({ size: 13 })}</i>
                  <i>{r.water_now ?? '-'}</i>
                  <i style="color:var(--warning)" aria-hidden="true">{Icon.bolt({ size: 13 })}</i>
                  <i>{r.elec_now ?? '-'}</i>
                </span>
                <span class="dim" aria-hidden="true">{Icon.arrowRight({ size: 15 })}</span>
              </a>
            );
          })}
        </div>
      </div>
    </FieldShell>,
  );
});

/* ------------------------------------------------------------ room screen --- */

function MeterCard({
  t, kind, prev, avg, value, unitLabel,
}: { t: T; kind: 'water' | 'electric'; prev: number; avg: number; value: number | null; unitLabel: string }) {
  const isWater = kind === 'water';
  return (
    <section class={`fcard meter-card ${kind}`}>
      <div class="mhead">
        <span class="ic" aria-hidden="true">{isWater ? Icon.droplet({ size: 17 }) : Icon.bolt({ size: 17 })}</span>
        <span>{isWater ? t('meter.water') : t('meter.electric')} · {t('meter.title')}</span>
      </div>

      <div class="mprev">
        {t('walk.prev_reading')}
        <span class="pv">{prev.toLocaleString('en-US')} <em>{unitLabel}</em></span>
      </div>

      <div class="mnow">
        <label for={kind}>{t('walk.this_reading')}</label>
        <div class="minput">
          <input
            id={kind} name={kind} type="number" inputmode="numeric" step="1" min="0"
            value={value ?? ''} placeholder={isWater ? t('walk.enter_water') : t('walk.enter_electric')}
            data-prev={String(prev)} data-avg={String(Math.round(avg))} data-unit={unitLabel}
            data-need-msg={isWater ? t('walk.need_water') : t('walk.need_electric')}
            enterkeyhint="next" autocomplete="off"
          />
          <span class="unit">{unitLabel}</span>
        </div>
        <div class="musage">
          <span>{t('walk.used')}</span>
          <span class="chip none">- {unitLabel}</span>
        </div>
        <div class="mwarn" hidden
          data-lower={t('walk.warn_lower')}
          data-lower-hint={t('walk.warn_lower_hint', { prev: '{prev}', now: '{now}' })}
          data-spike={t('walk.warn_spike')}
          data-spike-hint={t('walk.warn_spike_hint', { pct: '{pct}' })}>
          <span class="ic" aria-hidden="true">{Icon.alert({ size: 15 })}</span>
          <span class="mwarn-text" />
        </div>
      </div>
    </section>
  );
}

app.get('/walk/:building/:period/room/:room', async (c) => {
  const t = c.get('t');
  const buildingId = c.req.param('building');
  const period = c.req.param('period');
  const roomId = c.req.param('room');

  const building = await c.get('db').building(buildingId);
  if (!building) return c.notFound();
  const rooms = await walkRooms(c, buildingId, period);
  const idx = rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) return c.notFound();
  const room = rooms[idx];
  const st = tally(rooms);
  const base = walkBase(buildingId, period);

  const after = nextTodo(rooms, room.id);
  const nextHref = after ? `${base}/room/${after.id}` : `${base}/done`;
  const isLast = !after;
  const unit = t('walk.unit');

  return c.html(
    <FieldShell
      t={t} title={`${t('room.number')} ${room.number}`} locale={c.get('locale')}
      back={`${base}/rooms?at=${room.id}`}
      action={<ThemeTap t={t} />}
      foot={
        <>
          <button class="btn primary field-primary" type="submit" form="walk-form">
            {isLast ? t('walk.save_finish') : t('walk.save_next')}
            <span aria-hidden="true">{Icon.arrowRight({ size: 17 })}</span>
          </button>
          <a class="btn field-secondary" href={`${base}/skip/${room.id}`}>{t('walk.skip')}</a>
          <div class="foot-prog">
            <span>{t('walk.progress', { i: idx + 1, n: st.total })}</span>
            <div class="bar"><i style={`width:${Math.round(((idx + 1) / st.total) * 100)}%`} /></div>
            <SyncPill t={t} />
          </div>
        </>
      }
    >
      <section class="fcard tight ftenant">
        <span class="av" aria-hidden="true">{Icon.users({ size: 18 })}</span>
        <span class="tx">
          {room.tenant_name
            ? <><b>{room.tenant_name}</b><span>{t('contract.start')} {thaiDate(room.moved_in)}</span></>
            : <><b class="muted">{t('room.vacant')}</b><span>{t('walk.skip_vacant')}</span></>}
        </span>
        {room.tenant_name ? <span class="tag occupied">{t('room.occupied')}</span> : null}
      </section>

      <form
        id="walk-form" method="post" action={`${base}/room/${room.id}`} enctype="multipart/form-data"
        data-room={room.id} data-period={period} data-next={nextHref}
        data-require-values={room.tenant_name ? '1' : '0'}
      >
        <input type="hidden" name="next" value={nextHref} />

        <MeterCard t={t} kind="water" prev={prevOf(room, 'water')} avg={room.water_avg}
          value={room.water_now} unitLabel={unit} />

        <div style="height:.875rem" />

        <MeterCard t={t} kind="electric" prev={prevOf(room, 'electric')} avg={room.elec_avg}
          value={room.elec_now} unitLabel={unit} />

        <div class="flash err form-error" hidden role="alert" style="margin:.875rem 0 0" />

        <section class="fcard tight" style="margin-top:.875rem">
          <label for="note">{t('walk.note')}</label>
          <div class="fnote">
            <input id="note" name="note" placeholder={t('walk.note_placeholder')} autocomplete="off" />
            <label class="cam" for="photo" aria-label={t('walk.photo')} title={t('walk.photo')}>
              <span aria-hidden="true">{Icon.print({ size: 18 })}</span>
              <input id="photo" name="photo" type="file" accept="image/*" capture="environment" />
            </label>
          </div>
          <div class="photo-name" data-attached={t('walk.photo_attached')} />
        </section>
      </form>
    </FieldShell>,
  );
});

/* ------------------------------------------------------------------ save --- */

async function upsertReading(
  c: Ctx, roomId: string, period: string, kind: 'water' | 'electric',
  prev: number, value: number, opts: { status?: string; reason?: string | null; note?: string | null; photo?: string | null },
) {
  const db = c.get('db');
  return db.prep(
    `INSERT INTO meter_readings
       (id, room_id, period, kind, prev_value, value, status, skip_reason, note, photo_key, recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(room_id, period, kind) DO UPDATE SET
       prev_value = excluded.prev_value, value = excluded.value,
       status = excluded.status, skip_reason = excluded.skip_reason,
       note = excluded.note,
       photo_key = COALESCE(excluded.photo_key, meter_readings.photo_key),
       recorded_by = excluded.recorded_by, recorded_at = datetime('now')`,
    id('m_'), roomId, period, kind, prev, value,
    opts.status ?? 'recorded', opts.reason ?? null, opts.note ?? null, opts.photo ?? null,
    c.get('user').id,
  );
}

app.post('/walk/:building/:period/room/:room', async (c) => {
  const db = c.get('db');
  const buildingId = c.req.param('building');
  const period = c.req.param('period');
  const roomId = c.req.param('room');

  const rooms = await walkRooms(c, buildingId, period);
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return c.notFound();

  const f = await c.req.formData();
  const note = str(f.get('note')) || null;

  let photoKey: string | null = null;
  const photo = f.get('photo');
  if (photo instanceof File && photo.size > 0) {
    photoKey = `meters/${period}/${roomId}/${id('')}`;
    await c.env.FILES.put(photoKey, await photo.arrayBuffer(), {
      httpMetadata: { contentType: photo.type || 'application/octet-stream' },
    });
  }

  const stmts: D1PreparedStatement[] = [];
  for (const kind of ['water', 'electric'] as const) {
    const raw = str(f.get(kind));
    if (raw === '') continue;                       // a blank meter is left untouched
    stmts.push(await upsertReading(
      c, roomId, period, kind, prevOf(room, kind), Math.round(num(f.get(kind))),
      { note, photo: photoKey },
    ));
  }
  if (stmts.length) await db.batch(stmts);

  // Keep one walk row per building+period so the office view can see activity.
  await db.run(
    `INSERT INTO meter_walks (id, building_id, period, started_by) VALUES (?,?,?,?)
     ON CONFLICT(building_id, period) DO NOTHING`,
    id('w_'), buildingId, period, c.get('user').id,
  );

  // Fetch requests from the offline queue just need an ack, not a redirect.
  if (c.req.header('x-walk-sync')) return c.text('ok');
  return c.redirect(str(f.get('next')) || walkBase(buildingId, period), 303);
});

/* ------------------------------------------------------------------ skip --- */

app.get('/walk/:building/:period/skip/:room', async (c) => {
  const t = c.get('t');
  const buildingId = c.req.param('building');
  const period = c.req.param('period');
  const roomId = c.req.param('room');
  const rooms = await walkRooms(c, buildingId, period);
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return c.notFound();
  const base = walkBase(buildingId, period);
  const after = nextTodo(rooms, room.id);

  const reasons = [
    ['vacant', t('walk.skip_vacant')],
    ['locked', t('walk.skip_locked')],
    ['broken', t('walk.skip_broken')],
    ['other', t('walk.skip_other')],
  ] as const;

  return c.html(
    <FieldShell t={t} title={t('walk.skip_title')} locale={c.get('locale')} back={`${base}/room/${room.id}`}>
      <p class="muted" style="margin-bottom:.25rem">
        {t('room.number')} <b style="color:var(--text)">{room.number}</b>
        {room.tenant_name ? ` · ${room.tenant_name}` : ''}
      </p>
      <form method="post" action={`${base}/skip/${room.id}`}>
        <input type="hidden" name="next" value={after ? `${base}/room/${after.id}` : `${base}/done`} />
        <div class="reasons">
          {reasons.map(([v, label], i) => (
            <label>
              <input type="radio" name="reason" value={v} required checked={i === 0} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div class="field">
          <label for="note">{t('walk.note')}</label>
          <input id="note" name="note" placeholder={t('walk.note_placeholder')} />
        </div>
        <button class="btn primary field-primary block" type="submit">{t('walk.skip_confirm')}</button>
        <a class="btn field-secondary block" href={`${base}/room/${room.id}`} style="margin-top:.5rem">
          {t('common.cancel')}
        </a>
      </form>
    </FieldShell>,
  );
});

app.post('/walk/:building/:period/skip/:room', async (c) => {
  const db = c.get('db');
  const buildingId = c.req.param('building');
  const period = c.req.param('period');
  const roomId = c.req.param('room');
  const rooms = await walkRooms(c, buildingId, period);
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return c.notFound();

  const f = await c.req.formData();
  const reason = str(f.get('reason')) || 'other';
  const note = str(f.get('note')) || null;

  // A skipped meter records the previous value as the current one, so usage is
  // zero and the billing engine bills rent without inventing consumption.
  const stmts = await Promise.all((['water', 'electric'] as const).map((kind) =>
    upsertReading(c, roomId, period, kind, prevOf(room, kind), prevOf(room, kind),
      { status: 'skipped', reason, note }),
  ));
  await db.batch(stmts);

  if (c.req.header('x-walk-sync')) return c.text('ok');
  return c.redirect(str(f.get('next')) || walkBase(buildingId, period), 303);
});

/* -------------------------------------------------------------- completion --- */

app.get('/walk/:building/:period/done', async (c) => {
  const t = c.get('t');
  const buildingId = c.req.param('building');
  const period = c.req.param('period');
  const building = await c.get('db').building(buildingId);
  if (!building) return c.notFound();
  const rooms = await walkRooms(c, buildingId, period);
  const st = tally(rooms);
  const base = walkBase(buildingId, period);

  const waterIn = rooms.filter((r) => r.water_now !== null).length;
  const elecIn = rooms.filter((r) => r.elec_now !== null).length;

  // Anything the office should look at before billing runs.
  const flagged = rooms.flatMap((r) => {
    const out: { room: string; msg: string }[] = [];
    if (r.water_now !== null && r.water_now < prevOf(r, 'water')) out.push({ room: r.number, msg: t('walk.warn_lower') });
    if (r.elec_now !== null && r.elec_now < prevOf(r, 'electric')) out.push({ room: r.number, msg: t('walk.warn_lower') });
    if (r.elec_now !== null && r.elec_avg > 0 && r.elec_now - prevOf(r, 'electric') > r.elec_avg * 1.5)
      out.push({ room: r.number, msg: t('walk.warn_spike') });
    if (stateOf(r) === 'skipped') out.push({ room: r.number, msg: t('walk.status_skipped') });
    return out;
  });

  await c.get('db').run(
    "UPDATE meter_walks SET finished_at = datetime('now') WHERE building_id = ? AND period = ?",
    buildingId, period,
  );

  return c.html(
    <FieldShell t={t} title={t('walk.title')} locale={c.get('locale')} back="/walk" tabs>
      <div class="done-hero">
        <div class="ring" aria-hidden="true">{Icon.check({ size: 34 })}</div>
        <h1>{st.todo === 0 ? t('walk.done_title') : t('walk.saved')}</h1>
        <p>{building.name} · {thaiPeriod(period)}</p>
      </div>

      <section class="fcard fprog">
        <div class="n">{st.done}<small> / {st.total} {t('common.rooms')}</small></div>
        <div class="barline">
          <div class="bar"><i class={st.pct === 100 ? 'green' : ''} style={`width:${st.pct}%`} /></div>
          <span class="pct">{st.pct}%</span>
        </div>
        <div class="fstats">
          <div class="fstat done">
            <span class="ic" aria-hidden="true">{Icon.droplet({ size: 17 })}</span>
            <div class="v">{waterIn}/{st.total}</div><div class="l">{t('meter.water')}</div>
          </div>
          <div class="fstat done">
            <span class="ic" aria-hidden="true">{Icon.bolt({ size: 17 })}</span>
            <div class="v">{elecIn}/{st.total}</div><div class="l">{t('meter.electric')}</div>
          </div>
          <div class="fstat skip">
            <span class="ic" aria-hidden="true">{Icon.close({ size: 17 })}</span>
            <div class="v">{st.skipped}</div><div class="l">{t('walk.rooms_skipped')}</div>
          </div>
        </div>
      </section>

      {flagged.length > 0 ? (
        <section class="fcard">
          <div class="mhead" style="margin-bottom:.625rem">
            <span class="ic" style="background:var(--warning-soft);color:var(--warning)" aria-hidden="true">
              {Icon.alert({ size: 16 })}
            </span>
            <span>{t('walk.review_items', { n: flagged.length })}</span>
          </div>
          <div class="att">
            {flagged.slice(0, 8).map((w) => (
              <div class="att-row">
                <span class="dot warn" aria-hidden="true">{Icon.alert({ size: 14 })}</span>
                <span class="txt"><b>{t('room.number')} {w.room}</b><span>{w.msg}</span></span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:.625rem">
        {st.todo > 0 ? (
          <a class="btn primary field-primary" href={`/walk?building=${buildingId}&period=${period}`}>
            {t('walk.continue')} ({st.todo})
          </a>
        ) : (
          <a class="btn primary field-primary" href={`/billing?building=${buildingId}&period=${period}`}>
            {t('walk.go_billing')}<span aria-hidden="true">{Icon.arrowRight({ size: 17 })}</span>
          </a>
        )}
        <a class="btn field-secondary" href={`/meters?building=${buildingId}&period=${period}`}>
          {t('walk.view_summary')}
        </a>
        <a class="btn field-secondary ghost" href="/">{t('walk.back_home')}</a>
      </div>
    </FieldShell>,
  );
});

export default app;
