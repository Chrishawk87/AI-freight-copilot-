"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Fuel Intelligence merged into the single "Map" tab (/navigation), which shows
// live diesel pins + station cards on the map. Kept as a redirect so old
// bookmarks and co-pilot "open fuel" deep-links still resolve.
export default function FuelRedirect() {
  const router = useRouter();
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    router.replace(`/navigation${qs}`);
  }, [router]);
  return null;
}
