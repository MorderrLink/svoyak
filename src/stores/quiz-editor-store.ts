"use client";

import { create } from "zustand";

import {
  createQuestion,
  createQuizSlug,
  createRound,
  createTheme,
} from "@/shared/quiz/factory";
import type {
  QuizConfig,
  QuizImage,
  QuizQuestion,
  QuizSettings,
} from "@/shared/types/quiz";

interface QuizEditorState {
  dirty: boolean;
  draft: QuizConfig | null;
  error: string | null;
  savedQuiz: QuizConfig | null;
  saving: boolean;
  slugManuallyEdited: boolean;
  addQuestion: (roundId: string, themeId: string) => void;
  addRound: () => void;
  addTheme: (roundId: string) => void;
  initialize: (quiz: QuizConfig) => void;
  markSaved: (quiz: QuizConfig) => void;
  moveRound: (roundId: string, direction: -1 | 1) => void;
  moveTheme: (roundId: string, themeId: string, direction: -1 | 1) => void;
  removeQuestion: (
    roundId: string,
    themeId: string,
    questionId: string,
  ) => void;
  removeRound: (roundId: string) => void;
  removeTheme: (roundId: string, themeId: string) => void;
  setError: (error: string | null) => void;
  setSaving: (saving: boolean) => void;
  setSetting: <Key extends keyof QuizSettings>(
    key: Key,
    value: QuizSettings[Key],
  ) => void;
  setSlug: (slug: string) => void;
  setTitle: (title: string) => void;
  setQuestionImage: (
    roundId: string,
    themeId: string,
    questionId: string,
    image: QuizImage | undefined,
  ) => void;
  setQuestionImageAlt: (
    roundId: string,
    themeId: string,
    questionId: string,
    alt: string,
  ) => void;
  updateQuestion: (
    roundId: string,
    themeId: string,
    questionId: string,
    patch: Partial<
      Pick<QuizQuestion, "answer" | "hostComment" | "price"> & {
        text: string;
      }
    >,
  ) => void;
  updateThemeTitle: (roundId: string, themeId: string, title: string) => void;
}

function normalizeOrders(quiz: QuizConfig): void {
  quiz.rounds.forEach((round, roundIndex) => {
    round.order = roundIndex;
    round.themes.forEach((theme, themeIndex) => {
      theme.order = themeIndex;
    });
  });
}

function updateDraft(
  state: QuizEditorState,
  operation: (draft: QuizConfig) => void,
): Partial<QuizEditorState> {
  if (state.draft === null) {
    return {};
  }

  const draft = structuredClone(state.draft);
  operation(draft);
  normalizeOrders(draft);

  return {
    dirty: true,
    draft,
    error: null,
  };
}

