import { forwardRef, type InputHTMLAttributes } from "react";

import { classNames } from "@/shared/utils/class-names";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={classNames(
        "min-h-11 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 disabled:cursor-not-allowed disabled:bg-slate-800/60",
        className,
      )}
      {...props}
    />
  );
});
