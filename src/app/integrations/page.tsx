"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Check,
  Plug,
  Truck,
  Radio,
  Calculator,
  PackageCheck,
  Fuel,
  Wrench,
  Navigation,
  AudioLines,
  Brain,
  ScanLine,
  Banknote,
  ClipboardList,
  HelpCircle,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/ui";
import clsx from "clsx";
import {
  PLUGINS_KEY as STORAGE_KEY_SHARED,
  PLUGIN_KEYS_KEY,
  readKeys,
  type KeyMap,
} from "@/lib/plugins";
import { api, getToken } from "@/lib/api";

type Plugin = {
  id: string;
  name: string;
  category: string;
  blurb: string;
  status?: "beta" | "soon";
  // If set, connecting this plugin reveals a field for the client's own API key.
  needsKey?: boolean;
  keyHint?: string;
  // An optional second, non-secret field (e.g. a chosen voice ID) shown once
  // connected. Stored under its own key id in the same key map.
  extraField?: { id: string; label: string; hint: string };
  // Documentation shown on the card (used for load boards).
  cost?: "Free" | "Freemium" | "Paid";
  equipment?: string[];
  website?: string;
  // One honest line about whether a public API exists for live load pulls.
  apiNote?: string;
};

type Category = {
  key: string;
  label: string;
  icon: LucideIcon;
  desc: string;
};

const CATEGORIES: Category[] = [
  { key: "loadboards", label: "Load Boards", icon: Truck, desc: "Find and book freight" },
  { key: "tms", label: "TMS & Dispatch", icon: ClipboardList, desc: "Dispatch, invoicing, settlements, IFTA" },
  { key: "gps", label: "Truck GPS & Navigation", icon: Navigation, desc: "Truck-legal routing and turn-by-turn" },
  { key: "telematics", label: "ELD & Telematics", icon: Radio, desc: "Hours of service, tracking, diagnostics" },
  { key: "accounting", label: "Accounting & Payments", icon: Calculator, desc: "Invoicing, bookkeeping, expenses" },
  { key: "factoring", label: "Factoring & Cash Flow", icon: Banknote, desc: "Get paid on invoices in hours, not weeks" },
  { key: "lastmile", label: "Last-Mile & Delivery", icon: PackageCheck, desc: "On-demand and local delivery gigs" },
  { key: "fuel", label: "Fuel & Savings", icon: Fuel, desc: "Discounts, fuel cards, and station networks" },
  { key: "maintenance", label: "Fleet & Maintenance", icon: Wrench, desc: "Service, parts, and asset tracking" },
  { key: "documents", label: "Documents & Compliance", icon: ScanLine, desc: "Scan BOL/POD and read the fields automatically" },
  { key: "voice", label: "Co-Pilot Voice", icon: AudioLines, desc: "Give your Co-Pilot a real human voice" },
  { key: "brain", label: "Co-Pilot Brain", icon: Brain, desc: "Upgrade your Co-Pilot's reasoning with Claude" },
];

