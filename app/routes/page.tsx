"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResourceManager,
  type FormField,
  type TableColumn,
} from "@/components/ui/resource-manager";

interface Warehouse {
  warehouse_id: number;
  name: string;
  city: string;
}

interface Route {
  route_id: number;
  origin_warehouse_id: number;
  destination_warehouse_id: number;
  distance_km: number;
  estimated_duration_minutes: number;
  origin_name: string;
  destination_name: string;
}

const INITIAL_FORM = {
  origin_warehouse_id: 1,
  destination_warehouse_id: 2,
  distance_km: 150,
  estimated_duration_minutes: 210,
};

export default function RoutesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadWarehouses = async () => {
      try {
        const response = await fetch("/api/warehouses", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && Array.isArray(data)) setWarehouses(data);
      } catch (error) {
        console.error("Error loading warehouse options:", error);
      }
    };
    void loadWarehouses();
    return () => {
      cancelled = true;
    };
  }, []);

  const fields = useMemo<FormField[]>(() => {
    const options = warehouses.map((warehouse) => ({
      value: warehouse.warehouse_id,
      label: `${warehouse.name} — ${warehouse.city}`,
    }));
    return [
      { name: "origin_warehouse_id", label: "Origin warehouse", type: "select", options },
      { name: "destination_warehouse_id", label: "Destination warehouse", type: "select", options },
      { name: "distance_km", label: "Distance (km)", type: "number", min: 1 },
      { name: "estimated_duration_minutes", label: "Duration (minutes)", type: "number", min: 1 },
    ];
  }, [warehouses]);

  const columns = useMemo<TableColumn<Route>[]>(() => {
    const nameFor = (id: number) =>
      warehouses.find((warehouse) => warehouse.warehouse_id === id)?.name ?? `Warehouse #${id}`;

    return [
      {
        label: "Route",
        cell: (route) => (
          <div>
            <p className="font-medium text-navy-900">Route {route.route_id}</p>
            <p className="text-xs text-slate-500">Karnataka corridor</p>
          </div>
        ),
      },
      {
        label: "Origin → Destination",
        cell: (route) => (
          <span className="text-slate-700">
            {route.origin_name || nameFor(route.origin_warehouse_id)}
            <span className="mx-1.5 text-teal-600">→</span>
            {route.destination_name || nameFor(route.destination_warehouse_id)}
          </span>
        ),
      },
      {
        label: "Distance",
        align: "right",
        cell: (route) => `${Number(route.distance_km).toLocaleString("en-IN")} km`,
      },
      {
        label: "Duration",
        align: "right",
        cell: (route) => `${Number(route.estimated_duration_minutes).toLocaleString("en-IN")} min`,
      },
    ];
  }, [warehouses]);

  return (
    <ResourceManager<Route>
      title="Route Management"
      description="Inter-city corridors used for shipment planning and GPS simulation."
      resourceLabel="Route"
      endpoint="/api/routes"
      idKey="route_id"
      initialForm={INITIAL_FORM}
      fields={fields}
      columns={columns}
      toForm={(route) => ({
        origin_warehouse_id: route.origin_warehouse_id,
        destination_warehouse_id: route.destination_warehouse_id,
        distance_km: route.distance_km,
        estimated_duration_minutes: route.estimated_duration_minutes,
      })}
    />
  );
}
