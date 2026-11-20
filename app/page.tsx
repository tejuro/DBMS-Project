import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDashboardData, type TrendPoint } from "@/lib/dashboard-data";
import DashboardMapClient from "@/components/dashboard-map-client";

export const dynamic = "force-dynamic";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KpiCard({
  label,
  value,
  hint,
  accent,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-navy-900">{value}</p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accent}`}>
          {icon}
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-navy-900">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? (
          <Link href={action.href} className="shrink-0 text-xs font-semibold text-teal-700 hover:underline">
            {action.label}
          </Link>
        ) : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Sparkline({ points, color }: { points: TrendPoint[]; color: string }) {
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">No sensor readings available.</p>;
  }
  if (points.length === 1) {
    return (
      <div className="flex h-40 flex-col items-center justify-center rounded-xl bg-slate-50">
        <p className="text-3xl font-bold" style={{ color }}>{points[0].value.toFixed(1)}</p>
        <p className="mt-1 text-xs text-slate-500">Single reading · {points[0].label}</p>
      </div>
    );
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 480;
  const height = 140;
  const pad = 8;
  const coords = points.map((point, i) => {
    const x = pad + (i / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.value - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Sensor trend">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#e2e8f0" />
        <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((point, i) => {
          const [x, y] = coords[i].split(",");
          return <circle key={`${point.timestamp}-${i}`} cx={x} cy={y} r="3" fill={color} />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{points[0].label}</span>
        <span>
          min {min.toFixed(1)} · max {max.toFixed(1)}
        </span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  // Defense in depth: proxy already checks the signed cookie, this also
  // rejects deactivated accounts / role changes before dashboard data loads.
  if (!(await getSessionUser())) redirect("/auth/signin");

  const data = (await getDashboardData()) ?? {
    mysql: {},
    mongo: {},
    errors: [],
  };
  const { mysql, mongo } = data;

  const maxCount = Math.max(1, ...mysql.statusBreakdown.map((item) => item.count));
  const totalForShare = Math.max(1, mysql.totalShipments);
  const criticalFeed = mongo.alerts.filter(
    (alert) => alert.severity === "CRITICAL" || alert.severity === "HIGH"
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-600">Overview</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
            Operations Dashboard
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Live Karnataka cold-chain status, sensor readings and fleet telemetry.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/shipments" className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700">
            View shipments
          </Link>
          <Link href="/monitoring" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-50">
            Open monitoring
          </Link>
        </div>
      </div>

      {data.errors.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold">Some live data could not be loaded:</p>
          <ul className="mt-1 list-disc pl-5">
            {data.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total shipments" value={String(mysql.totalShipments)} hint="Records in the shipment registry" accent="bg-teal-50 text-teal-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" /><path d="M3 7l9 4 9-4" /></svg>} />
        <KpiCard label="Active shipments" value={String(mysql.activeShipments)} hint="Not yet delivered or cancelled" accent="bg-blue-50 text-blue-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>} />
        <KpiCard label="Delivered" value={String(mysql.deliveredShipments)} hint="Completed deliveries" accent="bg-emerald-50 text-emerald-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>} />
        <KpiCard label="Delayed" value={String(mysql.delayedShipments)} hint="Currently marked DELAYED" accent="bg-amber-50 text-amber-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l4 2" /></svg>} />
        <KpiCard label="Open alerts" value={String(mongo.openAlerts)} hint="Alerts awaiting action" accent="bg-orange-50 text-orange-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /></svg>} />
        <KpiCard label="Critical alerts" value={String(mongo.criticalAlerts)} hint="Highest severity open alerts" accent="bg-red-50 text-red-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4" /><path d="M12 17h.01" /><circle cx="12" cy="12" r="9" /></svg>} />
        <KpiCard label="Avg temperature" value={`${mongo.averageTemperature.toFixed(1)} °C`} hint="Across all stored readings (see product context below)" accent="bg-sky-50 text-sky-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z" /></svg>} />
        <KpiCard label="Avg humidity" value={`${mongo.averageHumidity.toFixed(1)} %`} hint="Across all stored readings" accent="bg-teal-50 text-teal-700" icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z" /></svg>} />
      </div>

      <p className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs text-sky-900">
        <strong>Temperature context:</strong> products have different permitted ranges, so the unweighted
        overall average above is not a pass/fail measure. Compare each product average with its own
        MySQL limits in the panel below.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Shipment Activity" subtitle="Distribution by current status" action={{ href: "/analytics", label: "Full analytics" }}>
          {mysql.statusBreakdown.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No shipment data available.</p>
          ) : (
            <div className="space-y-4">
              {mysql.statusBreakdown.map((item) => (
                <div key={item.status} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs font-medium text-slate-600">{item.status}</span>
                  <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="cc-bar h-3 rounded-full bg-teal-500" style={{ width: `${Math.max(6, (item.count / maxCount) * 100)}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs font-semibold text-navy-900">
                    {item.count} ({Math.round((item.count / totalForShare) * 100)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Temperature & Humidity" subtitle="Latest stored sensor readings (simulated data)" action={{ href: "/monitoring", label: "Live monitoring" }}>
          {mongo.readings.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No sensor readings available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 font-semibold">Shipment</th>
                    <th className="pb-2 font-semibold">Sensor</th>
                    <th className="pb-2 font-semibold">Temperature</th>
                    <th className="pb-2 font-semibold">Humidity</th>
                    <th className="pb-2 font-semibold">Recorded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mongo.readings.slice(0, 8).map((reading) => {
                    const product = mysql.products.find((p) => p.product_id === reading.product_id);
                    const outOfRange = product && (reading.temperature < product.min_temp_c || reading.temperature > product.max_temp_c);
                    return (
                      <tr key={reading.id} className="text-slate-700">
                        <td className="py-2 font-medium text-navy-900">#{reading.shipment_id}</td>
                        <td className="py-2">{reading.sensor_id}</td>
                        <td className="py-2">
                          <span className={outOfRange ? "font-semibold text-red-600" : "font-semibold text-teal-700"}>
                            {Number.isFinite(reading.temperature) ? reading.temperature.toFixed(1) : "—"} °C
                          </span>
                        </td>
                        <td className="py-2">{Number.isFinite(reading.humidity) ? reading.humidity.toFixed(1) : "—"}%</td>
                        <td className="py-2 text-slate-400">{formatTime(reading.timestamp)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Temperature trend" subtitle="Chronological sensor readings">
          <Sparkline points={mongo.temperatureTrend} color="#0ea5e9" />
        </Panel>
        <Panel title="Humidity trend" subtitle="Chronological sensor readings">
          <Sparkline points={mongo.humidityTrend} color="#0d9488" />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Critical alert feed" subtitle="Open high-severity alerts" action={{ href: "/monitoring", label: "View all" }}>
          {criticalFeed.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No critical or high alerts.</p>
          ) : (
            <div className="space-y-3">
              {criticalFeed.map((alert) => (
                <div key={alert.id} className="rounded-xl border border-red-100 bg-red-50/60 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-red-700">{alert.severity}</span>
                    <span className="text-[11px] text-slate-500">{formatTime(alert.detected_at)}</span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-navy-900">{alert.message}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{alert.alert_type} · Shipment #{alert.shipment_id}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent shipment activity" subtitle="MySQL status history" action={{ href: "/shipments", label: "Manage shipments" }}>
          {mysql.recentActivity.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No status history recorded.</p>
          ) : (
            <div className="space-y-3">
              {mysql.recentActivity.map((entry, index) => (
                <div key={`${entry.shipment_id}-${entry.changed_at}-${index}`} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-navy-900">
                      Shipment #{entry.shipment_id}: {entry.to_status.replaceAll("_", " ")}
                    </p>
                    <p className="text-[11px] text-slate-500">{entry.remarks || "Status updated"}</p>
                    <p className="text-[10px] text-slate-400">{formatTime(entry.changed_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Product temperature context" subtitle="Range-aware averages from MySQL limits">
          {mongo.temperatureContext.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No product data available.</p>
          ) : (
            <div className="space-y-2">
              {mongo.temperatureContext.map((product) => (
                <div key={product.product_id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
                  <span className="font-medium text-navy-900">{product.name}</span>
                  <span className="text-slate-500">
                    {product.min_temp_c}–{product.max_temp_c} °C
                  </span>
                  <span className="font-semibold text-teal-700">
                    {product.average_temperature == null ? "—" : `${product.average_temperature.toFixed(1)} °C`}
                  </span>
                  <span className={product.excursion_count > 0 ? "font-semibold text-red-600" : "text-slate-400"}>
                    {product.excursion_count} exc.
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Karnataka Shipment Tracking Preview" subtitle="Warehouse and shipment locations" action={{ href: "/gps-tracking", label: "Open map" }}>
          <DashboardMapClient
            warehouses={data?.mysql?.warehouses ?? []}
            shipments={(data?.mysql?.shipments ?? []).map((s) => {
              const gps = mongo.gps.find((g) => g.shipment_id === s.shipment_id);
              return {
                shipment_id: s.shipment_id,
                status: s.status,
                latitude: gps?.latitude ?? null,
                longitude: gps?.longitude ?? null,
              };
            })}
          />
          <p className="mt-3 text-xs text-slate-600">
            {(mongo.gps?.length ?? 0)} telemetry points · {(data?.mysql?.warehouses?.length ?? 0)} warehouses
          </p>
        </Panel>

        <Panel title="Warehouse Network" subtitle="Karnataka cold-storage locations from MySQL" action={{ href: "/warehouses", label: "View warehouses" }}>
          {mysql.warehouses.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No warehouses recorded.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {mysql.warehouses.map((warehouse) => (
                <div key={warehouse.name} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21V8l9-5 9 5v13" /><path d="M3 21h18" /></svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-navy-900">{warehouse.name}</p>
                    <p className="text-[11px] text-slate-500">{warehouse.city}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {Number.isFinite(warehouse.latitude) ? warehouse.latitude.toFixed(4) : "—"}, {Number.isFinite(warehouse.longitude) ? warehouse.longitude.toFixed(4) : "—"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
