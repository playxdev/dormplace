import { route } from '../app';
import { Head } from '../ui/layout';
import { LeaseBody, LeaseSignatures } from '../ui/lease';

const app = route();

/**
 * The printable lease. Same wording the tenant reads before confirming — see
 * `src/ui/lease.tsx` — with the ID number unmasked and the signature blocks
 * attached, because this is the copy that gets signed.
 */
app.get('/contracts/:id/print', async (c) => {
  const db = c.get('db');
  const contract = await db.contract(c.req.param('id'));
  if (!contract) return c.notFound();
  const room = await db.room(contract.room_id);
  const tenant = await db.tenant(contract.tenant_id);
  if (!room || !tenant) return c.notFound();
  const building = await db.building(room.building_id);
  if (!building) return c.notFound();

  return c.html(
    <html lang="th">
      <head>
        <Head title={`สัญญาเช่าห้องพัก ${room.number}`} />
      </head>
      <body>
        <div style="padding:1rem">
          <div class="btn-row no-print" style="max-width:210mm;margin:0 auto 1rem">
            <button class="btn primary" onclick="window.print()">พิมพ์สัญญา</button>
            <a class="btn" href={`/contracts/${contract.id}`}>ย้อนกลับ</a>
          </div>
          <div class="paper" style="line-height:1.9">
            <LeaseBody contract={contract} room={room} tenant={tenant} building={building} />
            <LeaseSignatures tenantName={tenant.name} />
          </div>
        </div>
      </body>
    </html>,
  );
});

export default app;
