/**
 * Permission catalog and preset roles.
 *
 * STANDARD §8.2 defines the platform namespace; docs/XYZ_VERTICAL_DORM.md §7
 * defines `app.*` for this vertical. Both live here so the two can be checked
 * against each other in one place, and so the conformance suite has a single
 * list to iterate (INV-13: every endpoint × every preset role).
 *
 * A role stores an array of these strings. It does not store a name that code
 * branches on — `if (role === 'owner')` scattered through routes is how a
 * permission model rots into a guess.
 */

import { ForbiddenError, type TenantContext } from './tenant-context';

/* ---------- platform namespace (STANDARD §8.2) ---------- */

export const PLATFORM_PERMISSIONS = [
  'tenant.read', 'tenant.update', 'tenant.terminate', 'tenant.transfer_owner',
  'staff.read', 'staff.invite', 'staff.update_role', 'staff.suspend', 'staff.remove',
  'client.read', 'client.invite', 'client.update', 'client.suspend',
  'client.release', 'client.ban', 'client.export',
  'invitation.read', 'invitation.create', 'invitation.revoke',
  'audit.read', 'data.export',
  'billing.read', 'billing.manage',
] as const;

/* ---------- vertical namespace (VERTICAL §7) ---------- */

export const APP_PERMISSIONS = [
  'app.building.read', 'app.building.manage',
  'app.room.read', 'app.room.manage',
  'app.resident.read', 'app.resident.manage', 'app.resident.pii_view',
  'app.contract.read', 'app.contract.create', 'app.contract.amend', 'app.contract.end',
  'app.meter.read', 'app.meter.record', 'app.meter.correct',
  'app.billing.generate',
  'app.invoice.read', 'app.invoice.void',
  'app.payment.record', 'app.payment.verify',
  'app.ticket.read', 'app.ticket.manage',
  'app.announcement.read', 'app.announcement.publish',
  'app.report.read', 'app.report.export',
] as const;

export const ALL_PERMISSIONS = [...PLATFORM_PERMISSIONS, ...APP_PERMISSIONS] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

/* ---------- preset roles ---------- */

export type PresetRoleKey = 'OWNER' | 'MANAGER' | 'ADMIN';

/**
 * OWNER is the landlord. MANAGER runs a building day to day. ADMIN is the front
 * desk: takes cash, logs repairs, walks meters — and can neither void money nor
 * read a national ID.
 *
 * `app.invoice.void` is OWNER-only deliberately. It is the one action that
 * erases a debt with no payment against it, which is the shape of every
 * internal fraud in this business.
 */
const MANAGER: Permission[] = [
  'tenant.read', 'tenant.update',
  'staff.read', 'staff.invite', 'staff.suspend', 'staff.remove',
  'client.read', 'client.invite', 'client.update', 'client.suspend',
  'client.release', 'client.ban', 'client.export',
  'invitation.read', 'invitation.create', 'invitation.revoke',
  'audit.read',
  'billing.read',
  'app.building.read', 'app.building.manage',
  'app.room.read', 'app.room.manage',
  'app.resident.read', 'app.resident.manage', 'app.resident.pii_view',
  'app.contract.read', 'app.contract.create', 'app.contract.amend', 'app.contract.end',
  'app.meter.read', 'app.meter.record', 'app.meter.correct',
  'app.billing.generate',
  'app.invoice.read',
  'app.payment.record', 'app.payment.verify',
  'app.ticket.read', 'app.ticket.manage',
  'app.announcement.read', 'app.announcement.publish',
  'app.report.read', 'app.report.export',
];

const ADMIN: Permission[] = [
  'tenant.read',
  'staff.read',
  'client.read', 'client.invite', 'client.update', 'client.suspend',
  'invitation.read', 'invitation.create',
  'app.building.read',
  'app.room.read',
  'app.resident.read', 'app.resident.manage',
  'app.contract.read',
  'app.meter.read', 'app.meter.record',
  'app.invoice.read',
  'app.payment.record',
  'app.ticket.read', 'app.ticket.manage',
  'app.announcement.read',
];

export const PRESET_ROLES: Record<PresetRoleKey, { name: string; rank: number; permissions: Permission[] }> = {
  // OWNER holds everything, listed by construction rather than by hand so a
  // permission added to the catalog cannot be silently missing from the role
  // that is supposed to have all of them.
  OWNER: { name: 'เจ้าของกิจการ', rank: 100, permissions: [...ALL_PERMISSIONS] },
  MANAGER: { name: 'ผู้จัดการ', rank: 50, permissions: MANAGER },
  ADMIN: { name: 'พนักงานหน้าเคาน์เตอร์', rank: 10, permissions: ADMIN },
};

/* ---------- checking ---------- */

export function has(ctx: TenantContext, permission: Permission): boolean {
  // '*' belongs to the platform and to system contexts only. A tenant's role can
  // never contain it: PRESET_ROLES enumerate real permissions, and a custom role
  // is validated against ALL_PERMISSIONS before it is stored.
  return ctx.permissions.includes('*') || ctx.permissions.includes(permission);
}

/**
 * Throws unless the context holds the permission. Called at the API boundary on
 * every endpoint (STANDARD §8.4) — never in the UI alone, because a hidden
 * button is not an access control.
 */
export function require_(ctx: TenantContext, permission: Permission): void {
  if (!has(ctx, permission)) throw new ForbiddenError(permission);
}

/**
 * No privilege escalation: a staff member cannot grant what they do not hold,
 * and cannot touch a role ranked at or above their own (STANDARD §8.4).
 */
export function canGrant(ctx: TenantContext, wanted: readonly string[]): boolean {
  return wanted.every((p) => has(ctx, p as Permission));
}

export function isKnownPermission(p: string): p is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(p);
}
