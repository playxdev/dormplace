/** Shared primitives: ids, money (satang), Thai-aware date helpers. */

export function id(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/* ---------- money: everything is stored as INTEGER satang ---------- */

export function toSatang(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/,/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromSatang(satang: number): number {
  return satang / 100;
}

/** 125000 -> "1,250.00" */
export function baht(satang: number): string {
  const neg = satang < 0;
  const s = Math.abs(Math.round(satang));
  const whole = Math.floor(s / 100).toLocaleString('en-US');
  const frac = String(s % 100).padStart(2, '0');
  return (neg ? '-' : '') + whole + '.' + frac;
}

const THAI_ONES = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

function thaiIntWords(n: number): string {
  if (n === 0) return 'ศูนย์';
  if (n >= 1_000_000) {
    return thaiIntWords(Math.floor(n / 1_000_000)) + 'ล้าน' + (n % 1_000_000 ? thaiIntWords(n % 1_000_000) : '');
  }
  let out = '';
  const digits = String(n).split('').map(Number);
  const len = digits.length;
  digits.forEach((d, i) => {
    const place = len - i - 1;
    if (d === 0) return;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && len > 1) out += 'เอ็ด';
    else out += THAI_ONES[d] + THAI_PLACE[place];
  });
  return out;
}

/** Thai baht text used on receipts: "หนึ่งพันสองร้อยห้าสิบบาทถ้วน" */
export function bahtText(satang: number): string {
  const s = Math.abs(Math.round(satang));
  const b = Math.floor(s / 100);
  const st = s % 100;
  const sign = satang < 0 ? 'ลบ' : '';
  if (st === 0) return sign + thaiIntWords(b) + 'บาทถ้วน';
  return sign + thaiIntWords(b) + 'บาท' + thaiIntWords(st) + 'สตางค์';
}

/* ---------- dates ---------- */

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** current billing period, YYYY-MM */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export function periodBounds(period: string): { start: string; end: string; days: number } {
  const [y, m] = period.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period}-01`, end: `${period}-${String(days).padStart(2, '0')}`, days };
}

export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const ms = new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime();
  return Math.round(ms / 86400000);
}

/** Buddhist-era Thai date: "31 ส.ค. 2569" */
const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

export function thaiDate(date: string | null | undefined, full = false): string {
  if (!date) return '-';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return date;
  const months = full ? TH_MONTHS_FULL : TH_MONTHS_SHORT;
  return `${d} ${months[m - 1]} ${y + 543}`;
}

/** period "2026-08" -> "สิงหาคม 2569" */
export function thaiPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  if (!y || !m) return period;
  return `${TH_MONTHS_FULL[m - 1]} ${y + 543}`;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function num(v: File | string | null | undefined, fallback = 0): number {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return isFinite(n) ? n : fallback;
}

export function str(v: File | string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}
