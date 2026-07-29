"use client";

import { useEffect, useState } from "react";

import type { TimerState } from "@/shared/contracts/socket";
import { classNames } from "@/shared/utils/class-names";

import type { CSSProperties } from "react";

interface BottomProgressStyle extends CSSProperties {
  "--bottom-progress": string;
}

export interface BottomProgressProps {
  className?: string;
  label?: string;
  timer: TimerState | null;
}

export function BottomProgress({
  className,
  label = "Оставшееся время",
  timer,
}: BottomProgressProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer === null) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 50);

    return () => {
      window.clearInterval(interval);
    };
  }, [timer]);

  if (timer === null) {
    return null;
  }

  const remainingMs = timer.endsAt - now;
  const normalizedProgress = Math.min(
    1,
    Math.max(0, remainingMs / timer.durationMs),
  );
  const style: BottomProgressStyle = {
    "--bottom-progress": String(normalizedProgress),
  };

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(normalizedProgress * 100)}
      className={classNames("bottom-progress", className)}
      role="progressbar"
      style={style}
    >
      <div className="bottom-progress__bar" />
    </div>
  );
}
