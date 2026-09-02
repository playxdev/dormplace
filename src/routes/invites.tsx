import { back, page, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { baht, thaiDate } from '../lib/util';
import { qrSvg } from '../lib/qr';
import type { Contract } from '../types';
import type { Ctx } from '../app';

const app = route();

/**
 * Omits characters that are read wrong when a code is spoken over the phone or
 * copied off a screen: 0/O, 1/I/L, 2/Z, 5/S, 8/B. Must stay byte-identical to
 * `inviteAlphabet` in dormapi's `internal/store/invites.go` and to
 * `CODE_PATTERN` in dormmini's `src/pages/onboarding.js`.
 */
const ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';
const CODE_LENGTH = 8;

/** Days a fresh invite stays usable. Long enough that a tenant who moves in on
 *  a Friday and gets to it the next weekend is not locked out. */
const VALID_DAYS = 30;

function newCode(): string {
  const buf = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  // 256 is not a multiple of 25, so this is very slightly biased. With 25^8
  // codes, single use, and a 30-day expiry, that bias does not matter here.
  return Array.from(buf, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

interface InviteRow {
  code: string; contract_id: string; expires_at: string; revoked_at: string | null; created_at: string;
}

interface InviteView {
  invite: InviteRow;
  contract: Contract;
  buildingName: string;
  roomNumber: string;
  tenantName: string;
  claimed: boolean;
  expired: boolean;
}

/** The one invite that still matters for a contract: newest, not revoked. */
async function currentInvite(c: Ctx, contractId: string): Promise<InviteView | null> {
  const db = c.get('db');
  const invite = await db.one<InviteRow>(
    `SELECT * FROM invites
      WHERE contract_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    contractId,
  );
  if (!invite) return null;

  const row = await db.one<{
    building_name: string; room_number: string; tenant_name: string; confirmed_by_user_id: string | null;
  }>(
    `SELECT b.name AS building_name, r.number AS room_number, tn.name AS tenant_name,
            c.confirmed_by_user_id
       FROM contracts c
       JOIN rooms r     ON r.id = c.room_id
       JOIN buildings b ON b.id = r.building_id
       JOIN tenants tn  ON tn.id = c.tenant_id
      WHERE c.id = ?`,
    contractId,
  );
  const contract = await db.contract(contractId);
  if (!row || !contract) return null;

  return {
    invite,
    contract,
    buildingName: row.building_name,
    roomNumber: row.room_number,
    tenantName: row.tenant_name,
    claimed: row.confirmed_by_user_id !== null,
    expired: invite.expires_at <= new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}

const linkFor = (base: string, code: string) => `${base}?invite=${code}`;

/* ------------------------------------------------------------------ pages -- */

app.get('/contracts/:id/invite', async (c) => {
  const t = c.get('t');
  const cid = c.req.param('id');
  const contract = await c.get('db').contract(cid);
  if (!contract) return c.notFound();
  const view = await currentInvite(c, cid);
  const base = c.env.MINI_APP_URL as string;

  return c.html(
    <Layout {...page(c, t('invite.title'))}>
      <PageHead title={t('invite.title')} sub={view ? `${view.buildingName} ${view.roomNumber} · ${view.tenantName}` : undefined}>
        <a class="btn" href={`/contracts/${cid}`}>{t('common.back')}</a>
        {view && !view.claimed && !view.expired
          ? <a class="btn" href={`/contracts/${cid}/invite/print`} target="_blank">{t('invite.print')}</a>
          : null}
      </PageHead>

      <div class="grid c2">
        <div class="card" style="text-align:center">
          {view && !view.expired ? (
            <>
              {view.claimed ? (
                <p><Tag kind="paid" label={t('invite.claimed')} /></p>
              ) : (
                <>
                  <div dangerouslySetInnerHTML={{ __html: qrSvg(linkFor(base, view.invite.code), 260) }} />
                  <p class="code" style="font-size:1.6rem;letter-spacing:.28em;font-weight:700;margin:.75rem 0 .25rem">
                    {view.invite.code}
                  </p>
                  <p class="small muted">{t('invite.manual')}</p>
                  <p class="small muted">{t('invite.expires')} {thaiDate(view.invite.expires_at.slice(0, 10))}</p>
                </>
              )}
            </>
          ) : (
            <Empty text={view ? t('invite.expired') : t('invite.none')} />
          )}

          <div class="btn-row" style="justify-content:center;margin-top:1rem">
            {contract.status === 'active' && !view?.claimed ? (
              <form method="post" action={`/contracts/${cid}/invite`}>
                <button class="btn primary" type="submit">
                  {view && !view.expired ? t('invite.regenerate') : t('invite.new')}
                </button>
              </form>
            ) : null}
            {view && !view.claimed ? (
              <form method="post" action={`/invites/${view.invite.code}/revoke`}
                onsubmit={`return confirm('${t('invite.revoke_confirm')}')`}>
                <button class="btn danger" type="submit">{t('invite.revoke')}</button>
              </form>
            ) : null}
          </div>

          {contract.status !== 'active' ? <p class="small muted">{t('invite.only_active')}</p> : null}
        </div>

        <div class="card">
          <h2>{t('invite.howto')}</h2>
          <ol class="small" style="line-height:1.9;padding-left:1.2rem">
            <li>{t('invite.step1')}</li>
            <li>{t('invite.step2')}</li>
            <li>{t('invite.step3')}</li>
            <li>{t('invite.step4')}</li>
          </ol>
          {view && !view.claimed && !view.expired ? (
            <>
              <div class="small muted" style="margin-top:1rem">{t('contract.rent')}</div>
              <div>฿{baht(view.contract.rent)}</div>
            </>
          ) : null}
        </div>
      </div>
    </Layout>,
  );
});

/** A sheet the owner can hand over or tape to the door. Deliberately plain: it
 *  has to survive a cheap printer and a phone camera. */
app.get('/contracts/:id/invite/print', async (c) => {
  const t = c.get('t');
  const view = await currentInvite(c, c.req.param('id'));
  if (!view || view.expired) return c.notFound();
  const link = linkFor(c.env.MINI_APP_URL as string, view.invite.code);

  return c.html(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view.buildingName} ${view.roomNumber} · dorm.place</title>
<style>
  @page { size: A5; margin: 12mm }
  body { font-family: 'Noto Sans Thai', system-ui, sans-serif; text-align: center;
         color: #111; background: #fff; margin: 0; padding: 24px }
  h1 { font-size: 20px; margin: 0 0 2px }
  .sub { color: #555; font-size: 14px; margin: 0 0 18px }
  .code { font-size: 30px; letter-spacing: .3em; font-weight: 700; margin: 14px 0 4px }
  ol { text-align: left; display: inline-block; font-size: 13px; line-height: 1.9; color: #333 }
  .foot { margin-top: 18px; font-size: 11px; color: #777 }
  @media print { .noprint { display: none } }
</style></head><body onload="print()">
  <h1>${view.buildingName} ห้อง ${view.roomNumber}</h1>
  <p class="sub">${view.tenantName}</p>
  ${qrSvg(link, 260)}
  <p class="code">${view.invite.code}</p>
  <p class="sub">${t('invite.manual')}</p>
  <ol>
    <li>${t('invite.step1')}</li>
    <li>${t('invite.step2')}</li>
    <li>${t('invite.step3')}</li>
    <li>${t('invite.step4')}</li>
  </ol>
  <p class="foot">${t('invite.expires')} ${thaiDate(view.invite.expires_at.slice(0, 10))} · dorm.place</p>
</body></html>`);
});

/* ----------------------------------------------------------------- actions - */

app.post('/contracts/:id/invite', async (c) => {
  const db = c.get('db');
  const cid = c.req.param('id');
  const contract = await db.contract(cid);
  if (!contract) return c.notFound();
  // A QR for an ended contract would bind a tenant to a room they have left.
  if (contract.status !== 'active') return back(c, `/contracts/${cid}/invite`, 'invite_not_active', true);

  const expires = new Date(Date.now() + VALID_DAYS * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  await db.batch([
    // Regenerating retires the old code, so a QR already handed out or printed
    // stops working rather than silently staying valid alongside the new one.
    db.prep("UPDATE invites SET revoked_at = datetime('now') WHERE contract_id = ? AND revoked_at IS NULL", cid),
    db.prep(
      'INSERT INTO invites (code, contract_id, expires_at, created_by) VALUES (?,?,?,?)',
      newCode(), cid, expires, c.get('user').id,
    ),
  ]);
  return back(c, `/contracts/${cid}/invite`, 'invite_created');
});

app.post('/invites/:code/revoke', async (c) => {
  const db = c.get('db');
  const code = c.req.param('code');
  const invite = await db.one<InviteRow>('SELECT * FROM invites WHERE code = ?', code);
  if (!invite) return c.notFound();
  await db.run("UPDATE invites SET revoked_at = datetime('now') WHERE code = ? AND revoked_at IS NULL", code);
  return back(c, `/contracts/${invite.contract_id}/invite`, 'invite_revoked');
});

export default app;