const PLUGINS: Plugin[] = [
  // ---- Free load boards (no subscription to search) ----
  { id: "trucksmarter", name: "TruckSmarter", category: "loadboards", blurb: "100% free load board that aggregates 100K+ daily loads from other sources into one feed. Search, bid, and Book Now at no cost.", status: "beta", cost: "Free",
    equipment: ["Dry Van", "Reefer", "Flatbed", "Power Only", "Step Deck", "Conestoga", "Container", "Box Truck", "Hotshot", "Car Hauling"],
    website: "https://www.trucksmarter.com/free-load-boards", apiNote: "No public API — free via web & mobile app." },
  { id: "trulos", name: "Trulos", category: "loadboards", blurb: "Free since 2006. Search live loads by state and equipment with no login and zero signup friction.", status: "beta", cost: "Free",
    equipment: ["Flatbed", "Dry Van", "Reefer", "Auto Carrier", "Hotshot", "Step Deck", "Power Only", "Lowboy", "Dump"],
    website: "https://www.trulos.com/load-board", apiNote: "No public API — free web board, no account needed." },
  { id: "nextload", name: "NextLOAD", category: "loadboards", blurb: "Genuinely free board operated by Apex Capital. Open search with no subscription and no factoring account required.", status: "beta", cost: "Free",
    equipment: ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Hotshot"],
    website: "https://nextload.com", apiNote: "No public API — free web & app search." },
  { id: "directfreight", name: "Direct Freight", category: "loadboards", blurb: "300K+ loads daily from brokers and shippers. Free tier for searching; paid tiers add credit reports and alerts.", status: "beta", cost: "Freemium",
    equipment: ["Dry Van", "Flatbed", "Reefer", "Step Deck", "Double Drop", "Vented Van", "Curtain Van"],
    website: "https://www.directfreight.com", apiNote: "No public API — free tier + paid plans up to $34.95/mo." },
  { id: "coyotego", name: "CoyoteGo (C.H. Robinson)", category: "loadboards", blurb: "Free digital freight app from C.H. Robinson. Book directly with one of the largest brokers in North America.", status: "beta", cost: "Free",
    equipment: ["Dry Van", "Reefer", "Container", "Flatbed", "Step Deck", "RGN", "Hotshot", "Liftgate"],
    website: "https://coyote.com/carriers/coyotego", apiNote: "Partner API via C.H. Robinson (approval required)." },
  { id: "loadie", name: "TrueNorth Loadie", category: "loadboards", blurb: "Free, box-truck-friendly board. Post availability and get push-match notifications built for straight trucks.", status: "beta", cost: "Free",
    equipment: ["Box Truck (26')", "Cargo Van", "Sprinter", "Dry Van"],
    website: "https://www.truenorthfleet.com", apiNote: "No public API — free web & app." },
  { id: "uship", name: "uShip", category: "loadboards", blurb: "Open freight marketplace. Free to search and bid on specialized, LTL, auto, heavy-haul, and oversized loads.", status: "beta", cost: "Free",
    equipment: ["Flatbed", "Step Deck", "RGN / Lowboy", "Auto Carrier", "LTL", "Heavy Haul", "Boat / Oversized"],
    website: "https://www.uship.com/carriers", apiNote: "Partner API available (contact uShip)." },
  { id: "uberfreight", name: "Uber Freight", category: "loadboards", blurb: "Free carrier app with upfront pricing and instant booking. No subscription to browse and book.", status: "beta", cost: "Free",
    equipment: ["Dry Van", "Reefer", "Flatbed"],
    website: "https://www.uberfreight.com/carriers", apiNote: "Partner API for TMS integration (approval required)." },
  { id: "amazonrelay", name: "Amazon Relay", category: "loadboards", blurb: "Free load board for Amazon freight. Requires a qualifying carrier account (DOT/MC, insurance).", status: "beta", cost: "Free",
    equipment: ["Dry Van (53')", "Box Truck"],
    website: "https://relay.amazon.com", apiNote: "No public API — app-only for approved carriers." },

  // ---- Major paid / partner-API boards ----
  { id: "123loadboard", name: "123Loadboard", category: "loadboards", blurb: "Freight matching with rate check and credit tools. Limited free search (≈5 loads/day); paid plans unlock full access. Has a partner API for live pulls — paste a partner key to enable.", status: "beta", cost: "Freemium",
    equipment: ["Flatbed", "Dry Van", "Reefer", "Step Deck", "Power Only", "Auto Carrier", "Box Truck", "Conestoga", "Container", "Hopper Bottom", "Hotshot", "Tanker", "Lowboy"],
    website: "https://www.123loadboard.com/api", apiNote: "Partner API (email partner-integrations@123loadboard.com).",
    needsKey: true, keyHint: "123Loadboard partner API key" },
  { id: "dat", name: "DAT", category: "loadboards", blurb: "The largest truckload marketplace in North America. Subscription board with a developer API (setup fee applies). Paste your DAT API key to turn on live pulls.", status: "beta", cost: "Paid",
    equipment: ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Hotshot"],
    website: "https://www.dat.com/api-integration", apiNote: "Developer API — paid setup + subscription.",
    needsKey: true, keyHint: "DAT API key" },
  { id: "truckstop", name: "Truckstop", category: "loadboards", blurb: "Load board with rate insights and broker credit checks. Strong for flatbed and hotshot. Partner API available for live pulls.", status: "beta", cost: "Paid",
    equipment: ["Flatbed", "Step Deck", "Hotshot", "Dry Van", "Reefer", "Power Only", "RGN"],
    website: "https://truckstop.com/integrations", apiNote: "Partner API (approval required).",
    needsKey: true, keyHint: "Truckstop API key" },
  { id: "truckerpath", name: "Trucker Path (Truckloads)", category: "loadboards", blurb: "150K+ daily loads plus parking, weigh stations, and truck-safe routing. Free tier (≈5 loads/day); paid plans unlock full search.", status: "beta", cost: "Freemium",
    equipment: ["Dry Van", "Reefer", "Flatbed", "Step Deck", "Power Only", "Auto Carrier", "Box Truck", "Conestoga", "Hopper Bottom", "Hotshot", "Tanker", "Lowboy"],
    website: "https://truckerpath.com/truckloads", apiNote: "No public API — free tier + paid plans." },

  { id: "trimble", name: "Trimble Maps", category: "gps", blurb: "PC*MILER truck-legal routing and mileage. Connect your key and the Maps screen switches to Trimble automatically.", status: "beta", needsKey: true, keyHint: "Trimble Maps API key" },
  { id: "googlemaps", name: "Google Maps", category: "gps", blurb: "Google Maps engine for the in-app map. Add your Maps JavaScript API key to power it.", status: "beta", needsKey: true, keyHint: "Google Maps API key" },
  { id: "herewego", name: "HERE Maps", category: "gps", blurb: "HERE navigation with truck attributes (dimensions, weight, hazmat).", status: "beta", needsKey: true, keyHint: "HERE API key" },
  { id: "hammer", name: "Hammer GPS", category: "gps", blurb: "Truck-safe GPS routing (Hammer Trucking).", status: "soon" },
  { id: "truckmap", name: "TruckMap", category: "gps", blurb: "Truck routing, fuel, parking, and weigh stations.", status: "soon" },
  { id: "copilot", name: "CoPilot Truck GPS", category: "gps", blurb: "Commercial truck navigation by Trimble.", status: "soon" },
  { id: "sygic", name: "Sygic Truck", category: "gps", blurb: "Truck & RV navigation with offline maps.", status: "soon" },
  { id: "smarttruckroute", name: "SmartTruckRoute", category: "gps", blurb: "Live truck-legal routing by TeleType.", status: "soon" },
  { id: "ptv", name: "PTV Navigator", category: "gps", blurb: "Professional truck routing and logistics.", status: "soon" },
  { id: "motive", name: "Motive", category: "telematics", blurb: "ELD, dash cams, and fleet management (formerly KeepTruckin).", status: "beta" },
  { id: "geotab", name: "Geotab", category: "telematics", blurb: "GPS tracking and vehicle telematics.", status: "soon" },
  { id: "samsara", name: "Samsara", category: "telematics", blurb: "Connected operations: ELD, cameras, and diagnostics.", status: "soon" },
  { id: "quickbooks", name: "QuickBooks", category: "accounting", blurb: "Sync loads to invoices, expenses, and profit reports.", status: "beta" },
  { id: "mudflap", name: "Mudflap", category: "fuel", blurb: "Instant diesel discounts at thousands of stations.", status: "soon" },
  { id: "pilot", name: "Pilot Flying J", category: "fuel", blurb: "myRewards Plus loyalty pricing and station data.", status: "soon" },
  { id: "loves", name: "Love's", category: "fuel", blurb: "Love's Connect fuel savings and amenities.", status: "soon" },
  { id: "roadie", name: "Roadie", category: "lastmile", blurb: "On-demand delivery marketplace by UPS.", status: "beta" },
  { id: "bungii", name: "Bungii", category: "lastmile", blurb: "Big & bulky local delivery on demand.", status: "soon" },
  { id: "senpex", name: "Senpex", category: "lastmile", blurb: "Same-day courier and route delivery.", status: "soon" },
  { id: "fleetio", name: "Fleetio", category: "maintenance", blurb: "Maintenance schedules, work orders, and parts.", status: "beta" },

  { id: "ocr", name: "Document AI (OCR)", category: "documents", blurb: "Snap a photo of a BOL or POD and the fields read themselves — BOL#, PRO#, shipper, consignee, pieces, weight, and signature — then auto-match to your booked load and stage the invoice. This works out of the box on your subscription; nothing to set up. Optional: paste your OWN OCR provider key (Mindee) only if you'd rather run extraction on your own account.", status: "beta", needsKey: true, keyHint: "Your own OCR key (optional)" },

  { id: "elevenlabs", name: "ElevenLabs", category: "voice", blurb: "Swap the built-in voice for a genuinely human one. Paste your ElevenLabs API key. Heads up: free ElevenLabs plans can't use the stock voices over the API — add your own voice in your ElevenLabs library and paste its Voice ID below, or upgrade your plan.", status: "beta", needsKey: true, keyHint: "ElevenLabs API key", extraField: { id: "elevenlabs_voice", label: "Voice ID", hint: "ElevenLabs Voice ID (optional)" } },

  { id: "anthropic", name: "Claude (Anthropic)", category: "brain", blurb: "Your Co-Pilot already runs on Claude's brain — reasoning, researching, and talking like a real co-driver — included with your subscription. Nothing to set up. Optional: paste your OWN Anthropic key only if you'd rather it bill your own account and run straight from this device.", status: "beta", needsKey: true, keyHint: "Your own Anthropic key (optional, sk-ant-…)", extraField: { id: "anthropic_model", label: "Model (optional)", hint: "e.g. claude-haiku-4-5-20251001" } },

  // ---- TMS & Dispatch ----
  { id: "truckbase", name: "Truckbase", category: "tms", blurb: "Modern cloud TMS for 10–100 truck fleets — dispatch, invoicing, driver settlements, live tracking links, and AI data entry.", status: "soon", website: "https://www.truckbase.com", apiNote: "API + partner integrations (access on request)." },
  { id: "alvys", name: "Alvys", category: "tms", blurb: "Unified carrier + brokerage TMS — dispatch, billing, safety, and load tracking in one system.", status: "soon", website: "https://www.alvys.com", apiNote: "Open API + integration marketplace." },
  { id: "roserocket", name: "Rose Rocket", category: "tms", blurb: "Order automation, customer portals, and dispatch with AI-assisted workflows.", status: "soon", website: "https://www.roserocket.com", apiNote: "Public REST API (varies by plan tier)." },
  { id: "ascendtms", name: "AscendTMS", category: "tms", blurb: "Affordable cloud TMS for carriers and brokers with a free tier for very small operations.", status: "soon", website: "https://www.thefreetms.com", apiNote: "Developer API available." },
  { id: "axon", name: "Axon Software", category: "tms", blurb: "All-in-one trucking software with real-time accounting, dispatch, and IFTA — built for small fleets.", status: "soon", website: "https://axonsoftware.com", apiNote: "Vendor-built integrations; no open public API." },
  { id: "protransport", name: "ProTransport", category: "tms", blurb: "TMS for owner-operators and small fleets — dispatch, accounting, ELD, and maintenance.", status: "soon", website: "https://www.protransport.com", apiNote: "Integrations via ProTransport." },
  { id: "tailwind", name: "Tailwind TMS", category: "tms", blurb: "Owner-operator TMS from ~$99/mo — dispatch, invoicing, and IFTA in one place.", status: "soon", website: "https://www.tailwindtms.com", apiNote: "API + Zapier integrations." },
  { id: "truckingoffice", name: "TruckingOffice", category: "tms", blurb: "Low-cost record-keeping, invoicing, and IFTA reporting for single owner-operators.", status: "soon", website: "https://truckingoffice.com", apiNote: "No public API." },
  { id: "turvo", name: "Turvo", category: "tms", blurb: "Collaborative TMS with real-time visibility across shippers, brokers, and carriers.", status: "soon", website: "https://turvo.com", apiNote: "Public API + integration hub." },
  { id: "mcleod", name: "McLeod LoadMaster", category: "tms", blurb: "Enterprise-grade TMS for large fleets — deeply customizable dispatch and accounting.", status: "soon", website: "https://www.mcleodsoftware.com", apiNote: "Integration toolkit (enterprise)." },

  // ---- More ELD & Telematics ----
  { id: "omnitracs", name: "Omnitracs (Solera)", category: "telematics", blurb: "ELD, routing, and compliance from one of the oldest names in fleet telematics.", status: "soon", apiNote: "Developer/partner API." },
  { id: "verizonconnect", name: "Verizon Connect", category: "telematics", blurb: "GPS fleet tracking, ELD, and vehicle diagnostics (Reveal).", status: "soon", apiNote: "REST API (Reveal)." },
  { id: "eroad", name: "EROAD", category: "telematics", blurb: "ELD, IFTA, and fleet telematics with strong tax/compliance reporting.", status: "soon", apiNote: "Partner API." },
  { id: "fleetcomplete", name: "Fleet Complete / BigRoad", category: "telematics", blurb: "ELD and GPS tracking popular with owner-operators and small fleets.", status: "soon", apiNote: "Developer API." },
  { id: "garminelog", name: "Garmin eLog", category: "telematics", blurb: "Simple no-subscription ELD for hours-of-service compliance.", status: "soon", apiNote: "No public API — device only." },

  // ---- More Accounting ----
  { id: "xero", name: "Xero", category: "accounting", blurb: "Cloud accounting — sync loads to invoices, bills, and expense reports.", status: "soon", website: "https://www.xero.com", apiNote: "Full public API." },
  { id: "rigbooks", name: "Rigbooks", category: "accounting", blurb: "Simple bookkeeping and true cost-per-mile tracking built for owner-operators.", status: "soon", website: "https://www.rigbooks.com", apiNote: "No public API." },
  { id: "trucklogics", name: "TruckLogics", category: "accounting", blurb: "Accounting, IFTA, and driver settlements with a load-management layer.", status: "soon", website: "https://www.trucklogics.com", apiNote: "Integrations available." },

  // ---- Factoring & Cash Flow ----
  { id: "apex", name: "Apex Capital", category: "factoring", blurb: "Freight factoring — fund invoices in minutes with the Blynk app, plus a fuel card and discounts. No minimum volume.", status: "soon", cost: "Paid", website: "https://www.apexcapitalcorp.com", apiNote: "Partner API (via TMS integrations)." },
  { id: "rts", name: "RTS Financial", category: "factoring", blurb: "24-hour funding, a mobile app, and one of the larger fuel-discount networks.", status: "soon", cost: "Paid", website: "https://www.rtsinc.com", apiNote: "Partner integrations." },
  { id: "otr", name: "OTR Solutions", category: "factoring", blurb: "Non-recourse factoring with genuinely open developer APIs for invoice/rate verification and document exchange.", status: "soon", cost: "Paid", website: "https://otrsolutions.com", apiNote: "Open developer API (Rate Verification, Document Exchange, Carrier Setup)." },
  { id: "tbs", name: "TBS Factoring", category: "factoring", blurb: "Same-day funding, free broker credit checks, and a fuel card.", status: "soon", cost: "Paid", website: "https://www.tbsfactoring.com", apiNote: "Portal-based; no public API." },
  { id: "triumph", name: "Triumph", category: "factoring", blurb: "24/7 funding with transparent pricing; non-recourse contracts available.", status: "soon", cost: "Paid", website: "https://www.mytriumph.com", apiNote: "Partner integrations." },
  { id: "bobtail", name: "Bobtail", category: "factoring", blurb: "Non-recourse factoring with a flat fee and same-day pay — no long-term contract.", status: "soon", cost: "Paid", website: "https://www.bobtail.com", apiNote: "TMS integrations." },
  { id: "ecapital", name: "eCapital", category: "factoring", blurb: "Funding in as little as one hour, advances up to 90%, recourse or non-recourse.", status: "soon", cost: "Paid", website: "https://ecapital.com", apiNote: "Factoring API (developer hub)." },
  { id: "tafs", name: "TAFS", category: "factoring", blurb: "One-hour weekday funding with weekend advances and fuel discounts.", status: "soon", cost: "Paid", website: "https://www.tafs.com", apiNote: "Portal-based." },
  { id: "datoutgo", name: "DAT Outgo", category: "factoring", blurb: "Low-rate factoring built into DAT — fast funding, no long-term contract.", status: "soon", cost: "Paid", apiNote: "Integrated with DAT." },
  { id: "truckstopfactoring", name: "Truckstop Factoring", category: "factoring", blurb: "Flat-rate non-recourse factoring from ~2.99%, wired into the Truckstop board.", status: "soon", cost: "Paid", apiNote: "Integrated with Truckstop." },

  // ---- More Fuel & Fuel Cards ----
  { id: "ta", name: "TA / Petro (Ultra ONE)", category: "fuel", blurb: "TravelCenters of America loyalty pricing and the largest full-service truck-stop network.", status: "soon", apiNote: "No public API — loyalty app." },
  { id: "wex", name: "WEX Fleet Cards", category: "fuel", blurb: "Fleet fuel cards with spend controls, discounts, and detailed expense data.", status: "soon", website: "https://www.wexinc.com", apiNote: "Developer API." },
  { id: "comdata", name: "Comdata", category: "fuel", blurb: "Fuel card plus payments and money codes for fleets (Corpay).", status: "soon", apiNote: "Partner API." },
  { id: "efs", name: "EFS (Corpay)", category: "fuel", blurb: "Fuel card and money codes widely accepted across truck stops.", status: "soon", apiNote: "Partner API." },
  { id: "tcs", name: "TCS Fuel Card", category: "fuel", blurb: "No transaction fee and deep in-network diesel discounts.", status: "soon", apiNote: "No public API — card/app." },
  { id: "rtsfuel", name: "RTS Fuel Card", category: "fuel", blurb: "Diesel discounts at 2,000+ locations, paired with RTS factoring.", status: "soon", apiNote: "No public API — card/app." },
  { id: "atob", name: "AtoB", category: "fuel", blurb: "Universal-acceptance fuel card with fleet controls and telematics.", status: "soon", website: "https://www.atob.com", apiNote: "Developer API." },
  { id: "roadflex", name: "RoadFlex", category: "fuel", blurb: "Fuel card with security controls and telematics integration.", status: "soon", website: "https://www.roadflex.com", apiNote: "API available." },
  { id: "relay", name: "Relay Payments", category: "fuel", blurb: "Contactless payments for fuel and lumper fees.", status: "soon", apiNote: "Partner API." },
  { id: "fuelbook", name: "Fuelbook", category: "fuel", blurb: "Compare real fuel prices and manage card discounts across networks.", status: "soon", apiNote: "No public API — app." },

  // ---- More Last-Mile & Delivery ----
  { id: "goshare", name: "GoShare", category: "lastmile", blurb: "On-demand delivery for trucks, box trucks, and vans.", status: "soon", website: "https://goshare.co", apiNote: "Delivery API (business accounts)." },
  { id: "curri", name: "Curri", category: "lastmile", blurb: "Construction and industrial last-mile and on-demand delivery.", status: "soon", website: "https://www.curri.com", apiNote: "Developer API." },
  { id: "frayt", name: "FRAYT", category: "lastmile", blurb: "On-demand freight and last-mile for box trucks, cargo vans, and sprinters.", status: "soon", website: "https://www.frayt.com", apiNote: "Developer API." },
  { id: "dolly", name: "Dolly", category: "lastmile", blurb: "Local delivery and moving help booked on demand.", status: "soon", apiNote: "No public API — app." },
  { id: "veho", name: "Veho", category: "lastmile", blurb: "Last-mile package delivery routes for independent drivers.", status: "soon", apiNote: "Driver app." },

  // ---- More Fleet & Maintenance ----
  { id: "whiparound", name: "Whip Around", category: "maintenance", blurb: "Digital DVIR inspections plus maintenance and compliance tracking.", status: "soon", website: "https://www.whiparound.com", apiNote: "Public API." },
  { id: "fullbay", name: "Fullbay", category: "maintenance", blurb: "Heavy-duty repair-shop management — work orders, parts, and invoicing.", status: "soon", website: "https://www.fullbay.com", apiNote: "API + integrations." },
  { id: "rtafleet", name: "RTA Fleet Management", category: "maintenance", blurb: "Maintenance scheduling, parts inventory, and asset tracking.", status: "soon", apiNote: "Integration API." },
  { id: "simplyfleet", name: "Simply Fleet", category: "maintenance", blurb: "Maintenance, inspections, and expense tracking for small fleets.", status: "soon", apiNote: "REST API." },

  // ---- More Documents & Compliance ----
  { id: "transflo", name: "Transflo", category: "documents", blurb: "Scan and submit BOL/POD, e-docs, and ELD data across a huge broker and factor network.", status: "soon", website: "https://www.transflo.com", apiNote: "Partner API (Transflo Velocity)." },
  { id: "vector", name: "Vector", category: "documents", blurb: "Document capture and workflow automation for carriers and brokers.", status: "soon", website: "https://www.withvector.com", apiNote: "Partner API." },
];

