import { DisplayScreen } from "@/features/public-display/display-screen";

interface DisplayPageProps {
  params: Promise<{
    roomCode: string;
  }>;
}

export default async function DisplayPage({ params }: DisplayPageProps) {
  const { roomCode } = await params;
  return <DisplayScreen roomCode={roomCode.toUpperCase()} />;
}
