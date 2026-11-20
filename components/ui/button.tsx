"use client";

import { cn } from "@/lib/utils";

interface ButtonProps {
  type?: "button" | "submit" | "reset";
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "primary" | "secondary" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  type = "button",
  children,
  disabled,
  className,
  variant = "default",
  size = "default",
}: ButtonProps) {
  const variants = {
    default: "bg-navy-900 text-white hover:bg-navy-800",
    primary: "bg-teal-600 text-white hover:bg-teal-500",
    secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300",
    destructive: "bg-red-600 text-white hover:bg-red-500",
  };

  const sizes = {
    default: "px-4 py-2 rounded-md text-sm",
    sm: "px-3 py-2 rounded-md text-sm",
    lg: "px-6 py-3 rounded-md text-base",
    icon: "p-2 rounded-md",
  };

  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium",
        variants[variant] ?? variants.default,
        sizes[size] ?? sizes.default,
        className ?? ""
      )}
    >
      {children}
    </button>
  );
}