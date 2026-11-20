/**
 * Karnataka-only road corridor geometry for the GPS simulator.
 *
 * Every coordinate below is an actual town/city inside Karnataka. The routes
 * are polylines through those towns (never arbitrary generated points) so the
 * simulator never leaves the state and the marker cannot jump between steps.
 */

export type GeoPoint = { latitude: number; longitude: number };
export type GeoLocation = GeoPoint & { name: string };

export type GeoRoute = {
  id: number;
  origin: GeoLocation;
  destination: GeoLocation;
  /** Full corridor geometry, including the origin and destination as endpoints. */
  points: GeoPoint[];
  distance_km: number;
  estimated_duration_minutes: number;
};

export type GeoCoordinates = GeoPoint & { heading: number };

export const KARNATAKA_LOCATIONS: Record<string, GeoLocation> = {
  // Contract endpoints (exact coordinates).
  BENGALURU: { name: "Bengaluru", latitude: 12.9716, longitude: 77.5946 },
  MYSURU: { name: "Mysuru", latitude: 12.2958, longitude: 76.6394 },
  MANGALURU: { name: "Mangaluru", latitude: 12.9141, longitude: 74.856 },
  HUBBALLI: { name: "Hubballi", latitude: 15.3647, longitude: 75.124 },
  BELAGAVI: { name: "Belagavi", latitude: 15.8497, longitude: 74.4977 },
  SHIVAMOGGA: { name: "Shivamogga", latitude: 13.9299, longitude: 75.5681 },
  TUMAKURU: { name: "Tumakuru", latitude: 13.3379, longitude: 77.1173 },

  // Intermediate Karnataka towns along the road corridors below.
  RAMANAGARA: { name: "Ramanagara", latitude: 12.673, longitude: 77.5946 },
  CHANNAPATNA: { name: "Channapatna", latitude: 12.635, longitude: 77.209 },
  MADDUR: { name: "Maddur", latitude: 12.594, longitude: 76.874 },
  MANDYA: { name: "Mandya", latitude: 12.5235, longitude: 76.8724 },
  SRIRANGAPATNA: { name: "Srirangapatna", latitude: 12.41, longitude: 76.7 },
  HASSAN: { name: "Hassan", latitude: 13.1519, longitude: 76.1028 },
  BELUR: { name: "Belur", latitude: 13.1616, longitude: 75.8608 },
  SAKLESHUPUR: { name: "Sakleshpur", latitude: 12.9605, longitude: 75.741 },
  KUKKE_SUBRAMANYA: {
    name: "Kukke Subramanya",
    latitude: 12.952,
    longitude: 75.293,
  },
  NELAMANGALA: { name: "Nelamangala", latitude: 13.0782, longitude: 77.4016 },
  HESARAGHATTA: { name: "Hesaraghatta", latitude: 13.09, longitude: 77.49 },
  SOLUR: { name: "Solur", latitude: 13.064, longitude: 77.18 },
  KUNIGAL: { name: "Kunigal", latitude: 13.036, longitude: 77.025 },
  CHITRADURGA: { name: "Chitradurga", latitude: 14.4027, longitude: 76.4047 },
  DAVANAGERE: { name: "Davanagere", latitude: 14.4644, longitude: 75.9963 },
  HARIHAR: { name: "Harihar", latitude: 14.5339, longitude: 75.7664 },
  RANE_BENNUR: { name: "Ranebennur", latitude: 14.619, longitude: 75.605 },
  TARIKERE: { name: "Tarikere", latitude: 13.68, longitude: 75.75 },
  BHADRAVATI: { name: "Bhadravati", latitude: 13.95, longitude: 75.76 },
  DHARWAD: { name: "Dharwad", latitude: 15.4881, longitude: 74.981 },
  ALNAVAR: { name: "Alnavar", latitude: 15.45, longitude: 74.7167 },
  LONDA: { name: "Londa", latitude: 15.4833, longitude: 74.55 },
  KHANAPUR: { name: "Khanapur", latitude: 15.6389, longitude: 74.4353 },
};

type LocationKey = keyof typeof KARNATAKA_LOCATIONS;

function at(key: LocationKey): GeoPoint {
  const location = KARNATAKA_LOCATIONS[key];
  return { latitude: location.latitude, longitude: location.longitude };
}

