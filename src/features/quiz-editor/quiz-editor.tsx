"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { LoadingState } from "@/components/loading-state";
import { ScrollArea } from "@/components/scroll-area";
import {
  createQuiz,
  getQuiz,
  getQuizAssetUrl,
  updateQuiz,
  uploadQuizImage,
} from "@/shared/api/quizzes";
import { createNewQuiz } from "@/shared/quiz/factory";
import { quizConfigSchema } from "@/shared/schemas/quiz";
import { useQuizEditorStore } from "@/stores/quiz-editor-store";

export interface QuizEditorProps {
  quizId?: string;
}

export function QuizEditor({ quizId }: QuizEditorProps) {
  const router = useRouter();
  const editor = useQuizEditorStore();
  const initialize = useQuizEditorStore((state) => state.initialize);
  const setEditorError = useQuizEditorStore((state) => state.setError);
  const [confirmExit, setConfirmExit] = useState(false);
  const [loading, setLoading] = useState(quizId !== undefined);
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    if (quizId === undefined) {
      initialize(createNewQuiz());
      return;
    }

    void getQuiz(quizId)
      .then((quiz) => {
        if (active) {
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

  const save = async () => {
    if (editor.draft === null) {
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
  };

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
    file: File,
  ) => {
    if (editor.draft === null) {
      return;
    }
    if (
      editor.savedQuiz !== null &&
      editor.savedQuiz.slug !== editor.draft.slug
    ) {
      editor.setError(
        "Сначала сохраните новый slug, затем загрузите изображение",
      );
      return;
    }

    setUploadingQuestionId(questionId);
    editor.setError(null);
    try {
      const image = await uploadQuizImage(
        quizId ?? editor.draft.id,
        editor.draft.slug,
        file,
      );
      editor.setQuestionImage(roundId, themeId, questionId, image);
    } catch (uploadError: unknown) {
      editor.setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Не удалось загрузить изображение",
      );
    } finally {
      setUploadingQuestionId(null);
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

  return (
    <main className="flex h-full flex-col overflow-hidden bg-slate-950 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
        <div>
          <p className="text-sm text-blue-300">Редактор викторины</p>
          <h1 className="text-2xl font-semibold">{draft.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">
            {editor.dirty ? "Есть несохранённые изменения" : "Сохранено"}
          </span>
          <Button onClick={leaveEditor} variant="secondary">
            В библиотеку
          </Button>
          <Button
            disabled={editor.saving}
            onClick={() => {
              void save();
            }}
          >
            {editor.saving ? "Сохранение…" : "Сохранить"}
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-6xl space-y-5 p-4 pb-12">
          {editor.error === null ? null : (
            <ErrorMessage>{editor.error}</ErrorMessage>
          )}

          <section className="grid gap-4 rounded-2xl bg-slate-900 p-5 md:grid-cols-2">
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

          <section className="rounded-2xl bg-slate-900 p-5">
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

          {draft.rounds.map((round, roundIndex) => (
            <section
              className="rounded-2xl border border-slate-700 bg-slate-900 p-5"
              key={round.id}
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">
                  Раунд {roundIndex + 1}
                </h2>
                <div className="flex gap-2">
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
                      editor.removeRound(round.id);
                    }}
                    variant="danger"
                  >
                    Удалить раунд
                  </Button>
                </div>
              </header>
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
                    className="rounded-xl bg-slate-800 p-4"
                    key={theme.id}
                  >
                    <div className="flex flex-wrap items-end gap-2">
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
                          editor.removeTheme(round.id, theme.id);
                        }}
                        variant="danger"
                      >
                        Удалить тему
                      </Button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {theme.questions.map((question, questionIndex) => (
                        <article
                          className="grid gap-3 rounded-xl bg-slate-900 p-4 lg:grid-cols-[8rem_1fr_1fr]"
                          key={question.id}
                        >
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
                            <textarea
                              aria-label={`Текст вопроса ${questionIndex + 1}`}
                              className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-950 p-3"
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
                            <textarea
                              aria-label={`Ответ вопроса ${questionIndex + 1}`}
                              className="min-h-24 w-full rounded-lg border border-slate-600 bg-slate-950 p-3"
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
                          <section className="space-y-3 lg:col-span-2 lg:col-start-2">
                            <label className="block">
                              <span className="mb-1 block text-sm text-slate-300">
                                Изображение вопроса
                              </span>
                              <Input
                                accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
                                aria-label={`Изображение вопроса ${questionIndex + 1}`}
                                disabled={uploadingQuestionId === question.id}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  if (file !== undefined) {
                                    void uploadImage(
                                      round.id,
                                      theme.id,
                                      question.id,
                                      file,
                                    );
                                  }
                                  event.target.value = "";
                                }}
                                type="file"
                              />
                            </label>
                            {uploadingQuestionId === question.id ? (
                              <p className="text-sm text-blue-300">
                                Проверяем и нормализуем изображение…
                              </p>
                            ) : null}
                            {question.content.image === undefined ? null : (
                              <div className="grid gap-3 rounded-lg bg-slate-950 p-3 sm:grid-cols-[12rem_1fr]">
                                <Image
                                  alt={
                                    question.content.image.alt ??
                                    "Предпросмотр вопроса"
                                  }
                                  className="h-36 w-full rounded-lg object-contain"
                                  height={144}
                                  src={getQuizAssetUrl(
                                    question.content.image.path,
                                  )}
                                  unoptimized
                                  width={192}
                                />
                                <div>
                                  <label>
                                    <span className="mb-1 block text-sm text-slate-300">
                                      Alt-текст
                                    </span>
                                    <Input
                                      aria-label={`Alt-текст вопроса ${questionIndex + 1}`}
                                      onChange={(event) => {
                                        editor.setQuestionImageAlt(
                                          round.id,
                                          theme.id,
                                          question.id,
                                          event.target.value,
                                        );
                                      }}
                                      value={question.content.image.alt ?? ""}
                                    />
                                  </label>
                                  <Button
                                    className="mt-3"
                                    onClick={() => {
                                      editor.setQuestionImage(
                                        round.id,
                                        theme.id,
                                        question.id,
                                        undefined,
                                      );
                                    }}
                                    variant="danger"
                                  >
                                    Удалить изображение
                                  </Button>
                                </div>
                              </div>
                            )}
                          </section>
                          <Button
                            className="lg:col-start-1 lg:row-start-2"
                            onClick={() => {
                              editor.removeQuestion(
                                round.id,
                                theme.id,
                                question.id,
                              );
                            }}
                            variant="danger"
                          >
                            Удалить вопрос
                          </Button>
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
            </section>
          ))}

          <Button onClick={editor.addRound} variant="secondary">
            Добавить раунд
          </Button>
        </div>
      </ScrollArea>

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
