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

const GEO_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10000,
  timeout: 15000,
};

// Live position that tracks the driver via watchPosition. Returns the current
// fix, a status for the UI, and a `request` fn to (re)prompt for permission.
export function useGeolocation() {
  const [pos, setPos] = useState<LatLon | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  const watchRef = useRef<number | null>(null);

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
        setStatus("ok");
      },
      (err) =>
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      GEO_OPTS
    );
  }, []);

  // Watch once on mount, then keep tracking in the background so "nearby"
  // stays live as the driver moves.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude });
        setStatus("ok");
      },
      (err) =>
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      GEO_OPTS
    );
    watchRef.current = id;
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  return { pos, status, request };
}
