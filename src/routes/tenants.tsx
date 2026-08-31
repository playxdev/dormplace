import { back, page, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { baht, id, str, thaiDate } from '../lib/util';
import type { T } from '../lib/i18n';
import type { Tenant } from '../types';

const app = route();

function TenantForm({ tenant, t }: { tenant: Tenant | null; t: T }) {
  return (
    <form method="post" action={tenant ? `/tenants/${tenant.id}` : '/tenants'} class="card" style="max-width:720px">
      <div class="row">
        <div class="field">
          <label for="name">{t('tenant.name')}</label>
          <input id="name" name="name" required value={tenant?.name ?? ''} />
        </div>
        <div class="field">
          <label for="phone">{t('tenant.phone')}</label>
          <input id="phone" name="phone" inputmode="tel" value={tenant?.phone ?? ''} placeholder="08x-xxx-xxxx" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="id_card_no">{t('tenant.id_card')}</label>
          <input id="id_card_no" name="id_card_no" inputmode="numeric" maxlength={17} value={tenant?.id_card_no ?? ''} />
        </div>
        <div class="field">
          <label for="email">{t('tenant.email')}</label>
          <input id="email" name="email" type="email" value={tenant?.email ?? ''} />
        </div>
        <div class="field">
          <label for="line_id">{t('tenant.line')}</label>
          <input id="line_id" name="line_id" value={tenant?.line_id ?? ''} />
        </div>
      </div>
      <div class="field">
        <label for="address">{t('tenant.address')}</label>
        <textarea id="address" name="address" rows={2}>{tenant?.address ?? ''}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="emergency">{t('tenant.emergency')}</label>
          <input id="emergency" name="emergency" value={tenant?.emergency ?? ''} placeholder="ชื่อ / เบอร์" />
        </div>
        <div class="field">
          <label for="note">{t('common.optional')}</label>
          <input id="note" name="note" value={tenant?.note ?? ''} />
        </div>
      </div>
      <p class="small muted">
        ข้อมูลส่วนบุคคลถูกเก็บเพื่อการทำสัญญาเช่าเท่านั้น ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)
      </p>
      <div class="btn-row">
        <button class="btn primary" type="submit">{t('common.save')}</button>
        <a class="btn" href="/tenants">{t('common.cancel')}</a>
      </div>
    </form>
  );
}

async function readForm(c: Parameters<typeof back>[0]) {
  const f = await c.req.formData();
  return {
    name: str(f.get('name')),
    phone: str(f.get('phone')) || null,
    email: str(f.get('email')) || null,
    line_id: str(f.get('line_id')) || null,
    id_card_no: str(f.get('id_card_no')).replace(/\D/g, '') || null,
    address: str(f.get('address')) || null,
    emergency: str(f.get('emergency')) || null,
    note: str(f.get('note')) || null,
  };
}

