import { RoomError } from "@/server/room/room-error";
import type { PlayerRecord } from "@/server/room/types";
import type {
  AllPlayersScoreChangeProposal,
  AnswerJudgement,
  DisplayGameState,
  GameBoardTheme,
  GamePhase,
  HostActiveQuestion,
  HostGameState,
  MediaPlaybackState,
  PlayerScoreChangeProposal,
  ScoreChangeProposal,
  ThemeExplanation,
  TimerState,
} from "@/shared/contracts/socket";
import type { QuizConfig, QuizQuestion, QuizTheme } from "@/shared/types/quiz";

interface ActiveQuestionRecord {
  attemptedPlayerIds: Set<string>;
  correctPlayerId: string | null;
  currentPlayerId: string | null;
  questionId: string;
  scoreDeltas: Map<string, number>;
}

interface LocatedQuestion {
  question: QuizQuestion;
  theme: QuizTheme;
}

export type ScoreConfirmationOutcome = "answer-reveal" | "buzzing";
export type ScoreCancellationOutcome = "answering" | "buzzing";

export class GameSession {
  private activeQuestion: ActiveQuestionRecord | null = null;
  private activeThemeId: string | null = null;
  private currentRoundIndex = 0;
  private phase: GamePhase = "board";
  private readonly playedQuestionIds = new Set<string>();
  private mediaPlayback: MediaPlaybackState | null = null;
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

  getCorrectPlayerId(): string | null {
    return this.phase === "answer-reveal"
      ? (this.activeQuestion?.correctPlayerId ?? null)
      : null;
  }

  getAnswerDelta(playerId: string): number | null {
    return this.activeQuestion?.scoreDeltas.get(playerId) ?? null;
  }

