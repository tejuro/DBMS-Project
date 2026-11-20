"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PIE_COLORS = ["#0d9488", "#0f766e", "#f59e0b", "#ef4444", "#6366f1", "#94a3b8"];

type KPIs = {
  total_shipments: number;
  active_shipments: number;
  delivered_shipments: number;
  delayed_shipments: number;
  critical_alerts: number;
  open_alerts: number;
  average_temperature: number;
  average_humidity: number;
  reading_count: number;
};

type ProductContext = {
  product_id: number;
  name: string;
  min_temp_c: number;
  max_temp_c: number;
  average_temperature: number | null;
  reading_count: number;
  excursion_count: number;
};

type StatusRow = { status: string; count: number };
type LabelCount = { label: string; count: number };
type ViolationReport = {
  alert_id: string;
  shipment_id: number;
  product_name: string;
  alert_type: string;
  severity: string;
  status: string;
  temperature: number | null;
  humidity: number | null;
  detected_at: string;
};
type RoutePerformance = {
  route_id: number;
  origin: string;
  destination: string;
  distance_km: number;
  shipment_count: number;
  delivered: number;
  on_time: number;
  average_duration: number;
  duration_source: string;
  on_time_rate: number | null;
};
type Overview = {
  by_customer: LabelCount[];
  by_route: LabelCount[];
  by_driver: LabelCount[];
  by_vehicle: LabelCount[];
  severity_distribution: LabelCount[];
  alert_type_distribution: LabelCount[];
  delivery_performance: {
    total: number;
    delivered: number;
    delayed: number;
    on_time: number;
    on_time_rate: number | null;
    average_duration_minutes: number | null;
  };
};