// Hand-written setup steps for the integrations that are actually connectable
// today. Everything else gets sensible steps derived from its own fields below.
const HOW_TO: Record<string, string[]> = {
  googlemaps: [
    "Open the Google Cloud Console and create (or pick) a project.",
    "Under APIs & Services, enable “Maps JavaScript API” (add Directions API for routing).",
    "Go to Credentials → Create credentials → API key, then restrict it to your site’s domain.",
    "Toggle Google Maps on here, paste the key, and Save — the Navigation map switches to Google automatically.",
  ],
  trimble: [
    "Create a developer account at developer.trimblemaps.com.",
    "Generate a Maps API key in your developer dashboard.",
    "Toggle Trimble Maps on here, paste the key, and Save.",
    "The Navigation map switches to Trimble PC*MILER truck-legal routing automatically.",
  ],
  herewego: [
    "Sign up at platform.here.com and create a project.",
    "Generate a REST API key for that project.",
    "Toggle HERE Maps on here, paste the key, and Save to enable truck-attribute routing (weight, height, hazmat).",
  ],
  elevenlabs: [
    "Create an account at elevenlabs.io.",
    "Open your Profile → API Keys and copy your key.",
    "Heads up: free plans can’t use the stock voices over the API — add or clone a voice in your Voice Library and copy its Voice ID.",
    "Toggle on, paste the key (and Voice ID), Save, then tap “Test voice” to hear it.",
  ],
  anthropic: [
    "Optional — your Co-Pilot already runs on Claude with your subscription.",
    "To bill your own account instead, create a key at console.anthropic.com.",
    "Toggle on, paste your sk-ant-… key, and optionally set a model.",
    "Save — Co-Pilot calls now route through your own key.",
  ],
  ocr: [
    "Optional — document scanning already works on your subscription.",
    "To run extraction on your own account, create an API key with your OCR provider (e.g., Mindee).",
    "Toggle on, paste the key, and Save — scans now use your account.",
  ],
};

