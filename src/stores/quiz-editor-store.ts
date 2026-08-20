"use client";

import { create } from "zustand";

import { DEFAULT_IMAGE_ALT_TEXT } from "@/shared/constants/quiz";
import {
  createQuestion,
  createQuizSlug,
  createRound,
  createSpecialModifier,
  createTheme,
} from "@/shared/quiz/factory";
import type {
  QuizConfig,
  QuizImage,
  QuizMedia,
  QuizQuestion,
  QuizSettings,
  QuizSpecialModifier,
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
  addSpecialModifier: (kind: QuizSpecialModifier["kind"]) => void;
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
  removeSpecialModifier: (modifierId: string) => void;
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
  setQuestionMedia: (
    roundId: string,
    themeId: string,
    questionId: string,
    media: QuizMedia | undefined,
  ) => void;
  setQuestionImageAlt: (
    roundId: string,
    themeId: string,
    questionId: string,
    alt: string,
  ) => void;
  setQuestionWagerLimit: (
    roundId: string,
    themeId: string,
    questionId: string,
    wagerLimit: number | undefined,
  ) => void;
  setAnswerImage: (
    roundId: string,
    themeId: string,
    questionId: string,
    image: QuizImage | undefined,
  ) => void;
  setAnswerImageAlt: (
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
  updateThemeDescription: (
    roundId: string,
    themeId: string,
    description: string,
  ) => void;
  updateSpecialModifier: (
    modifierId: string,
    patch: { delta?: number; text?: string },
  ) => void;
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
  addSpecialModifier: (kind) => {
    set((state) =>
      updateDraft(state, (draft) => {
        (draft.specialModifiers ??= []).push(createSpecialModifier(kind));
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
  removeSpecialModifier: (modifierId) => {
    set((state) =>
      updateDraft(state, (draft) => {
        draft.specialModifiers = (draft.specialModifiers ?? []).filter(
          (modifier) => modifier.id !== modifierId,
        );
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
              const prefix = `assets/${oldSlug}/`;
              for (const image of [
                question.content.image,
                question.answerImage,
                question.content.media,
              ]) {
                if (image?.path.startsWith(prefix) === true) {
                  image.path = `assets/${slug}/${image.path.slice(prefix.length)}`;
                }
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
          if (image !== undefined) question.content.media = undefined;
        }
      }),
    );
  },
  setQuestionMedia: (roundId, themeId, questionId, media) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const question = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find((candidate) => candidate.id === questionId);
        if (question !== undefined) {
          question.content.media = media;
          if (media !== undefined) question.content.image = undefined;
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
          image.alt = alt.trim() === "" ? DEFAULT_IMAGE_ALT_TEXT : alt;
        }
      }),
    );
  },
  setQuestionWagerLimit: (roundId, themeId, questionId, wagerLimit) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const question = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find((candidate) => candidate.id === questionId);
        if (question !== undefined) {
          question.wagerLimit = wagerLimit;
        }
      }),
    );
  },
  setAnswerImage: (roundId, themeId, questionId, image) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const question = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find((candidate) => candidate.id === questionId);
        if (question !== undefined) {
          question.answerImage = image;
        }
      }),
    );
  },
  setAnswerImageAlt: (roundId, themeId, questionId, alt) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const image = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((theme) => theme.id === themeId)
          ?.questions.find(
            (candidate) => candidate.id === questionId,
          )?.answerImage;
        if (image !== undefined) {
          image.alt = alt.trim() === "" ? DEFAULT_IMAGE_ALT_TEXT : alt;
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
                const prefix = `assets/${oldSlug}/`;
                for (const image of [
                  question.content.image,
                  question.answerImage,
                  question.content.media,
                ]) {
                  if (image?.path.startsWith(prefix) === true) {
                    image.path = `assets/${newSlug}/${image.path.slice(prefix.length)}`;
                  }
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
  updateThemeDescription: (roundId, themeId, description) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const theme = draft.rounds
          .find((round) => round.id === roundId)
          ?.themes.find((candidate) => candidate.id === themeId);
        if (theme !== undefined) {
          theme.description =
            description.trim() === "" ? undefined : description;
        }
      }),
    );
  },
  updateSpecialModifier: (modifierId, patch) => {
    set((state) =>
      updateDraft(state, (draft) => {
        const modifier = draft.specialModifiers?.find(
          (candidate) => candidate.id === modifierId,
        );
        if (modifier === undefined) return;
        if (patch.text !== undefined) modifier.text = patch.text;
        if (modifier.kind === "money" && patch.delta !== undefined) {
          modifier.delta = patch.delta;
        }
      }),
    );
  },
}));
