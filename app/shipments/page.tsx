"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ShipmentMap = dynamic(() => import("@/components/shipment-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
      Loading map…
    </div>
  ),
});

const TruckImage = (props: {
  width?: number;
  height?: number;
  className?: string;
}) => (
  <img
    src="/truck-refrigerated.jpg"
    alt="Refrigerated delivery truck"
    {...props}
    style={{ width: props.width, height: props.height, objectFit: "cover", display: "block" }}
  />
);

type Shipment = {
  shipment_id: number;
  customer_id: number;
  created_by: number;
  route_id: number;
  vehicle_id: number | null;
  driver_id: number | null;
  status: string;
  risk_status: string;
  dispatched_at: string | null;
  expected_delivery: string | null;
  delivered_at: string | null;
  customer_name: string;
  creator_name: string;
  vehicle_reg: string | null;
  driver_name: string | null;
  distance_km: number;
  estimated_duration_minutes: number;
  origin_warehouse_id?: number | null;
  destination_warehouse_id?: number | null;
};

type Customer = { customer_id: number; name: string; company_name: string | null };
type RouteRow = { route_id: number; origin_warehouse_id: number; destination_warehouse_id: number; distance_km: number; estimated_duration_minutes: number };
type Warehouse = { warehouse_id: number; name: string; city: string; latitude: number; longitude: number };
type Vehicle = { vehicle_id: number; reg_no: string };
type Driver = { driver_id: number; name: string };
type SessionInfo = { user: { id: number; role: string; name?: string } | null };

type AddForm = {
  customer_id: string;
  route_id: string;
  vehicle_id: string;
  driver_id: string;
  status: string;
  risk_status: string;
  dispatched_at: string;
  expected_delivery: string;
};

const EMPTY_ADD_FORM: AddForm = {
  customer_id: "",
  route_id: "",
  vehicle_id: "",
  driver_id: "",
  status: "CREATED",
  risk_status: "LOW",
  dispatched_at: "",
  expected_delivery: "",
};

const STATUS_OPTIONS = ["CREATED", "CONFIRMED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELAYED", "DELIVERED", "CANCELLED"];
const RISK_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

type Monitoring = {
  readings: Array<{ shipment_id: number; temperature: number; humidity: number; timestamp: string; product_name: string | null }>;
  alerts: Array<{ shipment_id: number; alert_type: string; severity: string; message: string; status: string; detected_at: string }>;
  thresholds: Array<{ shipment_id: number; product_id: number; name: string; min_temp_c: number; max_temp_c: number; min_humidity: number; max_humidity: number }>;
  riskStatus: string;
};

type GpsTelemetry = {
  telemetry: Array<{ latitude: number; longitude: number; speed: number | null; timestamp: string | null }>;
  session: { status: string; progress: number; last_latitude: number; last_longitude: number; last_speed: number; updated_at: string } | null;
  route: { origin: { name: string; latitude: number; longitude: number }; destination: { name: string; latitude: number; longitude: number }; points: Array<{ latitude: number; longitude: number }>; distance_km: number } | null;
};

const STATUS_GROUPS = [
  { key: "created", label: "Created", statuses: new Set(["CREATED"]) },
  { key: "ongoing", label: "Ongoing Shipping", statuses: new Set(["CONFIRMED"]) },
  { key: "intransit", label: "In Transit", statuses: new Set(["IN_TRANSIT", "OUT_FOR_DELIVERY"]) },
  { key: "delivered", label: "Delivered", statuses: new Set(["DELIVERED"]) },
  { key: "delayed", label: "Delayed", statuses: new Set(["DELAYED"]) },
] as const;

const FILTER_CHIPS = ["All Shipments", "Ongoing", "In Transit", "Delivered", "Delayed", "High Risk"];

const STATUS_COLOR: Record<string, string> = {
  CREATED: "bg-slate-100 text-slate-700",
  CONFIRMED: "bg-slate-100 text-slate-700",
  IN_TRANSIT: "bg-blue-100 text-blue-800",
  OUT_FOR_DELIVERY: "bg-blue-100 text-blue-800",
  DELIVERED: "bg-green-100 text-green-800",
  DELAYED: "bg-orange-100 text-orange-800",
};

