import { describe, expect, it } from "vitest";

import { RoomError } from "@/server/room/room-error";
import { RoomManager } from "@/server/room/room-manager";
import type { QuizConfig } from "@/shared/types/quiz";

const firstQuestionId = "00000000-0000-4000-8000-000000000004";
const secondQuestionId = "00000000-0000-4000-8000-000000000007";

function createQuiz(): QuizConfig {
  return {
    createdAt: "2026-07-29T18:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    rounds: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        order: 0,
        themes: [
          {
            description:
              "Сначала прочитайте правила темы.\nПотом выбирайте вопрос.",
            id: "00000000-0000-4000-8000-000000000003",
            order: 0,
            questions: [
              {
                answer: "Ответ 1",
                content: { text: "Вопрос 1" },
                id: firstQuestionId,
                price: 100,
              },
            ],
            title: "Тема 1",
          },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000005",
        order: 1,
        themes: [
          {
            id: "00000000-0000-4000-8000-000000000006",
            order: 0,
            questions: [
              {
                answer: "Ответ 2",
                content: { text: "Вопрос 2" },
                id: secondQuestionId,
                price: 200,
              },
            ],
            title: "Тема 2",
          },
        ],
      },
    ],
    schemaVersion: 1,
    settings: {
      allowNegativeScore: true,
      answerRevealSeconds: 0,
      answerSeconds: 15,
      buzzSeconds: 10,
      questionIntroSeconds: 0,
      showScoresToPlayers: true,
    },
    slug: "test-game",
    title: "Тестовая игра",
    updatedAt: "2026-07-29T18:00:00.000Z",
  };
}

function createManager(
  now: () => number = () => 1_000,
  random: () => number = () => 0,
) {
  let generatedId = 0;
  return new RoomManager({
    codeGenerator: () => "A7K4",
    idGenerator: () =>
      `00000000-0000-4000-8000-${String(++generatedId).padStart(12, "0")}`,
    now,
    random,
    tokenGenerator: () =>
      `00000000-0000-4000-8000-${String(++generatedId).padStart(12, "0")}`,
  });
}

