import type { AdminRole } from './enums';

export const Permission = {
  DASHBOARD_VIEW: 'dashboard.view',
  CONTENT_READ: 'content.read',
  CONTENT_WRITE: 'content.write',
  CONTENT_REVIEW: 'content.review',
  TOURNAMENT_READ: 'tournament.read',
  TOURNAMENT_WRITE: 'tournament.write',
  CMS_WRITE: 'cms.write',
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  CONFIG_READ: 'config.read',
  CONFIG_WRITE: 'config.write',
  AUDIT_READ: 'audit.read',
  ADMINS_MANAGE: 'admins.manage',
  STORE_WRITE: 'store.write',
  FINANCE_READ: 'finance.read',
  FINANCE_WRITE: 'finance.write',
  RESULTS_WRITE: 'results.write',
  SUPPORT_READ: 'support.read',
  SUPPORT_WRITE: 'support.write',
  NOTIFY: 'notify.send',
  WALLET_READ: 'wallet.read',
  WALLET_WRITE: 'wallet.write',
  PROCTOR_VIEW: 'proctor.view',
  PROCTOR_ACT: 'proctor.act',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: ALL,
  OPERATIONS: [
    'dashboard.view',
    'content.read',
    'tournament.read',
    'tournament.write',
    'cms.write',
    'users.read',
    'config.read',
    'audit.read',
    'store.write',
    'results.write',
    'support.read',
    'support.write',
    'notify.send',
    'finance.read',
    'wallet.read',
    'proctor.view',
  ],
  CONTENT: ['dashboard.view', 'content.read', 'content.write', 'content.review', 'tournament.read', 'store.write'],
  FINANCE: ['dashboard.view', 'tournament.read', 'users.read', 'audit.read', 'finance.read', 'finance.write', 'support.read', 'wallet.read', 'wallet.write'],
  FRAUD: ['dashboard.view', 'tournament.read', 'users.read', 'users.write', 'audit.read', 'results.write', 'support.read', 'wallet.read', 'proctor.view', 'proctor.act'],
  SUPPORT: ['dashboard.view', 'tournament.read', 'users.read', 'support.read', 'support.write', 'finance.read', 'wallet.read'],
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
