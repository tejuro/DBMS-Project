"use client";

import { cn } from "@/lib/utils";

interface KPICardProps {
  className?: string;
  title: string;
  stat: Stat;
  variant?: "default" | "success" | "warning" | "critical";
}

interface Stat {
  value: string | number;
  label: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
}

export function KPICard({ className, title, stat, variant = "default" }: KPICardProps) {
  const variants = {
    default: "bg-white border-gray-200",
    success: "bg-green-50 border-green-200",
    warning: "bg-orange-50 border-orange-200",
    critical: "bg-red-50 border-red-200",
  };

  const trendClass = stat.trend === "up"
    ? "text-green-500"
    : stat.trend === "down"
      ? "text-red-500"
      : "text-gray-500";

  const trendIcon = stat.trend === "up"
    ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    : stat.trend === "down"
      ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 19l7-7-7-7"/></svg>
      : null;

  return (
    <div className={`rounded-xl p-6 ${variants[variant]}`}>
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-gray-500">{title}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-bold text-navy-900">{typeof stat.value === 'number' ? stat.value : stat.value}</p>
          {trendIcon}
        </div>
        <p className="text-xs text-gray-500">{stat.label}</p>
      </div>
    </div>
  );
}