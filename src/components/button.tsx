import { forwardRef, type ButtonHTMLAttributes } from "react";

import { classNames } from "@/shared/utils/class-names";

type ButtonVariant = "danger" | "primary" | "secondary" | "surface";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  danger:
    "bg-red-600 text-white hover:bg-red-500 focus-visible:outline-red-600",
  primary:
    "bg-blue-600 text-white hover:bg-blue-500 focus-visible:outline-blue-600",
  secondary:
    "bg-slate-200 text-slate-950 hover:bg-slate-300 focus-visible:outline-slate-500",
  surface:
    "border border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600 focus-visible:outline-slate-400",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, type = "button", variant = "primary", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={classNames(
          "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          variantClasses[variant],
          className,
        )}
        type={type}
        {...props}
      />
    );
  },
);
