import { PlayerScreen } from "@/features/buzzer/player-screen";

interface PlayerPageProps {
  params: Promise<{
    roomCode: string;
  }>;
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { roomCode } = await params;

  return <PlayerScreen roomCode={roomCode.toUpperCase()} />;
}
