'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  BellDot,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Disc3,
  LayoutGrid,
  LogOut,
  Receipt,
  Settings,
  Users,
} from 'lucide-react';
import { signOut } from '../lib/supabase/actions';

const navGroups = [
  {
    label: 'Tagesgeschäft',
    items: [
      { label: 'Übersicht', icon: LayoutGrid, href: '/' },
      { label: 'Werkstatt & Betrieb', icon: ClipboardCheck, href: '/werkstatt' },
      { label: 'Termine', icon: CalendarDays, href: '/termine' },
      { label: 'Finanzen & Zahlungen', icon: CreditCard, href: '/finanzen' },
      { label: 'Kunden & Fahrzeuge', icon: Users, href: '/kunden' },
      { label: 'Wiedervorlage / TÜV', icon: BellDot, href: '/tuv' },
    ],
  },
  {
    label: 'Lager & Verwaltung',
    items: [
      { label: 'Reifenlager', icon: Disc3, href: '/reifenlager' },
      { label: 'Bestand & Berichte', icon: Boxes, href: '/bestand' },
      { label: 'Einstellungen', icon: Settings, href: '/einstellungen' },
      { label: 'Abo', icon: Receipt, href: '/abo' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full shrink-0 bg-slate-900 text-slate-300 md:sticky md:top-0 md:flex md:h-full md:w-[248px] md:flex-col md:overflow-y-auto">
      <div className="flex h-16 items-center gap-2.5 px-5">
        {/* Flat mark: a plate outline, the product's signature */}
        <span aria-hidden className="flex h-5 w-7 items-stretch overflow-hidden rounded-[3px] border border-slate-500">
          <span className="w-1.5 bg-accent-500" />
        </span>
        <span className="text-[17px] font-medium text-slate-50">WerkPilot</span>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:overflow-visible md:pb-0 md:pt-2">
        {navGroups.map((group) => (
          <div key={group.label} className="flex gap-1 md:mb-6 md:block md:space-y-0.5">
            <p className="hidden px-2 pb-2 text-xs text-slate-500 md:block">{group.label}</p>
            {group.items.map(({ label, icon: Icon, href }) => {
              const isActive = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`group relative flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-2 text-sm transition-colors md:w-full ${
                    isActive
                      ? 'bg-slate-800 text-slate-50 ring-1 ring-inset ring-white/[0.06]'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  {isActive && <span aria-hidden className="absolute -left-3 top-2 hidden h-5 w-[3px] rounded-r bg-accent-500 md:block" />}
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-300'}`} strokeWidth={1.75} />
                  <span className="whitespace-nowrap">{label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <form action={signOut} className="px-3 pb-4 md:mt-auto md:border-t md:border-white/[0.06] md:pt-3">
        <button
          className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2 text-left text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
          type="submit"
        >
          <LogOut className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          <span>Abmelden</span>
        </button>
      </form>
    </aside>
  );
}
