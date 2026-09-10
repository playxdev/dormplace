import { back, page, requirePermission, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { baht, str, thaiDate } from '../lib/util';
import type { T } from '../lib/i18n';
import type { Ctx } from '../app';
import type { Resident, ResidentInput } from '../repo';

/*
 * Residents.
 *
 * The URLs say /residents, not /tenants. In this codebase a tenant is the
 * dormitory business; the person renting a room is a client, stored as a PARTY.
 * Leaving the old path in place would keep exactly the collision the rewrite
 * exists to remove. The Thai label the user sees is unchanged: ผู้เช่า.
 *
 * Personal data never reaches this file in the clear. The phone is shown from
 * party.phone_masked and the national ID from its last four digits; revealing
 * either is a separate, permissioned, audited request.
 */

const app = route();

function ResidentForm({ tenant, t }: { tenant: Resident | null; t: T }) {
  return (
    <form method="post" action={tenant ? `/residents/${tenant.party_id}` : '/residents'} class="card" style="max-width:720px">
      <div class="row">
        <div class="field">
          <label for="name">{t('tenant.name')}</label>
          <input id="name" name="name" required value={tenant?.display_name ?? ''} />
        </div>
        <div class="field">
          <label for="phone">{t('tenant.phone')}</label>
          {/* Shows the mask on an existing record. Leaving it untouched keeps
              the stored number; typing a new one replaces it. */}
          <input id="phone" name="phone" inputmode="tel" value={tenant?.phone_masked ?? ''} placeholder="08x-xxx-xxxx" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="id_card_no">{t('tenant.id_card')}</label>
          <input id="id_card_no" name="id_card_no" inputmode="numeric" maxlength={17}
            value={tenant?.national_id_last4 ? `•••••••••${tenant.national_id_last4}` : ''} />
        </div>
        <div class="field">
          <label for="email">{t('tenant.email')}</label>
          <input id="email" name="email" type="email" value="" placeholder={tenant?.email_hash ? '••••••' : ''} />
        </div>
      </div>
      <div class="field">
        <label for="address">{t('tenant.address')}</label>
        <textarea id="address" name="address" rows={2}>{tenant?.registered_address ?? ''}</textarea>
      </div>
      <div class="row">
        <div class="field">
          <label for="emergency">{t('tenant.emergency')}</label>
          <input id="emergency" name="emergency" value={tenant?.emergency_name ?? ''} placeholder="ชื่อผู้ติดต่อฉุกเฉิน" />
        </div>
        <div class="field">
          <label for="emergency_phone">{t('tenant.emergency')} — {t('tenant.phone')}</label>
          <input id="emergency_phone" name="emergency_phone" inputmode="tel" value="" />
        </div>
        <div class="field">
          <label for="note">{t('common.optional')}</label>
          <input id="note" name="note" value={tenant?.profile_note ?? ''} />
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

async function readForm(c: Ctx): Promise<ResidentInput> {
  const f = await c.req.formData();
  // A field left showing its mask or its bullets was not edited, so it must not
  // overwrite what is stored. Only digits the operator actually typed count.
  const phone = str(f.get('phone'));
  const nationalId = str(f.get('id_card_no'));
  return {
    display_name: str(f.get('name')),
    phone: /x/i.test(phone) ? undefined : phone || null,
    email: str(f.get('email')) || undefined,
    national_id: nationalId.includes('•') ? undefined : nationalId.replace(/\D/g, '') || null,
    registered_address: str(f.get('address')) || null,
    emergency_name: str(f.get('emergency')) || null,
    emergency_phone: str(f.get('emergency_phone')) || undefined,
    emergency_relation: null,
    note: str(f.get('note')) || null,
  };
}

app.get('/residents', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.resident.read');
  const q = c.req.query('q') ?? '';
  const rows = await c.get('repos').parties.listResidents(tctx, q || undefined);
  return c.html(
    <Layout {...page(c, t('tenant.title'))}>
      <PageHead title={t('tenant.title')} sub={`${rows.length} ${t('tenant.title')}`}>
        <form method="get" action="/residents" class="btn-row">
          <input name="q" value={q} placeholder={t('common.search')} style="min-width:200px" />
          <button class="btn" type="submit">{t('common.search')}</button>
        </form>
        <a class="btn primary" href="/residents/new">{t('tenant.new')}</a>
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
                    <td><a href={`/residents/${r.party_id}`}>{r.display_name}</a></td>
                    <td>{r.phone_masked ?? '-'}</td>
                    <td>{r.room_number ? <Tag kind="occupied" label={`${r.building_name} ${r.room_number}`} /> : <span class="muted small">-</span>}</td>
                    <td class="small">{r.national_id_last4 ? `•••••••••${r.national_id_last4}` : '-'}</td>
                    <td class="num"><a class="btn sm" href={`/residents/${r.party_id}`}>{t('common.view')}</a></td>
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

app.get('/residents/new', (c) => {
  const t = c.get('t');
  requirePermission(c.get('tctx'), 'app.resident.manage');
  return c.html(
    <Layout {...page(c, t('tenant.new'))}>
      <PageHead title={t('tenant.new')}>
        <a class="btn" href="/residents">{t('common.back')}</a>
      </PageHead>
      <ResidentForm tenant={null} t={t} />
    </Layout>,
  );
});

app.post('/residents', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.resident.manage');
  const d = await readForm(c);
  if (!d.display_name) return back(c, '/residents/new', 'missing', true);
  const party = await c.get('repos').parties.createResident(tctx, d);
  const next = c.req.query('next');
  return back(
    c,
    next === 'contract' ? `/contracts/new?resident=${party.party_id}` : `/residents/${party.party_id}`,
    'saved',
  );
});

app.get('/residents/:id', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.resident.read');
  const repos = c.get('repos');
  const tenant = await repos.parties.resident(tctx, c.req.param('id'));
  const [contracts, invoices] = await Promise.all([
    repos.contracts.forParty(tctx, tenant.party_id),
    repos.invoices.rows(tctx, { partyId: tenant.party_id, limit: 24 }),
  ]);

  return c.html(
    <Layout {...page(c, tenant.display_name ?? '')}>
      <PageHead title={tenant.display_name ?? ''} sub={tenant.phone_masked ?? ''}>
        <a class="btn" href="/residents">{t('common.back')}</a>
        <a class="btn primary" href={`/contracts/new?resident=${tenant.party_id}`}>{t('contract.new')}</a>
      </PageHead>

      <div class="grid c2">
        <ResidentForm tenant={tenant} t={t} />
        <div>
          <div class="card">
            <h2>{t('contract.title')}</h2>
            {contracts.length === 0 ? <Empty text={t('common.none')} /> : (
              <table>
                <tbody>
                  {contracts.map((ct) => (
                    <tr>
                      <td><a href={`/contracts/${ct.contract_id}`}>{ct.building_name} {ct.room_number}</a>
                        <div class="small muted">{thaiDate(ct.start_date)} – {ct.end_date ? thaiDate(ct.end_date) : '…'}</div>
                      </td>
                      <td class="num">฿{baht(ct.rent)}</td>
                      <td class="num"><Tag kind={ct.status.toLowerCase()} label={t(`contract.${ct.status.toLowerCase()}` as 'contract.active')} /></td>
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
                        <td><a href={`/invoices/${i.invoice_id}`}>{i.number}</a></td>
                        <td class="num">฿{baht(i.total)}</td>
                        <td class="num"><Tag kind={i.effective_status.toLowerCase()}
                          label={t(`invoice.${i.effective_status.toLowerCase()}` as 'invoice.paid')} /></td>
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

app.post('/residents/:id', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.resident.manage');
  const pid = c.req.param('id');
  const d = await readForm(c);
  if (!d.display_name) return back(c, `/residents/${pid}`, 'missing', true);
  await c.get('repos').parties.updateResident(tctx, pid, d);
  return back(c, `/residents/${pid}`, 'saved');
});

export default app;
