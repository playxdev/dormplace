import { back, page, requirePermission, route } from '../app';
import { Empty, Layout, PageHead, Tag } from '../ui/layout';
import { baht, thaiDate } from '../lib/util';
import { formatCode } from '../repo/invitation';
import { qrSvg } from '../lib/qr';

const app = route();

/**
 * The onboarding QR.
 *
 * The code is stored hashed (STANDARD §7.4), so it exists in the clear exactly
 * once: in the response to issuing it, which is the page the operator prints.
 * There is no screen that shows an existing code again — losing the sheet means
 * issuing a new one, which revokes the old.
 *
 * That is not a workaround for the hashing. It is the behaviour you want: a
 * handover sheet that went missing stops opening the room the moment its
 * replacement is printed.
 */

const linkFor = (base: string, code: string) => `${base}?invite=${code}`;

/** The sheet handed over with the key. Plain on purpose: it has to survive a
 *  cheap printer and a phone camera. */
function sheet(opts: {
  buildingName: string; roomNumber: string; residentName: string;
  code: string; link: string; expiresAt: string; steps: string[]; manual: string; expires: string;
}): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.buildingName} ${opts.roomNumber} · dorm.place</title>
<style>
  @page { size: A5; margin: 12mm }
  body { font-family: 'Noto Sans Thai', system-ui, sans-serif; text-align: center;
         color: #111; background: #fff; margin: 0; padding: 24px }
  h1 { font-size: 20px; margin: 0 0 2px }
  .sub { color: #555; font-size: 14px; margin: 0 0 18px }
  .code { font-size: 30px; letter-spacing: .3em; font-weight: 700; margin: 14px 0 4px }
  ol { text-align: left; display: inline-block; font-size: 13px; line-height: 1.9; color: #333 }
  .foot { margin-top: 18px; font-size: 11px; color: #777 }
  .warn { margin-top: 10px; font-size: 12px; color: #a33 }
  @media print { .noprint { display: none } }
</style></head><body onload="print()">
  <h1>${opts.buildingName} ห้อง ${opts.roomNumber}</h1>
  <p class="sub">${opts.residentName}</p>
  ${qrSvg(opts.link, 260)}
  <p class="code">${formatCode(opts.code)}</p>
  <p class="sub">${opts.manual}</p>
  <ol>${opts.steps.map((x) => `<li>${x}</li>`).join('')}</ol>
  <p class="warn noprint">รหัสนี้แสดงครั้งเดียว พิมพ์หรือถ่ายเก็บไว้ก่อนปิดหน้านี้</p>
  <p class="foot">${opts.expires} ${thaiDate(opts.expiresAt.slice(0, 10))} · dorm.place</p>
</body></html>`;
}

/* ------------------------------------------------------------------ pages -- */

app.get('/contracts/:id/invite', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'invitation.read');
  const repos = c.get('repos');
  const cid = c.req.param('id');
  const contract = await repos.contracts.byId(tctx, cid);
  const [room, resident, view] = await Promise.all([
    repos.rooms.byId(tctx, contract.room_id),
    repos.parties.byId(tctx, contract.party_id),
    repos.invitations.current(tctx, cid),
  ]);
  const building = await repos.buildings.byId(tctx, room.building_id);
  const live = contract.status === 'ACTIVE' || contract.status === 'ENDING';
  const claimed = contract.confirmed_at !== null;

  return c.html(
    <Layout {...page(c, t('invite.title'))}>
      <PageHead title={t('invite.title')}
        sub={`${building.name} ${room.number} · ${resident.display_name ?? ''}`}>
        <a class="btn" href={`/contracts/${cid}`}>{t('common.back')}</a>
      </PageHead>

      <div class="grid c2">
        <div class="card" style="text-align:center">
          {claimed ? (
            <p><Tag kind="paid" label={t('invite.claimed')} /></p>
          ) : view && !view.expired && view.status === 'ACTIVE' ? (
            <>
              {/* The code itself is a hash in the database and cannot be shown
                  again. What is left is enough for the operator to recognise
                  the sheet they printed. */}
              <p class="code" style="font-size:1.6rem;letter-spacing:.28em;font-weight:700;margin:.75rem 0 .25rem">
                {view.secret_prefix}····
              </p>
              <p class="small muted">{t('invite.issued_hint')}</p>
              <p class="small muted">{t('invite.expires')} {thaiDate(view.expires_at.slice(0, 10))}</p>
            </>
          ) : (
            <Empty text={view ? t('invite.expired') : t('invite.none')} />
          )}

          <div class="btn-row" style="justify-content:center;margin-top:1rem">
            {live && !claimed ? (
              <form method="post" action={`/contracts/${cid}/invite`} target="_blank"
                onsubmit={view && !view.expired ? `return confirm('${t('invite.reissue_confirm')}')` : undefined}>
                <button class="btn primary" type="submit">
                  {view && !view.expired ? t('invite.regenerate') : t('invite.new')}
                </button>
              </form>
            ) : null}
            {view && !claimed && view.status === 'ACTIVE' ? (
              <form method="post" action={`/invites/${view.invitation_id}/revoke`}
                onsubmit={`return confirm('${t('invite.revoke_confirm')}')`}>
                <button class="btn danger" type="submit">{t('invite.revoke')}</button>
              </form>
            ) : null}
          </div>

          {!live ? <p class="small muted">{t('invite.only_active')}</p> : null}
        </div>

        <div class="card">
          <h2>{t('invite.howto')}</h2>
          <ol class="small" style="line-height:1.9;padding-left:1.2rem">
            <li>{t('invite.step1')}</li>
            <li>{t('invite.step2')}</li>
            <li>{t('invite.step3')}</li>
            <li>{t('invite.step4')}</li>
          </ol>
          <div class="small muted" style="margin-top:1rem">{t('contract.rent')}</div>
          <div>฿{baht(contract.rent)}</div>
        </div>
      </div>
    </Layout>,
  );
});

/* ----------------------------------------------------------------- actions - */

/**
 * Issues a code and renders the handover sheet in the same response.
 *
 * This is the only moment the plaintext exists. It is not redirected to a page
 * that would show it, because a URL carrying a live credential ends up in
 * history, in logs, and in whatever the operator pastes into chat.
 */
app.post('/contracts/:id/invite', async (c) => {
  const t = c.get('t');
  const tctx = c.get('tctx');
  requirePermission(tctx, 'invitation.create');
  const repos = c.get('repos');
  const cid = c.req.param('id');
  const contract = await repos.contracts.byId(tctx, cid);

  // A QR for an ended lease would bind someone to a room they have left.
  const live = contract.status === 'ACTIVE' || contract.status === 'ENDING';
  if (!live) return back(c, `/contracts/${cid}/invite`, 'invite_not_active', true);

  const room = await repos.rooms.byId(tctx, contract.room_id);
  const [building, resident] = await Promise.all([
    repos.buildings.byId(tctx, room.building_id),
    repos.parties.byId(tctx, contract.party_id),
  ]);

  const { code, expiresAt } = await repos.invitations.issue(tctx, cid);
  return c.html(sheet({
    buildingName: building.name,
    roomNumber: room.number,
    residentName: resident.display_name ?? '',
    code,
    link: linkFor(c.env.MINI_APP_URL as string, code),
    expiresAt,
    steps: [t('invite.step1'), t('invite.step2'), t('invite.step3'), t('invite.step4')],
    manual: t('invite.manual'),
    expires: t('invite.expires'),
  }));
});

app.post('/invites/:id/revoke', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'invitation.revoke');
  const contractId = await c.get('repos').invitations.revoke(
    tctx, c.req.param('id'), 'ยกเลิกโดยเจ้าหน้าที่',
  );
  return back(c, `/contracts/${contractId}/invite`, 'invite_revoked');
});

export default app;
