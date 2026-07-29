"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/button";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { roomCodeSchema } from "@/shared/schemas/socket";

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = roomCodeSchema.safeParse(code);

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте код комнаты");
      return;
    }

    router.push(`/join/${parsed.data}`);
  };

  return (
    <form
      className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      onSubmit={handleSubmit}
    >
      <p className="text-sm font-medium text-blue-700">Подключение к игре</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-950">
        Введите код комнаты
      </h1>
      <Input
        aria-label="Код комнаты"
        autoComplete="off"
        autoFocus
        className="mt-6 text-center font-mono text-2xl tracking-[0.3em] uppercase"
        maxLength={4}
        onChange={(event) => {
          setCode(event.target.value.toUpperCase());
          setError(null);
        }}
        placeholder="A7K4"
        value={code}
      />
      {error === null ? null : (
        <ErrorMessage className="mt-3">{error}</ErrorMessage>
      )}
      <Button className="mt-4 w-full" type="submit">
        Продолжить
      </Button>
    </form>
  );
}
