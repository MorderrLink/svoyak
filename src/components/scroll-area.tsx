import { forwardRef, type HTMLAttributes } from "react";

import { classNames } from "@/shared/utils/class-names";

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement>;

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={classNames(
          "min-h-0 overflow-y-auto overscroll-contain",
          className,
        )}
        {...props}
      />
    );
  },
);
