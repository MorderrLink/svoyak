import { classNames } from "@/shared/utils/class-names";

import type { HTMLAttributes } from "react";

export type LoadingStateProps = HTMLAttributes<HTMLDivElement>;

export function LoadingState({
  className,
  children = "Загрузка…",
  ...props
}: LoadingStateProps) {
  return (
    <div
      aria-live="polite"
      className={classNames(
        "flex items-center justify-center gap-3 p-4 text-slate-600",
        className,
      )}
      role="status"
      {...props}
    >
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600"
      />
      <span>{children}</span>
    </div>
  );
}
