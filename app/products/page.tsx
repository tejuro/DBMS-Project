"use client";

import { ResourceManager, type FormField, type TableColumn } from "@/components/ui/resource-manager";

interface Product {
  product_id: number;
  name: string;
  category: string;
  min_temp_c: number;
  max_temp_c: number;
  min_humidity: number;
  max_humidity: number;
}

const INITIAL_FORM = {
  name: "",
  category: "",
  min_temp_c: 2,
  max_temp_c: 8,
  min_humidity: 30,
  max_humidity: 70,
};

const FIELDS: FormField[] = [
  { name: "name", label: "Product name", placeholder: "e.g. Vaccines" },
  { name: "category", label: "Category", placeholder: "e.g. Pharmaceuticals" },
  { name: "min_temp_c", label: "Min temperature (°C)", type: "number", step: "any" },
  { name: "max_temp_c", label: "Max temperature (°C)", type: "number", step: "any" },
  { name: "min_humidity", label: "Min humidity (%)", type: "number", step: "any" },
  { name: "max_humidity", label: "Max humidity (%)", type: "number", step: "any" },
];

const COLUMNS: TableColumn<Product>[] = [
  {
    label: "Product",
    cell: (product) => (
      <div>
        <p className="font-medium text-navy-900">{product.name}</p>
        <p className="text-xs text-slate-500">#{product.product_id}</p>
      </div>
    ),
  },
  { label: "Category", cell: (product) => product.category },
  {
    label: "Temperature range",
    cell: (product) => `${product.min_temp_c}°C to ${product.max_temp_c}°C`,
  },
  {
    label: "Humidity range",
    cell: (product) => `${product.min_humidity}% to ${product.max_humidity}%`,
  },
];

export default function ProductsPage() {
  return (
    <ResourceManager<Product>
      title="Product Management"
      description="Storage limits used by the monitoring simulator for violation detection."
      resourceLabel="Product"
      endpoint="/api/products"
      idKey="product_id"
      initialForm={INITIAL_FORM}
      fields={FIELDS}
      columns={COLUMNS}
      toForm={(product) => ({
        name: product.name,
        category: product.category,
        min_temp_c: product.min_temp_c,
        max_temp_c: product.max_temp_c,
        min_humidity: product.min_humidity,
        max_humidity: product.max_humidity,
      })}
    />
  );
}
