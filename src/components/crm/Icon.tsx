import {
  BarChart3,
  BookOpen,
  Building2,
  Calendar,
  CalendarCheck,
  Car,
  CheckCircle2,
  Circle,
  Contact,
  FileText,
  Handshake,
  Home,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Receipt,
  ShoppingCart,
  TrendingUp,
  UserPlus,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

/** Open-source (lucide) icons by name, so server components can pass icon names to client components. */
const ICONS: Record<string, LucideIcon> = {
  home: Home,
  "user-plus": UserPlus,
  contact: Contact,
  building: Building2,
  handshake: Handshake,
  "calendar-check": CalendarCheck,
  calendar: Calendar,
  "file-text": FileText,
  "shopping-cart": ShoppingCart,
  receipt: Receipt,
  car: Car,
  "book-open": BookOpen,
  warehouse: Warehouse,
  "life-buoy": LifeBuoy,
  megaphone: Megaphone,
  "bar-chart": BarChart3,
  "layout-dashboard": LayoutDashboard,
  "trending-up": TrendingUp,
  "check-circle": CheckCircle2,
};

export function Icon({ name, className }: { name: string; className?: string }) {
  const C = ICONS[name] ?? Circle;
  return <C className={className} aria-hidden="true" />;
}
