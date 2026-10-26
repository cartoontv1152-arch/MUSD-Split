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

const COLORS: Record<string, string> = {
  violet: "text-violet-300 bg-violet-500/12 border-violet-500/30",
  cyan: "text-cyan-300 bg-cyan-400/10 border-cyan-400/30",
  amber: "text-amber-300 bg-amber-400/10 border-amber-400/30",
  mint: "text-mint-400 bg-mint-400/10 border-mint-400/30",
  rose: "text-rose-400 bg-rose-400/10 border-rose-400/30",
  sky: "text-sky-400 bg-sky-400/10 border-sky-400/30",
};

export function GroupIcon({ icon, color, size = 40, className }: { icon: string; color: string; size?: number; className?: string }) {
  const I = ICONS[icon] ?? Users;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-[12px] border", COLORS[color] ?? COLORS.violet, className)} style={{ width: size, height: size }}>
      <I style={{ width: size * 0.45, height: size * 0.45 }} aria-hidden="true" />
    </span>
  );
}

export const groupIconOptions = Object.keys(ICONS);
export const groupColorOptions = Object.keys(COLORS);
export const groupColorSwatch: Record<string, string> = {
  violet: "#8a6cff",
  cyan: "#46ddeb",
  amber: "#ffb45c",
  mint: "#45e3a6",
  rose: "#ff7a8f",
  sky: "#6cb8ff",
};
