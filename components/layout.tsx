"use client";

import Sidebar from "./sidebar";
import Topbar from "./topbar";
import { usePathname } from "next/navigation";

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-gray-100">
      <Sidebar variant={pathname === "/shipments" ? "white" : "navy"} />
      <Topbar />
      <main className="ml-64 p-6 flex-1">{children}</main>
    </div>
  );
}
