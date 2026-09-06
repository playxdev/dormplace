import { baht, bahtText, thaiDate } from '../lib/util';

/**
 * Version of the lease wording below.
 *
 * A confirmation records this string, so it must change whenever a clause
 * changes — otherwise a stored confirmation names wording that never existed.
 * `internal/terms` in dormapi carries the same constant and the two move
 * together; the text itself lives here only.
 */
export const LEASE_VERSION = '1.0';

/** Version of clause 8, recorded separately because a privacy notice changes
 *  for reasons of its own. */
export const PDPA_VERSION = '1.0';

/**
 * The body of a Thai residential lease (สัญญาเช่าห้องพัก), filled from the
 * contract record.
 *
 * One copy, two readers: the owner prints it, and the tenant reads the same
 * rendering before confirming. Restating the clauses anywhere else would let
 * the two drift, and a tenant who agreed to a different wording than the one
 * on the printed page is exactly the dispute this is meant to survive.
 *
 * Intentionally generic — owners should have their own lawyer review the
 * wording before adopting it as a standard agreement.
 */
export function LeaseBody({ contract, room, tenant, building, maskIdCard = false }: {
  contract: any; room: any; tenant: any; building: any; maskIdCard?: boolean;
}) {
  const months = contract.end_date
    ? Math.max(1, Math.round((new Date(contract.end_date).getTime() - new Date(contract.start_date).getTime()) / (30 * 86400000)))
    : null;

  // The tenant already knows their own ID number; anyone else holding the
  // invite code does not need it. The unmasked number stays on the printed
  // copy, which never leaves the backoffice.
  const idCard = contract && tenant.id_card_no
    ? (maskIdCard ? `x-xxxx-xxxxx-xx-${String(tenant.id_card_no).slice(-1)}` : tenant.id_card_no)
    : null;

  return (
    <>
      <h2 style="text-align:center;font-size:1.25rem;margin-bottom:1.2rem">สัญญาเช่าห้องพัก</h2>
      <p style="text-align:right">ทำที่ {building.name}<br />วันที่ {thaiDate(contract.start_date, true)}</p>

      <p>
        สัญญาฉบับนี้ทำขึ้นระหว่าง <strong>{building.promptpay_name ?? building.name}</strong> ซึ่งต่อไปในสัญญานี้เรียกว่า
        “ผู้ให้เช่า” ฝ่ายหนึ่ง กับ <strong>{tenant.name}</strong>
        {idCard ? ` เลขประจำตัวประชาชน ${idCard}` : ''}
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
    </>
  );
}

/** Signature blocks. Print only — a screen reading is not a signing. */
export function LeaseSignatures({ tenantName }: { tenantName: string }) {
  return (
    <>
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
          <div class="small">({tenantName})</div>
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
    </>
  );
}
