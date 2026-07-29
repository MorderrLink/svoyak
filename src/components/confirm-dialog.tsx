"use client";

import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";

export interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
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
  danger = false,
  description,
  onCancel,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
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
