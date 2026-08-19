"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { LoadingState } from "@/components/loading-state";
import { ScrollArea } from "@/components/scroll-area";
import { QuestionMediaEditor } from "@/features/quiz-editor/question-media-editor";
import {
  createQuiz,
  getQuiz,
  getQuizAssetUrl,
  updateQuiz,
  uploadQuizImage,
  uploadQuizMedia,
} from "@/shared/api/quizzes";
import { DEFAULT_IMAGE_ALT_TEXT, quizLimits } from "@/shared/constants/quiz";
import { createNewQuiz } from "@/shared/quiz/factory";
import { quizConfigSchema } from "@/shared/schemas/quiz";
import type { QuizConfig, QuizQuestion } from "@/shared/types/quiz";
import { classNames } from "@/shared/utils/class-names";
import { useQuizEditorStore } from "@/stores/quiz-editor-store";

export interface QuizEditorProps {
  quizId?: string;
}

type CollapsibleItemKind = "question" | "round" | "theme";

type PendingRemoval =
  | {
      kind: "question";
      questionId: string;
      roundId: string;
      themeId: string;
    }
  | { kind: "round"; roundId: string }
  | { kind: "theme"; roundId: string; themeId: string };

function getCollapsibleItemKey(kind: CollapsibleItemKind, id: string): string {
  return `${kind}:${id}`;
}

function getAllCollapsibleItemKeys(quiz: QuizConfig): Set<string> {
  const keys = new Set<string>();

  for (const round of quiz.rounds) {
    keys.add(getCollapsibleItemKey("round", round.id));
    for (const theme of round.themes) {
      keys.add(getCollapsibleItemKey("theme", theme.id));
      for (const question of theme.questions) {
        keys.add(getCollapsibleItemKey("question", question.id));
      }
    }
  }

  return keys;
}

function hasQuestionContent(question: QuizQuestion): boolean {
  return (
    question.content.image !== undefined ||
    question.content.media !== undefined ||
    question.answerImage !== undefined ||
    [question.answer, question.content.text, question.hostComment].some(
      (value) => value?.trim() !== "",
    )
  );
}

