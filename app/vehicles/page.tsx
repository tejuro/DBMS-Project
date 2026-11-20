"use client";

import { ResourceManager, type FormField, type TableColumn } from "@/components/ui/resource-manager";

interface Vehicle {
  vehicle_id: number;
  reg_no: string;
  vehicle_type: string;
  capacity_kg: number;
  status: string;
}

const INITIAL_FORM = {
  reg_no: "",
  vehicle_type: "Reefer Truck",
  capacity_kg: 5000,
  status: "AVAILABLE",
};

const FIELDS: FormField[] = [
  { name: "reg_no", label: "Registration number", placeholder: "e.g. KA-01-AB-1234" },
  { name: "vehicle_type", label: "Vehicle type", placeholder: "e.g. Reefer Truck" },
  { name: "capacity_kg", label: "Capacity (kg)", type: "number", min: 1 },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "AVAILABLE", label: "AVAILABLE" },
      { value: "IN_USE", label: "IN_USE" },
      { value: "MAINTENANCE", label: "MAINTENANCE" },
    ],
  },
];

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value === "available") return "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800";
  if (value === "in_use") return "rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800";
  return "rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800";
}

const COLUMNS: TableColumn<Vehicle>[] = [
  {
    label: "Vehicle",
    cell: (vehicle) => (
      <div>
        <p className="font-medium text-navy-900">{vehicle.reg_no}</p>
        <p className="text-xs text-slate-500">#{vehicle.vehicle_id}</p>
      </div>
    ),
  },
  { label: "Type", cell: (vehicle) => vehicle.vehicle_type },
  {
    label: "Capacity",
    align: "right",
    cell: (vehicle) => `${Number(vehicle.capacity_kg).toLocaleString("en-IN")} kg`,
  },
  {
    label: "Status",
    cell: (vehicle) => <span className={statusClass(vehicle.status)}>{vehicle.status}</span>,
  },
];

export default function VehiclesPage() {
  return (
    <ResourceManager<Vehicle>
      title="Vehicle Management"
      description="Fleet available for cold-chain dispatch across Karnataka."
      resourceLabel="Vehicle"
      endpoint="/api/vehicles"
      idKey="vehicle_id"
      initialForm={INITIAL_FORM}
      fields={FIELDS}
      columns={COLUMNS}
      toForm={(vehicle) => ({
        reg_no: vehicle.reg_no,
        vehicle_type: vehicle.vehicle_type,
        capacity_kg: vehicle.capacity_kg,
        status: vehicle.status,
      })}
    />
  );
}
