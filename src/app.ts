import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from './lib/db';
import type { Locale, T } from './lib/i18n';
import type { User } from './types';

export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; t: T; locale: Locale; user: User };
};

export type Ctx = Context<AppEnv>;

export const route = () => new Hono<AppEnv>();

/** Flash codes carried across redirects as `?m=` / `?e=`. */
export const MESSAGES: Record<string, string> = {
  saved: 'บันทึกเรียบร้อย',
  deleted: 'ลบเรียบร้อย',
  meters_saved: 'บันทึกเลขมิเตอร์เรียบร้อย',
  billed: 'ออกบิลเรียบร้อย',
  already_billed: 'รอบบิลนี้ออกบิลไปแล้ว ระบบข้ามใบที่ซ้ำ',
  paid: 'บันทึกการชำระเงินเรียบร้อย',
  checked_out: 'บันทึกการย้ายออกเรียบร้อย ห้องกลับเป็นห้องว่าง',
  voided: 'ยกเลิกใบแจ้งหนี้แล้ว',
  missing: 'กรอกข้อมูลไม่ครบ',
  room_taken: 'ห้องนี้มีผู้เช่าอยู่แล้ว',
  no_building: 'กรุณาเพิ่มข้อมูลอาคารก่อน',
  no_rooms: 'ยังไม่มีห้องพักในอาคารนี้',
  nothing_to_bill: 'ไม่มีสัญญาที่ต้องออกบิลในรอบนี้',
  duplicate: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว',
  amount_invalid: 'จำนวนเงินไม่ถูกต้อง',
};

export function flashOf(c: Ctx): { kind: 'ok' | 'err' | 'warn'; text: string } | null {
  const ok = c.req.query('m');
  const err = c.req.query('e');
  if (ok) return { kind: 'ok', text: MESSAGES[ok] ?? ok };
  if (err) return { kind: 'err', text: MESSAGES[err] ?? err };
  return null;
}

/** Common props every authenticated page needs. */
export function page(c: Ctx, title: string) {
  return {
    t: c.get('t'),
    user: c.get('user'),
    locale: c.get('locale'),
    path: new URL(c.req.url).pathname,
    flash: flashOf(c),
    title,
  };
}

export function back(c: Ctx, path: string, msg?: string, isError = false) {
  const q = msg ? `${path.includes('?') ? '&' : '?'}${isError ? 'e' : 'm'}=${msg}` : '';
  return c.redirect(path + q, 303);
}
