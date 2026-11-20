"use client";

import { ResourceManager, type FormField, type TableColumn } from "@/components/ui/resource-manager";

interface Driver {
  driver_id: number;
  user_id: number | null;
  name: string;
  license_no: string;
  phone: string;
  status: string;
}

const INITIAL_FORM = {
  name: "",
  license_no: "",
  phone: "",
  status: "AVAILABLE",
};

const FIELDS: FormField[] = [
  { name: "name", label: "Full name", placeholder: "e.g. Ramesh Kumar" },
  { name: "license_no", label: "License number", placeholder: "e.g. KA-2019-004321" },
  { name: "phone", label: "Phone", placeholder: "e.g. 9876543210" },
  {
    name: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "AVAILABLE", label: "AVAILABLE" },
      { value: "BUSY", label: "BUSY" },
      { value: "MAINTENANCE", label: "MAINTENANCE" },
    ],
  },
];

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value === "available") return "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800";
  if (value === "busy") return "rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800";
  return "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700";
}

const COLUMNS: TableColumn<Driver>[] = [
  {
    label: "Driver",
    cell: (driver) => (
      <div>
        <p className="font-medium text-navy-900">{driver.name}</p>
        <p className="text-xs text-slate-500">#{driver.driver_id}</p>
      </div>
    ),
  },
  { label: "License", cell: (driver) => driver.license_no },
  { label: "Phone", cell: (driver) => driver.phone },
  {
    label: "Status",
    cell: (driver) => <span className={statusClass(driver.status)}>{driver.status}</span>,
  },
];

export default function DriversPage() {
  return (
    <ResourceManager<Driver>
      title="Driver Management"
      description="Driver profiles only — drivers do not have system logins."
      resourceLabel="Driver"
      endpoint="/api/drivers"
      idKey="driver_id"
      initialForm={INITIAL_FORM}
      fields={FIELDS}
      columns={COLUMNS}
      toForm={(driver) => ({
        name: driver.name,
        license_no: driver.license_no,
        phone: driver.phone,
        status: driver.status,
      })}
    />
  );
}
