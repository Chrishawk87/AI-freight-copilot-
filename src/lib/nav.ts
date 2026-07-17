import {
  LayoutDashboard,
  Truck,
  Gauge,
  Bot,
  Repeat,
  Fuel,
  Map,
  Building2,
  Puzzle,
  ScanLine,
  Brain,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
};

export const NAV: NavItem[] = [
  { href: "/", label: "Command Center", short: "Home", icon: LayoutDashboard },
  { href: "/loads", label: "Opportunity Center", short: "Loads", icon: Truck },
  { href: "/profit", label: "Profitability Engine", short: "Profit", icon: Gauge },
  { href: "/dispatcher", label: "AI Dispatcher", short: "AI", icon: Bot },
  { href: "/reloads", label: "Deadhead Prevention", short: "Reloads", icon: Repeat },
  { href: "/fuel", label: "Fuel Intelligence", short: "Fuel", icon: Fuel },
  { href: "/map", label: "Truck Map", short: "Map", icon: Map },
  { href: "/documents", label: "Documents (BOL/POD)", short: "Docs", icon: ScanLine },
  { href: "/memory", label: "Co-Pilot Memory", short: "Memory", icon: Brain },
  { href: "/integrations", label: "Plugin Engine", short: "Plugins", icon: Puzzle },
  { href: "/profile", label: "Company Profile", short: "Profile", icon: Building2 },
];
