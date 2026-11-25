// ADMIN NAV ICONS — the icon set of the rail, resolved on the client.
//
// The navigation model is built on the server (it is filtered by the session
// permission snapshot) and handed to the client shell as plain data. A React
// component is not plain data, so the model carries an icon NAME and the
// shell resolves it here, on the client, where the icon components live.
//
// Two rules keep this honest:
//   - the name set is closed (AdminIconName) — a typo fails the type check;
//   - the registry is the single place a rail icon is defined.

"use client";

import {
  Archive,
  BadgePercent,
  Bell,
  Boxes,
  ClipboardList,
  Eye,
  EyeOff,
  Gauge,
  MapPinned,
  Package,
  RotateCcwClock,
  ScrollText,
  Settings,
  ShieldCheck,
  Tags,
  Ticket,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminIconName } from "@/components/admin/nav-config";

const NAV_ICONS: Record<AdminIconName, LucideIcon> = {
  gauge: Gauge,
  "clipboard-list": ClipboardList,
  package: Package,
  eye: Eye,
  "eye-off": EyeOff,
  archive: Archive,
  bell: Bell,
  tags: Tags,
  boxes: Boxes,
  "badge-percent": BadgePercent,
  ticket: Ticket,
  users: Users,
  "user-cog": UserCog,
  "shield-check": ShieldCheck,
  "scroll-text": ScrollText,
  settings: Settings,
  "map-pinned": MapPinned,
  "rotate-ccw-clock": RotateCcwClock,
};

export function navIcon(name: AdminIconName): LucideIcon {
  return NAV_ICONS[name];
}