describe("игровая сессия", () => {
  it("собирает ставки всех игроков и считает ответ по личной ставке", () => {
    const quiz = createQuiz();
    quiz.rounds[0]!.themes[0]!.questions[0]!.wagerLimit = 500;
    const manager = createManager();
    const room = manager.createRoom(quiz);
    const anna = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    const boris = manager.addPlayer(room.roomCode, "Борис", "socket-2");
    manager.adjustPlayerScore(
      room.roomCode,
      room.hostToken,
      anna.playerId,
      -900,
    );
    manager.startSession(room.roomCode, room.hostToken);

    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      phase: "wagering",
      wagers: { maximum: 500, totalPlayerCount: 2 },
    });
    expect(
      manager.submitWager(room.roomCode, anna.playerToken, 500),
    ).toBeNull();
    expect(
      manager.getPlayerState(room.roomCode, anna.playerId).wager,
    ).toMatchObject({ submitted: true, value: 500 });
    expect(
      manager.submitWager(room.roomCode, boris.playerToken, 200),
    ).not.toBeNull();

    const buzzer = manager.completeQuestionIntro(room.roomCode)!;
    manager.pressBuzzer(room.roomCode, anna.playerToken, buzzer.buzzWindowId);
    manager.selectAnsweringPlayer(room.roomCode, room.hostToken, anna.playerId);
    manager.judgeAnswer(room.roomCode, room.hostToken, "incorrect");
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    expect(proposal?.suggestedDelta).toBe(-500);
  });

  it("случайно назначает режим «Отдай вопрос» и оставляет одного отвечающего", () => {
    const quiz = createQuiz();
    quiz.specialModifiers = [
      {
        id: "00000000-0000-4000-8000-000000000010",
        kind: "giveaway",
        text: "Отдай вопрос",
      },
    ];
    const manager = new RoomManager({
      codeGenerator: () => "A7K4",
      idGenerator: () => "00000000-0000-4000-8000-000000000020",
      now: () => 1_000,
      random: () => 0,
      tokenGenerator: () => "00000000-0000-4000-8000-000000000021",
    });
    const room = manager.createRoom(quiz);
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);

    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "giveaway-setup",
    );
    manager.configureGiveaway(
      room.roomCode,
      room.hostToken,
      player.playerId,
      500,
    );
    expect(manager.completeQuestionIntro(room.roomCode)).toBeNull();
    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      activeQuestion: { currentPlayerId: player.playerId, price: 500 },
      phase: "answering",
    });
    manager.judgeAnswer(room.roomCode, room.hostToken, "incorrect");
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    expect(proposal?.suggestedDelta).toBe(-500);
    manager.confirmScore(room.roomCode, room.hostToken, proposal!.id, -500);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "answer-reveal",
    );
    expect(
      manager.getPlayerState(room.roomCode, player.playerId).buzzer.status,
    ).toBe("answered-incorrectly");
  });

  it("генерирует денежный модификатор отдельной клеткой и отдаёт первому нажавшему", () => {
    const quiz = createQuiz();
    const modifierId = "00000000-0000-4000-8000-000000000010";
    quiz.specialModifiers = [
      {
        delta: 1_000,
        id: modifierId,
        kind: "money",
        text: "Держи косарь!",
      },
    ];
    const manager = createManager();
    const room = manager.createRoom(quiz);
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);

    const modifierCell = manager
      .getHostState(room.roomCode)
      .game?.board.flatMap((theme) => theme.questions)
      .find((question) => question.id === modifierId);
    expect(modifierCell).toMatchObject({ label: "Модификатор", price: 0 });
    const selection = manager.selectQuestion(
      room.roomCode,
      room.hostToken,
      modifierId,
    );
    expect(selection.buzzer).not.toBeNull();
    manager.pressBuzzer(
      room.roomCode,
      player.playerToken,
      selection.buzzer!.buzzWindowId,
    );
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    expect(proposal).toMatchObject({
      playerId: player.playerId,
      suggestedDelta: 1_000,
    });
    manager.confirmScore(room.roomCode, room.hostToken, proposal!.id, 1_000);
    expect(manager.getPlayerState(room.roomCode, player.playerId).score).toBe(
      1_000,
    );
  });

  it("для «Плюс на минус» предлагает изменение, которое меняет знак счёта", () => {
    const quiz = createQuiz();
    const modifierId = "00000000-0000-4000-8000-000000000010";
    quiz.specialModifiers = [
      {
        id: modifierId,
        kind: "invert-score",
        text: "Плюс на минус",
      },
    ];
    const manager = createManager();
    const room = manager.createRoom(quiz);
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.adjustPlayerScore(
      room.roomCode,
      room.hostToken,
      player.playerId,
      300,
    );
    manager.startSession(room.roomCode, room.hostToken);
    const selection = manager.selectQuestion(
      room.roomCode,
      room.hostToken,
      modifierId,
    );
    manager.pressBuzzer(
      room.roomCode,
      player.playerToken,
      selection.buzzer!.buzzWindowId,
    );

    expect(
      manager.getHostState(room.roomCode).game?.scoreProposal?.suggestedDelta,
    ).toBe(-600);
  });

  it("использует независимый снимок викторины", () => {
    const quiz = createQuiz();
    const manager = createManager();
    const room = manager.createRoom(quiz);
    quiz.title = "Изменённый оригинал";
    quiz.rounds[0]!.themes[0]!.questions[0]!.content.text = "Изменённый вопрос";

    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);

    const game = manager.getHostState(room.roomCode).game;
    expect(game?.quizTitle).toBe("Тестовая игра");
    expect(game?.activeQuestion?.text).toBe("Вопрос 1");
  });

  it("не принимает новых игроков после начала игры", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);

    expect(() => manager.addPlayer(room.roomCode, "Борис", "socket-2")).toThrow(
      RoomError,
    );
  });

  it("показывает пояснение темы до нажатия ведущим Space", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    manager.startSession(room.roomCode, room.hostToken);

    manager.startThemeExplanation(
      room.roomCode,
      room.hostToken,
      "00000000-0000-4000-8000-000000000003",
    );

    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      activeQuestion: null,
      activeThemeExplanation: {
        description:
          "Сначала прочитайте правила темы.\nПотом выбирайте вопрос.",
        title: "Тема 1",
      },
      phase: "theme-explanation",
      timer: null,
    });
    expect(manager.getDisplayState(room.roomCode).game).toMatchObject({
      activeThemeExplanation: {
        description:
          "Сначала прочитайте правила темы.\nПотом выбирайте вопрос.",
        title: "Тема 1",
      },
      phase: "theme-explanation",
    });

    manager.skipTimer(room.roomCode, room.hostToken);
    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      activeThemeExplanation: null,
      phase: "board",
    });
  });

  it("автоматически запускает медиа, переключает паузу и перезапускает его", () => {
    const quiz = createQuiz();
    quiz.rounds[0]!.themes[0]!.questions[0]!.content.media = {
      durationMs: 5_000,
      kind: "video",
      mimeType: "video/mp4",
      path: "assets/test-game/media/question.mp4",
      trimEndMs: 4_000,
      trimStartMs: 500,
    };
    let now = 1_000;
    const manager = createManager(() => now);
    const room = manager.createRoom(quiz);
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    manager.completeQuestionIntro(room.roomCode);

    const started = manager.getDisplayState(room.roomCode).game;
    expect(started?.activeQuestion?.media).toMatchObject({ kind: "video" });
    expect(started?.mediaPlayback).toMatchObject({
      playing: true,
      positionMs: 500,
      startedAt: 1_000,
    });

    now = 1_750;
    manager.stopMedia(room.roomCode, room.hostToken);
    expect(
      manager.getHostState(room.roomCode).game?.mediaPlayback,
    ).toMatchObject({ playing: false, positionMs: 1_250, startedAt: null });

    now = 2_000;
    manager.stopMedia(room.roomCode, room.hostToken);
    expect(
      manager.getDisplayState(room.roomCode).game?.mediaPlayback,
    ).toMatchObject({ playing: true, positionMs: 1_250, startedAt: 2_000 });

    now = 2_250;
    manager.restartMedia(room.roomCode, room.hostToken);
    expect(
      manager.getDisplayState(room.roomCode).game?.mediaPlayback,
    ).toMatchObject({ playing: true, positionMs: 500, startedAt: 2_250 });
  });

  it("создаёт предложение и меняет счёт только после подтверждения", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    const buzzer = manager.completeQuestionIntro(room.roomCode)!;
    manager.pressBuzzer(room.roomCode, player.playerToken, buzzer.buzzWindowId);
    manager.selectAnsweringPlayer(
      room.roomCode,
      room.hostToken,
      player.playerId,
    );
    manager.judgeAnswer(room.roomCode, room.hostToken, "correct");

    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    expect(proposal?.suggestedDelta).toBe(100);
    expect(manager.getPlayerState(room.roomCode, player.playerId).score).toBe(
      0,
    );

    manager.confirmScore(room.roomCode, room.hostToken, proposal!.id, 120);
    expect(manager.getPlayerState(room.roomCode, player.playerId).score).toBe(
      120,
    );
    expect(
      manager.getPlayerState(room.roomCode, player.playerId),
    ).toMatchObject({
      answerDelta: 120,
      buzzer: { status: "correct" },
    });
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "answer-reveal",
    );
    expect(() =>
      manager.confirmScore(room.roomCode, room.hostToken, proposal!.id, 120),
    ).toThrow(RoomError);
  });

  it("разрешает ручную корректировку на сетке и запрещает её во время вопроса", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);

    manager.adjustPlayerScore(
      room.roomCode,
      room.hostToken,
      player.playerId,
      200,
    );
    expect(manager.getPlayerState(room.roomCode, player.playerId).score).toBe(
      200,
    );

    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    expect(() =>
      manager.adjustPlayerScore(
        room.roomCode,
        room.hostToken,
        player.playerId,
        100,
      ),
    ).toThrow(RoomError);
  });

  it("собирает очередь нажатий и позволяет ведущему выбрать отвечающего", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const first = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    const second = manager.addPlayer(room.roomCode, "Борис", "socket-2");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    const buzzer = manager.completeQuestionIntro(room.roomCode)!;

    manager.pressBuzzer(room.roomCode, first.playerToken, buzzer.buzzWindowId);
    manager.pressBuzzer(room.roomCode, second.playerToken, buzzer.buzzWindowId);

    expect(manager.getHostState(room.roomCode).players).toEqual([
      expect.objectContaining({ buzzPosition: 1, id: first.playerId }),
      expect.objectContaining({ buzzPosition: 2, id: second.playerId }),
    ]);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe("buzzing");

    manager.selectAnsweringPlayer(
      room.roomCode,
      room.hostToken,
      second.playerId,
    );

    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      activeQuestion: { currentPlayerId: second.playerId },
      phase: "answering",
    });
    expect(manager.getHostState(room.roomCode).buzzer.winner?.id).toBe(
      second.playerId,
    );
    expect(
      manager.getPlayerState(room.roomCode, second.playerId).buzzer.status,
    ).toBe("winner");
    expect(
      manager.getPlayerState(room.roomCode, first.playerId).buzzer.status,
    ).toBe("other-player-answering");
  });

  it("позволяет ведущему пропускать активные таймеры", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);

    const opened = manager.skipTimer(room.roomCode, room.hostToken);
    expect(opened).not.toBeNull();
    expect(manager.getHostState(room.roomCode).game?.phase).toBe("buzzing");

    manager.pressBuzzer(
      room.roomCode,
      player.playerToken,
      opened!.buzzWindowId,
    );
    manager.skipTimer(room.roomCode, room.hostToken);
    expect(manager.getHostState(room.roomCode).buzzer.status).toBe("closed");
    expect(
      manager.getPlayerState(room.roomCode, player.playerId).buzzer.status,
    ).toBe("queued");

    manager.selectAnsweringPlayer(
      room.roomCode,
      room.hostToken,
      player.playerId,
    );
    manager.skipTimer(room.roomCode, room.hostToken);
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    expect(proposal).toMatchObject({
      judgement: "timeout",
      playerId: player.playerId,
      suggestedDelta: 0,
    });

    manager.confirmScore(room.roomCode, room.hostToken, proposal!.id, 0);
    manager.skipTimer(room.roomCode, room.hostToken);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe("board");
  });

  it("списывает цену вопроса со всех игроков только после подтверждения", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const first = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    const second = manager.addPlayer(room.roomCode, "Борис", "socket-2");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    manager.completeQuestionIntro(room.roomCode);

    manager.proposeNoAnswerPenalty(room.roomCode, room.hostToken);

    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    expect(proposal).toMatchObject({
      playerIds: [first.playerId, second.playerId],
      playerNames: ["Анна", "Борис"],
      suggestedDelta: -100,
      target: "all-players",
    });
    expect(manager.getPlayerState(room.roomCode, first.playerId).score).toBe(0);
    expect(manager.getPlayerState(room.roomCode, second.playerId).score).toBe(
      0,
    );

    manager.confirmScore(
      room.roomCode,
      room.hostToken,
      proposal!.id,
      proposal!.suggestedDelta,
    );

    expect(manager.getPlayerState(room.roomCode, first.playerId).score).toBe(
      -100,
    );
    expect(manager.getPlayerState(room.roomCode, second.playerId).score).toBe(
      -100,
    );
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "answer-reveal",
    );
  });

  it("после отмены общего списания переоткрывает сохранённую очередь", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    const firstWindow = manager.completeQuestionIntro(room.roomCode)!;
    manager.pressBuzzer(
      room.roomCode,
      player.playerToken,
      firstWindow.buzzWindowId,
    );

    manager.proposeNoAnswerPenalty(room.roomCode, room.hostToken);
    manager.cancelScoreProposal(room.roomCode, room.hostToken);

    const state = manager.getHostState(room.roomCode);
    expect(state.game?.phase).toBe("buzzing");
    expect(state.game?.scoreProposal).toBeNull();
    expect(state.buzzer.status).toBe("open");
    expect(state.buzzer.windowId).toBe(firstWindow.buzzWindowId);
    expect(state.players[0]?.buzzPosition).toBe(1);
  });

  it("после неверного ответа сохраняет очередь только для остальных", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const first = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    const second = manager.addPlayer(room.roomCode, "Борис", "socket-2");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    const firstWindow = manager.completeQuestionIntro(room.roomCode)!;
    manager.pressBuzzer(
      room.roomCode,
      first.playerToken,
      firstWindow.buzzWindowId,
    );
    manager.pressBuzzer(
      room.roomCode,
      second.playerToken,
      firstWindow.buzzWindowId,
    );
    manager.selectAnsweringPlayer(
      room.roomCode,
      room.hostToken,
      first.playerId,
    );
    manager.judgeAnswer(room.roomCode, room.hostToken, "incorrect");
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    const outcome = manager.confirmScore(
      room.roomCode,
      room.hostToken,
      proposal!.id,
      proposal!.suggestedDelta,
    );
    const state = manager.getHostState(room.roomCode);
    const secondWindow = state.buzzer.windowId;

    expect(outcome).toBe("buzzing");
    expect(secondWindow).toBe(firstWindow.buzzWindowId);
    expect(state.players).toEqual([
      expect.objectContaining({ buzzPosition: 1, id: first.playerId }),
      expect.objectContaining({ buzzPosition: 2, id: second.playerId }),
    ]);
    expect(
      manager.getPlayerState(room.roomCode, first.playerId).buzzer.status,
    ).toBe("answered-incorrectly");
    expect(() =>
      manager.selectAnsweringPlayer(
        room.roomCode,
        room.hostToken,
        first.playerId,
      ),
    ).toThrow(RoomError);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe("buzzing");
    manager.selectAnsweringPlayer(
      room.roomCode,
      room.hostToken,
      second.playerId,
    );
    expect(manager.getHostState(room.roomCode).game?.phase).toBe("answering");
  });

  it("отделяет публичное состояние от приватных данных ведущего", () => {
    const quiz = createQuiz();
    const question = quiz.rounds[0]!.themes[0]!.questions[0]!;
    question.hostComment = "Секретная подсказка ведущему";
    question.content.image = {
      alt: "Тестовое изображение",
      path: "assets/test-game/images/question.webp",
    };
    question.answerImage = {
      alt: "Изображение правильного ответа",
      path: "assets/test-game/images/answer.webp",
    };
    const manager = createManager();
    const room = manager.createRoom(quiz);
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");

    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);

    const introState = manager.getDisplayState(room.roomCode);
    expect(introState.game?.activeQuestion).toMatchObject({
      answer: null,
      answerImage: null,
      currentPlayerName: null,
      image: null,
      price: 100,
      text: null,
      themeTitle: "Тема 1",
    });
    expect(JSON.stringify(introState)).not.toContain(
      "Секретная подсказка ведущему",
    );

    const buzzer = manager.completeQuestionIntro(room.roomCode)!;
    const questionState = manager.getDisplayState(room.roomCode);
    expect(questionState.game?.activeQuestion).toMatchObject({
      answer: null,
      answerImage: null,
      currentPlayerName: null,
      image: question.content.image,
      text: "Вопрос 1",
    });
    expect(JSON.stringify(questionState)).not.toContain("Ответ 1");
    expect(JSON.stringify(questionState)).not.toContain(
      "Секретная подсказка ведущему",
    );

    manager.pressBuzzer(room.roomCode, player.playerToken, buzzer.buzzWindowId);
    expect(
      manager.getDisplayState(room.roomCode).game?.activeQuestion,
    ).toMatchObject({
      answer: null,
      currentPlayerName: null,
    });
    manager.selectAnsweringPlayer(
      room.roomCode,
      room.hostToken,
      player.playerId,
    );
    expect(
      manager.getDisplayState(room.roomCode).game?.activeQuestion,
    ).toMatchObject({
      answer: null,
      currentPlayerName: "Анна",
    });

    manager.judgeAnswer(room.roomCode, room.hostToken, "correct");
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    manager.confirmScore(
      room.roomCode,
      room.hostToken,
      proposal!.id,
      proposal!.suggestedDelta,
    );

    const revealState = manager.getDisplayState(room.roomCode);
    expect(revealState.game?.phase).toBe("answer-reveal");
    expect(revealState.game?.activeQuestion?.answer).toBe("Ответ 1");
    expect(revealState.game?.activeQuestion?.answerImage).toEqual(
      question.answerImage,
    );
    expect(revealState.game?.activeQuestion?.image).toBeNull();
    expect(revealState.game?.activeQuestion?.text).toBeNull();
    expect(revealState).not.toHaveProperty("players");
    expect(JSON.stringify(revealState)).not.toContain(
      "Секретная подсказка ведущему",
    );
  });

  it("завершает вопрос, переходит к следующему раунду и завершает игру", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    manager.startSession(room.roomCode, room.hostToken);

    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    manager.completeQuestionIntro(room.roomCode);
    manager.revealAnswer(room.roomCode, room.hostToken);
    manager.finishQuestion(room.roomCode);
    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      currentRoundIndex: 1,
      phase: "board",
    });

    manager.selectQuestion(room.roomCode, room.hostToken, secondQuestionId);
    manager.completeQuestionIntro(room.roomCode);
    manager.revealAnswer(room.roomCode, room.hostToken);
    manager.finishQuestion(room.roomCode);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "game-finished",
    );
  });

  it("позволяет ведущему переключать раунды и завершает игру только после всех вопросов", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    manager.startSession(room.roomCode, room.hostToken);

    manager.changeRound(room.roomCode, room.hostToken, 1);
    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      board: [
        {
          questions: [{ id: secondQuestionId }],
          title: "Тема 2",
        },
      ],
      currentRoundIndex: 1,
    });

    manager.selectQuestion(room.roomCode, room.hostToken, secondQuestionId);
    expect(() => manager.changeRound(room.roomCode, room.hostToken, 0)).toThrow(
      RoomError,
    );
    manager.completeQuestionIntro(room.roomCode);
    manager.revealAnswer(room.roomCode, room.hostToken);
    manager.finishQuestion(room.roomCode);

    expect(manager.getHostState(room.roomCode).game).toMatchObject({
      currentRoundIndex: 0,
      phase: "board",
    });
    expect(() => manager.changeRound(room.roomCode, room.hostToken, 2)).toThrow(
      RoomError,
    );

    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    manager.completeQuestionIntro(room.roomCode);
    manager.revealAnswer(room.roomCode, room.hostToken);
    manager.finishQuestion(room.roomCode);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "game-finished",
    );
  });
});
