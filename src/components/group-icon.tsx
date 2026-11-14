import { Briefcase, Car, GraduationCap, Heart, Home, Mountain, Music, PartyPopper, Plane, ShoppingBag, Users, Utensils, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/client/cn";

const ICONS: Record<string, LucideIcon> = {
  users: Users,
  plane: Plane,
  home: Home,
  utensils: Utensils,
  "graduation-cap": GraduationCap,
  heart: Heart,
  "party-popper": PartyPopper,
  mountain: Mountain,
  briefcase: Briefcase,
  car: Car,
  music: Music,
  "shopping-bag": ShoppingBag,
};

/** Stored colour keys are historical; each now maps to one blue/black/white tile style. */
const COLORS: Record<string, string> = {
  violet: "bg-blue-600 text-white border-blue-600",
  cyan: "bg-fg text-white border-fg",
  amber: "bg-blue-50 text-blue-700 border-blue-200",
  mint: "bg-paper text-blue-700 border-blue-600",
  rose: "bg-paper text-fg border-fg",
  sky: "bg-wash text-fg border-line",
};

export function GroupIcon({ icon, color, size = 40, className }: { icon: string; color: string; size?: number; className?: string }) {
  const I = ICONS[icon] ?? Users;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-[var(--radius-card)] border", COLORS[color] ?? COLORS.violet, className)} style={{ width: size, height: size }}>
      <I style={{ width: size * 0.45, height: size * 0.45 }} aria-hidden="true" />
    </span>
  );
}

export const groupIconOptions = Object.keys(ICONS);
export const groupColorOptions = Object.keys(COLORS);
export const groupColorLabel: Record<string, string> = {
  violet: "Blue",
  cyan: "Black",
  amber: "Light blue",
  mint: "Blue outline",
  rose: "Black outline",
  sky: "Grey",
};
/** Tile classes for the colour picker swatches. */
export const groupColorSwatchClass = COLORS;
