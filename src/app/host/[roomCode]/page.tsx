import { HostScreen } from "@/features/buzzer/host-screen";

interface HostRoomPageProps {
  params: Promise<{
    roomCode: string;
  }>;
}

export default async function HostRoomPage({ params }: HostRoomPageProps) {
  const { roomCode } = await params;
  return <HostScreen roomCode={roomCode.toUpperCase()} />;
}
