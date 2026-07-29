import { QuizEditor } from "@/features/quiz-editor/quiz-editor";

interface EditQuizPageProps {
  params: Promise<{
    quizId: string;
  }>;
}

export default async function EditQuizPage({ params }: EditQuizPageProps) {
  const { quizId } = await params;

  return <QuizEditor quizId={quizId} />;
}
