"use client";

import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/button";

export interface DialogProps {
  actions?: ReactNode;
  children: ReactNode;
  closable?: boolean;
  onClose: () => void;
  open: boolean;
  title: string;
}

export function Dialog({
  actions,
  children,
  closable = true,
  onClose,
  open,
  title,
}: DialogProps) {
  useEffect(() => {
    if (!open || !closable) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closable, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-labelledby="dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      role="dialog"
    >
      <section className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 p-4">
          <h2
            className="text-xl font-semibold text-slate-950"
            id="dialog-title"
          >
            {title}
          </h2>
          {closable ? (
            <Button
              aria-label="Закрыть диалог"
              className="min-h-9 px-3"
              onClick={onClose}
              variant="secondary"
            >
              ×
            </Button>
          ) : null}
        </header>
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
        {actions === undefined ? null : (
          <footer className="flex justify-end gap-3 border-t border-slate-200 p-4">
            {actions}
          </footer>
        )}
      </section>
    </div>
  );
}
