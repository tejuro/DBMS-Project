"use client";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";
// Leaflet 1.9 ships no bundled TypeScript declarations in this project.
// @ts-expect-error - runtime module, narrowed below via LeafletModule.
import leafletModule from "leaflet";
import "leaflet/dist/leaflet.css";

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
const LeafletMarker = Marker as unknown as React.ComponentType<{
  position: LatLng;
  icon?: unknown;
  children?: React.ReactNode;
}>;

const warehouseIcon = L.divIcon({
  className: "dashboard-warehouse-icon",
  html: `<div style="width:24px;height:24px;border-radius:50%;background:#16a34a;color:#fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(7,22,52,.4);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;">W</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -28],
});

const vehicleIcon = L.divIcon({
  className: "dashboard-vehicle-icon",
  html: `<div style="width:24px;height:24px;border-radius:50%;background:#0b8575;color:#fff;border:3px solid #fff;box-shadow:0 1px 4px rgba(7,22,52,.4);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;">V</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -28],
});

type DashboardMapProps = {
  warehouses: Array<{ name: string; city: string; latitude: number; longitude: number }>;
  shipments: Array<{ shipment_id: number; status: string; latitude?: number | null; longitude?: number | null }>;
  className?: string;
};

export default function DashboardMap({
  warehouses,
  shipments,
  className,
}: DashboardMapProps) {
  if (warehouses.length === 0 && shipments.length === 0) {
    return (
      <div className={className ?? "w-full h-56 rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center text-sm text-slate-400"}>
        No map data available
      </div>
    );
  }

  const center: LatLng = [13.0, 76.0]; // Karnataka center

  return (
    <LeafletMapContainer
      center={center}
      zoom={7}
      className={className ?? "w-full h-56"}
      style={{ height: "224px", width: "100%" }}
      scrollWheelZoom={false}
    >
      <LeafletTileLayer
        attribution="&copy; OpenStreetMap contributors"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {warehouses.map((w) => {
        const pos: LatLng = [w.latitude, w.longitude];
        return (
          <LeafletMarker
            key={`wh-${w.name}`}
            position={pos}
            icon={warehouseIcon}
          >
            <Popup>{w.name}</Popup>
          </LeafletMarker>
        );
      })}

      {shipments.map((s) => {
        const lat = Number(s.latitude);
        const lng = Number(s.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const pos: LatLng = [lat, lng];
        return (
          <LeafletMarker
            key={`ship-${s.shipment_id}`}
            position={pos}
            icon={vehicleIcon}
          >
            <Popup>Shipment #{s.shipment_id} — {s.status}</Popup>
          </LeafletMarker>
        );
      })}

    </LeafletMapContainer>
  );
}
