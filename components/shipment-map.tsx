"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
// Leaflet 1.9 ships no bundled TypeScript declarations in this project.
// @ts-expect-error - runtime module, narrowed below via LeafletModule.
import leafletModule from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";

type LatLng = [number, number];

type LeafletModule = {
  icon(options: {
    iconUrl: string;
    iconRetinaUrl: string;
    shadowUrl: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
    popupAnchor: [number, number];
    shadowSize: [number, number];
  }): unknown;
  divIcon(options: {
    className: string;
    html: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
    popupAnchor: [number, number];
  }): unknown;
  latLngBounds(corners: LatLng[]): { isValid(): boolean };
};

type MapBounds = { isValid(): boolean };

type MapInstance = {
  fitBounds(bounds: MapBounds, options?: { padding?: [number, number]; maxZoom?: number }): MapInstance;
  setView(center: LatLng, zoom: number): MapInstance;
  invalidateSize(options?: { animate?: boolean }): MapInstance;
  getContainer(): HTMLElement | null;
};

const L = leafletModule as LeafletModule;

const LeafletMapContainer = MapContainer as unknown as React.ComponentType<{
  center: LatLng;
  zoom: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  scrollWheelZoom?: boolean;
}>;
const LeafletTileLayer = TileLayer as unknown as React.ComponentType<{
  url: string;
  attribution?: string;
}>;
const LeafletPolyline = Polyline as unknown as React.ComponentType<{
  positions: LatLng[];
  pathOptions?: { color?: string; weight?: number; opacity?: number };
  children?: React.ReactNode;
}>;
const LeafletMarker = Marker as unknown as React.ComponentType<{
  position: LatLng;
  icon?: unknown;
  children?: React.ReactNode;
}>;
function useLeafletMap(): MapInstance {
  return useMap() as MapInstance;
}

function badgeIcon(color: string, label: string): unknown {
  return L.divIcon({
    className: "shipment-badge-icon",
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(7,22,52,.35);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;">${label}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -30],
  });
}

const originIcon = badgeIcon("#16a34a", "S"); // green pickup
const destinationIcon = badgeIcon("#0f5d46", "D"); // dark green destination
const vehicleIcon = badgeIcon("#0b8575", "\u25B6"); // teal vehicle with play triangle

export type ShipmentMapTelemetry = {
  latitude: number;
  longitude: number;
  speed?: number | null;
  timestamp?: string | null;
};

export type ShipmentMapVehicle = {
  latitude?: number | null;
  longitude?: number | null;
  reg_no?: string | null;
};

export type ShipmentMapRoute = {
  origin: { name: string; latitude: number; longitude: number };
  destination: { name: string; latitude: number; longitude: number };
  points?: Array<{ latitude: number; longitude: number }>;
  distance_km?: number;
};

type ShipmentMapProps = {
  route: ShipmentMapRoute | null;
  telemetry: ShipmentMapTelemetry[];
  vehiclePosition: ShipmentMapVehicle | null;
  className?: string;
  /** When true, the tracking session is stopped and the vehicle speed should read 0. */
  sessionStopped?: boolean;
};

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toLatLng(
  point: { latitude?: number | null; longitude?: number | null } | null | undefined
): LatLng | null {
  if (!point || !isFiniteCoordinate(point.latitude) || !isFiniteCoordinate(point.longitude)) {
    return null;
  }
  return [point.latitude, point.longitude];
}

function FitBounds({ positions }: { positions: LatLng[] }) {
  const map = useLeafletMap();
  const lastBoundsKey = useRef<string | null>(null);
  const boundsKey = positions.map((position) => position.join(",")).join(";");

  useEffect(() => {
    if (positions.length === 0 || boundsKey === lastBoundsKey.current) return;
    lastBoundsKey.current = boundsKey;
    // The panel may have been resized (responsive layout / See More toggle).
    // Tell Leaflet to remeasure before fitting the bounds so tiles never go blank.
    map.invalidateSize({ animate: false });
    if (positions.length === 1) {
      map.setView(positions[0], 8);
      return;
    }
    const bounds = L.latLngBounds(positions);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
    }
  }, [map, positions, boundsKey]);

  return null;
}

/** Keeps Leaflet in sync when the surrounding panel changes size. */
function ResizeHandler() {
  const map = useLeafletMap();

  useEffect(() => {
    const container = map.getContainer();
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function ShipmentMap({
  route,
  telemetry,
  vehiclePosition,
  className,
  sessionStopped,
}: ShipmentMapProps) {
  const routePositions = useMemo(() => {
    const positions: LatLng[] = [];
    const add = (point: { latitude: number; longitude: number } | null | undefined) => {
      const latLng = toLatLng(point);
      if (latLng && !positions.some((p) => p[0] === latLng[0] && p[1] === latLng[1])) {
        positions.push(latLng);
      }
    };
    if (route) {
      add(route.origin);
      for (const point of route.points ?? []) add(point);
      add(route.destination);
    }
    return positions;
  }, [route]);

  const vehiclePositionLatLng = toLatLng(vehiclePosition);
  const boundsPositions =
    routePositions.length > 0
      ? routePositions
      : vehiclePositionLatLng
        ? [vehiclePositionLatLng]
        : [];

  const latestTelemetry = telemetry.length > 0 ? telemetry[0] : null;
  const displaySpeed = sessionStopped ? 0 : latestTelemetry?.speed;

  return (
    <LeafletMapContainer
      center={[15.0, 76.5]}
      zoom={7}
      className={cn("h-full w-full", className)}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom={false}
    >
      <ResizeHandler />
      <LeafletTileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {routePositions.length > 1 ? (
        <LeafletPolyline
          positions={routePositions}
          pathOptions={{ color: "#0b8575", weight: 4, opacity: 0.9 }}
        />
      ) : null}

      {route ? (
        <>
          {route.origin ? (
            <LeafletMarker position={[route.origin.latitude, route.origin.longitude]} icon={originIcon}>
              <Popup>Pickup: {route.origin.name}</Popup>
            </LeafletMarker>
          ) : null}
          {route.destination ? (
            <LeafletMarker
              position={[route.destination.latitude, route.destination.longitude]}
              icon={destinationIcon}
            >
              <Popup>Destination: {route.destination.name}</Popup>
            </LeafletMarker>
          ) : null}
        </>
      ) : null}

      {vehiclePositionLatLng ? (
        <LeafletMarker position={vehiclePositionLatLng} icon={vehicleIcon}>
          <Popup>
            {vehiclePosition?.reg_no || "Truck"} {displaySpeed != null ? `· ${displaySpeed} km/h` : ""}
          </Popup>
        </LeafletMarker>
      ) : null}

      <FitBounds positions={boundsPositions} />
    </LeafletMapContainer>
  );
}