// Build friendly, honest setup steps for any plugin from what we know about it.
function deriveHowTo(p: Plugin): string[] {
  if (HOW_TO[p.id]?.length) return HOW_TO[p.id];

  const steps: string[] = [];
  steps.push(
    p.website
      ? `Tap “Visit & sign up” above to open ${p.name} and create your account.`
      : `Create an account with ${p.name}.`,
  );

  const noApi = !!p.apiNote && /no public api/i.test(p.apiNote);

  if (p.needsKey) {
    steps.push(
      `In your ${p.name} dashboard, find your ${p.keyHint ?? "API key"} (usually under Settings → API or Developer).`,
    );
    steps.push(`Toggle ${p.name} on here, paste the key, and hit Save.`);
  } else if (p.category === "loadboards" || p.cost === "Free") {
    steps.push(`Search and book loads directly in the ${p.name} app or website.`);
    steps.push(
      noApi
        ? `${p.name} has no public API, so live sync into this app isn’t available yet — book in their app for now.`
        : `Live sync into this app turns on as we finish wiring ${p.name}.`,
    );
  } else {
    steps.push(
      p.apiNote
        ? `Ask ${p.name} for API/partner access — ${p.apiNote}`
        : `Ask ${p.name} for API or partner access.`,
    );
    steps.push(
      `Toggle it on here; we enable the live connection as each provider’s integration is wired.`,
    );
  }
  return steps;
}

