"use client";

import { cn } from "@/lib/utils";

interface CardProps {
  className?: string;
  children?: React.ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div className={cn("rounded-lg border bg-white shadow-sm", className)}>
      {children}
    </div>
  );
}

interface CardSectionProps {
  className?: string;
  children?: React.ReactNode;
}

// Export commonly used sub-components for convenience. `className` is optional
// so existing call sites keep their original spacing.
export const CardHeader = ({ className, children }: CardSectionProps) => {
  return <div className={cn("px-6 py-1.5 text-xs font-medium text-gray-500", className)}>{children}</div>;
};

export const CardTitle = ({ className, children }: CardSectionProps) => {
  return <h3 className={cn("text-sm font-semibold text-gray-900", className)}>{children}</h3>;
};

export const CardContent = ({ className, children }: CardSectionProps) => {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
};
