import { requirePermission, route } from '../app';
import { Head } from '../ui/layout';
import { LeaseBody, LeaseSignatures } from '../ui/lease';

const app = route();

/**
 * The printable lease. Same wording the tenant reads before confirming — see
 * `src/ui/lease.tsx` — with the ID number unmasked and the signature blocks
 * attached, because this is the copy that gets signed.
 */
app.get('/contracts/:id/print', async (c) => {
  const tctx = c.get('tctx');
  requirePermission(tctx, 'app.contract.read');
  const repos = c.get('repos');
  const contract = await repos.contracts.byId(tctx, c.req.param('id'));
  const room = await repos.rooms.byId(tctx, contract.room_id);
  const resident = await repos.parties.resident(tctx, contract.party_id);
  const building = await repos.buildings.byId(tctx, room.building_id);

  // The signed copy shows the ID number in full, so it is a pii_view: gated on
  // the permission and audited like every other reveal.
  const nationalId = await repos.parties.revealNationalId(
    tctx, contract.party_id, 'พิมพ์สัญญาเช่าเพื่อลงนาม',
  );

  return c.html(
    <html lang="th">
      <head>
        <Head title={`สัญญาเช่าห้องพัก ${room.number}`} />
      </head>
      <body>
        <div style="padding:1rem">
          <div class="btn-row no-print" style="max-width:210mm;margin:0 auto 1rem">
            <button class="btn primary" onclick="window.print()">พิมพ์สัญญา</button>
            <a class="btn" href={`/contracts/${contract.contract_id}`}>ย้อนกลับ</a>
          </div>
          <div class="paper" style="line-height:1.9">
            <LeaseBody contract={contract} room={room} tenant={resident} nationalId={nationalId}
              building={building} />
            <LeaseSignatures tenantName={resident.display_name ?? ''} />
          </div>
        </div>
      </body>
    </html>,
  );
});

export default app;