const STORAGE_KEY = STORAGE_KEY_SHARED;

// Quick lookup so the server-sync helpers can read a plugin's credential shape.
const PLUGIN_BY_ID: Record<string, Plugin> = Object.fromEntries(
  PLUGINS.map((p) => [p.id, p]),
);

// Honest state per integration. Nothing pulls live data until its API is wired,
// so we only advertise what's actually available today.
const STATUS_STYLE: Record<string, string> = {
  beta: "bg-electric/15 text-electric ring-1 ring-electric/30",
  soon: "bg-white/10 text-white/50 ring-1 ring-white/15",
};

const STATUS_LABEL: Record<string, string> = {
  beta: "Available",
  soon: "Coming soon",
};

const COST_STYLE: Record<string, string> = {
  Free: "bg-success/15 text-success ring-1 ring-success/30",
  Freemium: "bg-electric/15 text-electric ring-1 ring-electric/30",
  Paid: "bg-white/10 text-white/50 ring-1 ring-white/15",
};

function initials(name: string) {
  return name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function IntegrationsPage() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<KeyMap>({});
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Start from this device's local state so the page paints instantly…
    let localEnabled: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localEnabled = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    setEnabled(localEnabled);
    setKeys(readKeys());
    setHydrated(true);

    // …then reconcile with the server, which is the source of truth for a
    // carrier's connections across every device they sign in from.
    if (getToken()) {
      api
        .connections()
        .then((rows) => {
          setEnabled((prev) => {
            const next = { ...prev };
            for (const r of rows) {
              // A live, connected, or pending connection means "on" for this
              // carrier regardless of which device first flipped the switch.
              next[r.provider] =
                r.status === "connected" || r.status === "pending" || r.status === "error";
              if (r.status === "disabled") next[r.provider] = false;
            }
            return next;
          });
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
  }, [enabled, hydrated]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(PLUGIN_KEYS_KEY, JSON.stringify(keys));
  }, [keys, hydrated]);

  // Persist a connect to the server (encrypted, per-carrier). Fire-and-forget:
  // the local toggle already updated the UI; the server call makes it stick
  // across devices and triggers this carrier's data sync. Silent on failure so
  // an offline/logged-out device still works from localStorage.
  function pushConnect(id: string, keyState: KeyMap) {
    if (!getToken()) return;
    const p = PLUGIN_BY_ID[id];
    const credentials: Record<string, string> = {};
    if (p?.needsKey && keyState[id]?.trim()) credentials.apiKey = keyState[id].trim();
    const config: Record<string, unknown> = {};
    if (p?.extraField && keyState[p.extraField.id]?.trim()) {
      config[p.extraField.id] = keyState[p.extraField.id].trim();
    }
    api
      .connectPlugin(id, {
        credentials: Object.keys(credentials).length ? credentials : undefined,
        config: Object.keys(config).length ? config : undefined,
        label: p?.name,
      })
      .catch(() => undefined);
  }

  function toggle(id: string) {
    setEnabled((prev) => {
      const nowOn = !prev[id];
      if (nowOn) pushConnect(id, keys);
      else if (getToken()) api.disconnectPlugin(id).catch(() => undefined);
      return { ...prev, [id]: nowOn };
    });
  }

  function setKey(id: string, value: string) {
    setKeys((prev) => {
      const next = { ...prev };
      if (value.trim()) next[id] = value.trim();
      else delete next[id];
      // Persist the credential/config change to the owning plugin's connection.
      const owner = PLUGIN_BY_ID[id]
        ? id
        : PLUGINS.find((p) => p.extraField?.id === id)?.id;
      if (owner) pushConnect(owner, next);
      return next;
    });
  }

  const enabledCount = useMemo(
    () => PLUGINS.filter((p) => enabled[p.id]).length,
    [enabled]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLUGINS;
    return PLUGINS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.blurb.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <div>
      <PageHeader
        title="Plugin Engine"
        subtitle="Connect the apps you already use. Everything shows up inside one interface — no app-switching."
      />

      {/* Hero / value banner */}
      <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 border-electric/25 bg-electric/5 p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-electric shadow-glow">
            <Plug className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold">One app. All your tools.</div>
            <div className="text-xs text-white/50">
              Turn on the services you use. Live data sync rolls out per integration as each
              provider is connected — “Available” apps are wired up first.
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold text-electric">{enabledCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-white/40">
            of {PLUGINS.length} connected
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search integrations…"
          className="input w-full pl-9"
        />
      </div>

      {query.trim() ? (
        <PluginGrid plugins={filtered} enabled={enabled} keys={keys} onToggle={toggle} onSetKey={setKey} />
      ) : (
        CATEGORIES.map((cat) => {
          const items = PLUGINS.filter((p) => p.category === cat.key);
          if (!items.length) return null;
          const Icon = cat.icon;
          return (
            <section key={cat.key} className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <Icon className="h-[18px] w-[18px] text-electric" />
                <h2 className="text-base font-bold">{cat.label}</h2>
                <span className="text-xs text-white/40">— {cat.desc}</span>
              </div>
              <PluginGrid plugins={items} enabled={enabled} keys={keys} onToggle={toggle} onSetKey={setKey} />
            </section>
          );
        })
      )}

      {query.trim() && !filtered.length && (
        <div className="card p-10 text-center text-sm text-white/50">
          No integrations match “{query}”.
        </div>
      )}
    </div>
  );
}

