"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
// Leaflet 1.9 ships no bundled TypeScript declarations in this project.
// @ts-expect-error - runtime module, narrowed below via LeafletModule.
import leafletModule from "leaflet";
import "leaflet/dist/leaflet.css";

type LatLng = [number, number];
type MarkerIcon = { readonly leafletIcon: true };
type LatLngBounds = { isValid(): boolean };

type ImageIconOptions = {
  iconUrl: string;
  iconRetinaUrl: string;
  shadowUrl: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
  shadowSize: [number, number];
};

type DivIconOptions = {
  className: string;
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
};

type LeafletModule = {
  icon(options: ImageIconOptions): MarkerIcon;
  divIcon(options: DivIconOptions): MarkerIcon;
  latLngBounds(corners: LatLng[]): LatLngBounds;
};

type MapInstance = {
  fitBounds(
    bounds: LatLngBounds,
    options?: { padding?: [number, number]; maxZoom?: number }
  ): MapInstance;
  setView(center: LatLng, zoom: number): MapInstance;
};

const L = leafletModule as LeafletModule;

// Narrow local component props: react-leaflet's own prop types depend on the
// missing Leaflet declarations, so they collapse to empty objects at typecheck.
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
  icon?: MarkerIcon;
  children?: React.ReactNode;
}>;
function useLeafletMap(): MapInstance {
  return useMap() as MapInstance;
}

function badgeIcon(color: string, label: string): MarkerIcon {
  return L.divIcon({
    className: "gps-badge-icon",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;border:3px solid #fff;box-shadow:0 1px 5px rgba(7,22,52,.4);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${label}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28],
  });
}

const originIcon = badgeIcon("#16a34a", "S");
const destinationIcon = badgeIcon("#dc2626", "E");
const vehicleIcon = badgeIcon("#0b8575", "V");

export type GpsTelemetryPoint = {
  id?: string;
  timestamp?: string | null;
  latitude: number;
  longitude: number;
  speed?: number | null;
  heading?: number | null;
  progress?: number | null;
  source?: string;
};

export type GpsVehiclePosition = {
  vehicle_id?: number;
  reg_no?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
};

export type GpsRouteGeometry = {
  route_id: number;
  origin: { name: string; latitude: number; longitude: number };
  destination: { name: string; latitude: number; longitude: number };
  points: Array<{ latitude: number; longitude: number }>;
  distance_km?: number;
};

type GpsMapProps = {
  telemetry: GpsTelemetryPoint[];
  vehiclePosition: GpsVehiclePosition | null;
  route?: GpsRouteGeometry | null;
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
  // Polling returns a fresh route object every few seconds; only refit when
  // the actual geometry changes so the map does not jump during tracking.
  const boundsKey = positions.map((position) => position.join(",")).join(";");

  useEffect(() => {
    if (positions.length === 0 || boundsKey === lastBoundsKey.current) return;
    lastBoundsKey.current = boundsKey;
    if (positions.length === 1) {
      map.setView(positions[0], 8);
      return;
    }
    const bounds = L.latLngBounds(positions);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
    }
  }, [map, positions, boundsKey]);

  return null;
}

export default function GpsMap({ telemetry, vehiclePosition, route, sessionStopped }: GpsMapProps) {
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
      for (const point of route.points) add(point);
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
      key={route?.route_id ?? "no-route"}
      center={[15.0, 76.5]}
      zoom={7}
      className="h-[480px] w-full"
      style={{ height: "480px", width: "100%" }}
      scrollWheelZoom={false}
    >
      <LeafletTileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {routePositions.length > 1 ? (
        <LeafletPolyline
          positions={routePositions}
          pathOptions={{ color: "#0b8575", weight: 3, opacity: 0.85 }}
        />
      ) : null}

      {route
        ? (() => {
            const origin = toLatLng(route.origin);
            const destination = toLatLng(route.destination);
            return (
              <>
                {origin ? (
                  <LeafletMarker position={origin} icon={originIcon}>
                    <Popup>Origin: {route.origin.name}</Popup>
                  </LeafletMarker>
                ) : null}
                {destination ? (
                  <LeafletMarker position={destination} icon={destinationIcon}>
                    <Popup>Destination: {route.destination.name}</Popup>
                  </LeafletMarker>
                ) : null}
              </>
            );
          })()
        : null}

      {vehiclePositionLatLng ? (
        <LeafletMarker position={vehiclePositionLatLng} icon={vehicleIcon}>
          <Popup>
            {vehiclePosition?.reg_no || "Tracked vehicle"}{" "}
            {displaySpeed != null ? `· ${displaySpeed} km/h` : ""}
          </Popup>
        </LeafletMarker>
      ) : null}

      <FitBounds positions={boundsPositions} />
    </LeafletMapContainer>
  );
}