  changeRound(roundIndex: number): void {
    this.requirePhase("board");

    if (roundIndex < 0 || roundIndex >= this.quiz.rounds.length) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Указанный раунд не существует",
      );
    }

    this.currentRoundIndex = roundIndex;
  }

  startThemeExplanation(themeId: string): void {
    this.requirePhase("board");
    const theme = this.findThemeInCurrentRound(themeId);
    if (theme.description === undefined || theme.description.trim() === "") {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Для этой темы не заполнено пояснение",
      );
    }

    this.activeThemeId = theme.id;
    this.phase = "theme-explanation";
    this.timer = null;
  }

  finishThemeExplanation(): void {
    this.requirePhase("theme-explanation");
    this.activeThemeId = null;
    this.phase = "board";
    this.timer = null;
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
      correctPlayerId: null,
      currentPlayerId: null,
      questionId: located.question.id,
      scoreDeltas: new Map(),
    };
    this.scoreProposal = null;
    this.mediaPlayback = null;
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
    const media = this.getHostActiveQuestion()?.media;
    this.mediaPlayback =
      media === null || media === undefined
        ? null
        : {
            playing: true,
            positionMs: media.trimStartMs,
            revision: this.idGenerator(),
            startedAt: this.now(),
          };
  }

  restartMedia(): void {
    this.requireMediaPhase();
    const media = this.getHostActiveQuestion()?.media;
    if (media === null || media === undefined) {
      throw new RoomError("SESSION_INVALID_PHASE", "В вопросе нет медиа");
    }
    this.mediaPlayback = {
      playing: true,
      positionMs: media.trimStartMs,
      revision: this.idGenerator(),
      startedAt: this.now(),
    };
  }

  stopMedia(): void {
    this.requireMediaPhase();
    if (this.mediaPlayback === null) {
      throw new RoomError("SESSION_INVALID_PHASE", "Вопрос не воспроизводится");
    }
    const media = this.getHostActiveQuestion()?.media;
    if (media === null || media === undefined) {
      throw new RoomError("SESSION_INVALID_PHASE", "В вопросе нет медиа");
    }
    if (!this.mediaPlayback.playing) {
      this.mediaPlayback = {
        playing: true,
        positionMs: this.mediaPlayback.positionMs,
        revision: this.idGenerator(),
        startedAt: this.now(),
      };
      return;
    }
    const elapsedMs =
      this.mediaPlayback.startedAt === null
        ? 0
        : Math.max(0, this.now() - this.mediaPlayback.startedAt);
    const positionMs = Math.min(
      media.trimEndMs,
      this.mediaPlayback.positionMs + elapsedMs,
    );
    this.mediaPlayback = {
      playing: false,
      positionMs,
      revision: this.idGenerator(),
      startedAt: null,
    };
  }

  setBuzzTimer(timer: TimerState): void {
    this.requirePhase("buzzing");
    this.timer = { ...timer };
  }

  expireBuzzTimer(): void {
    this.requirePhase("buzzing");
    this.timer = null;
  }

  beginAnswer(playerId: string): TimerState {
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
    return { ...this.timer };
  }

  judgeAnswer(
    judgement: AnswerJudgement,
    players: Map<string, PlayerRecord>,
  ): PlayerScoreChangeProposal {
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
    const proposal: PlayerScoreChangeProposal = {
      editedDelta: suggestedDelta,
      id: this.idGenerator(),
      judgement,
      playerId: player.id,
      playerName: player.name,
      questionId: question.id,
      questionPrice: question.price,
      suggestedDelta,
      target: "player",
    };

    this.scoreProposal = proposal;
    this.phase = "score-confirmation";
    this.timer = null;
    return { ...proposal };
  }

  createNoAnswerProposal(
    players: Map<string, PlayerRecord>,
  ): AllPlayersScoreChangeProposal {
    this.requirePhase("buzzing");
    const activeQuestion = this.requireActiveQuestion();
    const { question } = this.findQuestion(activeQuestion.questionId);
    const targets = [...players.values()];

    if (targets.length === 0) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "В комнате нет игроков для списания баллов",
      );
    }

    const suggestedDelta = -question.price;
    const proposal: AllPlayersScoreChangeProposal = {
      editedDelta: suggestedDelta,
      id: this.idGenerator(),
      playerIds: targets.map((player) => player.id),
      playerNames: targets.map((player) => player.name),
      questionId: question.id,
      questionPrice: question.price,
      suggestedDelta,
      target: "all-players",
    };

    this.scoreProposal = proposal;
    this.phase = "score-confirmation";
    this.timer = null;
    return {
      ...proposal,
      playerIds: [...proposal.playerIds],
      playerNames: [...proposal.playerNames],
    };
  }

  cancelScoreProposal(): ScoreCancellationOutcome {
    this.requirePhase("score-confirmation");
    const target = this.scoreProposal?.target;
    this.scoreProposal = null;
    this.phase = target === "all-players" ? "buzzing" : "answering";
    return this.phase;
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

    if (proposal.target === "all-players") {
      for (const playerId of proposal.playerIds) {
        const player = players.get(playerId);
        if (player !== undefined) {
          player.score += delta;
        }
      }
      this.scoreProposal = null;
      this.startAnswerReveal();
      return "answer-reveal";
    }

    const player = players.get(proposal.playerId);
    if (player === undefined) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }

    player.score += delta;
    activeQuestion.scoreDeltas.set(player.id, delta);
    this.scoreProposal = null;

    if (proposal.judgement === "correct") {
      activeQuestion.correctPlayerId = player.id;
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
    this.mediaPlayback = null;

    if (this.areAllQuestionsPlayed()) {
      this.phase = "game-finished";
      return;
    }

    if (this.isRoundFinished(this.currentRoundIndex)) {
      const nextRoundIndex = this.findNextRoundWithQuestions();
      if (nextRoundIndex !== null) {
        this.currentRoundIndex = nextRoundIndex;
      }
    }

    this.phase = "board";
  }

  finishSession(): void {
    this.activeThemeId = null;
    this.phase = "game-finished";
    this.timer = null;
    this.scoreProposal = null;
    this.mediaPlayback = null;
  }

  getState(): HostGameState {
    return {
      activeQuestion: this.getHostActiveQuestion(),
      activeThemeExplanation: this.getActiveThemeExplanation(),
      board: this.getBoard(),
      currentRoundIndex: this.currentRoundIndex,
      mediaPlayback:
        this.mediaPlayback === null ? null : { ...this.mediaPlayback },
      phase: this.phase,
      quizTitle: this.quiz.title,
      roundCount: this.quiz.rounds.length,
      scoreProposal:
        this.scoreProposal === null
          ? null
          : this.scoreProposal.target === "all-players"
            ? {
                ...this.scoreProposal,
                playerIds: [...this.scoreProposal.playerIds],
                playerNames: [...this.scoreProposal.playerNames],
              }
            : { ...this.scoreProposal },
      timer: this.timer === null ? null : { ...this.timer },
    };
  }

  getDisplayState(players: Map<string, PlayerRecord>): DisplayGameState {
    const activeQuestion = this.getHostActiveQuestion();
    const showsQuestion =
      this.phase === "answering" ||
      this.phase === "buzzing" ||
      this.phase === "score-confirmation";
    const showsActiveQuestion =
      showsQuestion ||
      this.phase === "answer-reveal" ||
      this.phase === "question-intro";
    const currentPlayer =
      activeQuestion?.currentPlayerId === null ||
      activeQuestion?.currentPlayerId === undefined
        ? undefined
        : players.get(activeQuestion.currentPlayerId);

    return {
      activeQuestion:
        !showsActiveQuestion || activeQuestion === null
          ? null
          : {
              answer:
                this.phase === "answer-reveal" ? activeQuestion.answer : null,
              answerImage:
                this.phase === "answer-reveal"
                  ? activeQuestion.answerImage
                  : null,
              currentPlayerName:
                this.phase === "answering" ||
                this.phase === "score-confirmation"
                  ? (currentPlayer?.name ?? null)
                  : null,
              id: activeQuestion.id,
              image: showsQuestion ? activeQuestion.image : null,
              media: showsQuestion ? activeQuestion.media : null,
              price: activeQuestion.price,
              text: showsQuestion ? activeQuestion.text : null,
              themeTitle: activeQuestion.themeTitle,
            },
      activeThemeExplanation: this.getActiveThemeExplanation(),
      board: this.getBoard(),
      currentRoundIndex: this.currentRoundIndex,
      mediaPlayback:
        this.mediaPlayback === null ? null : { ...this.mediaPlayback },
      phase: this.phase,
      roundCount: this.quiz.rounds.length,
      timer: this.timer === null ? null : { ...this.timer },
    };
  }

  private startAnswerReveal(): void {
    const activeQuestion = this.requireActiveQuestion();
    this.playedQuestionIds.add(activeQuestion.questionId);
    activeQuestion.currentPlayerId = null;
    this.mediaPlayback = null;
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
      description: theme.description?.trim() || null,
      id: theme.id,
      questions: theme.questions.map((question) => ({
        id: question.id,
        played: this.playedQuestionIds.has(question.id),
        price: question.price,
      })),
      title: theme.title,
    }));
  }

  private getActiveThemeExplanation(): ThemeExplanation | null {
    if (this.activeThemeId === null) {
      return null;
    }

    const theme = this.findThemeInCurrentRound(this.activeThemeId);
    const description = theme.description?.trim();
    if (description === undefined || description === "") {
      return null;
    }

    return {
      description,
      id: theme.id,
      title: theme.title,
    };
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
      answerImage: question.answerImage ?? null,
      attemptedPlayerIds: [...this.activeQuestion.attemptedPlayerIds],
      currentPlayerId: this.activeQuestion.currentPlayerId,
      hostComment: question.hostComment ?? null,
      id: question.id,
      image: question.content.image ?? null,
      media: question.content.media ?? null,
      price: question.price,
      text: question.content.text?.trim() || null,
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

  private findThemeInCurrentRound(themeId: string): QuizTheme {
    const theme = this.quiz.rounds[this.currentRoundIndex]?.themes.find(
      (candidate) => candidate.id === themeId,
    );
    if (theme !== undefined) {
      return theme;
    }

    throw new RoomError(
      "SESSION_INVALID_PHASE",
      "Тема текущего раунда не найдена",
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

  private areAllQuestionsPlayed(): boolean {
    return this.quiz.rounds.every((_round, roundIndex) =>
      this.isRoundFinished(roundIndex),
    );
  }

  private findNextRoundWithQuestions(): number | null {
    for (let offset = 1; offset < this.quiz.rounds.length; offset += 1) {
      const roundIndex =
        (this.currentRoundIndex + offset) % this.quiz.rounds.length;
      if (!this.isRoundFinished(roundIndex)) {
        return roundIndex;
      }
    }
    return null;
  }

  private isRoundFinished(roundIndex: number): boolean {
    const round = this.quiz.rounds[roundIndex];
    return (
      round !== undefined &&
      round.themes.every((theme) =>
        theme.questions.every((question) =>
          this.playedQuestionIds.has(question.id),
        ),
      )
    );
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

  private requireMediaPhase(): void {
    if (
      this.phase !== "buzzing" &&
      this.phase !== "answering" &&
      this.phase !== "score-confirmation"
    ) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Медиа нельзя управлять в текущей фазе",
      );
    }
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
