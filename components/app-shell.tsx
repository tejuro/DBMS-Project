"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/sidebar";
import Topbar from "@/components/topbar";

/**
 * The sign-in screen is a standalone, full-viewport page. Every other route
 * gets the app chrome (sidebar/topbar). Keeping this decision in one place
 * avoids leftover sidebar padding on the centered sign-in card and stops the
 * client router from prefetching app pages while signed out.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/auth/signin") {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <div className="min-h-screen bg-slate-50 lg:pl-64">
        <Topbar />
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">{children}</main>
      </div>
    </>
  );
}
