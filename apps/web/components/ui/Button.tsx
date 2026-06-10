"use client";

import clsx from "clsx";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import React from "react";

type Variant = "primary" | "ghost" | "danger" | "pd";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: React.ReactNode;
}

const styles: Record<Variant, string> = {
  primary:
    "bg-accent text-bg font-bold hover:bg-accent2 disabled:bg-surface2 disabled:text-muted shadow-glow-amber disabled:shadow-none",
  ghost:
    "bg-surface2 text-text border border-line hover:border-muted/50 disabled:opacity-50",
  danger:
    "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25 disabled:opacity-50",
  pd: "bg-pd/15 text-pd border border-pd/40 hover:bg-pd/25 disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs rounded-lg",
  md: "px-4 py-2.5 text-sm rounded-xl",
  lg: "px-6 py-3.5 text-base rounded-2xl",
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      whileHover={reduced || disabled ? undefined : { scale: 1.02 }}
      whileTap={reduced || disabled ? undefined : { scale: 0.97 }}
      className={clsx(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors select-none",
        styles[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </motion.button>
  );
}
