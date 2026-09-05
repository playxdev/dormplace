import { back, page, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import type { AnnouncementRow } from '../lib/db';
import { id, str, thaiDate, today } from '../lib/util';

const app = route();

type State = 'draft' | 'published' | 'expired';

/** A draft has never been published; an expired one was, and its day has
 *  passed. Both are invisible to tenants, for different reasons, and the owner
 *  has to be able to tell them apart at a glance. */
function stateOf(a: AnnouncementRow): State {
  if (!a.published_at) return 'draft';
  if (a.expires_at && a.expires_at < today()) return 'expired';
  return 'published';
}

const TAG: Record<State, string> = { draft: 'draft', published: 'active', expired: 'ended' };

const preview = (body: string) => (body.length > 90 ? body.slice(0, 90) + '…' : body);

app.get('/announcements', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildingId = c.req.query('building') || '';
  const [rows, buildings] = await Promise.all([
    db.announcementRows(buildingId || undefined),
    db.buildings(),
  ]);
  return c.html(
    <Layout {...page(c, t('ann.title'))}>
      <PageHead title={t('ann.title')} sub={`${rows.length}`}>
        {buildings.length > 1 ? (
          <form method="get" action="/announcements">
            <select name="building" onchange="this.form.submit()">
              <option value="">{t('common.all')}</option>
              {buildings.map((b) => (
                <option value={b.id} selected={b.id === buildingId}>{b.name}</option>
              ))}
            </select>
          </form>
        ) : null}
        <a class="btn primary" href={`/announcements/new${buildingId ? `?building=${buildingId}` : ''}`}>
          {t('ann.new')}
        </a>
      </PageHead>
      <div class="card">
        {rows.length === 0 ? <Empty text={t('ann.none')} hint={t('ann.none_hint')} icon="bell" /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('ann.subject')}</th>
                  <th>{t('ann.building')}</th>
                  <th>{t('room.status')}</th>
                  <th>{t('ann.published_on')}</th>
                  <th class="num">{t('ann.read_count')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const state = stateOf(a);
                  return (
                    <tr>
                      <td>
                        <a href={`/announcements/${a.id}`}>{a.pinned ? '📌 ' : ''}{a.title}</a>
                        <div class="small muted">{preview(a.body)}</div>
                      </td>
                      <td class="small">{a.building_name}</td>
                      <td><Tag kind={TAG[state]} label={t(`ann.${state}` as 'ann.draft')} /></td>
                      <td class="small">
                        {a.published_at ? thaiDate(a.published_at.slice(0, 10)) : <span class="muted">-</span>}
                        {a.expires_at ? <div class="small muted">{t('ann.until')} {thaiDate(a.expires_at)}</div> : null}
                      </td>
                      <td class="num">{state === 'draft' ? <span class="muted">-</span> : a.read_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>,
  );
});

app.get('/announcements/new', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const buildings = await db.buildings();
  if (buildings.length === 0) return back(c, '/buildings', 'no_building', true);
  const preBuilding = c.req.query('building') || buildings[0].id;
  return c.html(
    <Layout {...page(c, t('ann.new'))}>
      <PageHead title={t('ann.new')} sub={t('ann.new_sub')}>
        <a class="btn" href="/announcements">{t('common.back')}</a>
      </PageHead>
      <form method="post" action="/announcements" class="card" style="max-width:720px">
        <div class="field">
          <label for="building_id">{t('ann.building')}</label>
          <select id="building_id" name="building_id" required>
            {buildings.map((b) => (
              <option value={b.id} selected={b.id === preBuilding}>{b.name}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="title">{t('ann.subject')}</label>
          <input id="title" name="title" required maxlength={120} placeholder="น้ำประปาหยุดไหล 5 ก.ย. 09:00–15:00" />
        </div>
        <div class="field">
          <label for="body">{t('ann.body')}</label>
          <textarea id="body" name="body" rows={8} required></textarea>
        </div>
        <div class="row">
          <div class="field">
            <label for="expires_at">{t('ann.expires')}</label>
            <input id="expires_at" name="expires_at" type="date" min={today()} />
            <div class="small muted">{t('ann.expires_hint')}</div>
          </div>
          <div class="field">
            <label for="pinned">{t('ann.pinned')}</label>
            <label class="small"><input id="pinned" name="pinned" type="checkbox" value="1" /> {t('ann.pinned_hint')}</label>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn primary" type="submit" name="action" value="publish">{t('ann.publish')}</button>
          <button class="btn" type="submit" name="action" value="draft">{t('ann.save_draft')}</button>
        </div>
      </form>
    </Layout>,
  );
});

app.post('/announcements', async (c) => {
  const db = c.get('db');
  const f = await c.req.formData();
  const buildingId = str(f.get('building_id'));
  const title = str(f.get('title'));
  const body = str(f.get('body'));
  if (!buildingId || !title || !body) return back(c, '/announcements/new', 'missing', true);

  const aid = id('a_');
  const publish = str(f.get('action')) === 'publish';
  await db.run(
    `INSERT INTO announcements (id, building_id, title, body, pinned, expires_at, published_at, created_by)
     VALUES (?,?,?,?,?,?,${publish ? "datetime('now')" : 'NULL'},?)`,
    aid, buildingId, title, body, f.get('pinned') ? 1 : 0,
    str(f.get('expires_at')) || null, c.get('user').id,
  );
  return back(c, `/announcements/${aid}`, publish ? 'published' : 'saved');
});

app.get('/announcements/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const a = await db.announcement(c.req.param('id'));
  if (!a) return c.notFound();
  const state = stateOf(a);
  const audience = await db.announcementAudience(a.building_id);
  return c.html(
    <Layout {...page(c, a.title)}>
      <PageHead title={a.title} sub={`${a.building_name} · ${t(`ann.${state}` as 'ann.draft')}`}>
        <a class="btn" href="/announcements">{t('common.back')}</a>
      </PageHead>
      <div class="grid c2">
        <div class="card">
          <h2>{t('ann.body')}</h2>
          <p style="white-space:pre-wrap">{a.body}</p>
          <p class="small muted">
            {state === 'draft'
              ? t('ann.draft_hint')
              : `${t('ann.published_on')} ${thaiDate(a.published_at!.slice(0, 10))}`}
            {a.expires_at ? ` · ${t('ann.until')} ${thaiDate(a.expires_at)}` : ''}
          </p>
          <p class="small muted">
            {t('ann.audience')}: {audience} · {t('ann.read_count')}: {state === 'draft' ? '-' : a.read_count}
          </p>
          <div class="btn-row">
            {state === 'draft' ? (
              <form method="post" action={`/announcements/${a.id}/publish`}>
                <button class="btn primary" type="submit">{t('ann.publish')}</button>
              </form>
            ) : (
              <form method="post" action={`/announcements/${a.id}/unpublish`}
                onsubmit={`return confirm('${t('ann.unpublish_confirm')}')`}>
                <button class="btn" type="submit">{t('ann.unpublish')}</button>
              </form>
            )}
            <form method="post" action={`/announcements/${a.id}/delete`}
              onsubmit={`return confirm('${t('ann.delete_confirm')}')`}>
              <button class="btn danger" type="submit">{t('common.delete')}</button>
            </form>
          </div>
        </div>

        <form method="post" action={`/announcements/${a.id}`} class="card">
          <h2>{t('common.edit')}</h2>
          <div class="field">
            <label for="title">{t('ann.subject')}</label>
            <input id="title" name="title" required maxlength={120} value={a.title} />
          </div>
          <div class="field">
            <label for="body">{t('ann.body')}</label>
            <textarea id="body" name="body" rows={8} required>{a.body}</textarea>
          </div>
          <div class="row">
            <div class="field">
              <label for="expires_at">{t('ann.expires')}</label>
              <input id="expires_at" name="expires_at" type="date" value={a.expires_at ?? ''} />
            </div>
            <div class="field">
              <label for="pinned">{t('ann.pinned')}</label>
              <label class="small">
                <input id="pinned" name="pinned" type="checkbox" value="1" checked={a.pinned === 1} /> {t('ann.pinned_hint')}
              </label>
            </div>
          </div>
          <button class="btn primary" type="submit">{t('common.save')}</button>
        </form>
      </div>
    </Layout>,
  );
});

app.post('/announcements/:id', async (c) => {
  const aid = c.req.param('id');
  const f = await c.req.formData();
  const title = str(f.get('title'));
  const body = str(f.get('body'));
  if (!title || !body) return back(c, `/announcements/${aid}`, 'missing', true);
  await c.get('db').run(
    'UPDATE announcements SET title = ?, body = ?, pinned = ?, expires_at = ? WHERE id = ?',
    title, body, f.get('pinned') ? 1 : 0, str(f.get('expires_at')) || null, aid,
  );
  return back(c, `/announcements/${aid}`, 'saved');
});

/* Publishing is the moment the text leaves the office, so it is its own action
   rather than a field on the edit form — and it only ever moves a draft
   forward. Re-publishing an existing notice would move its date and push it
   back to the top of every tenant's list. */
app.post('/announcements/:id/publish', async (c) => {
  const aid = c.req.param('id');
  await c.get('db').run(
    "UPDATE announcements SET published_at = datetime('now') WHERE id = ? AND published_at IS NULL",
    aid,
  );
  return back(c, `/announcements/${aid}`, 'published');
});

/** Back to a draft. The tenant's read rows are kept: if it goes out again, who
 *  has already seen it is still true. */
app.post('/announcements/:id/unpublish', async (c) => {
  const aid = c.req.param('id');
  await c.get('db').run('UPDATE announcements SET published_at = NULL WHERE id = ?', aid);
  return back(c, `/announcements/${aid}`, 'unpublished');
});

app.post('/announcements/:id/delete', async (c) => {
  await c.get('db').run('DELETE FROM announcements WHERE id = ?', c.req.param('id'));
  return back(c, '/announcements', 'deleted');
});

export default app;
