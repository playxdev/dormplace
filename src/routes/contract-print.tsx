import { route } from '../app';
import { Head } from '../ui/layout';
import { baht, bahtText, thaiDate } from '../lib/util';

const app = route();

/**
 * A Thai residential lease (สัญญาเช่าห้องพัก) filled from the contract record.
 * Plain, printable, and intentionally generic — owners should have their own
 * lawyer review the wording before using it as their standard agreement.
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

  const months = contract.end_date
    ? Math.max(1, Math.round((new Date(contract.end_date).getTime() - new Date(contract.start_date).getTime()) / (30 * 86400000)))
    : null;

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
            <h2 style="text-align:center;font-size:1.25rem;margin-bottom:1.2rem">สัญญาเช่าห้องพัก</h2>
            <p style="text-align:right">ทำที่ {building.name}<br />วันที่ {thaiDate(contract.start_date, true)}</p>

            <p>
              สัญญาฉบับนี้ทำขึ้นระหว่าง <strong>{building.promptpay_name ?? building.name}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า
              “ผู้ให้เช่า” ฝ่ายหนึ่ง กับ <strong>{tenant.name}</strong>
              {tenant.id_card_no ? ` เลขประจำตัวประชาชน ${tenant.id_card_no}` : ''}
              {tenant.address ? ` อยู่บ้านเลขที่ ${tenant.address}` : ''} ซึ่งต่อไปในสัญญานี้เรียกว่า “ผู้เช่า” อีกฝ่ายหนึ่ง
              โดยทั้งสองฝ่ายตกลงทำสัญญากันดังมีข้อความต่อไปนี้
            </p>

            <p>
              <strong>ข้อ 1.</strong> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข <strong>{room.number}</strong> ชั้น {room.floor}
              ณ {building.name} {building.address ? `เลขที่ ${building.address}` : ''}
            </p>

            <p>
              <strong>ข้อ 2.</strong> กำหนดระยะเวลาเช่า เริ่มตั้งแต่วันที่ {thaiDate(contract.start_date, true)}
              {contract.end_date ? ` ถึงวันที่ ${thaiDate(contract.end_date, true)} รวมเป็นระยะเวลาประมาณ ${months} เดือน` : ' โดยไม่กำหนดวันสิ้นสุด และให้เช่าเป็นรายเดือน'}
            </p>

            <p>
              <strong>ข้อ 3.</strong> ผู้เช่าตกลงชำระค่าเช่าเดือนละ <strong>{baht(contract.rent)}</strong> บาท ({bahtText(contract.rent)})
              ภายในวันที่ {building.due_day} ของทุกเดือน
            </p>

            <p>
              <strong>ข้อ 4.</strong> ค่าสาธารณูปโภค ผู้เช่าตกลงชำระตามอัตราดังนี้ ค่าน้ำประปา{' '}
              {building.water_mode === 'flat'
                ? `เหมาจ่ายเดือนละ ${baht(building.water_flat)} บาท`
                : `หน่วยละ ${baht(building.water_rate)} บาท ตามที่ใช้จริง`}
              {' '}และค่ากระแสไฟฟ้า{' '}
              {building.electric_mode === 'flat'
                ? `เหมาจ่ายเดือนละ ${baht(building.electric_flat)} บาท`
                : `หน่วยละ ${baht(building.electric_rate)} บาท ตามที่ใช้จริง`}
              {building.common_fee > 0 ? ` และค่าส่วนกลางเดือนละ ${baht(building.common_fee)} บาท` : ''}
            </p>

            <p>
              <strong>ข้อ 5.</strong> ในวันทำสัญญา ผู้เช่าได้วางเงินประกันความเสียหายไว้กับผู้ให้เช่าเป็นเงิน{' '}
              <strong>{baht(contract.deposit)}</strong> บาท ({bahtText(contract.deposit)})
              ผู้ให้เช่าจะคืนเงินประกันดังกล่าวให้แก่ผู้เช่าภายใน 30 วันนับแต่วันสิ้นสุดสัญญา
              หลังหักค่าเสียหายและค่าใช้จ่ายค้างชำระ (ถ้ามี)
            </p>

            <p>
              <strong>ข้อ 6.</strong> ผู้เช่าจะไม่ดัดแปลงต่อเติมห้องพัก ไม่นำห้องพักไปให้ผู้อื่นเช่าช่วง
              และจะดูแลรักษาทรัพย์สินภายในห้องพักให้อยู่ในสภาพเรียบร้อยตลอดอายุสัญญา
            </p>

            <p>
              <strong>ข้อ 7.</strong> หากผู้เช่าประสงค์จะย้ายออกก่อนครบกำหนด ผู้เช่าต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าไม่น้อยกว่า 30 วัน
            </p>

            <p>
              <strong>ข้อ 8.</strong> ผู้ให้เช่าเก็บรวบรวมและใช้ข้อมูลส่วนบุคคลของผู้เช่าเพียงเพื่อการปฏิบัติตามสัญญาฉบับนี้
              ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562
            </p>

            <p style="margin-top:1rem">
              สัญญานี้ทำขึ้นเป็นสองฉบับ มีข้อความตรงกัน คู่สัญญาได้อ่านและเข้าใจข้อความโดยตลอดแล้ว
              จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน
            </p>

            <div style="display:flex;justify-content:space-around;margin-top:3rem;text-align:center;gap:2rem">
              <div>
                <div style="border-bottom:1px dotted #000;min-width:170px;height:2.2rem"></div>
                <div>ผู้ให้เช่า</div>
              </div>
              <div>
                <div style="border-bottom:1px dotted #000;min-width:170px;height:2.2rem"></div>
                <div>ผู้เช่า</div>
                <div class="small">({tenant.name})</div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-around;margin-top:2rem;text-align:center;gap:2rem">
              <div>
                <div style="border-bottom:1px dotted #000;min-width:170px;height:2.2rem"></div>
                <div>พยาน</div>
              </div>
              <div>
                <div style="border-bottom:1px dotted #000;min-width:170px;height:2.2rem"></div>
                <div>พยาน</div>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>,
  );
});

export default app;
