import { route } from '../app';
import { Head } from '../ui/layout';
import { LeaseBody } from '../ui/lease';

const app = route();

/**
 * The lease a tenant reads before confirming, addressed by their invite code.
 *
 * Public by necessity: the reader has no account yet — binding their LINE
 * identity to the room is the thing they are about to do. The code is the
 * authorisation, and it already carries more power than this page does: anyone
 * holding it can claim the room outright.
 *
 * Two limits follow from that. The ID number is masked, because a signed copy
 * is not what this is. And an expired, revoked or already-confirmed code
 * renders nothing — the page must not outlive the invite that opened it.
 */
app.get('/lease/:code', async (c) => {
  const db = c.get('db');
  const code = c.req.param('code').toUpperCase();

  const invite = await db.one<{ contract_id: string }>(
    `SELECT i.contract_id
       FROM invites i
       JOIN contracts c ON c.id = i.contract_id
      WHERE i.code = ?
        AND i.revoked_at IS NULL
        AND i.expires_at > datetime('now')
        AND c.status = 'active'`,
    code,
  );
  if (!invite) return c.notFound();

  const contract = await db.contract(invite.contract_id);
  if (!contract) return c.notFound();
  const room = await db.room(contract.room_id);
  const tenant = await db.tenant(contract.tenant_id);
  if (!room || !tenant) return c.notFound();
  const building = await db.building(room.building_id);
  if (!building) return c.notFound();

  return c.html(
    <html lang="th">
      <head>
        <Head title="สัญญาเช่าห้องพัก" />
        {/* Read inside the LINE in-app browser on a phone, not printed. */}
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body>
        <div style="padding:1rem">
          <div class="paper" style="line-height:1.9;max-width:46rem;margin:0 auto">
            <LeaseBody contract={contract} room={room} tenant={tenant} building={building} maskIdCard />
            <p class="small muted" style="margin-top:1.5rem">
              เอกสารฉบับนี้แสดงเพื่ออ่านก่อนยืนยัน การยืนยันทำในแอป dorm.place บน LINE
              และฉบับที่ลงลายมือชื่อจะออกโดยผู้ให้เช่า
            </p>
          </div>
        </div>
      </body>
    </html>,
  );
});

export default app;
