import { JoinRoomForm } from "@/features/buzzer/join-room-form";

interface JoinRoomPageProps {
  params: Promise<{
    roomCode: string;
  }>;
}

export default async function JoinRoomPage({ params }: JoinRoomPageProps) {
  const { roomCode } = await params;

  return (
    <main className="grid h-full place-items-center bg-slate-950 p-6">
      <JoinRoomForm roomCode={roomCode.toUpperCase()} />
    </main>
  );
}
