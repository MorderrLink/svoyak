"use client";

import { useEffect } from "react";

import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";

export interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  confirmOnEnter?: boolean;
  danger?: boolean;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  cancelLabel = "Отмена",
  confirmLabel = "Подтвердить",
  confirmOnEnter = false,
  danger = false,
  description,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open || !confirmOnEnter) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmOnEnter, onConfirm, open]);

  return (
    <Dialog
      actions={
        <>
          <Button onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} variant={danger ? "danger" : "primary"}>
            {confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      title={title}
    >
      <p className="text-slate-700">{description}</p>
    </Dialog>
  );
}
