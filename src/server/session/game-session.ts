import { RoomError } from "@/server/room/room-error";
import type { PlayerRecord } from "@/server/room/types";
import type {
  AnswerJudgement,
  GameBoardTheme,
  GamePhase,
  HostActiveQuestion,
  HostGameState,
  ScoreChangeProposal,
  TimerState,
} from "@/shared/contracts/socket";
import type { QuizConfig, QuizQuestion, QuizTheme } from "@/shared/types/quiz";

interface ActiveQuestionRecord {
  attemptedPlayerIds: Set<string>;
  currentPlayerId: string | null;
  questionId: string;
}

interface LocatedQuestion {
  question: QuizQuestion;
  theme: QuizTheme;
}

export type ScoreConfirmationOutcome = "answer-reveal" | "buzzing";

export class GameSession {
  private activeQuestion: ActiveQuestionRecord | null = null;
  private currentRoundIndex = 0;
  private phase: GamePhase = "board";
  private readonly playedQuestionIds = new Set<string>();
  private readonly quiz: QuizConfig;
  private scoreProposal: ScoreChangeProposal | null = null;
  private timer: TimerState | null = null;

  constructor(
    quizSnapshot: QuizConfig,
    private readonly now: () => number,
    private readonly idGenerator: () => string,
  ) {
    this.quiz = structuredClone(quizSnapshot);
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getTimer(): TimerState | null {
    return this.timer === null ? null : { ...this.timer };
  }

  getAttemptedPlayerIds(): Set<string> {
    return new Set(this.activeQuestion?.attemptedPlayerIds ?? []);
  }

  selectQuestion(questionId: string): TimerState {
    this.requirePhase("board");
    const located = this.findQuestionInCurrentRound(questionId);

    if (this.playedQuestionIds.has(questionId)) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Этот вопрос уже был сыгран",
      );
    }

