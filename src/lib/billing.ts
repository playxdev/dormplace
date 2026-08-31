import type { Building, Contract, InvoiceItem, MeterReading, Room } from '../types';
import { addDays, daysBetween, id, periodBounds } from './util';

export interface DraftItem {
  kind: InvoiceItem['kind'];
  label: string;
  detail: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  amount: number;
}

export interface Draft {
  items: DraftItem[];
  subtotal: number;
  warnings: string[];
  /** Days of the period the tenant is actually charged rent for. */
  chargedDays: number;
  periodDays: number;
}

/**
 * Charged window inside `period` for a contract: it starts no earlier than the
 * move-in date and ends no later than the move-out date, so a tenant arriving
 * or leaving mid-month is billed pro rata by day.
 */
export function chargeWindow(contract: Contract, period: string) {
  const { start, end, days } = periodBounds(period);
  const from = contract.start_date > start ? contract.start_date : start;
  const stop = contract.moved_out_at && contract.moved_out_at < end ? contract.moved_out_at : end;
  const chargedDays = stop < from ? 0 : daysBetween(from, stop) + 1;
  return { from, to: stop, chargedDays, periodDays: days, full: chargedDays >= days };
}

/** Whether a contract is billable at all for the given period. */
export function isBillable(contract: Contract, period: string): boolean {
  const { end } = periodBounds(period);
  if (contract.start_date > end) return false;
  const { start } = periodBounds(period);
  if (contract.moved_out_at && contract.moved_out_at < start) return false;
  return true;
}

export interface BuildDraftInput {
  building: Building;
  room: Room;
  contract: Contract;
  water?: MeterReading | null;
  electric?: MeterReading | null;
  /** Extra one-off lines the operator added by hand. */
  extras?: DraftItem[];
}

export function buildDraft(input: BuildDraftInput, period: string): Draft {
  const { building, contract, water, electric, extras = [] } = input;
  const win = chargeWindow(contract, period);
  const items: DraftItem[] = [];
  const warnings: string[] = [];

  /* --- rent, pro-rated by day when the tenant did not occupy the whole month --- */
  const monthlyRent = contract.rent || input.room.rent;
  if (win.chargedDays > 0) {
    const amount = win.full
      ? monthlyRent
      : Math.round((monthlyRent * win.chargedDays) / win.periodDays);
    items.push({
      kind: 'rent',
      label: 'ค่าเช่าห้อง',
      detail: win.full ? null : `${win.from} ถึง ${win.to} (${win.chargedDays}/${win.periodDays} วัน)`,
      qty: win.full ? 1 : win.chargedDays,
      unit: win.full ? 'เดือน' : 'วัน',
      unit_price: win.full ? monthlyRent : Math.round(monthlyRent / win.periodDays),
      amount,
    });
  }

  /* --- utilities --- */
  if (building.water_mode === 'flat') {
    if (building.water_flat > 0) {
      items.push({ kind: 'water', label: 'ค่าน้ำ (เหมาจ่าย)', detail: null, qty: 1, unit: 'เดือน', unit_price: building.water_flat, amount: building.water_flat });
    }
  } else if (water) {
    const used = Math.max(0, water.value - water.prev_value);
    const amount = Math.round(used * building.water_rate);
    items.push({
      kind: 'water', label: 'ค่าน้ำประปา',
      detail: `${water.prev_value} → ${water.value}`,
      qty: used, unit: 'หน่วย', unit_price: building.water_rate, amount,
    });
  } else {
    warnings.push('ยังไม่ได้จดมิเตอร์น้ำ');
  }

  if (building.electric_mode === 'flat') {
    if (building.electric_flat > 0) {
      items.push({ kind: 'electric', label: 'ค่าไฟ (เหมาจ่าย)', detail: null, qty: 1, unit: 'เดือน', unit_price: building.electric_flat, amount: building.electric_flat });
    }
  } else if (electric) {
    const used = Math.max(0, electric.value - electric.prev_value);
    const amount = Math.round(used * building.electric_rate);
    items.push({
      kind: 'electric', label: 'ค่าไฟฟ้า',
      detail: `${electric.prev_value} → ${electric.value}`,
      qty: used, unit: 'หน่วย', unit_price: building.electric_rate, amount,
    });
  } else {
    warnings.push('ยังไม่ได้จดมิเตอร์ไฟ');
  }

  if (building.common_fee > 0) {
    items.push({ kind: 'common', label: 'ค่าส่วนกลาง', detail: null, qty: 1, unit: 'เดือน', unit_price: building.common_fee, amount: building.common_fee });
  }

  /* --- deposit is billed once, on the invoice covering the move-in month --- */
  const { start, end } = periodBounds(period);
  const movesInThisPeriod = contract.start_date >= start && contract.start_date <= end;
  const depositOwed = contract.deposit - contract.deposit_invoiced;
  if (movesInThisPeriod && depositOwed > 0) {
    items.push({ kind: 'deposit', label: 'เงินประกันห้อง', detail: null, qty: 1, unit: null, unit_price: depositOwed, amount: depositOwed });
  }

  items.push(...extras);

  const subtotal = items.reduce((sum, it) => sum + it.amount, 0);
  return { items, subtotal, warnings, chargedDays: win.chargedDays, periodDays: win.periodDays };
}

/** Due date for a period: the building's due day, rolled into the next month. */
export function dueDateFor(period: string, dueDay: number): string {
  const [y, m] = period.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const daysInNext = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, dueDay), daysInNext);
  return `${next.toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/** INV-2026-08-0007 */
export function invoiceNumber(period: string, seq: number): string {
  return `INV-${period}-${String(seq).padStart(4, '0')}`;
}

export function lateFee(building: Building, dueDate: string, asOf: string): number {
  if (building.late_fee_daily <= 0) return 0;
  const late = daysBetween(dueDate, asOf);
  return late > 0 ? late * building.late_fee_daily : 0;
}

export { addDays, id };
