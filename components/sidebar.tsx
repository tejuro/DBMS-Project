"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth";

type Role = SessionUser["role"];

type SidebarVariant = "navy" | "white";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const icon = (path: React.ReactNode) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

const operations: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: icon(<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  },
  {
    href: "/shipments",
    label: "Shipments",
    icon: icon(<><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></>),
  },
  {
    href: "/customers",
    label: "Customers",
    icon: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  },
  {
    href: "/products",
    label: "Products",
    icon: icon(<><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>),
  },
  {
    href: "/drivers",
    label: "Drivers",
    icon: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>),
  },
  {
    href: "/vehicles",
    label: "Vehicles",
    icon: icon(<><rect x="2" y="6" width="20" height="11" rx="2" /><path d="M2 11h20" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>),
  },
  {
    href: "/warehouses",
    label: "Warehouses",
    icon: icon(<><path d="M3 21V8l9-5 9 5v13" /><path d="M3 21h18" /><path d="M9 21v-7h6v7" /></>),
  },
  {
    href: "/routes",
    label: "Routes",
    icon: icon(<><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M8.6 17.4C12 15 9 11 12 8.5c2-1.7 3.4-.5 4.5-2" /></>),
  },
];

const intelligence: NavItem[] = [
  {
    href: "/monitoring",
    label: "Monitoring",
    icon: icon(<><path d="M3 12h4l3-8 4 16 3-8h4" /></>),
  },
  {
    href: "/gps-tracking",
    label: "GPS Tracking",
    icon: icon(<><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: icon(<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>),
  },
];

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  DISPATCHER: "Dispatcher",
  CUSTOMER: "Customer",
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/** Customers only get the read-only sections of the workspace. */
export function getNavigation(role: Role | null | undefined) {
  const isCustomer = role === "CUSTOMER";
  return {
    operations: isCustomer
      ? operations.filter((item) => item.href === "/" || item.href === "/shipments")
      : operations,
    intelligence,
  };
}

/**
 * Loads the current session from the server on mount, on route changes and
 * whenever the window regains focus. `undefined` means still loading.
 */
export function useSessionUser(): SessionUser | null | undefined {
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        setUser(null);
        return;
      }
      const data = (await response.json()) as { user?: SessionUser | null };
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [load, pathname]);

  return user;
}

export async function logout(router: ReturnType<typeof useRouter>) {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Clear local state regardless of network errors.
  }
  try {
    localStorage.removeItem("user");
  } catch {
    // Ignore unavailable storage.
  }
  router.push("/auth/signin");
  router.refresh();
}

function NavGroup({
  title,
  items,
  current,
  variant,
}: {
  title: string;
  items: NavItem[];
  current: string;
  variant: SidebarVariant;
}) {
  return (
    <div className="mb-6">
      <p className={`mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] ${variant === "white" ? "text-slate-500" : "text-slate-400"}`}>
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => {
          const active = current === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? variant === "white"
                      ? "bg-green-50 text-green-800"
                      : "bg-white/20 text-white"
                    : variant === "white"
                      ? "text-slate-600 hover:bg-slate-100 hover:text-green-700"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span
                  className={`transition-colors ${active
                    ? variant === "white"
                      ? "text-green-700"
                      : "text-white"
                    : variant === "white"
                      ? "text-teal-600"
                      : "text-teal-300"}`}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Sidebar({
  variant = "navy",
}: { variant?: SidebarVariant } = {}) {
  const user = useSessionUser();
  const router = useRouter();
  const pathname = usePathname();
  const { operations: visibleOperations, intelligence: visibleIntelligence } =
    getNavigation(user?.role);

  const isWhite = variant === "white";
  const baseBg = isWhite ? "bg-white" : "bg-navy-900";
  const baseText = isWhite ? "text-slate-900" : "text-white";
  const borderColor = isWhite ? "border-slate-200" : "border-white/10";

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto ${baseBg} ${baseText} lg:flex`}>
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500 text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2v20" />
            <path d="M2 12h20" />
            <path d="M4.9 4.9l14.2 14.2" />
            <path d="M19.1 4.9L4.9 19.1" />
          </svg>
        </div>
        <div>
          <p className="text-base font-bold leading-tight tracking-tight">ColdChain</p>
          <p className="text-[11px] uppercase tracking-widest text-teal-300">Logistics Suite</p>
        </div>
      </div>

      <nav className="flex-1 px-3 pb-4">
        {user === undefined ? (
          <div className="space-y-2 px-3 py-4" aria-label="Loading navigation">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="h-8 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        ) : (
          <>
            <NavGroup
              title="Operations"
              items={visibleOperations}
              current={pathname}
              variant={isWhite ? "white" : "navy"}
            />
            <NavGroup
              title="Intelligence"
              items={visibleIntelligence}
              current={pathname}
              variant={isWhite ? "white" : "navy"}
            />
          </>
        )}
      </nav>

      <div className={`border-t ${borderColor} px-6 py-5`}>
        {user === undefined ? (
          <div className="flex items-center gap-3" aria-label="Loading account">
            <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
              <div className="h-2.5 w-20 animate-pulse rounded bg-white/5" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">
              {getInitials(user?.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${baseText}`}>
                {user?.name ?? "Not signed in"}
              </p>
              <p className={`truncate text-xs ${isWhite ? "text-slate-500" : "text-slate-400"}`}>
                {user ? `${roleLabel(user.role)} · ${user.email ?? user.username}` : "Sign in to continue"}
              </p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void logout(router)}
          className={`mt-4 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${isWhite ? "text-slate-600 hover:bg-slate-100 hover:text-green-700" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          Logout
        </button>
      </div>
    </aside>
  );
}