    this.activeQuestion = {
      attemptedPlayerIds: new Set(),
      currentPlayerId: null,
      questionId: located.question.id,
    };
    this.scoreProposal = null;
    this.phase = "question-intro";
    this.timer = this.createTimer(
      this.quiz.settings.questionIntroSeconds * 1_000,
    );
    return { ...this.timer };
  }

  completeQuestionIntro(): void {
    this.requirePhase("question-intro");
    this.phase = "buzzing";
    this.timer = null;
  }

  setBuzzTimer(timer: TimerState): void {
    this.requirePhase("buzzing");
    this.timer = { ...timer };
  }

  beginAnswer(playerId: string): void {
    this.requirePhase("buzzing");
    const activeQuestion = this.requireActiveQuestion();

    if (activeQuestion.attemptedPlayerIds.has(playerId)) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Этот игрок уже отвечал на текущий вопрос",
      );
    }

    activeQuestion.currentPlayerId = playerId;
    this.phase = "answering";
    this.timer = this.createTimer(this.quiz.settings.answerSeconds * 1_000);
  }

  judgeAnswer(
    judgement: AnswerJudgement,
    players: Map<string, PlayerRecord>,
  ): ScoreChangeProposal {
    this.requirePhase("answering");
    const activeQuestion = this.requireActiveQuestion();
    const player =
      activeQuestion.currentPlayerId === null
        ? undefined
        : players.get(activeQuestion.currentPlayerId);

    if (player === undefined) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Отвечающий игрок не найден",
      );
    }

    const { question } = this.findQuestion(activeQuestion.questionId);
    const suggestedDelta =
      judgement === "correct"
        ? question.price
        : judgement === "incorrect" && this.quiz.settings.allowNegativeScore
          ? -question.price
          : 0;
    const proposal: ScoreChangeProposal = {
      editedDelta: suggestedDelta,
      id: this.idGenerator(),
      judgement,
      playerId: player.id,
      playerName: player.name,
      questionId: question.id,
      questionPrice: question.price,
      suggestedDelta,
    };

    this.scoreProposal = proposal;
    this.phase = "score-confirmation";
    this.timer = null;
    return { ...proposal };
  }

  cancelScoreProposal(): void {
    this.requirePhase("score-confirmation");
    this.scoreProposal = null;
    this.phase = "answering";
  }

  confirmScore(
    proposalId: string,
    delta: number,
    players: Map<string, PlayerRecord>,
  ): ScoreConfirmationOutcome {
    this.requirePhase("score-confirmation");
    const proposal = this.scoreProposal;
    const activeQuestion = this.requireActiveQuestion();

    if (proposal === null || proposal.id !== proposalId) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Предложение изменения баллов не найдено",
      );
    }

    if (proposal.questionId !== activeQuestion.questionId) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Предложение относится к другому вопросу",
      );
    }

    const player = players.get(proposal.playerId);
    if (player === undefined) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }

    player.score += delta;
    this.scoreProposal = null;

    if (proposal.judgement === "correct") {
      this.startAnswerReveal();
      return "answer-reveal";
    }

    activeQuestion.attemptedPlayerIds.add(player.id);
    activeQuestion.currentPlayerId = null;
    const hasEligiblePlayer = [...players.values()].some(
      (candidate) =>
        candidate.connected &&
        !activeQuestion.attemptedPlayerIds.has(candidate.id),
    );

    if (hasEligiblePlayer) {
      this.phase = "buzzing";
      this.timer = null;
      return "buzzing";
    }

    this.startAnswerReveal();
    return "answer-reveal";
  }

  revealAnswer(): TimerState {
    if (
      this.phase !== "buzzing" &&
      this.phase !== "answering" &&
      this.phase !== "score-confirmation"
    ) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Ответ нельзя раскрыть в текущей фазе",
      );
    }

    this.scoreProposal = null;
    this.startAnswerReveal();
    return { ...this.requireTimer() };
  }

  finishQuestion(): void {
    this.requirePhase("answer-reveal");
    this.activeQuestion = null;
    this.scoreProposal = null;
    this.timer = null;

    const currentRound = this.quiz.rounds[this.currentRoundIndex];
    const roundFinished =
      currentRound !== undefined &&
      currentRound.themes.every((theme) =>
        theme.questions.every((question) =>
          this.playedQuestionIds.has(question.id),
        ),
      );

    if (roundFinished && this.currentRoundIndex + 1 < this.quiz.rounds.length) {
      this.currentRoundIndex += 1;
      this.phase = "board";
    } else if (roundFinished) {
      this.phase = "game-finished";
    } else {
      this.phase = "board";
    }
  }

  finishSession(): void {
    this.phase = "game-finished";
    this.timer = null;
    this.scoreProposal = null;
  }

  getState(): HostGameState {
    return {
      activeQuestion: this.getHostActiveQuestion(),
      board: this.getBoard(),
      currentRoundIndex: this.currentRoundIndex,
      phase: this.phase,
      quizTitle: this.quiz.title,
      roundCount: this.quiz.rounds.length,
      scoreProposal:
        this.scoreProposal === null ? null : { ...this.scoreProposal },
      timer: this.timer === null ? null : { ...this.timer },
    };
  }

  private startAnswerReveal(): void {
    const activeQuestion = this.requireActiveQuestion();
    this.playedQuestionIds.add(activeQuestion.questionId);
    activeQuestion.currentPlayerId = null;
    this.phase = "answer-reveal";
    this.timer = this.createTimer(
      this.quiz.settings.answerRevealSeconds * 1_000,
    );
  }

  private getBoard(): GameBoardTheme[] {
    const round = this.quiz.rounds[this.currentRoundIndex];

    if (round === undefined) {
      return [];
    }

    return round.themes.map((theme) => ({
      id: theme.id,
      questions: theme.questions.map((question) => ({
        id: question.id,
        played: this.playedQuestionIds.has(question.id),
        price: question.price,
      })),
      title: theme.title,
    }));
  }

  private getHostActiveQuestion(): HostActiveQuestion | null {
    if (this.activeQuestion === null) {
      return null;
    }

    const { question, theme } = this.findQuestion(
      this.activeQuestion.questionId,
    );

    return {
      answer: question.answer,
      attemptedPlayerIds: [...this.activeQuestion.attemptedPlayerIds],
      currentPlayerId: this.activeQuestion.currentPlayerId,
      hostComment: question.hostComment ?? null,
      id: question.id,
      price: question.price,
      text: question.content.text,
      themeTitle: theme.title,
    };
  }

  private findQuestionInCurrentRound(questionId: string): LocatedQuestion {
    const round = this.quiz.rounds[this.currentRoundIndex];

    if (round !== undefined) {
      for (const theme of round.themes) {
        const question = theme.questions.find(
          (candidate) => candidate.id === questionId,
        );
        if (question !== undefined) {
          return {
            question,
            theme,
          };
        }
      }
    }

    throw new RoomError(
      "SESSION_INVALID_PHASE",
      "Вопрос текущего раунда не найден",
    );
  }

  private findQuestion(questionId: string): LocatedQuestion {
    for (const round of this.quiz.rounds) {
      for (const theme of round.themes) {
        const question = theme.questions.find(
          (candidate) => candidate.id === questionId,
        );
        if (question !== undefined) {
          return {
            question,
            theme,
          };
        }
      }
    }

    throw new RoomError("SESSION_INVALID_PHASE", "Вопрос не найден");
  }

  private createTimer(durationMs: number): TimerState {
    const startedAt = this.now();
    return {
      durationMs,
      endsAt: startedAt + durationMs,
      startedAt,
    };
  }

  private requireActiveQuestion(): ActiveQuestionRecord {
    if (this.activeQuestion === null) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Активный вопрос отсутствует",
      );
    }

    return this.activeQuestion;
  }

  private requireTimer(): TimerState {
    if (this.timer === null) {
      throw new RoomError("SESSION_INVALID_PHASE", "Таймер отсутствует");
    }

    return this.timer;
  }

  private requirePhase(expected: GamePhase): void {
    if (this.phase !== expected) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        `Ожидалась фаза ${expected}, текущая фаза ${this.phase}`,
      );
    }
  }
}