app.get('/tenants', async (c) => {
  const t = c.get('t');
  const q = c.req.query('q') ?? '';
  const rows = await c.get('db').all<Tenant & { room_number: string | null; building_name: string | null }>(
    `SELECT t.*, r.number AS room_number, b.name AS building_name
       FROM tenants t
       LEFT JOIN contracts ct ON ct.tenant_id = t.id AND ct.status = 'active'
       LEFT JOIN rooms r ON r.id = ct.room_id
       LEFT JOIN buildings b ON b.id = r.building_id
      ${q ? 'WHERE t.name LIKE ?1 OR t.phone LIKE ?1 OR t.id_card_no LIKE ?1' : ''}
      ORDER BY t.name`,
    ...(q ? [`%${q}%`] : []),
  );
  return c.html(
    <Layout {...page(c, t('tenant.title'))}>
      <PageHead title={t('tenant.title')} sub={`${rows.length} ${t('tenant.title')}`}>
        <form method="get" action="/tenants" class="btn-row">
          <input name="q" value={q} placeholder={t('common.search')} style="min-width:200px" />
          <button class="btn" type="submit">{t('common.search')}</button>
        </form>
        <a class="btn primary" href="/tenants/new">{t('tenant.new')}</a>
      </PageHead>
      <div class="card">
        {rows.length === 0 ? <Empty text={t('common.none')} /> : (
          <div class="table-wrap">
            <table class="responsive">
              <thead>
                <tr>
                  <th>{t('tenant.name')}</th>
                  <th>{t('tenant.phone')}</th>
                  <th>{t('room.number')}</th>
                  <th>{t('tenant.id_card')}</th>
                  <th class="num">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr>
                    <td><a href={`/tenants/${r.id}`}>{r.name}</a></td>
                    <td>{r.phone ?? '-'}</td>
                    <td>{r.room_number ? <Tag kind="occupied" label={`${r.building_name} ${r.room_number}`} /> : <span class="muted small">-</span>}</td>
                    <td class="small">{r.id_card_no ? r.id_card_no.replace(/^(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})$/, '$1-$2-$3-$4-$5') : '-'}</td>
                    <td class="num"><a class="btn sm" href={`/tenants/${r.id}`}>{t('common.view')}</a></td>
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

app.get('/tenants/new', (c) => {
  const t = c.get('t');
  return c.html(
    <Layout {...page(c, t('tenant.new'))}>
      <PageHead title={t('tenant.new')}>
        <a class="btn" href="/tenants">{t('common.back')}</a>
      </PageHead>
      <TenantForm tenant={null} t={t} />
    </Layout>,
  );
});

app.post('/tenants', async (c) => {
  const d = await readForm(c);
  if (!d.name) return back(c, '/tenants/new', 'missing', true);
  const tid = id('t_');
  await c.get('db').run(
    'INSERT INTO tenants (id, name, phone, email, line_id, id_card_no, address, emergency, note) VALUES (?,?,?,?,?,?,?,?,?)',
    tid, d.name, d.phone, d.email, d.line_id, d.id_card_no, d.address, d.emergency, d.note,
  );
  const next = c.req.query('next');
  return back(c, next === 'contract' ? `/contracts/new?tenant=${tid}` : `/tenants/${tid}`, 'saved');
});

app.get('/tenants/:id', async (c) => {
  const db = c.get('db');
  const t = c.get('t');
  const tenant = await db.tenant(c.req.param('id'));
  if (!tenant) return c.notFound();
  const [contracts, invoices] = await Promise.all([
    db.all<{ id: string; start_date: string; end_date: string | null; status: string; rent: number; room_number: string; building_name: string }>(
      `SELECT ct.id, ct.start_date, ct.end_date, ct.status, ct.rent, r.number AS room_number, b.name AS building_name
         FROM contracts ct JOIN rooms r ON r.id = ct.room_id JOIN buildings b ON b.id = r.building_id
        WHERE ct.tenant_id = ? ORDER BY ct.start_date DESC`,
      tenant.id,
    ),
    db.invoiceRows({ tenantId: tenant.id, limit: 24 }),
  ]);

  return c.html(
    <Layout {...page(c, tenant.name)}>
      <PageHead title={tenant.name} sub={tenant.phone ?? ''}>
        <a class="btn" href="/tenants">{t('common.back')}</a>
        <a class="btn primary" href={`/contracts/new?tenant=${tenant.id}`}>{t('contract.new')}</a>
      </PageHead>

      <div class="grid c2">
        <TenantForm tenant={tenant} t={t} />
        <div>
          <div class="card">
            <h2>{t('contract.title')}</h2>
            {contracts.length === 0 ? <Empty text={t('common.none')} /> : (
              <table>
                <tbody>
                  {contracts.map((ct) => (
                    <tr>
                      <td><a href={`/contracts/${ct.id}`}>{ct.building_name} {ct.room_number}</a>
                        <div class="small muted">{thaiDate(ct.start_date)} – {ct.end_date ? thaiDate(ct.end_date) : '…'}</div>
                      </td>
                      <td class="num">฿{baht(ct.rent)}</td>
                      <td class="num"><Tag kind={ct.status} label={t(`contract.${ct.status}` as 'contract.active')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div class="card">
            <h2>{t('nav.invoices')}</h2>
            {invoices.length === 0 ? <Empty text={t('invoice.none')} /> : (
              <div class="table-wrap">
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
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>,
  );
});

app.post('/tenants/:id', async (c) => {
  const tid = c.req.param('id');
  const d = await readForm(c);
  if (!d.name) return back(c, `/tenants/${tid}`, 'missing', true);
  await c.get('db').run(
    'UPDATE tenants SET name=?, phone=?, email=?, line_id=?, id_card_no=?, address=?, emergency=?, note=? WHERE id=?',
    d.name, d.phone, d.email, d.line_id, d.id_card_no, d.address, d.emergency, d.note, tid,
  );
  return back(c, `/tenants/${tid}`, 'saved');
});

export default app;