export const useQuizEditorStore = create<QuizEditorState>((set) => ({
  addQuestion: (roundId, themeId) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const theme = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((candidate) => candidate.id === themeId);

        if (theme !== undefined) {
          const highestPrice = theme.questions.reduce(
            (maximum, question) => Math.max(maximum, question.price),
            0,
          );
          theme.questions.push(createQuestion(highestPrice + 100));
        }
      }),
    );
  },
  addRound: () => {
    set((state) =>
      updateDraft(state, (draft) => {
        draft.rounds.push(createRound(draft.rounds.length));
      }),
    );
  },
  addTheme: (roundId) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const round = draft.rounds.find(
          (candidate) => candidate.id === roundId,
        );
        if (round !== undefined) {
          round.themes.push(createTheme(round.themes.length));
        }
      }),
    );
  },
  dirty: false,
  draft: null,
  error: null,
  initialize: (quiz) => {
    set({
      dirty: false,
      draft: structuredClone(quiz),
      error: null,
      savedQuiz: structuredClone(quiz),
      saving: false,
      slugManuallyEdited: false,
    });
  },
  markSaved: (quiz) => {
    set({
      dirty: false,
      draft: structuredClone(quiz),
      error: null,
      savedQuiz: structuredClone(quiz),
      saving: false,
    });
  },
  moveRound: (roundId, direction) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const sourceIndex = draft.rounds.findIndex(
          (round) => round.id === roundId,
        );
        const targetIndex = sourceIndex + direction;

        if (
          sourceIndex >= 0 &&
          targetIndex >= 0 &&
          targetIndex < draft.rounds.length
        ) {
          const [round] = draft.rounds.splice(sourceIndex, 1);
          if (round !== undefined) {
            draft.rounds.splice(targetIndex, 0, round);
          }
        }
      }),
    );
  },
  moveTheme: (roundId, themeId, direction) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const themes = draft.rounds.find(
          (round) => round.id === roundId,
        )?.themes;
        const sourceIndex =
          themes?.findIndex((theme) => theme.id === themeId) ?? -1;
        const targetIndex = sourceIndex + direction;

        if (
          themes !== undefined &&
          sourceIndex >= 0 &&
          targetIndex >= 0 &&
          targetIndex < themes.length
        ) {
          const [theme] = themes.splice(sourceIndex, 1);
          if (theme !== undefined) {
            themes.splice(targetIndex, 0, theme);
          }
        }
      }),
    );
  },
  removeQuestion: (roundId, themeId, questionId) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const theme = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((candidate) => candidate.id === themeId);
        if (theme !== undefined) {
          theme.questions = theme.questions.filter(
            (question) => question.id !== questionId,
          );
        }
      }),
    );
  },
  removeRound: (roundId) => {
    set((state) =>
      updateDraft(state, (draft) => {
        draft.rounds = draft.rounds.filter((round) => round.id !== roundId);
      }),
    );
  },
  removeTheme: (roundId, themeId) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const round = draft.rounds.find(
          (candidate) => candidate.id === roundId,
        );
        if (round !== undefined) {
          round.themes = round.themes.filter((theme) => theme.id !== themeId);
        }
      }),
    );
  },
  savedQuiz: null,
  saving: false,
  setError: (error) => {
    set({
      error,
    });
  },
  setSaving: (saving) => {
    set({
      saving,
    });
  },
  setSetting: (key, value) => {
    set((state) =>
      updateDraft(state, (draft) => {
        draft.settings[key] = value;
      }),
    );
  },
  setSlug: (slug) => {
    set((state) => ({
      ...updateDraft(state, (draft) => {
        const oldSlug = draft.slug;
        draft.slug = slug;
        for (const round of draft.rounds) {
          for (const theme of round.themes) {
            for (const question of theme.questions) {
              const image = question.content.image;
              const prefix = `assets/${oldSlug}/`;
              if (image?.path.startsWith(prefix) === true) {
                image.path = `assets/${slug}/${image.path.slice(prefix.length)}`;
              }
            }
          }
        }
      }),
      slugManuallyEdited: true,
    }));
  },
  setQuestionImage: (roundId, themeId, questionId, image) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const question = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find((candidate) => candidate.id === questionId);
        if (question !== undefined) {
          question.content.image = image;
        }
      }),
    );
  },
  setQuestionImageAlt: (roundId, themeId, questionId, alt) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const image = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find((candidate) => candidate.id === questionId)
          ?.content.image;
        if (image !== undefined) {
          image.alt = alt.trim() === "" ? undefined : alt;
        }
      }),
    );
  },
  setTitle: (title) => {
    set((state) =>
      updateDraft(state, (draft) => {
        draft.title = title;
        if (!state.slugManuallyEdited) {
          const oldSlug = draft.slug;
          const newSlug = createQuizSlug(title);
          draft.slug = newSlug;
          for (const round of draft.rounds) {
            for (const theme of round.themes) {
              for (const question of theme.questions) {
                const image = question.content.image;
                const prefix = `assets/${oldSlug}/`;
                if (image?.path.startsWith(prefix) === true) {
                  image.path = `assets/${newSlug}/${image.path.slice(prefix.length)}`;
                }
              }
            }
          }
        }
      }),
    );
  },
  slugManuallyEdited: false,
  updateQuestion: (roundId, themeId, questionId, patch) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const question = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find((candidate) => candidate.id === questionId);

        if (question === undefined) {
          return;
        }

        if (patch.answer !== undefined) {
          question.answer = patch.answer;
        }
        if (patch.hostComment !== undefined) {
          question.hostComment =
            patch.hostComment.trim() === "" ? undefined : patch.hostComment;
        }
        if (patch.price !== undefined) {
          question.price = patch.price;
        }
        if (patch.text !== undefined) {
          question.content.text = patch.text;
        }
      }),
    );
  },
  updateThemeTitle: (roundId, themeId, title) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const theme = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((candidate) => candidate.id === themeId);
        if (theme !== undefined) {
          theme.title = title;
        }
      }),
    );
  },
}));
