"use client";

import {
  ResourceManager,
  type FormField,
  type TableColumn,
} from "@/components/ui/resource-manager";
import { useSessionUser } from "@/components/sidebar";

interface Customer {
  customer_id: number;
  user_id: number | null;
  name: string;
  company_name: string | null;
  address: string | null;
  phone: string | null;
  username: string | null;
  email: string | null;
}

const INITIAL_FORM = {
  name: "",
  company_name: "",
  phone: "",
  address: "",
  username: "",
  email: "",
  // Blank means "keep current" on edit; new accounts fall back to 123456.
  password: "",
};

const FIELDS: FormField[] = [
  { name: "name", label: "Full name", placeholder: "e.g. FreshFlow Foods" },
  {
    name: "company_name",
    label: "Company name",
    placeholder: "e.g. FreshFlow Foods Pvt Ltd",
    required: false,
  },
  {
    name: "phone",
    label: "Phone",
    placeholder: "e.g. +91-98800-11223",
    required: false,
  },
  {
    name: "address",
    label: "Address",
    placeholder: "e.g. 12 Industrial Estate, Bengaluru, Karnataka",
    required: false,
  },
  { name: "username", label: "Login username", placeholder: "e.g. customer3" },
  {
    name: "email",
    label: "Login email",
    placeholder: "e.g. customer3@coldchain.com",
  },
  {
    name: "password",
    label: "Password",
    type: "password",
    placeholder: "Blank = keep current (new accounts default to 123456)",
    required: false,
  },
];

const COLUMNS: TableColumn<Customer>[] = [
  {
    label: "Customer",
    cell: (customer) => (
      <div>
        <p className="font-medium text-navy-900">{customer.name}</p>
        <p className="text-xs text-slate-500">#{customer.customer_id}</p>
      </div>
    ),
  },
  {
    label: "Company",
    cell: (customer) => customer.company_name ?? "—",
  },
  {
    label: "Phone",
    cell: (customer) => customer.phone ?? "—",
  },
  {
    label: "Login",
    cell: (customer) => (
      <div>
        <p className="font-medium text-slate-700">{customer.username ?? "—"}</p>
        <p className="text-xs text-slate-500">{customer.email ?? ""}</p>
      </div>
    ),
  },
];

export default function CustomersPage() {
  const user = useSessionUser();
  // The API is authoritative; this only hides controls that would fail.
  const canMutate = user != null && user.role !== "CUSTOMER";

  return (
    <ResourceManager<Customer>
      title="Customer Management"
      description="Customer profiles with system logins. Customers only see their own shipments."
      resourceLabel="Customer"
      endpoint="/api/customers"
      idKey="customer_id"
      initialForm={INITIAL_FORM}
      fields={FIELDS}
      columns={COLUMNS}
      toForm={(customer) => ({
        name: customer.name,
        company_name: customer.company_name ?? "",
        phone: customer.phone ?? "",
        address: customer.address ?? "",
        username: customer.username ?? "",
        email: customer.email ?? "",
        // Never prefill the stored hash — blank keeps the current password.
        password: "",
      })}
      canMutate={canMutate}
    />
  );
}
