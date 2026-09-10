import { route } from '../app';
import { Head } from '../ui/layout';
import { LeaseBody } from '../ui/lease';
import { systemContext } from '../lib/tenant-context';

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
  const repos = c.get('repos');

  // The code is the credential and the only thing that says which operator this
  // request belongs to. lookup() is the one call in the codebase that resolves
  // a tenant from something a request supplied — it can be, because a matching
  // hash against a live, unexpired, unused invitation is proof of nothing else.
  const found = await repos.invitations.lookup(c.req.param('code'));
  if (!found) return c.notFound();

  // Everything after this point is scoped to the tenant the code named, so a
  // code for operator A cannot read operator B's lease even by id.
  const tctx = systemContext(found.tenantId, c.req.header('cf-ray') ?? 'lease');
  const contract = await repos.contracts.byId(tctx, found.contractId);
  const room = await repos.rooms.byId(tctx, contract.room_id);
  const resident = await repos.parties.resident(tctx, contract.party_id);
  const building = await repos.buildings.byId(tctx, room.building_id);

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
            {/* maskIdCard, and no national id is passed at all: the reader
                holding this code has not proved they are the person on the
                lease, and a signed copy is not what this page is. */}
            <LeaseBody contract={contract} room={room} tenant={resident} building={building} maskIdCard />
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
