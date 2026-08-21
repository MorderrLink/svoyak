"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/button";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { LoadingState } from "@/components/loading-state";
import { getPlayerTokenStorageKey } from "@/shared/constants/storage";
import { PLAYER_NAME_MAX_LENGTH } from "@/shared/player/player-name";
import { playerTokenSchema, roomNameSchema } from "@/shared/schemas/socket";
import { createClientSocket } from "@/shared/socket/client";
import type { ApplicationClientSocket } from "@/shared/socket/client";

export interface JoinRoomFormProps {
  roomCode: string;
}

export function JoinRoomForm({ roomCode }: JoinRoomFormProps) {
  const router = useRouter();
  const socketRef = useRef<ApplicationClientSocket | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const storageKey = getPlayerTokenStorageKey(roomCode);
    const storedToken = window.localStorage.getItem(storageKey);

    if (
      storedToken !== null &&
      playerTokenSchema.safeParse(storedToken).success
    ) {
      router.replace(`/player/${roomCode}`);
      return;
    }

    const socket = createClientSocket();
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("room:check", { roomCode }, (result) => {
        if (!result.ok) {
          if (result.error.code === "ROOM_NOT_FOUND") {
            router.replace("/");
            return;
          }
          setError(result.error.message);
          setAvailable(false);
          return;
        }

        setAvailable(result.data.exists);
        if (!result.data.exists) {
          router.replace("/");
        }
      });
    });
    socket.on("disconnect", () => {
      setError("Соединение с сервером потеряно");
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedName = roomNameSchema.safeParse(name);
    const socket = socketRef.current;

    if (!parsedName.success) {
      setError(parsedName.error.issues[0]?.message ?? "Проверьте имя");
      return;
    }

    if (socket === null || !socket.connected) {
      setError("Нет соединения с сервером");
      return;
    }

    setSubmitting(true);
    setError(null);
    socket.emit(
      "room:join",
      {
        name: parsedName.data,
        roomCode,
      },
      (result) => {
        if (!result.ok) {
          setSubmitting(false);
          if (result.error.code === "ROOM_NOT_FOUND") {
            router.replace("/");
            return;
          }
          setError(result.error.message);
          return;
        }

        window.localStorage.setItem(
          getPlayerTokenStorageKey(roomCode),
          result.data.playerToken,
        );
        router.replace(`/player/${roomCode}`);
      },
    );
  };

  if (available === null && error === null) {
    return (
      <LoadingState className="text-white">Проверяем комнату…</LoadingState>
    );
  }

  return (
    <form
      className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      onSubmit={handleSubmit}
    >
      <p className="text-sm font-medium text-blue-700">
        Комната <span className="font-mono">{roomCode}</span>
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-950">
        Представьтесь
      </h1>
      <Input
        aria-label="Имя игрока"
        autoComplete="name"
        autoFocus
        className="mt-6"
        disabled={!available || submitting}
        maxLength={PLAYER_NAME_MAX_LENGTH}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        placeholder="Ваше имя"
        value={name}
      />
      {error === null ? null : (
        <ErrorMessage className="mt-3">{error}</ErrorMessage>
      )}
      <Button
        className="mt-4 w-full"
        disabled={!available || submitting}
        type="submit"
      >
        {submitting ? "Подключение…" : "Войти в комнату"}
      </Button>
    </form>
  );
}
