"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  getInitials,
  getNavigation,
  logout,
  roleLabel,
  useSessionUser,
} from "@/components/sidebar";

export default function Topbar() {
  const user = useSessionUser();
  const router = useRouter();
  const pathname = usePathname();
  const { operations, intelligence } = getNavigation(user?.role);
  const navItems = [...operations, ...intelligence];

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <details className="relative lg:hidden">
          <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 text-navy-900">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </summary>
          <div className="absolute left-0 top-11 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            {user === undefined ? (
              <p className="px-3 py-2 text-sm text-slate-400">Loading…</p>
            ) : (
              navItems.map((item) => (
                <Link key={item.href} href={item.href} className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                  {item.label}
                </Link>
              ))
            )}
          </div>
        </details>

        <div>
          <h1 className="text-base font-bold text-navy-900 sm:text-lg">
            {pathname === "/shipments" ? "Shipment" : "ColdChain Logistics"}
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block">
            {pathname === "/shipments"
              ? "Cold-chain freight tracking across Karnataka"
              : "Monitoring &amp; Risk Analytics"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400 md:flex">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <span>Search shipments...</span>
        </div>

        <Link href="/monitoring" aria-label="View alerts" className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        </Link>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3 sm:pl-4">
          {user === undefined ? (
            <>
              <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" aria-label="Loading account" />
              <div className="hidden space-y-1.5 sm:block">
                <div className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                <div className="h-2.5 w-16 animate-pulse rounded bg-slate-100" />
              </div>
            </>
          ) : (
            <>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
                {getInitials(user?.name)}
              </div>
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-navy-900">
                  {user?.name ?? "Not signed in"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {user ? roleLabel(user.role) : "Sign in to continue"}
                </p>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => void logout(router)}
            aria-label="Logout"
            title="Logout"
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-navy-900"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
