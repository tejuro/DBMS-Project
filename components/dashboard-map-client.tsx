"use client";

import dynamic from "next/dynamic";

const DashboardMap = dynamic(() => import("@/components/dashboard-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-400">
      Loading map…
    </div>
  ),
});

type DashboardMapClientProps = {
  warehouses: Array<{ name: string; city: string; latitude: number; longitude: number }>;
  shipments: Array<{ shipment_id: number; status: string; latitude?: number | null; longitude?: number | null }>;
  className?: string;
};

export default function DashboardMapClient({
  warehouses = [],
  shipments = [],
  className,
}: DashboardMapClientProps) {
  return (
    <DashboardMap
      warehouses={warehouses}
      shipments={shipments}
      className={className}
    />
  );
}
