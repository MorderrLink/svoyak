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

function createManager() {
  let generatedId = 0;
  return new RoomManager({
    codeGenerator: () => "A7K4",
    idGenerator: () =>
      `00000000-0000-4000-8000-${String(++generatedId).padStart(12, "0")}`,
    now: () => 1_000,
    tokenGenerator: () =>
      `00000000-0000-4000-8000-${String(++generatedId).padStart(12, "0")}`,
  });
}

describe("игровая сессия", () => {
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

  it("создаёт предложение и меняет счёт только после подтверждения", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    const buzzer = manager.completeQuestionIntro(room.roomCode);
    manager.pressBuzzer(room.roomCode, player.playerToken, buzzer.buzzWindowId);
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
    expect(manager.getHostState(room.roomCode).game?.phase).toBe(
      "answer-reveal",
    );
    expect(() =>
      manager.confirmScore(room.roomCode, room.hostToken, proposal!.id, 120),
    ).toThrow(RoomError);
  });

  it("после неверного ответа открывает новое окно только остальным", () => {
    const manager = createManager();
    const room = manager.createRoom(createQuiz());
    const first = manager.addPlayer(room.roomCode, "Анна", "socket-1");
    const second = manager.addPlayer(room.roomCode, "Борис", "socket-2");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, firstQuestionId);
    const firstWindow = manager.completeQuestionIntro(room.roomCode);
    manager.pressBuzzer(
      room.roomCode,
      first.playerToken,
      firstWindow.buzzWindowId,
    );
    manager.judgeAnswer(room.roomCode, room.hostToken, "incorrect");
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    const outcome = manager.confirmScore(
      room.roomCode,
      room.hostToken,
      proposal!.id,
      proposal!.suggestedDelta,
    );
    const secondWindow = manager.getHostState(room.roomCode).buzzer.windowId;

    expect(outcome).toBe("buzzing");
    expect(secondWindow).not.toBe(firstWindow.buzzWindowId);
    expect(
      manager.getPlayerState(room.roomCode, first.playerId).buzzer.status,
    ).toBe("answered-incorrectly");
    manager.pressBuzzer(room.roomCode, second.playerToken, secondWindow!);
    expect(manager.getHostState(room.roomCode).game?.phase).toBe("answering");
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
});