function CollapsibleContent({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  return (
    <div
      aria-hidden={!open}
      className={classNames(
        "grid transition-[grid-template-rows] duration-300 ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
      data-collapsible-state={open ? "open" : "closed"}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function AutoGrowingTextarea({
  className,
  onInput,
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback((textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    if (textareaRef.current !== null) {
      resize(textareaRef.current);
    }
  }, [resize, value]);

  return (
    <textarea
      {...props}
      className={classNames(
        "min-h-24 w-full resize-none overflow-hidden rounded-lg border border-slate-600 bg-slate-800 p-3 text-slate-100 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30",
        className,
      )}
      onInput={(event) => {
        resize(event.currentTarget);
        onInput?.(event);
      }}
      ref={textareaRef}
      value={value}
    />
  );
}

export function QuizEditor({ quizId }: QuizEditorProps) {
  const router = useRouter();
  const editor = useQuizEditorStore();
  const imageInputRefs = useRef(new Map<string, HTMLInputElement>());
  const initialize = useQuizEditorStore((state) => state.initialize);
  const setEditorError = useQuizEditorStore((state) => state.setError);
  const [confirmExit, setConfirmExit] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(quizId !== undefined);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(
    null,
  );
  const [uploadingImageKey, setUploadingImageKey] = useState<string | null>(
    null,
  );
  const [uploadingMediaQuestionId, setUploadingMediaQuestionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    let active = true;

    if (quizId === undefined) {
      initialize(createNewQuiz());
      return;
    }

    void getQuiz(quizId)
      .then((quiz) => {
        if (active) {
          setCollapsedItems(new Set());
          initialize(quiz);
          setLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setEditorError(
            loadError instanceof Error
              ? loadError.message
              : "Не удалось загрузить викторину",
          );
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [initialize, quizId, setEditorError]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (editor.dirty) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [editor.dirty]);

  const save = useCallback(async () => {
    if (editor.draft === null) {
      return;
    }
    if (editor.saving) {
      return;
    }
    if (uploadingImageKey !== null) {
      editor.setError("Дождитесь завершения загрузки изображения");
      return;
    }

    const candidate = {
      ...editor.draft,
      updatedAt: new Date().toISOString(),
    };
    const parsed = quizConfigSchema.safeParse(candidate);

    if (!parsed.success) {
      editor.setError(
        parsed.error.issues[0]?.message ?? "Проверьте данные викторины",
      );
      return;
    }

    editor.setSaving(true);
    editor.setError(null);

    try {
      const saved =
        quizId === undefined
          ? await createQuiz(parsed.data)
          : await updateQuiz(parsed.data);
      editor.markSaved(saved);

      if (quizId === undefined) {
        router.replace(`/editor/${saved.id}`);
      }
    } catch (saveError: unknown) {
      editor.setSaving(false);
      editor.setError(
        saveError instanceof Error
          ? saveError.message
          : "Не удалось сохранить викторину",
      );
    }
  }, [editor, quizId, router, uploadingImageKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [save]);

  const leaveEditor = () => {
    if (editor.dirty) {
      setConfirmExit(true);
    } else {
      router.push("/library");
    }
  };

  const uploadImage = async (
    roundId: string,
    themeId: string,
    questionId: string,
    target: "answer" | "question",
    file: File,
  ) => {
    if (editor.draft === null) {
      return;
    }
    if (
      quizId !== undefined &&
      editor.savedQuiz !== null &&
      editor.savedQuiz.slug !== editor.draft.slug
    ) {
      const input = imageInputRefs.current.get(`${questionId}:${target}`);
      if (input !== undefined) {
        input.value = "";
      }
      editor.setError(
        "Сначала сохраните новый slug, затем загрузите изображение",
      );
      return;
    }

    setUploadingImageKey(`${questionId}:${target}`);
    editor.setError(null);
    try {
      const image = await uploadQuizImage(
        quizId ?? editor.draft.id,
        editor.draft.slug,
        file,
      );
      const imageWithDefaultAlt = {
        ...image,
        alt: image.alt ?? DEFAULT_IMAGE_ALT_TEXT,
      };
      if (target === "question") {
        editor.setQuestionImage(
          roundId,
          themeId,
          questionId,
          imageWithDefaultAlt,
        );
      } else {
        editor.setAnswerImage(
          roundId,
          themeId,
          questionId,
          imageWithDefaultAlt,
        );
      }
    } catch (uploadError: unknown) {
      const input = imageInputRefs.current.get(`${questionId}:${target}`);
      if (input !== undefined) {
        input.value = "";
      }
      editor.setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Не удалось загрузить изображение",
      );
    } finally {
      setUploadingImageKey(null);
    }
  };

  const uploadMedia = async (
    roundId: string,
    themeId: string,
    questionId: string,
    file: File,
    kind: "audio" | "video",
  ) => {
    if (editor.draft === null) return;
    if (
      quizId !== undefined &&
      editor.savedQuiz !== null &&
      editor.savedQuiz.slug !== editor.draft.slug
    ) {
      editor.setError("Сначала сохраните новый slug, затем загрузите медиа");
      return;
    }

    setUploadingMediaQuestionId(questionId);
    editor.setError(null);
    try {
      const media = await uploadQuizMedia(
        quizId ?? editor.draft.id,
        editor.draft.slug,
        file,
        kind,
      );
      editor.setQuestionMedia(roundId, themeId, questionId, media);
    } catch (uploadError: unknown) {
      editor.setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Не удалось загрузить медиафайл",
      );
    } finally {
      setUploadingMediaQuestionId(null);
    }
  };

  if (loading || editor.draft === null) {
    return (
      <main className="grid h-full place-items-center bg-slate-950 text-white">
        {editor.error === null ? (
          <LoadingState>Загружаем редактор…</LoadingState>
        ) : (
          <ErrorMessage>{editor.error}</ErrorMessage>
        )}
      </main>
    );
  }

  const { draft } = editor;
  const isCollapsed = (kind: CollapsibleItemKind, id: string) =>
    collapsedItems.has(getCollapsibleItemKey(kind, id));
  const toggleCollapsed = (kind: CollapsibleItemKind, id: string) => {
    const key = getCollapsibleItemKey(kind, id);
    setCollapsedItems((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const confirmRemoval = () => {
    if (pendingRemoval === null) {
      return;
    }

    if (pendingRemoval.kind === "question") {
      editor.removeQuestion(
        pendingRemoval.roundId,
        pendingRemoval.themeId,
        pendingRemoval.questionId,
      );
    } else if (pendingRemoval.kind === "theme") {
      editor.removeTheme(pendingRemoval.roundId, pendingRemoval.themeId);
    } else {
      editor.removeRound(pendingRemoval.roundId);
    }
    setPendingRemoval(null);
  };
  const removalTitle =
    pendingRemoval?.kind === "question"
      ? "Удалить вопрос?"
      : pendingRemoval?.kind === "theme"
        ? "Удалить тему?"
        : "Удалить раунд?";
  const removalDescription =
    pendingRemoval?.kind === "question"
      ? "Вопрос и все его данные будут удалены без возможности восстановления."
      : pendingRemoval?.kind === "theme"
        ? "Тема и все её вопросы будут удалены без возможности восстановления."
        : "Раунд со всеми темами и вопросами будет удалён без возможности восстановления.";

  return (
    <main className="flex h-full flex-col overflow-hidden bg-slate-900 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 p-4">
        <div>
          <p className="text-sm text-blue-300">Редактор викторины</p>
          <h1 className="text-2xl font-semibold">{draft.title}</h1>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <span className="w-full text-sm text-slate-400 sm:w-auto">
            {editor.dirty ? "Есть несохранённые изменения" : "Сохранено"}
          </span>
          <Button onClick={leaveEditor} variant="secondary">
            В библиотеку
          </Button>
          <Button
            disabled={editor.saving || uploadingImageKey !== null}
            onClick={() => {
              void save();
            }}
          >
            {editor.saving
              ? "Сохранение…"
              : uploadingImageKey === null
                ? "Сохранить"
                : "Загрузка изображения…"}
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-6xl space-y-5 p-4 pb-12">
          <section className="grid gap-4 rounded-2xl bg-slate-800 p-5 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-sm text-slate-300">
                Название
              </span>
              <Input
                aria-label="Название викторины"
                onChange={(event) => {
                  editor.setTitle(event.target.value);
                }}
                value={draft.title}
              />
            </label>
            <label>
              <span className="mb-1 block text-sm text-slate-300">Slug</span>
              <Input
                aria-label="Slug викторины"
                onChange={(event) => {
                  editor.setSlug(event.target.value.toLowerCase());
                }}
                value={draft.slug}
              />
            </label>
          </section>

          <section className="rounded-2xl bg-slate-800 p-5">
            <h2 className="text-lg font-semibold">Настройки времени</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["questionIntroSeconds", "Задержка перед вопросом"],
                  ["buzzSeconds", "Время на нажатие"],
                  ["answerSeconds", "Время ответа"],
                  ["answerRevealSeconds", "Показ ответа"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span className="mb-1 block text-sm text-slate-300">
                    {label}, сек.
                  </span>
                  <Input
                    aria-label={label}
                    min={0}
                    onChange={(event) => {
                      editor.setSetting(key, Number(event.target.value));
                    }}
                    step="0.5"
                    type="number"
                    value={draft.settings[key]}
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-5">
              <label className="flex items-center gap-2">
                <input
                  checked={draft.settings.allowNegativeScore}
                  onChange={(event) => {
                    editor.setSetting(
                      "allowNegativeScore",
                      event.target.checked,
                    );
                  }}
                  type="checkbox"
                />
                Отрицательные баллы
              </label>
              <label className="flex items-center gap-2">
                <input
                  checked={draft.settings.showScoresToPlayers}
                  onChange={(event) => {
                    editor.setSetting(
                      "showScoresToPlayers",
                      event.target.checked,
                    );
                  }}
                  type="checkbox"
                />
                Показывать баллы игрокам
              </label>
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => {
                setCollapsedItems(getAllCollapsibleItemKeys(draft));
              }}
              variant="secondary"
            >
              Свернуть всё
            </Button>
            <Button
              onClick={() => {
                setCollapsedItems(new Set());
              }}
              variant="secondary"
            >
              Развернуть всё
            </Button>
          </div>

          {draft.rounds.map((round, roundIndex) => (
            <section
              className="rounded-2xl border border-slate-700 bg-slate-800 p-5"
              key={round.id}
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">
                  Раунд {roundIndex + 1}
                </h2>
                <div className="flex gap-2">
                  {isCollapsed("round", round.id) ? null : (
                    <>
                      <Button
                        aria-label={`Переместить раунд ${roundIndex + 1} вверх`}
                        disabled={roundIndex === 0}
                        onClick={() => {
                          editor.moveRound(round.id, -1);
                        }}
                        variant="secondary"
                      >
                        ↑
                      </Button>
                      <Button
                        aria-label={`Переместить раунд ${roundIndex + 1} вниз`}
                        disabled={roundIndex === draft.rounds.length - 1}
                        onClick={() => {
                          editor.moveRound(round.id, 1);
                        }}
                        variant="secondary"
                      >
                        ↓
                      </Button>
                      <Button
                        onClick={() => {
                          setPendingRemoval({
                            kind: "round",
                            roundId: round.id,
                          });
                        }}
                        variant="danger"
                      >
                        Удалить раунд
                      </Button>
                    </>
                  )}
                  <Button
                    aria-label={
                      isCollapsed("round", round.id)
                        ? `Развернуть раунд ${roundIndex + 1}`
                        : `Свернуть раунд ${roundIndex + 1}`
                    }
                    onClick={() => {
                      toggleCollapsed("round", round.id);
                    }}
                    variant="secondary"
                  >
                    {isCollapsed("round", round.id) ? "Развернуть" : "Свернуть"}
                  </Button>
                </div>
              </header>
              <CollapsibleContent open={!isCollapsed("round", round.id)}>
                {round.themes.length > 8 ||
                round.themes.some((theme) => theme.title.length > 32) ? (
                  <div
                    className="mt-3 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm text-amber-200"
                    role="status"
                  >
                    Публичная сетка может плохо поместиться на телевизоре.
                    Рекомендуется не больше 8 тем и до 32 символов в названии
                    темы.
                  </div>
                ) : null}

                <div className="mt-4 space-y-4">
                  {round.themes.map((theme, themeIndex) => (
                    <section
                      className="rounded-xl bg-slate-700 p-4"
                      key={theme.id}
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        {isCollapsed("theme", theme.id) ? (
                          <h3 className="min-w-52 flex-1 text-lg font-semibold">
                            {theme.title}
                          </h3>
                        ) : (
                          <label className="min-w-52 flex-1">
                            <span className="mb-1 block text-sm text-slate-300">
                              Тема {themeIndex + 1}
                            </span>
                            <Input
                              aria-label={`Название темы ${themeIndex + 1}`}
                              onChange={(event) => {
                                editor.updateThemeTitle(
                                  round.id,
                                  theme.id,
                                  event.target.value,
                                );
                              }}
                              value={theme.title}
                            />
                          </label>
                        )}
                        {isCollapsed("theme", theme.id) ? null : (
                          <>
                            <Button
                              disabled={themeIndex === 0}
                              onClick={() => {
                                editor.moveTheme(round.id, theme.id, -1);
                              }}
                              variant="secondary"
                            >
                              ↑
                            </Button>
                            <Button
                              disabled={themeIndex === round.themes.length - 1}
                              onClick={() => {
                                editor.moveTheme(round.id, theme.id, 1);
                              }}
                              variant="secondary"
                            >
                              ↓
                            </Button>
                            <Button
                              onClick={() => {
                                setPendingRemoval({
                                  kind: "theme",
                                  roundId: round.id,
                                  themeId: theme.id,
                                });
                              }}
                              variant="danger"
                            >
                              Удалить тему
                            </Button>
                          </>
                        )}
                        <Button
                          aria-label={
                            isCollapsed("theme", theme.id)
                              ? `Развернуть тему ${themeIndex + 1}`
                              : `Свернуть тему ${themeIndex + 1}`
                          }
                          onClick={() => {
                            toggleCollapsed("theme", theme.id);
                          }}
                          variant="secondary"
                        >
                          {isCollapsed("theme", theme.id)
                            ? "Развернуть"
                            : "Свернуть"}
                        </Button>
                      </div>

                      <CollapsibleContent
                        open={!isCollapsed("theme", theme.id)}
                      >
                        <div className="mt-4 space-y-3">
                          <label className="block">
                            <span className="mb-1 block text-sm text-slate-300">
                              Пояснение темы
                            </span>
                            <AutoGrowingTextarea
                              aria-label={`Пояснение темы ${themeIndex + 1}`}
                              maxLength={quizLimits.themeDescriptionLength}
                              onChange={(event) => {
                                editor.updateThemeDescription(
                                  round.id,
                                  theme.id,
                                  event.target.value,
                                );
                              }}
                              placeholder="Что будет происходить в этой теме"
                              value={theme.description ?? ""}
                            />
                          </label>
                          {theme.questions.map((question, questionIndex) => (
                            <article
                              className="rounded-xl bg-slate-800 p-4"
                              key={question.id}
                            >
                              <header className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="font-semibold">
                                  Вопрос {questionIndex + 1} · {question.price}
                                </h4>
                                <Button
                                  aria-label={
                                    isCollapsed("question", question.id)
                                      ? `Развернуть вопрос ${questionIndex + 1}`
                                      : `Свернуть вопрос ${questionIndex + 1}`
                                  }
                                  onClick={() => {
                                    toggleCollapsed("question", question.id);
                                  }}
                                  variant="secondary"
                                >
                                  {isCollapsed("question", question.id)
                                    ? "Развернуть"
                                    : "Свернуть"}
                                </Button>
                              </header>
                              <CollapsibleContent
                                open={!isCollapsed("question", question.id)}
                              >
                                <div className="mt-3 grid gap-3 lg:grid-cols-[8rem_1fr_1fr]">
                                  <label>
                                    <span className="mb-1 block text-sm text-slate-300">
                                      Стоимость
                                    </span>
                                    <Input
                                      aria-label={`Стоимость вопроса ${questionIndex + 1}`}
                                      min={1}
                                      onChange={(event) => {
                                        editor.updateQuestion(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          {
                                            price: Number(event.target.value),
                                          },
                                        );
                                      }}
                                      type="number"
                                      value={question.price}
                                    />
                                  </label>
                                  <label>
                                    <span className="mb-1 block text-sm text-slate-300">
                                      Текст вопроса
                                    </span>
                                    <AutoGrowingTextarea
                                      aria-label={`Текст вопроса ${questionIndex + 1}`}
                                      onChange={(event) => {
                                        editor.updateQuestion(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          {
                                            text: event.target.value,
                                          },
                                        );
                                      }}
                                      value={question.content.text ?? ""}
                                    />
                                  </label>
                                  <label>
                                    <span className="mb-1 block text-sm text-slate-300">
                                      Правильный ответ
                                    </span>
                                    <AutoGrowingTextarea
                                      aria-label={`Ответ вопроса ${questionIndex + 1}`}
                                      onChange={(event) => {
                                        editor.updateQuestion(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          {
                                            answer: event.target.value,
                                          },
                                        );
                                      }}
                                      value={question.answer}
                                    />
                                  </label>
                                  <label className="lg:col-span-2 lg:col-start-2">
                                    <span className="mb-1 block text-sm text-slate-300">
                                      Комментарий ведущего
                                    </span>
                                    <Input
                                      aria-label={`Комментарий вопроса ${questionIndex + 1}`}
                                      onChange={(event) => {
                                        editor.updateQuestion(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          {
                                            hostComment: event.target.value,
                                          },
                                        );
                                      }}
                                      value={question.hostComment ?? ""}
                                    />
                                  </label>
                                  <QuestionMediaEditor
                                    image={question.content.image}
                                    media={question.content.media}
                                    onChange={(media) => {
                                      editor.setQuestionMedia(
                                        round.id,
                                        theme.id,
                                        question.id,
                                        media,
                                      );
                                    }}
                                    onImageAltChange={(alt) => {
                                      editor.setQuestionImageAlt(
                                        round.id,
                                        theme.id,
                                        question.id,
                                        alt,
                                      );
                                    }}
                                    onRemove={() => {
                                      if (
                                        question.content.image !== undefined
                                      ) {
                                        editor.setQuestionImage(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          undefined,
                                        );
                                      } else {
                                        editor.setQuestionMedia(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          undefined,
                                        );
                                      }
                                    }}
                                    onUpload={(file, kind) => {
                                      void uploadMedia(
                                        round.id,
                                        theme.id,
                                        question.id,
                                        file,
                                        kind,
                                      );
                                    }}
                                    onUploadImage={(file) => {
                                      void uploadImage(
                                        round.id,
                                        theme.id,
                                        question.id,
                                        "question",
                                        file,
                                      );
                                    }}
                                    questionNumber={questionIndex + 1}
                                    uploading={
                                      uploadingMediaQuestionId ===
                                        question.id ||
                                      uploadingImageKey ===
                                        `${question.id}:question`
                                    }
                                  />
                                  <section className="space-y-3 lg:col-span-2 lg:col-start-2">
                                    <label className="block">
                                      <span className="mb-1 block text-sm text-slate-300">
                                        Изображение правильного ответа
                                      </span>
                                      <Input
                                        accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                                        aria-label={`Изображение ответа ${questionIndex + 1}`}
                                        disabled={uploadingImageKey !== null}
                                        ref={(input) => {
                                          const key = `${question.id}:answer`;
                                          if (input === null) {
                                            imageInputRefs.current.delete(key);
                                          } else {
                                            imageInputRefs.current.set(
                                              key,
                                              input,
                                            );
                                          }
                                        }}
                                        onChange={(event) => {
                                          const file = event.target.files?.[0];
                                          if (file !== undefined) {
                                            void uploadImage(
                                              round.id,
                                              theme.id,
                                              question.id,
                                              "answer",
                                              file,
                                            );
                                          }
                                        }}
                                        type="file"
                                      />
                                    </label>
                                    {uploadingImageKey ===
                                    `${question.id}:answer` ? (
                                      <p className="text-sm text-blue-300">
                                        Проверяем и нормализуем изображение…
                                      </p>
                                    ) : null}
                                    {question.answerImage ===
                                    undefined ? null : (
                                      <div className="grid gap-3 rounded-lg bg-slate-800 p-3 sm:grid-cols-[12rem_1fr]">
                                        <Image
                                          alt={
                                            question.answerImage.alt ??
                                            "Предпросмотр ответа"
                                          }
                                          className="h-36 w-full rounded-lg object-contain"
                                          height={144}
                                          src={getQuizAssetUrl(
                                            question.answerImage.path,
                                          )}
                                          unoptimized
                                          width={192}
                                        />
                                        <div>
                                          <label>
                                            <span className="mb-1 block text-sm text-slate-300">
                                              Alt-текст ответа
                                            </span>
                                            <Input
                                              aria-label={`Alt-текст ответа ${questionIndex + 1}`}
                                              onChange={(event) => {
                                                editor.setAnswerImageAlt(
                                                  round.id,
                                                  theme.id,
                                                  question.id,
                                                  event.target.value,
                                                );
                                              }}
                                              value={
                                                question.answerImage.alt ??
                                                DEFAULT_IMAGE_ALT_TEXT
                                              }
                                            />
                                          </label>
                                          <Button
                                            className="mt-3"
                                            onClick={() => {
                                              editor.setAnswerImage(
                                                round.id,
                                                theme.id,
                                                question.id,
                                                undefined,
                                              );
                                              const input =
                                                imageInputRefs.current.get(
                                                  `${question.id}:answer`,
                                                );
                                              if (input !== undefined) {
                                                input.value = "";
                                              }
                                            }}
                                            variant="danger"
                                          >
                                            Удалить изображение ответа
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </section>
                                  <Button
                                    className="lg:col-start-1 lg:row-start-2"
                                    onClick={() => {
                                      if (hasQuestionContent(question)) {
                                        setPendingRemoval({
                                          kind: "question",
                                          questionId: question.id,
                                          roundId: round.id,
                                          themeId: theme.id,
                                        });
                                      } else {
                                        editor.removeQuestion(
                                          round.id,
                                          theme.id,
                                          question.id,
                                        );
                                      }
                                    }}
                                    variant="danger"
                                  >
                                    Удалить вопрос
                                  </Button>
                                </div>
                              </CollapsibleContent>
                            </article>
                          ))}
                        </div>
                        <Button
                          className="mt-3"
                          onClick={() => {
                            editor.addQuestion(round.id, theme.id);
                          }}
                          variant="secondary"
                        >
                          Добавить вопрос
                        </Button>
                      </CollapsibleContent>
                    </section>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  onClick={() => {
                    editor.addTheme(round.id);
                  }}
                  variant="secondary"
                >
                  Добавить тему
                </Button>
              </CollapsibleContent>
            </section>
          ))}

          <Button onClick={editor.addRound} variant="secondary">
            Добавить раунд
          </Button>
        </div>
      </ScrollArea>

      {editor.error === null ? null : (
        <div className="shrink-0 border-t border-slate-700 bg-slate-800 p-4">
          <ErrorMessage>{editor.error}</ErrorMessage>
        </div>
      )}

      <ConfirmDialog
        cancelLabel="Нет"
        confirmLabel="Да"
        confirmOnEnter
        danger
        description={removalDescription}
        onCancel={() => {
          setPendingRemoval(null);
        }}
        onConfirm={confirmRemoval}
        open={pendingRemoval !== null}
        title={removalTitle}
      />

      <ConfirmDialog
        description="Несохранённые изменения будут потеряны."
        onCancel={() => {
          setConfirmExit(false);
        }}
        onConfirm={() => {
          router.push("/library");
        }}
        open={confirmExit}
        title="Выйти без сохранения?"
      />
    </main>
  );
}
