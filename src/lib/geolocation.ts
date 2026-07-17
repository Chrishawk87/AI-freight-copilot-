"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared geolocation primitives for the app. Uses the browser Geolocation API
// only — no paid service, no API key. Degrades gracefully when the user denies
// permission or the device has no GPS.

export type LatLon = { lat: number; lon: number };

export type GeoStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

// Geographic middle of the lower-48 — the neutral view before we have a fix.
export const US_CENTER: LatLon = { lat: 39.8283, lon: -98.5795 };

// Great-circle distance in miles between two coordinates.
export function haversineMiles(a: LatLon, b: LatLon): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// High-accuracy first. If the device can't get a precise fix in time we relax
// to a coarser, faster mode instead of giving up — a cell/wifi fix is far
// better than a dead map.
const GEO_OPTS_HIGH: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 12000,
};
const GEO_OPTS_LOW: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 30000,
  timeout: 20000,
};

// Extra live-navigation signals pulled from the GPS fix. `heading` is degrees
// clockwise from true north (null when stationary or unsupported); `speed` is
// meters/second; `accuracy` is the horizontal radius in meters.
export type GeoFix = {
  pos: LatLon;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
};

// Live position that tracks the driver via watchPosition. Returns the current
// fix (plus heading/speed/accuracy for navigation), a status for the UI, and a
// `request` fn to (re)prompt for permission.
export function useGeolocation() {
  const [pos, setPos] = useState<LatLon | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const watchRef = useRef<number | null>(null);
  const lowWatchRef = useRef<number | null>(null);
  const lastHeadingRef = useRef<number | null>(null);
  const lastPosRef = useRef<LatLon | null>(null);

  const apply = useCallback((p: GeolocationPosition) => {
    const next: LatLon = { lat: p.coords.latitude, lon: p.coords.longitude };
    // Derive a heading from consecutive fixes when the device doesn't report
    // one (common on laptops / stationary phones), so the truck still faces
    // the direction of travel.
    let hdg = p.coords.heading;
    if (hdg == null || Number.isNaN(hdg)) {
      const prev = lastPosRef.current;
      if (prev) {
        const moved = haversineMiles(prev, next);
        if (moved > 0.005) hdg = bearing(prev, next);
        else hdg = lastHeadingRef.current;
      } else hdg = lastHeadingRef.current;
    }
    if (hdg != null && !Number.isNaN(hdg)) lastHeadingRef.current = hdg;
    lastPosRef.current = next;

    setPos(next);
    setHeading(lastHeadingRef.current);
    setSpeed(p.coords.speed != null && !Number.isNaN(p.coords.speed) ? p.coords.speed : null);
    setAccuracy(p.coords.accuracy ?? null);
    setStatus("ok");
  }, []);

  const startWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    // Clear any prior watches so we never stack duplicates.
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    if (lowWatchRef.current != null) {
      navigator.geolocation.clearWatch(lowWatchRef.current);
      lowWatchRef.current = null;
    }

    let gotFix = false;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        gotFix = true;
        apply(p);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus("denied");
          return;
        }
        // High-accuracy timed out / failed: fall back to a coarse watch rather
        // than showing an unavailable map. Keep whatever fix we have.
        if (!gotFix && lowWatchRef.current == null) {
          lowWatchRef.current = navigator.geolocation.watchPosition(
            (p) => apply(p),
            () => setStatus((s) => (s === "ok" ? s : "unavailable")),
            GEO_OPTS_LOW,
          );
        } else if (!gotFix) {
          setStatus((s) => (s === "ok" ? s : "unavailable"));
        }
      },
      GEO_OPTS_HIGH,
    );
    watchRef.current = id;
  }, [apply]);

  const request = useCallback(() => {
    // Re-prompting / retry just restarts the layered watch.
    startWatch();
  }, [startWatch]);

  // Watch once on mount, then keep tracking in the background so "nearby"
  // stays live as the driver moves.
  useEffect(() => {
    startWatch();
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      if (lowWatchRef.current != null) navigator.geolocation.clearWatch(lowWatchRef.current);
    };
  }, [startWatch]);

  return { pos, heading, speed, accuracy, status, request };
}

// Initial bearing (degrees clockwise from north) from point a to point b.
export function bearing(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