const ROUTE_DEFINITIONS: GeoRoute[] = [
  {
    id: 1,
    origin: KARNATAKA_LOCATIONS.BENGALURU,
    destination: KARNATAKA_LOCATIONS.MYSURU,
    // NH 275 corridor through Ramanagara, Mandya and Srirangapatna.
    points: [
      at("BENGALURU"),
      at("RAMANAGARA"),
      at("CHANNAPATNA"),
      at("MADDUR"),
      at("MANDYA"),
      at("SRIRANGAPATNA"),
      at("MYSURU"),
    ],
    distance_km: 145,
    estimated_duration_minutes: 180,
  },
  {
    id: 2,
    origin: KARNATAKA_LOCATIONS.BENGALURU,
    destination: KARNATAKA_LOCATIONS.MANGALURU,
    // NH 75 corridor through Hassan, Belur and Sakleshpur.
    points: [
      at("BENGALURU"),
      at("NELAMANGALA"),
      at("HASSAN"),
      at("BELUR"),
      at("SAKLESHUPUR"),
      at("KUKKE_SUBRAMANYA"),
      at("MANGALURU"),
    ],
    distance_km: 430,
    estimated_duration_minutes: 480,
  },
  {
    id: 3,
    origin: KARNATAKA_LOCATIONS.BENGALURU,
    destination: KARNATAKA_LOCATIONS.HUBBALLI,
    // NH 48 corridor through Chitradurga, Davanagere, Harihar and Dharwad.
    points: [
      at("BENGALURU"),
      at("NELAMANGALA"),
      at("CHITRADURGA"),
      at("DAVANAGERE"),
      at("HARIHAR"),
      at("RANE_BENNUR"),
      at("DHARWAD"),
      at("HUBBALLI"),
    ],
    distance_km: 410,
    estimated_duration_minutes: 450,
  },
  {
    id: 4,
    origin: KARNATAKA_LOCATIONS.MYSURU,
    destination: KARNATAKA_LOCATIONS.SHIVAMOGGA,
    // Mysuru - Mandya - Hassan - Belur - Tarikere - Bhadravati.
    points: [
      at("MYSURU"),
      at("MANDYA"),
      at("HASSAN"),
      at("BELUR"),
      at("TARIKERE"),
      at("BHADRAVATI"),
      at("SHIVAMOGGA"),
    ],
    distance_km: 285,
    estimated_duration_minutes: 360,
  },
  {
    id: 5,
    origin: KARNATAKA_LOCATIONS.HUBBALLI,
    destination: KARNATAKA_LOCATIONS.BELAGAVI,
    // NH 48 corridor through Dharwad, Alnavar, Londa and Khanapur.
    points: [
      at("HUBBALLI"),
      at("DHARWAD"),
      at("ALNAVAR"),
      at("LONDA"),
      at("KHANAPUR"),
      at("BELAGAVI"),
    ],
    distance_km: 95,
    estimated_duration_minutes: 110,
  },
  {
    id: 6,
    origin: KARNATAKA_LOCATIONS.BENGALURU,
    destination: KARNATAKA_LOCATIONS.TUMAKURU,
    // Short NH 48 / NH 75 feeder corridor north-west of Bengaluru.
    points: [
      at("BENGALURU"),
      at("HESARAGHATTA"),
      at("NELAMANGALA"),
      at("SOLUR"),
      at("KUNIGAL"),
      at("TUMAKURU"),
    ],
    distance_km: 72,
    estimated_duration_minutes: 95,
  },
];

export const GEO_ROUTES: Record<number, GeoRoute> = Object.fromEntries(
  ROUTE_DEFINITIONS.map((route) => [route.id, route])
) as Record<number, GeoRoute>;

export function getGeoRoute(routeId: number): GeoRoute | null {
  return GEO_ROUTES[routeId] ?? null;
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 1e-9 &&
    Math.abs(a.longitude - b.longitude) < 1e-9
  );
}

function toPoint(location: GeoPoint): GeoPoint {
  return { latitude: location.latitude, longitude: location.longitude };
}

/** Full path including the declared origin/destination even if points omit them. */
function pathFor(route: GeoRoute): GeoPoint[] {
  const path = route.points.filter(
    (point) =>
      Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  );

  if (path.length === 0 || !samePoint(path[0], route.origin)) {
    path.unshift(toPoint(route.origin));
  }
  if (!samePoint(path[path.length - 1], route.destination)) {
    path.push(toPoint(route.destination));
  }
  return path;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceKmBetween(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function headingBetween(from: GeoPoint, to: GeoPoint): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * Piecewise-linear interpolation along the route's real road waypoints.
 * Progress is clamped to 0..1; the heading is the bearing of the current leg.
 * Throws for an unknown route id.
 */
export function pointAtProgress(routeId: number, progress: number): GeoCoordinates {
  const route = getGeoRoute(routeId);
  if (!route) {
    throw new Error(`Unknown GPS route: ${routeId}`);
  }

  const path = pathFor(route);
  const clamped = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;

  const segments = path.slice(1).map((end, index) => ({
    start: path[index],
    end,
    lengthKm: distanceKmBetween(path[index], end),
  }));

  const totalKm = segments.reduce((sum, segment) => sum + segment.lengthKm, 0);
  if (totalKm <= 0 || segments.length === 0) {
    return { ...path[0], heading: 0 };
  }

  const targetKm = totalKm * clamped;
  let travelledKm = 0;

  for (const segment of segments) {
    const segmentEndKm = travelledKm + segment.lengthKm;
    if (targetKm <= segmentEndKm || segment === segments[segments.length - 1]) {
      const fraction =
        segment.lengthKm > 0
          ? Math.min(1, Math.max(0, (targetKm - travelledKm) / segment.lengthKm))
          : 0;
      return {
        latitude:
          segment.start.latitude +
          (segment.end.latitude - segment.start.latitude) * fraction,
        longitude:
          segment.start.longitude +
          (segment.end.longitude - segment.start.longitude) * fraction,
        heading: headingBetween(segment.start, segment.end),
      };
    }
    travelledKm = segmentEndKm;
  }

  const last = path[path.length - 1];
  const previous = path[path.length - 2];
  return { ...last, heading: headingBetween(previous, last) };
}

/** Leaflet-friendly bounds for fitting the map to a route. */
export function bboxForRoute(
  routeId: number
): { south: number; west: number; north: number; east: number } | null {
  const route = getGeoRoute(routeId);
  if (!route) return null;

  const path = [toPoint(route.origin), ...pathFor(route), toPoint(route.destination)];
  return {
    south: Math.min(...path.map((point) => point.latitude)),
    west: Math.min(...path.map((point) => point.longitude)),
    north: Math.max(...path.map((point) => point.latitude)),
    east: Math.max(...path.map((point) => point.longitude)),
  };
}
