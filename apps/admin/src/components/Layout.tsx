import {
  Banknote,
  ClipboardList,
  LifeBuoy,
  Megaphone,
  ShoppingBag,
  FileUp,
  FolderTree,
  Gauge,
  History,
  Image,
  LogOut,
  ScrollText,
  Settings,
  ShieldCheck,
  Swords,
  Trophy,
  Users,
  Wallet,
  ScanEye,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { can, getSession, logout } from '../lib/api';
import { cx } from './ui';

const NAV: { group: string; items: { to: string; label: string; icon: typeof Gauge; perm: string }[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: Gauge, perm: 'dashboard.view' }] },
  {
    group: 'Content',
    items: [
      { to: '/questions', label: 'Questions', icon: ScrollText, perm: 'content.read' },
      { to: '/questions/import', label: 'Bulk upload', icon: FileUp, perm: 'content.write' },
      { to: '/taxonomy', label: 'Exams & subjects', icon: FolderTree, perm: 'content.read' },
      { to: '/tests', label: 'Tests', icon: ClipboardList, perm: 'content.read' },
      { to: '/store', label: 'Test series & coupons', icon: ShoppingBag, perm: 'content.read' },
    ],
  },
  {
    group: 'Competition',
    items: [
      { to: '/tournaments', label: 'Tournaments', icon: Trophy, perm: 'tournament.read' },
      { to: '/duels', label: 'Duels & bots', icon: Swords, perm: 'tournament.read' },
      { to: '/proctoring', label: 'Proctoring', icon: ScanEye, perm: 'proctor.view' },
    ],
  },
  {
    group: 'App',
    items: [
      { to: '/cms', label: 'Home screen', icon: Image, perm: 'tournament.read' },
      { to: '/users', label: 'Students', icon: Users, perm: 'users.read' },
      { to: '/support', label: 'Support & FAQs', icon: LifeBuoy, perm: 'support.read' },
      { to: '/notifications', label: 'Notifications', icon: Megaphone, perm: 'support.read' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'config.read' },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/finance', label: 'Finance', icon: Banknote, perm: 'finance.read' },
      { to: '/wallet', label: 'Wallet & rewards', icon: Wallet, perm: 'wallet.read' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { to: '/admins', label: 'Admins & roles', icon: ShieldCheck, perm: 'admins.manage' },
      { to: '/audit', label: 'Audit log', icon: History, perm: 'audit.read' },
    ],
  },
];

export function Layout() {
  const admin = getSession()?.admin;
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink text-gray-300 md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 font-extrabold text-white">T</div>
          <div>
            <p className="text-base font-extrabold leading-none text-white">Testwise</p>
            <p className="text-[10px] font-semibold tracking-widest text-gray-400">CONTROL CENTER</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map((g) => {
            const items = g.items.filter((i) => can(i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group} className="mt-4">
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">{g.group}</p>
                {items.map((i) => (
                  <NavLink
                    key={i.to}
                    to={i.to}
                    end={i.to === '/' || i.to === '/questions' || i.to === '/tests'}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                        isActive && !i.to.includes('#') ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    <i.icon size={16} />
                    {i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-semibold text-white">{admin?.name}</p>
          <p className="truncate text-xs text-gray-400">{admin?.role.replace('_', ' ')}</p>
          <button onClick={() => void logout()} className="mt-3 flex items-center gap-2 text-xs text-gray-400 hover:text-white">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
