"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

const GpsMap = dynamic(() => import("@/components/gps-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[480px] w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
      Loading map...
    </div>
  ),
});

type Shipment = {
  shipment_id: number;
  customer_name?: string;
  status?: string;
  route_id?: number | null;
  vehicle_id?: number | null;
  vehicle_reg?: string;
  reg_no?: string;
  driver_name?: string;
};

type Telemetry = {
  id?: string;
  shipment_id?: number | null;
  timestamp?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speed?: number | null;
  heading?: number | null;
  route_id?: number | null;
  progress?: number | null;
  source?: string;
};

type PositionedTelemetry = Telemetry & { latitude: number; longitude: number };

type GpsSession = {
  status?: string;
  progress?: number | null;
  last_latitude?: number | null;
  last_longitude?: number | null;
  last_speed?: number | null;
  updated_at?: string | null;
} | null;

type GpsRoute = {
  route_id: number;
  origin: { name: string; latitude: number; longitude: number };
  destination: { name: string; latitude: number; longitude: number };
  points: Array<{ latitude: number; longitude: number }>;
  distance_km: number;
};

type TelemetryResponse = {
  telemetry: Telemetry[];
  session: GpsSession;
  route: GpsRoute | null;
};

type SimulatorAction = "start" | "pause" | "resume" | "stop" | "manual";

