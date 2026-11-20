"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCallback, useEffect, useRef, useState } from "react";

interface Shipment {
  shipment_id: number;
  customer_name: string;
  status: string;
  risk_status: string;
}

interface Reading {
  id: string | null;
  shipment_id: number;
  sensor_id: string;
  temperature: number;
  humidity: number;
  timestamp: string;
  source: string;
  product_id: number | null;
  product_name: string | null;
}

interface Alert {
  id: string | null;
  shipment_id: number;
  alert_type: string;
  severity: string;
  message: string;
  status: string;
  detected_at: string;
  acknowledged_at: string | null;
  last_detected_at: string | null;
  resolved_at: string | null;
  product_id: number | null;
  product_name: string | null;
  source: string;
}

interface Threshold {
  shipment_id: number;
  product_id: number;
  name: string;
  min_temp_c: number;
  max_temp_c: number;
  min_humidity: number;
  max_humidity: number;
  reference?: boolean;
}

interface ChartPoint {
  label: string;
  temperature: number;
  humidity: number;
  t: number;
  shipment_id?: number;
  tempMin?: number;
  tempMax?: number;
  humidityMin?: number;
  humidityMax?: number;
  referenceProduct?: string;
}

interface MonitoringResponse {
  readings: Reading[];
  alerts: Alert[];
  thresholds: Threshold[];
  chartData: ChartPoint[];
  riskStatus: string | null;
  simulated: boolean;
}

type Feedback = { kind: "success" | "error"; message: string };

