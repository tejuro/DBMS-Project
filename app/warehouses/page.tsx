"use client";

import { ResourceManager, type FormField, type TableColumn } from "@/components/ui/resource-manager";

interface Warehouse {
  warehouse_id: number;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  is_archived?: number;
}

const INITIAL_FORM = {
  name: "",
  address: "",
  city: "Bengaluru",
  latitude: 12.9716,
  longitude: 77.5946,
};

const FIELDS: FormField[] = [
  { name: "name", label: "Warehouse name", placeholder: "e.g. Bengaluru Cold Hub" },
  { name: "address", label: "Address", placeholder: "e.g. 12 Industrial Estate, Bengaluru" },
  { name: "city", label: "City", placeholder: "e.g. Bengaluru" },
  { name: "latitude", label: "Latitude", type: "number", step: "any", placeholder: "12.9716" },
  { name: "longitude", label: "Longitude", type: "number", step: "any", placeholder: "77.5946" },
];

const COLUMNS: TableColumn<Warehouse>[] = [
  {
    label: "Warehouse",
    cell: (warehouse) => (
      <div>
        <p className="font-medium text-navy-900">{warehouse.name}</p>
        <p className="text-xs text-slate-500">{warehouse.address}</p>
      </div>
    ),
  },
  { label: "City", cell: (warehouse) => warehouse.city },
  {
    label: "Coordinates",
    cell: (warehouse) => (
      <span className="font-mono text-xs text-slate-600">
        {Number(warehouse.latitude).toFixed(4)}, {Number(warehouse.longitude).toFixed(4)}
      </span>
    ),
  },
];

const handleArchive = async (id: number, isArchived: boolean) => {
  const response = await fetch("/api/warehouses", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ warehouse_id: id, is_archived: !isArchived }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Archive failed (HTTP ${response.status})`);
  }
};

export default function WarehousesPage() {
  return (
    <ResourceManager<Warehouse>
      title="Warehouse Management"
      description="Cold-storage hubs and distribution centres across Karnataka."
      resourceLabel="Warehouse"
      endpoint="/api/warehouses"
      idKey="warehouse_id"
      initialForm={INITIAL_FORM}
      fields={FIELDS}
      columns={COLUMNS}
      toForm={(warehouse) => ({
        name: warehouse.name,
        address: warehouse.address,
        city: warehouse.city,
        latitude: warehouse.latitude,
        longitude: warehouse.longitude,
      })}
      emptyMessage="No warehouses found. Add your first warehouse to get started."
      onArchive={handleArchive}
      archiveLabel={(isArchived) => (isArchived ? "Restore" : "Archive")}
    />
  );
}