function formatNumber(value: unknown, digits: number): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "-";
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "string" && !(value instanceof Date)) return "-";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function isPositioned(point: Telemetry): point is PositionedTelemetry {
  return (
    typeof point.latitude === "number" &&
    Number.isFinite(point.latitude) &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.longitude)
  );
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the status-based message when the body is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export default function GpsTrackingPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<Telemetry[]>([]);
  const [session, setSession] = useState<GpsSession>(null);
  const [route, setRoute] = useState<GpsRoute | null>(null);
  const [shipmentDetail, setShipmentDetail] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<SimulatorAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTracking = useCallback(async (shipmentId: number) => {
    try {
      const response = await fetch(
        `/api/monitoring/gps-telemetry?shipment_id=${shipmentId}`,
        { cache: "no-store" }
      );
      const data = await readJson<TelemetryResponse>(response);
      setTelemetry(Array.isArray(data.telemetry) ? data.telemetry : []);
      setSession(data.session ?? null);
      setRoute(data.route ?? null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to load GPS telemetry"
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/shipments", { cache: "no-store" });
        const list = await readJson<Shipment[]>(response);
        if (cancelled) return;
        const safeList = Array.isArray(list) ? list : [];
        setShipments(safeList);
        const first = safeList.find((shipment) =>
          typeof shipment.shipment_id === "number"
        );
        if (first) setSelectedShipment(first.shipment_id);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Failed to load shipments"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleShipmentChange = (value: string) => {
    const id = Number(value);
    const nextId = Number.isFinite(id) && id > 0 ? id : null;
    // Clear the previous shipment's view immediately; all new data comes from
    // the API responses below, never from an invented position.
    setSelectedShipment(nextId);
    setTelemetry([]);
    setSession(null);
    setRoute(null);
    setShipmentDetail(null);
    setError(null);
  };

  useEffect(() => {
    if (selectedShipment === null) return;

    let cancelled = false;

    (async () => {
      try {
        const [detailResponse] = await Promise.all([
          fetch(`/api/shipments/${selectedShipment}`, { cache: "no-store" }),
          loadTracking(selectedShipment),
        ]);
        const detail = await readJson<Shipment>(detailResponse);
        if (!cancelled) setShipmentDetail(detail);
      } catch {
        // Shipment detail is supplementary; the list entry remains available.
        if (!cancelled) setShipmentDetail(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedShipment, loadTracking]);

  // Polling advances the simulator with a stored `step` action, then re-reads
  // telemetry from the API. Marker position always comes from stored telemetry.
  useEffect(() => {
    if (selectedShipment === null || session?.status !== "RUNNING") return;
    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch("/api/monitoring/gps-telemetry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shipment_id: selectedShipment, action: "step" }),
          });
          if (!response.ok || cancelled) return;
          await loadTracking(selectedShipment);
        } catch {
          // A transient failure must not stop the polling loop.
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedShipment, session?.status, loadTracking]);

  const runAction = async (action: SimulatorAction) => {
    if (selectedShipment === null) return;
    setBusyAction(action);
    setError(null);
    try {
      const response = await fetch("/api/monitoring/gps-telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipment_id: selectedShipment, action }),
      });
      const result = await readJson<{ success?: boolean }>(response);
      if (!result.success) throw new Error("GPS simulator rejected the action");
      await loadTracking(selectedShipment);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "GPS action failed");
    } finally {
      setBusyAction(null);
    }
  };

  const status = session?.status ?? "IDLE";
  const latest = telemetry.find(isPositioned) ?? null;
  const mapTelemetry = telemetry.filter(isPositioned);
  const selected = shipments.find(
    (shipment) => shipment.shipment_id === selectedShipment
  );

  const vehiclePosition = useMemo(() => {
    if (!latest) return null;
    return {
      vehicle_id: shipmentDetail?.vehicle_id ?? selected?.vehicle_id ?? 0,
      reg_no:
        shipmentDetail?.reg_no ??
        shipmentDetail?.vehicle_reg ??
        selected?.vehicle_reg ??
        `Shipment ${selectedShipment}`,
      latitude: latest.latitude,
      longitude: latest.longitude,
      status: shipmentDetail?.status ?? selected?.status ?? "TRACKED",
    };
  }, [latest, shipmentDetail, selected, selectedShipment]);

  const progressValue = latest?.progress ?? session?.progress ?? null;
  const busy = busyAction !== null || loading;
  const noSelection = selectedShipment === null;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-900 bg-navy-900 px-6 py-4">
          <div>
            <h1 className="text-xl font-semibold text-white">GPS Tracking</h1>
            <p className="mt-1 text-sm text-teal-100">
              Karnataka corridors · simulator telemetry stored in the monitoring database
            </p>
          </div>
          <span className="rounded-full bg-teal-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-navy-950">
            Simulated
          </span>
        </div>

        <div className="grid gap-6 px-6 py-5 lg:grid-cols-2">
          <div>
            <label
              htmlFor="gps-shipment"
              className="mb-2 block text-sm font-medium text-navy-900"
            >
              Select shipment
            </label>
            <select
              id="gps-shipment"
              value={selectedShipment !== null ? String(selectedShipment) : ""}
              onChange={(event) => handleShipmentChange(event.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
              disabled={loading}
            >
              <option value="">-- Select Shipment --</option>
              {shipments.map((shipment) => (
                <option key={shipment.shipment_id} value={shipment.shipment_id}>
                  Shipment {shipment.shipment_id}
                  {shipment.customer_name ? ` - ${shipment.customer_name}` : ""}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-500">
              {loading
                ? "Loading shipments..."
                : `${shipments.length} shipment(s) available`}
            </p>
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => void runAction("start")}
              disabled={busy || noSelection || status === "RUNNING" || status === "PAUSED"}
              className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "start" ? "Starting..." : "Start"}
            </button>
            <button
              type="button"
              onClick={() => void runAction("pause")}
              disabled={busy || noSelection || status !== "RUNNING"}
              className="rounded-md bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "pause" ? "Pausing..." : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => void runAction("resume")}
              disabled={busy || noSelection || status !== "PAUSED"}
              className="rounded-md bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "resume" ? "Resuming..." : "Resume"}
            </button>
            <button
              type="button"
              onClick={() => void runAction("stop")}
              disabled={busy || noSelection || status === "STOPPED" || status === "IDLE"}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-navy-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "stop" ? "Stopping..." : "Stop"}
            </button>
            <button
              type="button"
              onClick={() => void runAction("manual")}
              disabled={busy || noSelection}
              className="rounded-md border border-teal-600 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "manual" ? "Updating..." : "Manual update"}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      ) : null}

      {noSelection ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
          Select a shipment to view its simulated GPS route.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: "Route",
                value: route
                  ? `${route.origin.name} → ${route.destination.name}`
                  : "-",
                hint: route ? `Route #${route.route_id}` : "No mapped route",
              },
              {
                label: "Current position",
                value: latest
                  ? `${formatNumber(latest.latitude, 4)}, ${formatNumber(latest.longitude, 4)}`
                  : "-",
                hint: latest ? `Heading ${formatNumber(latest.heading, 0)}°` : "Awaiting telemetry",
              },
              {
                label: "Speed",
                value:
                  status === "STOPPED" || status === "IDLE"
                    ? "0 km/h"
                    : latest
                      ? `${formatNumber(latest.speed, 1)} km/h`
                      : "-",
                hint: `Progress ${formatNumber(
                  progressValue !== null ? progressValue * 100 : null,
                  1
                )}%`,
              },
              {
                label: "Last stored update",
                value: formatTimestamp(latest?.timestamp),
                hint: `Session: ${status}`,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {stat.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-navy-900">{stat.value}</p>
                <p className="mt-1 text-xs text-teal-700">{stat.hint}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
              <h2 className="text-sm font-semibold text-navy-900">Live route map</h2>
              <span className="text-xs text-slate-500">
                Green = origin · Red = destination · Teal = vehicle
              </span>
            </div>
            <div className="p-3">
              <GpsMap
                telemetry={mapTelemetry}
                vehiclePosition={vehiclePosition}
                route={route}
                sessionStopped={status === "STOPPED" || status === "IDLE"}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-3">
              <h2 className="text-sm font-semibold text-navy-900">Telemetry history</h2>
              <p className="mt-1 text-xs text-slate-500">
                {telemetry.length} stored point(s), newest first
              </p>
            </div>
            {telemetry.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-slate-500">
                No GPS telemetry recorded for this shipment yet. Start tracking to see live
                positions.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-3 font-medium">Time</th>
                      <th className="px-6 py-3 font-medium">Lat</th>
                      <th className="px-6 py-3 font-medium">Lng</th>
                      <th className="px-6 py-3 font-medium">Speed</th>
                      <th className="px-6 py-3 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetry.map((point, index) => (
                      <tr
                        key={point.id ?? `${point.timestamp ?? "point"}-${index}`}
                        className="border-b border-slate-100 last:border-0"
                      >
                        <td className="px-6 py-3 text-navy-900">
                          {formatTimestamp(point.timestamp)}
                        </td>
                        <td className="px-6 py-3">{formatNumber(point.latitude, 4)}</td>
                        <td className="px-6 py-3">{formatNumber(point.longitude, 4)}</td>
                        <td className="px-6 py-3">
                          {formatNumber(point.speed, 1)}
                          {typeof point.speed === "number" && Number.isFinite(point.speed)
                            ? " km/h"
                            : ""}
                        </td>
                        <td className="px-6 py-3">
                          <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold uppercase text-teal-700">
                            {point.source || "-"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
