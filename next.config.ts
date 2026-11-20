import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/shipments", destination: "/shipments/api" },
      { source: "/api/customers", destination: "/customers/api" },
      { source: "/api/customers/:id", destination: "/customers/api/:id" },
      { source: "/api/products", destination: "/products/api" },
      { source: "/api/drivers", destination: "/drivers/api" },
      { source: "/api/vehicles", destination: "/vehicles/api" },
      { source: "/api/warehouses", destination: "/warehouses/api" },
      { source: "/api/routes", destination: "/routes/api" },
      { source: "/api/monitoring", destination: "/monitoring/api" },
      { source: "/api/monitoring/generate", destination: "/monitoring/api" },
      { source: "/api/monitoring/readings", destination: "/monitoring/api" },
      { source: "/api/monitoring/alerts", destination: "/monitoring/alerts" },
      { source: "/api/monitoring/gps-telemetry", destination: "/monitoring/gps-telemetry" },
      { source: "/api/analytics", destination: "/analytics/api" },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
