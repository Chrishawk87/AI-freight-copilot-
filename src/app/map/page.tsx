"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Truck Map merged into the single "Map" tab (/navigation). This route is
// kept as a redirect so old bookmarks and any lingering deep-links still land
// on the live map, preserving whatever query string they carried.
export default function MapRedirect() {
  const router = useRouter();
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    router.replace(`/navigation${qs}`);
  }, [router]);
  return null;
}