function PluginGrid({
  plugins,
  enabled,
  keys,
  onToggle,
  onSetKey,
}: {
  plugins: Plugin[];
  enabled: Record<string, boolean>;
  keys: KeyMap;
  onToggle: (id: string) => void;
  onSetKey: (id: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {plugins.map((p) => {
        const on = !!enabled[p.id];
        const hasKey = !!keys[p.id]?.trim();
        return (
          <div
            key={p.id}
            className={clsx(
              "card flex flex-col gap-3 p-4 transition",
              on ? "ring-1 ring-electric/40" : ""
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={clsx(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold",
                    on ? "bg-electric text-white" : "bg-white/10 text-white/70"
                  )}
                >
                  {initials(p.name)}
                </div>
                <div className="leading-tight">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {p.name}
                    {p.needsKey && on && hasKey ? (
                      <span className="chip bg-success/15 px-2 py-0.5 text-[10px] text-success ring-1 ring-success/30">
                        Connected
                      </span>
                    ) : (
                      p.status && (
                        <span
                          className={clsx("chip px-2 py-0.5 text-[10px]", STATUS_STYLE[p.status])}
                        >
                          {STATUS_LABEL[p.status]}
                        </span>
                      )
                    )}
                  </div>
                </div>
              </div>
              <ToggleSwitch on={on} onClick={() => onToggle(p.id)} label={p.name} />
            </div>
            <p className="text-xs leading-relaxed text-white/50">{p.blurb}</p>

            {(p.cost || p.equipment?.length || p.website || p.apiNote) && (
              <div className="flex flex-col gap-2 border-t border-white/5 pt-2.5">
                {p.cost && (
                  <div className="flex items-center gap-2">
                    <span className={clsx("chip px-2 py-0.5 text-[10px] font-semibold", COST_STYLE[p.cost])}>
                      {p.cost}
                    </span>
                    {p.apiNote && <span className="text-[10px] leading-tight text-white/40">{p.apiNote}</span>}
                  </div>
                )}
                {!!p.equipment?.length && (
                  <div className="flex flex-wrap gap-1">
                    {p.equipment.map((e) => (
                      <span
                        key={e}
                        className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                )}
                {p.website && (
                  <a
                    href={p.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-electric hover:underline"
                  >
                    Visit &amp; sign up →
                  </a>
                )}
              </div>
            )}

            <HowTo steps={deriveHowTo(p)} />

            {p.needsKey && on && (
              <KeyField
                value={keys[p.id] ?? ""}
                hint={p.keyHint ?? "API key"}
                onSave={(v) => onSetKey(p.id, v)}
              />
            )}
            {p.extraField && on && (
              <PlainField
                label={p.extraField.label}
                value={keys[p.extraField.id] ?? ""}
                hint={p.extraField.hint}
                onSave={(v) => onSetKey(p.extraField!.id, v)}
              />
            )}
            {p.id === "elevenlabs" && on && (
              <ElevenTest
                apiKey={keys["elevenlabs"] ?? ""}
                voiceId={keys["elevenlabs_voice"] ?? ""}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Per-card, click-to-open setup guide. Collapsed by default so cards stay clean;
// the driver only sees steps for the plugin they're actually setting up.
function HowTo({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-white/5 pt-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60 hover:text-white"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        How to set up
        <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-white/55">
              <span className="mt-px grid h-4 w-4 flex-none place-items-center rounded-full bg-white/10 text-[9px] font-bold text-white/70">
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function KeyField({
  value,
  hint,
  onSave,
}: {
  value: string;
  hint: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const saved = !!value.trim();
  const dirty = draft.trim() !== value.trim();

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Paste your ${hint}`}
          className="input h-9 flex-1 text-xs"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className={clsx("btn-primary h-9 px-3 text-xs", !dirty && "cursor-not-allowed opacity-50")}
        >
          {saved ? "Update" : "Save"}
        </button>
      </div>
      <div className="mt-1 text-[10px] text-white/40">
        {saved
          ? "Saved to your account — encrypted on our servers, synced to your devices."
          : "Stored encrypted on your account and used only to power this connection."}
      </div>
    </div>
  );
}

// The default ElevenLabs voice (Rachel). Only usable on paid plans via the API.
const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

// A one-click check so the driver knows immediately whether their key + voice
// actually work — without hunting through the Co-Pilot screen to find out.
function ElevenTest({ apiKey, voiceId }: { apiKey: string; voiceId: string }) {
  const [state, setState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    if (!apiKey.trim()) {
      setState("fail");
      setMsg("Paste your API key first.");
      return;
    }
    setState("testing");
    setMsg("");
    const id = voiceId.trim() || ELEVEN_DEFAULT_VOICE;
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey.trim(),
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: "Hey, your co-pilot's talking now. This is the voice you'll hear on the road.",
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
        }),
      });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        setState("ok");
        setMsg("That's your voice — you're all set. It'll speak in the Co-Pilot now.");
        return;
      }
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.detail?.message || body?.detail?.status || "";
      } catch {
        /* ignore */
      }
      setState("fail");
      if (res.status === 402 || /paid_plan|payment/i.test(detail)) {
        setMsg(
          "Your ElevenLabs plan can't use this voice over the API. Either upgrade your ElevenLabs plan, or add a voice you own in your ElevenLabs library and paste its Voice ID above.",
        );
      } else if (res.status === 401) {
        setMsg("That key was rejected. Double-check you pasted it correctly.");
      } else {
        setMsg(`ElevenLabs said no (${res.status}). ${detail}`.trim());
      }
    } catch (e: any) {
      setState("fail");
      setMsg(`Couldn't reach ElevenLabs. ${e?.message ?? ""}`.trim());
    }
  }

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <button
        type="button"
        onClick={run}
        disabled={state === "testing"}
        className={clsx(
          "btn-primary h-9 w-full text-xs",
          state === "testing" && "cursor-wait opacity-70",
        )}
      >
        {state === "testing" ? "Testing…" : "Test voice"}
      </button>
      {msg && (
        <div
          className={clsx(
            "mt-1.5 text-[11px] leading-relaxed",
            state === "ok" ? "text-success" : "text-amber-400",
          )}
        >
          {msg}
        </div>
      )}
    </div>
  );
}

function PlainField({
  label,
  value,
  hint,
  onSave,
}: {
  label: string;
  value: string;
  hint: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value.trim();

  return (
    <div className="rounded-lg bg-white/5 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hint}
          className="input h-9 flex-1 text-xs"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className={clsx("btn-primary h-9 px-3 text-xs", !dirty && "cursor-not-allowed opacity-50")}
        >
          {value.trim() ? "Update" : "Save"}
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Disconnect" : "Connect"} ${label}`}
      onClick={onClick}
      className={clsx(
        "relative h-6 w-11 shrink-0 rounded-full transition",
        on ? "bg-electric" : "bg-white/15"
      )}
    >
      <span
        className={clsx(
          "absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white transition-all",
          on ? "left-[22px]" : "left-0.5"
        )}
      >
        {on && <Check className="h-3 w-3 text-electric" />}
      </span>
    </button>
  );
}
