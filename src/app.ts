import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Locale, T } from './lib/i18n';
import type { TenantContext } from './lib/tenant-context';
import type { Account, MembershipSummary } from './repo/identity';
import type { IdentityRepo } from './repo/identity';
import type { Repos } from './repo';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    t: T;
    locale: Locale;
    /** Global tables: accounts, sessions, provisioning. No tenant scope. */
    identity: IdentityRepo;
    /** Everything tenant-scoped. Every call takes `tctx` as its first argument. */
    repos: Repos;
    /** The signed-in person. */
    account: Account;
    /**
     * The resolved tenant. Built server-side from membership and immutable for
     * the request — see `src/repo/identity.ts` resolve(). Nothing else may
     * construct one, and no route may read a tenant_id from anywhere else.
     */
    tctx: TenantContext;
    /** Every tenant this account can act in. Always an array (STANDARD §9.4). */
    memberships: MembershipSummary[];
  };
};

export type Ctx = Context<AppEnv>;

export const route = () => new Hono<AppEnv>();

/**
 * Permission gate for a route. Throws ForbiddenError, which the error handler
 * renders as 403 — except for anything reached by id, where the repo has
 * already answered 404 first.
 */
export { require_ as requirePermission } from './lib/perm';

/** Flash codes carried across redirects as `?m=` / `?e=`. */
export const MESSAGES: Record<string, string> = {
  saved: 'บันทึกเรียบร้อย',
  deleted: 'ลบเรียบร้อย',
  meters_saved: 'บันทึกเลขมิเตอร์เรียบร้อย',
  billed: 'ออกบิลเรียบร้อย',
  already_billed: 'รอบบิลนี้ออกบิลไปแล้ว ระบบข้ามใบที่ซ้ำ',
  paid: 'บันทึกการชำระเงินเรียบร้อย',
  verified: 'ยืนยันการชำระเรียบร้อย ยอดค้างถูกหักแล้ว',
  invite_created: 'สร้าง QR ผูกห้องเรียบร้อย',
  invite_revoked: 'ยกเลิกรหัสเรียบร้อย QR เดิมใช้ไม่ได้แล้ว',
  invite_not_active: 'สร้าง QR ได้เฉพาะสัญญาที่ยังอยู่ระหว่างเช่า',
  checked_out: 'บันทึกการย้ายออกเรียบร้อย ห้องกลับเป็นห้องว่าง',
  voided: 'ยกเลิกใบแจ้งหนี้แล้ว',
  published: 'เผยแพร่ประกาศแล้ว ผู้เช่าในอาคารเห็นได้ทันที',
  unpublished: 'ยกเลิกการเผยแพร่แล้ว ประกาศกลับเป็นฉบับร่าง',
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
  const account = c.get('account');
  return {
    t: c.get('t'),
    // The layout wants a name and a role label, not an identity record.
    user: { id: account.account_id, name: account.display_name ?? '', role: roleLabel(c) },
    locale: c.get('locale'),
    path: new URL(c.req.url).pathname,
    flash: flashOf(c),
    title,
  };
}

/**
 * What to show next to the person's name. Derived from the resolved membership,
 * never from a column on the account — an account has no role, because the same
 * person may be an owner in one business and a resident in another.
 */
function roleLabel(c: Ctx): string {
  const tctx = c.get('tctx');
  const membership = c.get('memberships')?.find((m) => m.tenant_id === tctx?.tenantId);
  return membership?.role_key ?? '';
}

export function back(c: Ctx, path: string, msg?: string, isError = false) {
  const q = msg ? `${path.includes('?') ? '&' : '?'}${isError ? 'e' : 'm'}=${msg}` : '';
  return c.redirect(path + q, 303);
}
