import { classNames } from "@/shared/utils/class-names";

import type { HTMLAttributes } from "react";

export type ErrorMessageProps = HTMLAttributes<HTMLParagraphElement>;

export function ErrorMessage({
  className,
  children,
  ...props
}: ErrorMessageProps) {
  return (
    <p
      className={classNames(
        "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800",
        className,
      )}
      role="alert"
      {...props}
    >
      {children}
    </p>
  );
}