const RISK_COLOR: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  HIGH: "bg-orange-100 text-orange-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-green-100 text-green-800",
};

const STAGE_ORDER = ["Pickup", "Departure", "In Transit", "Intermediate checkpoint", "Destination"];
const STAGE_PROGRESS: Record<string, number> = { CREATED: 0, CONFIRMED: 25, IN_TRANSIT: 50, DELAYED: 50, OUT_FOR_DELIVERY: 75, DELIVERED: 100 };

function statusColor(status: string): string {
  return STATUS_COLOR[status.toUpperCase()] ?? STATUS_COLOR.CREATED;
}

function riskColor(risk: string): string {
  return RISK_COLOR[risk.toUpperCase()] ?? RISK_COLOR.LOW;
}

function groupKeyFor(status: string): string | null {
  const upper = status.toUpperCase();
  for (const group of STATUS_GROUPS) {
    if (group.statuses.has(upper)) return group.key;
  }
  return null;
}

function matchesGroup(key: string, status: string, risk: string): boolean {
  if (key === "all") return true;
  if (key === "high-risk") return ["HIGH", "CRITICAL"].includes(risk.toUpperCase());
  return groupKeyFor(status) === key;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const seconds = (Date.now() - d.getTime()) / 1000;
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} Hrs ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function fetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (HTTP ${response.status})`);
  }
  return (await response.json()) as T;
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [currentUser, setCurrentUser] = useState<SessionInfo["user"]>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [seeMore, setSeeMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDeliveredAt, setEditingDeliveredAt] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD_FORM);
  const [savingShipment, setSavingShipment] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const warehouseById = useMemo(() => new Map(warehouses.map((w) => [w.warehouse_id, w])), [warehouses]);
  const routeById = useMemo(() => new Map(routes.map((r) => [r.route_id, r])), [routes]);
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.vehicle_id, v])), [vehicles]);
  const customerById = useMemo(() => new Map(customers.map((c) => [c.customer_id, c])), [customers]);

  const selected = useMemo(() => shipments.find((s) => s.shipment_id === selectedId), [shipments, selectedId]);

  const loadReference = useCallback(async () => {
    const [customersData, routesData, warehousesData, vehiclesData, driversData, sessionData] = await Promise.all([
      fetchJson<Customer[]>("/api/customers").catch(() => [] as Customer[]),
      fetchJson<RouteRow[]>("/api/routes").catch(() => [] as RouteRow[]),
      fetchJson<Warehouse[]>("/api/warehouses").catch(() => [] as Warehouse[]),
      fetchJson<Vehicle[]>("/api/vehicles").catch(() => [] as Vehicle[]),
      fetchJson<Driver[]>("/api/drivers").catch(() => [] as Driver[]),
      fetchJson<SessionInfo>("/api/auth/me").catch(() => ({ user: null })),
    ]);
    setCustomers(customersData);
    setRoutes(routesData);
    setWarehouses(warehousesData);
    setVehicles(vehiclesData);
    setDrivers(driversData);
    setCurrentUser(sessionData.user ?? null);
  }, []);

  const loadShipments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchJson<Shipment[]>("/api/shipments")) as Shipment[];
      setShipments(data);
      if (selectedId === null && data.length > 0) setSelectedId(data[0].shipment_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shipments.");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void loadReference();
        void loadShipments();
      }
    });
    return () => {
      active = false;
    };
  }, [loadReference, loadShipments]);

  const routeFor = useMemo(
    () =>
      selected ? routeById.get(selected.route_id) : undefined,
    [selected, routeById]
  );

  const originWarehouse = useMemo(
    () => routeFor ? warehouseById.get(routeFor.origin_warehouse_id) : undefined,
    [routeFor, warehouseById]
  );
  const destinationWarehouse = useMemo(
    () => routeFor ? warehouseById.get(routeFor.destination_warehouse_id) : undefined,
    [routeFor, warehouseById]
  );
  const vehicle = useMemo(() => {
    if (!selected || selected.vehicle_id == null) return undefined;
    return vehicleById.get(selected.vehicle_id);
  }, [selected, vehicleById]);
  const customer = useMemo(() => (selected ? customerById.get(selected.customer_id) : undefined), [selected, customerById]);

  const [monitoring, setMonitoring] = useState<Monitoring | null>(null);
  const [gps, setGps] = useState<GpsTelemetry | null>(null);

  const loadSelectedDetail = useCallback(async () => {
    if (!selected) return;
    try {
      const [mon, gpsData] = await Promise.all([
        fetchJson<Monitoring>(`/api/monitoring?shipment_id=${selected.shipment_id}`).catch(() => null),
        fetchJson<GpsTelemetry>(`/api/monitoring/gps-telemetry?shipment_id=${selected.shipment_id}`).catch(() => null),
      ]);
      setMonitoring(mon ?? null);
      setGps(gpsData ?? null);
    } catch {
      setMonitoring(null);
      setGps(null);
    }
  }, [selected]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadSelectedDetail();
    });
    return () => {
      active = false;
    };
  }, [loadSelectedDetail]);

  const latestReading = useMemo(() => monitoring?.readings[0], [monitoring]);
  const latestTelemetry = useMemo(() => gps?.telemetry[0], [gps]);
  const routeGeometry = useMemo(() => gps?.route, [gps]);

  const displayRoute = useMemo(() => {
    if (routeGeometry) return routeGeometry;
    if (routeFor && originWarehouse && destinationWarehouse) {
      return {
        origin: { name: originWarehouse.name, latitude: originWarehouse.latitude, longitude: originWarehouse.longitude },
        destination: { name: destinationWarehouse.name, latitude: destinationWarehouse.latitude, longitude: destinationWarehouse.longitude },
        points: [],
        distance_km: routeFor.distance_km,
      };
    }
    return null;
  }, [routeGeometry, routeFor, originWarehouse, destinationWarehouse]);

  const vehiclePosition = useMemo(
    () =>
      latestTelemetry
        ? { latitude: latestTelemetry.latitude, longitude: latestTelemetry.longitude, reg_no: vehicle?.reg_no }
        : null,
    [latestTelemetry, vehicle]
  );

  const progress = useMemo(() => {
    if (gps?.session?.progress != null) return gps.session.progress * 100;
    if (selected) return STAGE_PROGRESS[selected.status.toUpperCase()] ?? 0;
    return 0;
  }, [gps, selected]);

  const filteredShipments = useMemo(() => {
    const term = search.toLowerCase();
    return shipments.filter((s) => {
      const origin = routeById.get(s.route_id);
      const ow = origin ? warehouseById.get(origin.origin_warehouse_id)?.name : "";
      const dw = origin ? warehouseById.get(origin.destination_warehouse_id)?.name : "";
      const haystack = `${s.shipment_id} ${s.customer_name} ${ow} ${dw} ${s.vehicle_reg ?? ""} ${s.driver_name ?? ""}`.toLowerCase();
      const matchesSearch = term === "" || haystack.includes(term);
      const matchesFilter = matchesGroup(filter, s.status, s.risk_status);
      return matchesSearch && matchesFilter;
    });
  }, [shipments, search, filter, routeById, warehouseById]);

  const grouped = useMemo(() => {
    const map = new Map<string, Shipment[]>();
    for (const group of STATUS_GROUPS) map.set(group.key, []);
    for (const s of filteredShipments) {
      const key = groupKeyFor(s.status);
      if (key) map.get(key)!.push(s);
    }
    return map;
  }, [filteredShipments]);

  const handleSelect = (id: number) => {
    setSelectedId(id);
    setSeeMore(false);
  };

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    setFilter("all");
  };

  const handleFilter = (chip: string) => {
    setFilter(chip === "All Shipments" ? "all" : chip === "Ongoing" ? "ongoing" : chip === "In Transit" ? "intransit" : chip === "Delivered" ? "delivered" : chip === "Delayed" ? "delayed" : "high-risk");
    setSearch("");
  };

  const toLocalInput = (iso: string | null): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const openAddModal = () => {
    setEditingId(null);
    setEditingDeliveredAt(null);
    setAddForm({
      ...EMPTY_ADD_FORM,
      customer_id: customers[0] ? String(customers[0].customer_id) : "",
      route_id: routes[0] ? String(routes[0].route_id) : "",
    });
    setActionError(null);
    setShowAddModal(true);
  };

  const openEditModal = (shipment: Shipment) => {
    setEditingId(shipment.shipment_id);
    setEditingDeliveredAt(shipment.delivered_at ?? null);
    setAddForm({
      customer_id: String(shipment.customer_id),
      route_id: String(shipment.route_id),
      vehicle_id: shipment.vehicle_id == null ? "" : String(shipment.vehicle_id),
      driver_id: shipment.driver_id == null ? "" : String(shipment.driver_id),
      status: shipment.status,
      risk_status: shipment.risk_status,
      dispatched_at: toLocalInput(shipment.dispatched_at),
      expected_delivery: toLocalInput(shipment.expected_delivery),
    });
    setActionError(null);
    setShowAddModal(true);
  };

  const handleSubmitShipment = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    if (!addForm.customer_id || !addForm.route_id) {
      setActionError("Customer and route are required.");
      return;
    }
    setSavingShipment(true);
    try {
      const payload = {
        customer_id: Number(addForm.customer_id),
        route_id: Number(addForm.route_id),
        vehicle_id: addForm.vehicle_id ? Number(addForm.vehicle_id) : null,
        driver_id: addForm.driver_id ? Number(addForm.driver_id) : null,
        status: addForm.status,
        risk_status: addForm.risk_status,
        dispatched_at: addForm.dispatched_at ? new Date(addForm.dispatched_at).toISOString() : null,
        expected_delivery: addForm.expected_delivery ? new Date(addForm.expected_delivery).toISOString() : null,
        delivered_at: editingId != null ? editingDeliveredAt : null,
      };
      if (editingId != null) {
        await fetchJson(`/api/shipments/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        const result = await fetchJson<{ shipment_id: number }>("/api/shipments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (result?.shipment_id) setSelectedId(result.shipment_id);
      }
      setShowAddModal(false);
      setEditingId(null);
      await loadShipments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : editingId != null ? "Could not update shipment." : "Could not create shipment.");
    } finally {
      setSavingShipment(false);
    }
  };

  const handleDeleteShipment = async (id: number) => {
    if (!window.confirm(`Delete shipment #${id}? This cannot be undone.`)) return;
    setActionError(null);
    setDeletingId(id);
    try {
      await fetchJson(`/api/shipments/${id}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      await loadShipments();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete shipment.");
    } finally {
      setDeletingId(null);
    }
  };

  const selectedDriverName = selected?.driver_name ?? "Not assigned";
  const selectedCompany = customer?.company_name ?? customer?.name ?? "Not assigned";
  const categoryNames = useMemo(() => {
    if (!monitoring?.thresholds.length) return "—";
    return [...new Set(monitoring.thresholds.map((t) => t.name))].join(" / ");
  }, [monitoring]);

  const remainingDistance = useMemo(() => {
    if (!displayRoute?.distance_km || selected?.status.toUpperCase() === "DELIVERED") return null;
    const p = progress / 100;
    const remaining = Number(displayRoute.distance_km) * (1 - p);
    return remaining > 0 ? remaining : 0;
  }, [displayRoute, progress, selected]);

  return (
    <div className="min-h-screen bg-gray-50">
      {loading && error ? (
        <div className="ml-64 p-6 flex-1 flex items-center justify-center text-slate-500">{error}</div>
      ) : (
        <div className="w-full">
          <div className="flex flex-col lg:flex-row items-start gap-4 lg:gap-6">
            {/* LEFT COLUMN — Shipment Activities (~34%) */}
            <aside className="w-full lg:w-[34%] xl:w-[32%] flex flex-col gap-4 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto lg:pr-1">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-800">Shipment Activities</h2>
                  {currentUser && currentUser.role !== "CUSTOMER" ? (
                    <button
                      type="button"
                      onClick={openAddModal}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
                    >
                      + Add Shipment
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
                  </svg>
                  <input
                    className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
                    placeholder="Search shipment ID, customer, pickup or destination…"
                    value={search}
                    onChange={handleSearch}
                  />
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50"
                    aria-label="Filters"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 3v18h18" /><path d="M19 3v18h-18" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTER_CHIPS.map((chip) => {
                  const active =
                    (chip === "All Shipments" && filter === "all") ||
                    (chip === "Ongoing" && filter === "ongoing") ||
                    (chip === "In Transit" && filter === "intransit") ||
                    (chip === "Delivered" && filter === "delivered") ||
                    (chip === "Delayed" && filter === "delayed") ||
                    (chip === "High Risk" && filter === "high-risk");
                  return (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleFilter(chip)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "border-green-600 bg-green-50 text-green-700"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>

              {STATUS_GROUPS.map((group) => {
                const items = grouped.get(group.key) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={group.key} className="flex flex-col gap-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      {group.label}
                    </h3>
                    {items.map((shipment) => {
                      const isSelected = shipment.shipment_id === selectedId;
                      const route = routeById.get(shipment.route_id);
                      const ow = route ? warehouseById.get(route.origin_warehouse_id)?.name : "";
                      const dw = route ? warehouseById.get(route.destination_warehouse_id)?.name : "";
                      const compact = !isSelected;
                      return (
                        <div
                          key={shipment.shipment_id}
                          className={cn(
                            "rounded-xl border p-3 transition-colors hover:bg-slate-50 cursor-pointer group",
                            isSelected
                              ? "border-green-600 bg-green-50 shadow-sm ring-1 ring-green-100"
                              : "border-slate-200 bg-white"
                          )}
                          onClick={() => handleSelect(shipment.shipment_id)}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex flex-col gap-1 min-w-0">
                              <p className="text-[11px] text-slate-400">Shipment number</p>
                              <p className="text-sm font-bold text-slate-800 leading-tight">#{shipment.shipment_id}</p>
                              {!compact && (
                                <p className="text-[11px] text-teal-600 font-medium">Category: {categoryNames}</p>
                              )}
                            </div>
                            <TruckImage
                              width={compact ? 90 : 150}
                              height={compact ? 56 : 95}
                              className="rounded-lg object-cover border border-slate-100 shrink-0"
                            />
                          </div>
                          {!compact ? (
                            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700 text-[10px] font-bold">●</span>
                                <span className="text-sm font-medium text-slate-700">Pickup ({ow})</span>
                              </div>
                              <p className="text-xs text-slate-500">
                                {originWarehouse ? `${originWarehouse.name}, ${originWarehouse.city}` : ""}
                              </p>
                              <div className="flex items-center gap-2">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-700 text-[10px] font-bold">●</span>
                                <span className="text-sm font-medium text-slate-700">Destination ({dw})</span>
                              </div>
                              <p className="text-xs text-slate-500">
                                {destinationWarehouse ? `${destinationWarehouse.name}, ${destinationWarehouse.city}` : ""}
                              </p>
                              <div className="flex items-center gap-3 pt-2">
                                <TruckImage
                                  width={32}
                                  height={32}
                                  className="rounded-full object-cover border border-slate-200"
                                />
                                <div className="flex flex-col leading-tight">
                                  <p className="text-xs font-medium text-slate-700">{selectedDriverName}</p>
                                  <p className="text-[10px] text-slate-500">{selectedCompany}</p>
                                </div>
                                <div className="ml-auto flex items-center gap-1.5">
                                  <button type="button" className="rounded-lg border border-green-100 bg-green-50 p-1.5 text-green-600 transition-colors hover:bg-green-100" aria-label="Call">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                                  </button>
                                  <button type="button" className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:bg-slate-50" aria-label="Message">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                  </button>
                                  {currentUser && currentUser.role !== "CUSTOMER" ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openEditModal(shipment);
                                        }}
                                        className="rounded-lg border border-blue-200 bg-blue-50 p-1.5 text-blue-600 transition-colors hover:bg-blue-100"
                                        aria-label={`Edit shipment ${shipment.shipment_id}`}
                                        title="Edit shipment"
                                      >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void handleDeleteShipment(shipment.shipment_id);
                                        }}
                                        disabled={deletingId === shipment.shipment_id}
                                        className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                                        aria-label={`Delete shipment ${shipment.shipment_id}`}
                                        title="Delete shipment"
                                      >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5" /><path d="M14 11v5" /></svg>
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-3">
                              <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusColor(shipment.status))}>
                                {toTitleCase(shipment.status)}
                              </span>
                              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                {ow} {ow && dw && <span className="text-teal-500">→</span>} {dw}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

            </aside>

            {/* RIGHT COLUMN — Map + Tracking (~66%) */}
            <div className="w-full lg:flex-1 flex flex-col gap-4 min-w-0">
              <Card className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm h-[420px] lg:h-[440px] shrink-0">
                <CardHeader className="shrink-0 border-b border-slate-100 px-4 py-3">
                  <CardTitle>Map Overview</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 p-0">
                  <div className="relative h-full w-full min-h-[360px]">
                    {selected ? (
                      <ShipmentMap
                        route={displayRoute ?? null}
                        telemetry={gps?.telemetry ?? []}
                        vehiclePosition={vehiclePosition}
                        sessionStopped={
                          selected.status.toUpperCase() === "DELIVERED" ||
                          selected.status.toUpperCase() === "CANCELLED"
                        }
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                        <p className="text-sm">Select a shipment to view its route</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm h-[420px] lg:h-[400px] shrink-0">
                <CardHeader className="shrink-0 border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Tracking Details</CardTitle>
                    <button
                      type="button"
                      onClick={() => setSeeMore((prev) => !prev)}
                      className="text-xs font-medium text-green-600 hover:underline"
                    >
                      {seeMore ? "See Less" : "See More"}
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                  <div className="h-full">
                    {selected ? (
                      <>
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Pickup</p>
                          <p className="text-sm font-medium text-slate-700 leading-tight">
                            {originWarehouse?.name ?? "—"}
                            <br />
                            <span className="text-[11px] text-slate-500">{originWarehouse?.city ?? ""}</span>
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Shipment Status</p>
                          <p className={cn("text-sm font-medium", statusColor(selected.status))}>
                            {toTitleCase(selected.status)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Destination</p>
                          <p className="text-sm font-medium text-slate-700 leading-tight">
                            {destinationWarehouse?.name ?? "—"}
                            <br />
                            <span className="text-[11px] text-slate-500">{destinationWarehouse?.city ?? ""}</span>
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Distance Info</p>
                          <p className="text-sm font-medium text-slate-700">
                            {routeFor ? `${Number(routeFor.distance_km).toLocaleString("en-IN")} km` : "—"}
                            {routeFor ? ` · ${routeFor.estimated_duration_minutes} min` : ""}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Avg. Speed</p>
                          <p className="text-sm font-medium text-slate-700">
                            {latestTelemetry?.speed != null ? `${Math.round(latestTelemetry.speed)} km/hour` : "—"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Last Stop</p>
                          <p className="text-sm font-medium text-slate-700">
                            {latestTelemetry ? formatRelative(latestTelemetry.timestamp) : "—"}
                          </p>
                        </div>
                      </div>

                      {seeMore && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 mb-4">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Shipment details</h4>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Shipment ID</span>
                              <span className="text-slate-700 font-medium">#{selected.shipment_id}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Product</span>
                              <span className="text-slate-700 font-medium">{categoryNames}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Customer</span>
                              <span className="text-slate-700 font-medium">{selectedCompany}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Driver</span>
                              <span className="text-slate-700 font-medium">{selectedDriverName}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Vehicle</span>
                              <span className="text-slate-700 font-medium">{vehicle?.reg_no ?? "Not assigned"}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Temperature</span>
                              <span className="text-slate-700 font-medium">
                                {latestReading?.temperature != null ? `${latestReading.temperature}°C` : "—"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Humidity</span>
                              <span className="text-slate-700 font-medium">
                                {latestReading?.humidity != null ? `${latestReading.humidity}%` : "—"}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Risk status</span>
                              <span className={cn("text-slate-700 font-medium", riskColor(monitoring?.riskStatus ?? selected.risk_status))}>
                                {toTitleCase(monitoring?.riskStatus ?? selected.risk_status)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-500">Last GPS update</span>
                              <span className="text-slate-700 font-medium">
                                {latestTelemetry ? formatRelative(latestTelemetry.timestamp) : "—"}
                              </span>
                            </div>
                            {remainingDistance != null && (
                              <div className="flex flex-col gap-1">
                                <span className="text-[11px] text-slate-500">Remaining distance</span>
                                <span className="text-slate-700 font-medium">{remainingDistance.toFixed(1)} km</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-slate-200 bg-white p-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Journey progress</h4>
                        <div className="relative">
                          <div className="flex justify-between text-[10px] font-medium text-slate-500 mb-2">
                            {STAGE_ORDER.map((stage) => (
                              <span key={stage}>{stage}</span>
                            ))}
                          </div>
                          <div className="relative h-2">
                            <div className="absolute inset-0 h-2 bg-slate-200 rounded-full" />
                            <div className="absolute left-0 top-0 h-2 rounded-full bg-green-500" style={{ width: `${Math.min(progress, 100)}%` }} />
                            <div
                              className="absolute top-1/2 -translate-y-1/2 left-full w-7 h-7 rounded-full bg-green-500 border-2 border-white shadow-sm flex items-center justify-center"
                              style={{ left: `${Math.min(progress, 100)}%` }}
                              aria-label="Vehicle position"
                            >
                              <span className="text-[10px] font-bold text-white">▶</span>
                            </div>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          Progress based on stored status: {selected.status}. {gps?.session ? `Session: ${toTitleCase(gps.session.status)}.` : ""}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <p className="text-sm">Select a shipment to view tracking details</p>
                    </div>
                  )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {showAddModal ? (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add shipment"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) { setShowAddModal(false); setEditingId(null); }
          }}
        >
          <form
            onSubmit={handleSubmitShipment}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{editingId != null ? `Edit Shipment #${editingId}` : "Add Shipment"}</h3>
                <p className="text-xs text-slate-500">
                  {editingId != null ? "Update the shipment details below." : "Create a new refrigerated delivery shipment."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddModal(false); setEditingId(null); }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Customer *</span>
                <select
                  value={addForm.customer_id}
                  onChange={(e) => setAddForm({ ...addForm, customer_id: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                  required
                >
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.customer_id} value={c.customer_id}>
                      {c.company_name || c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Route *</span>
                <select
                  value={addForm.route_id}
                  onChange={(e) => setAddForm({ ...addForm, route_id: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                  required
                >
                  <option value="">Select route</option>
                  {routes.map((r) => {
                    const origin = warehouseById.get(r.origin_warehouse_id)?.name ?? `Warehouse ${r.origin_warehouse_id}`;
                    const destination = warehouseById.get(r.destination_warehouse_id)?.name ?? `Warehouse ${r.destination_warehouse_id}`;
                    return (
                      <option key={r.route_id} value={r.route_id}>
                        {origin} → {destination}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Vehicle</span>
                <select
                  value={addForm.vehicle_id}
                  onChange={(e) => setAddForm({ ...addForm, vehicle_id: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                >
                  <option value="">Not assigned</option>
                  {vehicles.map((v) => (
                    <option key={v.vehicle_id} value={v.vehicle_id}>{v.reg_no}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Driver</span>
                <select
                  value={addForm.driver_id}
                  onChange={(e) => setAddForm({ ...addForm, driver_id: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                >
                  <option value="">Not assigned</option>
                  {drivers.map((d) => (
                    <option key={d.driver_id} value={d.driver_id}>{d.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Status</span>
                <select
                  value={addForm.status}
                  onChange={(e) => setAddForm({ ...addForm, status: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{toTitleCase(status)}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Risk status</span>
                <select
                  value={addForm.risk_status}
                  onChange={(e) => setAddForm({ ...addForm, risk_status: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                >
                  {RISK_OPTIONS.map((risk) => (
                    <option key={risk} value={risk}>{toTitleCase(risk)}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Dispatched at</span>
                <input
                  type="datetime-local"
                  value={addForm.dispatched_at}
                  onChange={(e) => setAddForm({ ...addForm, dispatched_at: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">Expected delivery</span>
                <input
                  type="datetime-local"
                  value={addForm.expected_delivery}
                  onChange={(e) => setAddForm({ ...addForm, expected_delivery: e.target.value })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-green-500"
                />
              </label>

              {actionError ? (
                <p className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{actionError}</p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => { setShowAddModal(false); setEditingId(null); }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingShipment}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingShipment ? "Saving…" : editingId != null ? "Save Changes" : "Create Shipment"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {actionError && !showAddModal ? (
        <div className="fixed bottom-4 right-4 z-[1900] max-w-sm rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          {actionError}
          <button type="button" onClick={() => setActionError(null)} className="ml-3 font-semibold" aria-label="Dismiss">×</button>
        </div>
      ) : null}
    </div>
  );
}