const EMPTY_KPIS: KPIs = {
  total_shipments: 0,
  active_shipments: 0,
  delivered_shipments: 0,
  delayed_shipments: 0,
  critical_alerts: 0,
  open_alerts: 0,
  average_temperature: 0,
  average_humidity: 0,
  reading_count: 0,
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function fmt(value: number | null | undefined, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h3 className="text-sm font-bold text-navy-900">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{message}</p>;
}

function CountTable({ rows, empty }: { rows: LabelCount[]; empty: string }) {
  if (rows.length === 0) return <Empty message={empty} />;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-xs font-medium text-slate-600" title={row.label}>
            {row.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-2.5 rounded-full bg-teal-500"
              style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs font-semibold text-navy-900">
            {row.count}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [kpis, setKpis] = useState<KPIs>(EMPTY_KPIS);
  const [productContext, setProductContext] = useState<ProductContext[]>([]);
  const [contextNote, setContextNote] = useState("");
  const [statusDistribution, setStatusDistribution] = useState<StatusRow[]>([]);
  const [violationReports, setViolationReports] = useState<ViolationReport[]>([]);
  const [routePerformance, setRoutePerformance] = useState<RoutePerformance[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  async function load<T>(url: string, label: string, fallback: T): Promise<T> {
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      setErrors((prev) => [
        ...prev,
        `${label}: ${error instanceof Error ? error.message : "request failed"}`,
      ]);
      return fallback;
    }
  }

  useEffect(() => {
    let active = true;
    setErrors([]);
    (async () => {
      const [kpiData, status, reports, routes, overviewData] = await Promise.all([
        load<{ kpis?: Partial<KPIs>; temperature_context?: { note?: string; products?: ProductContext[] } }>(
          "/api/analytics",
          "KPIs",
          {}
        ),
        load<StatusRow[]>("/api/analytics/shipments-by-status", "Status distribution", []),
        load<ViolationReport[]>("/api/analytics/violation-reports", "Alert reports", []),
        load<RoutePerformance[]>("/api/analytics/route-performance", "Route performance", []),
        load<Overview>("/api/analytics/overview", "Overview breakdowns", {} as Overview),
      ]);
      if (!active) return;
      setKpis({ ...EMPTY_KPIS, ...(kpiData.kpis || {}) });
      setProductContext(asArray<ProductContext>(kpiData.temperature_context?.products));
      setContextNote(kpiData.temperature_context?.note || "");
      setStatusDistribution(asArray<StatusRow>(status).filter((s) => !!s.status));
      setViolationReports(asArray<ViolationReport>(reports));
      setRoutePerformance(asArray<RoutePerformance>(routes));
      setOverview(overviewData && overviewData.delivery_performance ? overviewData : null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const statusChartData = statusDistribution.map((item) => ({
    name: item.status.replaceAll("_", " "),
    count: item.count,
  }));
  const severityChartData = (overview?.severity_distribution || []).map((item) => ({
    name: item.label,
    value: item.count,
  }));
  const performance = overview?.delivery_performance;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-600">Intelligence</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
          Risk & Performance Analytics
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Aggregated from MySQL shipment records and MongoDB monitoring documents.
        </p>
      </div>

      {errors.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold">Some analytics could not be loaded:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Loading analytics…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Total shipments", value: kpis.total_shipments, tone: "text-navy-900" },
              { label: "Active", value: kpis.active_shipments, tone: "text-teal-700" },
              { label: "Delivered", value: kpis.delivered_shipments, tone: "text-emerald-600" },
              { label: "Delayed", value: kpis.delayed_shipments, tone: "text-amber-600" },
              { label: "Open alerts", value: kpis.open_alerts, tone: "text-orange-600" },
              { label: "Critical alerts", value: kpis.critical_alerts, tone: "text-red-600" },
              { label: "Avg temperature", value: `${fmt(kpis.average_temperature)} °C`, tone: "text-sky-600" },
              { label: "Avg humidity", value: `${fmt(kpis.average_humidity)} %`, tone: "text-teal-700" },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                <p className={`mt-2 text-2xl font-bold tracking-tight ${card.tone}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {contextNote ? (
            <p className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-900">
              {contextNote} Based on {kpis.reading_count} stored sensor readings.
            </p>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Shipment status distribution" subtitle="MySQL shipment records">
              {statusChartData.length === 0 ? (
                <Empty message="No shipment data available" />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusChartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="Shipments" fill="#0d9488" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>

            <Panel title="Alert severity" subtitle="MongoDB alert documents">
              {severityChartData.length === 0 ? (
                <Empty message="No alerts recorded" />
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={severityChartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label
                      >
                        {severityChartData.map((entry, index) => (
                          <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            <Panel title="By customer" subtitle="Shipment counts">
              <CountTable rows={asArray<LabelCount>(overview?.by_customer)} empty="No customer data" />
            </Panel>
            <Panel title="By route" subtitle="Karnataka corridors">
              <CountTable rows={asArray<LabelCount>(overview?.by_route)} empty="No route data" />
            </Panel>
            <Panel title="By driver" subtitle="Driver profiles">
              <CountTable rows={asArray<LabelCount>(overview?.by_driver)} empty="No driver data" />
            </Panel>
            <Panel title="By vehicle" subtitle="Fleet assignment">
              <CountTable rows={asArray<LabelCount>(overview?.by_vehicle)} empty="No vehicle data" />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Delivery performance" subtitle="Actual delivery timestamps">
              {!performance ? (
                <Empty message="No delivery data available" />
              ) : (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">On-time rate</p>
                    <p className="mt-1 text-2xl font-bold text-teal-700">
                      {performance.on_time_rate == null ? "—" : `${performance.on_time_rate}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Delivered / total</p>
                    <p className="mt-1 text-2xl font-bold text-navy-900">
                      {performance.delivered} / {performance.total}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Delayed shipments</p>
                    <p className="mt-1 text-xl font-semibold text-amber-600">{performance.delayed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Average delivery duration</p>
                    <p className="mt-1 text-xl font-semibold text-navy-900">
                      {performance.average_duration_minutes == null
                        ? "—"
                        : `${fmt(performance.average_duration_minutes, 0)} min`}
                    </p>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Temperature context by product" subtitle="Range-aware averages and excursions">
              {productContext.length === 0 ? (
                <Empty message="No product readings available" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr className="border-b border-slate-100">
                        <th className="pb-2 font-semibold">Product</th>
                        <th className="pb-2 font-semibold">Allowed °C</th>
                        <th className="pb-2 font-semibold">Average °C</th>
                        <th className="pb-2 font-semibold">Excursions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {productContext.map((product) => (
                        <tr key={product.product_id} className="text-slate-700">
                          <td className="py-2 font-medium text-navy-900">{product.name}</td>
                          <td className="py-2">
                            {product.min_temp_c} to {product.max_temp_c}
                          </td>
                          <td className="py-2">{fmt(product.average_temperature)}</td>
                          <td className="py-2">
                            <span
                              className={
                                product.excursion_count > 0
                                  ? "font-semibold text-red-600"
                                  : "text-slate-500"
                              }
                            >
                              {product.excursion_count} / {product.reading_count}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Temperature excursions & humidity violations" subtitle="Alert documents from MongoDB">
            {violationReports.length === 0 ? (
              <Empty message="No environmental violations recorded" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 font-semibold">Shipment</th>
                      <th className="pb-2 font-semibold">Product</th>
                      <th className="pb-2 font-semibold">Type</th>
                      <th className="pb-2 font-semibold">Severity</th>
                      <th className="pb-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Temp / Humidity</th>
                      <th className="pb-2 font-semibold">Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {violationReports.map((report) => (
                      <tr key={report.alert_id || `${report.shipment_id}-${report.detected_at}`}>
                        <td className="py-2.5 font-semibold text-navy-900">#{report.shipment_id}</td>
                        <td className="py-2.5">{report.product_name}</td>
                        <td className="py-2.5">{report.alert_type.replaceAll("_", " ")}</td>
                        <td className="py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 font-semibold ${
                              report.severity === "CRITICAL"
                                ? "bg-red-100 text-red-700"
                                : report.severity === "HIGH"
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {report.severity}
                          </span>
                        </td>
                        <td className="py-2.5">{report.status}</td>
                        <td className="py-2.5">
                          {fmt(report.temperature)} °C / {fmt(report.humidity)} %
                        </td>
                        <td className="py-2.5 text-slate-500">{formatDate(report.detected_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Route performance" subtitle="Real delivery outcomes by Karnataka corridor">
            {routePerformance.length === 0 ? (
              <Empty message="No route data available" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 font-semibold">Route</th>
                      <th className="pb-2 font-semibold">Distance</th>
                      <th className="pb-2 font-semibold">Shipments</th>
                      <th className="pb-2 font-semibold">Delivered</th>
                      <th className="pb-2 font-semibold">Avg duration</th>
                      <th className="pb-2 font-semibold">On-time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {routePerformance.map((route) => (
                      <tr key={route.route_id}>
                        <td className="py-2.5 font-medium text-navy-900">
                          {route.origin} → {route.destination}
                        </td>
                        <td className="py-2.5">{route.distance_km} km</td>
                        <td className="py-2.5">{route.shipment_count}</td>
                        <td className="py-2.5">{route.delivered}</td>
                        <td className="py-2.5" title={route.duration_source}>
                          {fmt(route.average_duration, 0)} min
                        </td>
                        <td className="py-2.5 font-semibold text-teal-700">
                          {route.on_time_rate == null ? "—" : `${route.on_time_rate}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