function toFinite(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value: unknown, digits = 1): string {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function normalizeShipment(value: any): Shipment {
  return {
    shipment_id: toFinite(value?.shipment_id),
    customer_name:
      typeof value?.customer_name === "string"
        ? value.customer_name
        : `Shipment ${toFinite(value?.shipment_id)}`,
    status: typeof value?.status === "string" ? value.status : "UNKNOWN",
    risk_status:
      typeof value?.risk_status === "string" ? value.risk_status : "LOW",
  };
}

function normalizeReading(value: any): Reading {
  return {
    id: value?._id ?? value?.id ?? null,
    shipment_id: toFinite(value?.shipment_id),
    sensor_id:
      typeof value?.sensor_id === "string" ? value.sensor_id : "UNKNOWN",
    temperature: toFinite(value?.temperature),
    humidity: toFinite(value?.humidity),
    timestamp:
      typeof value?.timestamp === "string"
        ? value.timestamp
        : value?.timestamp instanceof Date
          ? value.timestamp.toISOString()
          : "",
    source: typeof value?.source === "string" ? value.source : "seed",
    product_id: value?.product_id == null ? null : toFinite(value.product_id),
    product_name:
      typeof value?.product_name === "string" ? value.product_name : null,
  };
}

function normalizeAlert(value: any): Alert {
  return {
    id: value?._id ?? value?.id ?? null,
    shipment_id: toFinite(value?.shipment_id),
    alert_type:
      typeof value?.alert_type === "string" ? value.alert_type : "UNKNOWN",
    severity: typeof value?.severity === "string" ? value.severity : "LOW",
    message: typeof value?.message === "string" ? value.message : "",
    status: typeof value?.status === "string" ? value.status : "OPEN",
    detected_at:
      typeof value?.detected_at === "string"
        ? value.detected_at
        : value?.detected_at instanceof Date
          ? value.detected_at.toISOString()
          : "",
    acknowledged_at:
      typeof value?.acknowledged_at === "string"
        ? value.acknowledged_at
        : value?.acknowledged_at instanceof Date
          ? value.acknowledged_at.toISOString()
          : null,
    last_detected_at:
      typeof value?.last_detected_at === "string"
        ? value.last_detected_at
        : value?.last_detected_at instanceof Date
          ? value.last_detected_at.toISOString()
          : null,
    resolved_at:
      typeof value?.resolved_at === "string"
        ? value.resolved_at
        : value?.resolved_at instanceof Date
          ? value.resolved_at.toISOString()
          : null,
    product_id: value?.product_id == null ? null : toFinite(value.product_id),
    product_name:
      typeof value?.product_name === "string" ? value.product_name : null,
    source: typeof value?.source === "string" ? value.source : "seed",
  };
}

function normalizeThreshold(value: any): Threshold {
  return {
    shipment_id: toFinite(value?.shipment_id),
    product_id: toFinite(value?.product_id),
    name: typeof value?.name === "string" ? value.name : "Unnamed product",
    min_temp_c: toFinite(value?.min_temp_c),
    max_temp_c: toFinite(value?.max_temp_c),
    min_humidity: toFinite(value?.min_humidity),
    max_humidity: toFinite(value?.max_humidity),
    reference: Boolean(value?.reference),
  };
}

function normalizeChartPoint(value: any): ChartPoint {
  return {
    label: typeof value?.label === "string" ? value.label : "",
    temperature: toFinite(value?.temperature),
    humidity: toFinite(value?.humidity),
    t: toFinite(value?.t),
    shipment_id: value?.shipment_id == null ? undefined : toFinite(value.shipment_id),
    tempMin: value?.tempMin == null ? undefined : toFinite(value.tempMin),
    tempMax: value?.tempMax == null ? undefined : toFinite(value.tempMax),
    humidityMin:
      value?.humidityMin == null ? undefined : toFinite(value.humidityMin),
    humidityMax:
      value?.humidityMax == null ? undefined : toFinite(value.humidityMax),
    referenceProduct:
      typeof value?.referenceProduct === "string"
        ? value.referenceProduct
        : undefined,
  };
}

function badgeClass(value: string): string {
  const status = value.toUpperCase();
  if (["OPEN", "CRITICAL", "VIOLATION", "HIGH"].includes(status)) {
    return "bg-red-100 text-red-800";
  }
  if (["ACKNOWLEDGED", "MEDIUM"].includes(status)) {
    return "bg-amber-100 text-amber-800";
  }
  if (["RESOLVED", "IN RANGE", "LOW", "NORMAL"].includes(status)) {
    return "bg-teal-50 text-teal-800";
  }
  return "bg-slate-100 text-slate-700";
}

export default function MonitoringPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [activeShipment, setActiveShipment] = useState<number | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [riskStatus, setRiskStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [polling, setPolling] = useState(false);
  const [actionAlertId, setActionAlertId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const requestSeq = useRef(0);

  const loadMonitoring = useCallback(
    async (
      shipmentId: number | null,
      options: { silent?: boolean; signal?: AbortSignal } = {}
    ) => {
      const seq = ++requestSeq.current;
      if (!options.silent) setLoading(true);
      setError(null);

      try {
        const url =
          shipmentId != null
            ? `/api/monitoring?shipment_id=${encodeURIComponent(String(shipmentId))}`
            : "/api/monitoring";
        const response = await fetch(url, {
          cache: "no-store",
          signal: options.signal,
        });
        if (!response.ok) {
          throw new Error(await responseError(response, "Unable to load monitoring data"));
        }
        const data = (await response.json()) as Partial<MonitoringResponse>;
        if (seq !== requestSeq.current) return;

        setReadings(Array.isArray(data.readings) ? data.readings.map(normalizeReading) : []);
        setAlerts(Array.isArray(data.alerts) ? data.alerts.map(normalizeAlert) : []);
        setThresholds(
          Array.isArray(data.thresholds) ? data.thresholds.map(normalizeThreshold) : []
        );
        setChartData(
          Array.isArray(data.chartData)
            ? data.chartData.map(normalizeChartPoint)
            : []
        );
        setRiskStatus(typeof data.riskStatus === "string" ? data.riskStatus : null);
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError" || seq !== requestSeq.current) return;
        const message =
          caught instanceof Error ? caught.message : "Unable to load monitoring data";
        setError(message);
        console.error("Error loading monitoring data:", caught);
      } finally {
        if (seq === requestSeq.current && !options.silent) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/shipments", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await responseError(response, "Unable to load shipments"));
        }
        const data = await response.json();
        const list = (Array.isArray(data) ? data : [])
          .map(normalizeShipment)
          .filter((shipment) => shipment.shipment_id > 0);
        if (controller.signal.aborted) return;
        setShipments(list);
        setActiveShipment((current) => current ?? list[0]?.shipment_id ?? null);
      } catch (caught) {
        if ((caught as Error)?.name === "AbortError") return;
        console.error("Error loading shipments:", caught);
        setError(
          caught instanceof Error ? caught.message : "Unable to load shipments"
        );
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setFeedback(null);
    void loadMonitoring(activeShipment, { signal: controller.signal });
    return () => controller.abort();
  }, [activeShipment, loadMonitoring]);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(() => {
      void loadMonitoring(activeShipment, { silent: true });
    }, 10_000);
    return () => clearInterval(interval);
  }, [polling, activeShipment, loadMonitoring]);

  const generateReading = async (simulateViolation = false) => {
    if (activeShipment == null) return;
    setGenerating(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/monitoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipment_id: activeShipment,
          simulate_violation: simulateViolation,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to generate reading"));
      }
      const data = (await response.json()) as {
        newReading?: Reading;
        alerts?: Alert[];
        riskStatus?: string;
      };
      const opened = Array.isArray(data.alerts) ? data.alerts.length : 0;
      const reading = data.newReading
        ? `${formatNumber(data.newReading.temperature)}°C / ${formatNumber(data.newReading.humidity)}%`
        : "values unavailable";
      setFeedback({
        kind: "success",
        message: `Simulated reading stored (${reading}). ${
          opened > 0 ? `${opened} new alert${opened === 1 ? "" : "s"} opened.` : "No new alerts."
        } Risk: ${data.riskStatus ?? "unknown"}.`,
      });
      await loadMonitoring(activeShipment, { silent: true });
    } catch (caught) {
      console.error("Error generating reading:", caught);
      setFeedback({
        kind: "error",
        message: caught instanceof Error ? caught.message : "Unable to generate reading",
      });
    } finally {
      setGenerating(false);
    }
  };

  const updateAlert = async (
    alert: Alert,
    nextStatus: "ACKNOWLEDGED" | "RESOLVED"
  ) => {
    if (!alert.id) return;
    setActionAlertId(alert.id);
    setFeedback(null);
    try {
      const response = await fetch("/monitoring/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alert.id, status: nextStatus }),
      });
      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to update alert"));
      }
      const data = (await response.json()) as { riskStatus?: string };
      setFeedback({
        kind: "success",
        message: `Alert ${alert.alert_type} is now ${nextStatus.toLowerCase()}. Risk: ${
          data.riskStatus ?? "unknown"
        }.`,
      });
      await loadMonitoring(activeShipment, { silent: true });
    } catch (caught) {
      console.error("Error updating alert:", caught);
      setFeedback({
        kind: "error",
        message: caught instanceof Error ? caught.message : "Unable to update alert",
      });
    } finally {
      setActionAlertId(null);
    }
  };

  const latest = readings[0] ?? null;
  const reference = thresholds.find((item) => item.reference) ?? thresholds[0] ?? null;

  const readingStatus = (reading: Reading) => {
    if (!reference) return "UNCHECKED";
    const inRange =
      reading.temperature >= reference.min_temp_c &&
      reading.temperature <= reference.max_temp_c &&
      reading.humidity >= reference.min_humidity &&
      reading.humidity <= reference.max_humidity;
    return inRange ? "IN RANGE" : "VIOLATION";
  };

  const currentTempStatus = (() => {
    if (!latest || !reference) return "UNCHECKED";
    return latest.temperature >= reference.min_temp_c &&
      latest.temperature <= reference.max_temp_c
      ? "IN RANGE"
      : "VIOLATION";
  })();
  const currentHumidityStatus = (() => {
    if (!latest || !reference) return "UNCHECKED";
    return latest.humidity >= reference.min_humidity &&
      latest.humidity <= reference.max_humidity
      ? "IN RANGE"
      : "VIOLATION";
  })();

  const chartPoints = chartData.map((point) => ({ ...point }));
  const tempLimitLines = reference
    ? [
        {
          key: `temp-min-${reference.product_id}`,
          y: reference.min_temp_c,
          label: `Min ${formatNumber(reference.min_temp_c)}°C`,
          color: "#0f766e",
        },
        {
          key: `temp-max-${reference.product_id}`,
          y: reference.max_temp_c,
          label: `Max ${formatNumber(reference.max_temp_c)}°C`,
          color: "#dc2626",
        },
      ].filter((line) => Number.isFinite(line.y))
    : [];
  const humidityLimitLines = reference
    ? [
        {
          key: `humidity-min-${reference.product_id}`,
          y: reference.min_humidity,
          label: `Min ${formatNumber(reference.min_humidity)}%`,
          color: "#0f766e",
        },
        {
          key: `humidity-max-${reference.product_id}`,
          y: reference.max_humidity,
          label: `Max ${formatNumber(reference.max_humidity)}%`,
          color: "#dc2626",
        },
      ].filter((line) => Number.isFinite(line.y))
    : [];

  const openAlertCount = alerts.filter(
    (alert) => alert.status.toUpperCase() === "OPEN"
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-600">
          Live sensors
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
          Temperature & Humidity Monitoring
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Stored readings, product limits and alert lifecycle from MongoDB and MySQL.
        </p>
        <p className="mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
          Demo readings are simulated (source: simulator). Limits come from MySQL PRODUCT.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadMonitoring(activeShipment)}
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.kind === "success"
              ? "border-teal-200 bg-teal-50 text-teal-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {feedback.message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sensor Console</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-sm">
              <label
                className="mb-2 block text-xs font-medium text-slate-600"
                htmlFor="monitoring-shipment"
              >
                Select Shipment
              </label>
              <select
                id="monitoring-shipment"
                aria-label="Select shipment to monitor"
                value={activeShipment != null ? String(activeShipment) : ""}
                onChange={(event) => {
                  const id = Number(event.target.value);
                  setActiveShipment(Number.isInteger(id) && id > 0 ? id : null);
                }}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
              >
                <option value="">All shipments</option>
                {shipments.map((shipment) => (
                  <option key={shipment.shipment_id} value={shipment.shipment_id}>
                    Shipment {shipment.shipment_id} - {shipment.customer_name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {shipments.length} shipments available
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label="Generate a normal simulated reading"
                onClick={() => void generateReading(false)}
                disabled={activeShipment == null || loading || generating}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate Reading"}
              </button>
              <button
                type="button"
                aria-label="Force a simulated threshold violation"
                onClick={() => void generateReading(true)}
                disabled={activeShipment == null || loading || generating}
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Simulate Violation
              </button>
              <button
                type="button"
                aria-label={polling ? "Stop auto refresh" : "Start auto refresh"}
                aria-pressed={polling}
                onClick={() => setPolling((current) => !current)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-navy-900 hover:bg-slate-50"
              >
                {polling ? "Stop Auto-Refresh" : "Auto-Refresh (10s)"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Current risk</p>
              <p className="mt-1 text-lg font-bold text-navy-900">
                {riskStatus ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Open alerts</p>
              <p className="mt-1 text-lg font-bold text-navy-900">{openAlertCount}</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">
                Reference product
              </p>
              <p className="mt-1 text-sm font-bold text-navy-900">
                {reference?.name ?? "No product limits loaded"}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">Temperature</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass(currentTempStatus)}`}
                >
                  {currentTempStatus}
                </span>
              </div>
              <p className="mt-1 text-2xl font-bold text-navy-900">
                {latest ? `${formatNumber(latest.temperature)}°C` : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">Humidity</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeClass(currentHumidityStatus)}`}
                >
                  {currentHumidityStatus}
                </span>
              </div>
              <p className="mt-1 text-2xl font-bold text-navy-900">
                {latest ? `${formatNumber(latest.humidity)}%` : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product Limits (MySQL)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && thresholds.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Loading limits…</p>
          ) : thresholds.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No product limits found for this shipment.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-100">
                    <th className="pb-2 font-semibold">Product</th>
                    <th className="pb-2 font-semibold">Temperature</th>
                    <th className="pb-2 font-semibold">Humidity</th>
                    <th className="pb-2 font-semibold">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {thresholds.map((threshold) => (
                    <tr
                      key={`${threshold.shipment_id}-${threshold.product_id}`}
                      className="text-slate-700"
                    >
                      <td className="py-2 font-medium text-navy-900">{threshold.name}</td>
                      <td className="py-2">
                        {formatNumber(threshold.min_temp_c)} – {formatNumber(threshold.max_temp_c)}°C
                      </td>
                      <td className="py-2">
                        {formatNumber(threshold.min_humidity)} – {formatNumber(threshold.max_humidity)}%
                      </td>
                      <td className="py-2">
                        {threshold.reference ? (
                          <span className="rounded-full bg-teal-50 px-2 py-0.5 font-semibold text-teal-800">
                            Reference
                          </span>
                        ) : (
                          <span className="text-slate-400">Additional product</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Temperature Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {chartPoints.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">
                No stored readings yet. Generate one to start the chart.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartPoints} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis domain={["auto", "auto"]} width={52} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Legend />
                  {tempLimitLines.map((line) => (
                    <ReferenceLine
                      key={line.key}
                      y={line.y}
                      stroke={line.color}
                      strokeDasharray="4 4"
                      label={{ value: line.label, position: "insideTopRight", fontSize: 10, fill: line.color }}
                    />
                  ))}
                  <Line
                    key="temperature-series"
                    type="monotone"
                    dataKey="temperature"
                    name="Temperature (°C)"
                    stroke="#0d9488"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
            <p className="mt-3 text-xs text-slate-500">
              {reference
                ? `Dashed lines show the reference product (${reference.name}) limits. Other products are listed above.`
                : "No product limits available for limit lines."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Humidity Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {chartPoints.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">
                No stored readings yet. Generate one to start the chart.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartPoints} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis domain={["auto", "auto"]} width={52} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Legend />
                  {humidityLimitLines.map((line) => (
                    <ReferenceLine
                      key={line.key}
                      y={line.y}
                      stroke={line.color}
                      strokeDasharray="4 4"
                      label={{ value: line.label, position: "insideTopRight", fontSize: 10, fill: line.color }}
                    />
                  ))}
                  <Line
                    key="humidity-series"
                    type="monotone"
                    dataKey="humidity"
                    name="Humidity (%)"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Values are taken from the stored reading history, not regenerated for display.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Historical Readings</CardTitle>
          </CardHeader>
          <CardContent>
            {readings.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No readings available for this shipment.
              </p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 font-semibold">Time</th>
                      <th className="pb-2 font-semibold">Source</th>
                      <th className="pb-2 font-semibold">Sensor</th>
                      <th className="pb-2 font-semibold">Product</th>
                      <th className="pb-2 font-semibold">Temp</th>
                      <th className="pb-2 font-semibold">Humidity</th>
                      <th className="pb-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {readings.map((reading) => {
                      const status = readingStatus(reading);
                      return (
                        <tr
                          key={
                            reading.id ??
                            `${reading.shipment_id}-${reading.sensor_id}-${reading.timestamp}`
                          }
                          className="text-slate-700"
                        >
                          <td className="py-2 text-slate-500">{formatDate(reading.timestamp)}</td>
                          <td className="py-2">{reading.source}</td>
                          <td className="py-2 font-medium text-navy-900">{reading.sensor_id}</td>
                          <td className="py-2">{reading.product_name ?? "—"}</td>
                          <td className="py-2">{formatNumber(reading.temperature)}°C</td>
                          <td className="py-2">{formatNumber(reading.humidity)}%</td>
                          <td className="py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 font-medium ${badgeClass(status)}`}
                            >
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alert Lifecycle</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                No alerts recorded for this shipment.
              </p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white text-slate-500">
                    <tr className="border-b border-slate-100">
                      <th className="pb-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Alert</th>
                      <th className="pb-2 font-semibold">Detected</th>
                      <th className="pb-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {alerts.map((alert) => {
                      const status = alert.status.toUpperCase();
                      const canAcknowledge = status === "OPEN";
                      const canResolve = status === "ACKNOWLEDGED";
                      const busy = actionAlertId === alert.id;
                      return (
                        <tr
                          key={
                            alert.id ??
                            `${alert.shipment_id}-${alert.alert_type}-${alert.detected_at}`
                          }
                          className="align-top text-slate-700"
                        >
                          <td className="py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 font-semibold ${badgeClass(status)}`}
                            >
                              {status}
                            </span>
                          </td>
                          <td className="py-2">
                            <p className="font-semibold text-navy-900">{alert.alert_type}</p>
                            <p className="mt-0.5 text-[11px] text-slate-600">{alert.message}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {alert.severity} · {formatDate(alert.detected_at)}
                            </p>
                          </td>
                          <td className="py-2 text-slate-500">
                            {formatDate(alert.detected_at)}
                          </td>
                          <td className="py-2">
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                aria-label={`Acknowledge ${alert.alert_type} alert`}
                                disabled={!canAcknowledge || busy}
                                onClick={() => void updateAlert(alert, "ACKNOWLEDGED")}
                                className="rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Acknowledge
                              </button>
                              <button
                                type="button"
                                aria-label={`Resolve ${alert.alert_type} alert`}
                                disabled={!canResolve || busy}
                                onClick={() => void updateAlert(alert, "RESOLVED")}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-navy-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Resolve
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
