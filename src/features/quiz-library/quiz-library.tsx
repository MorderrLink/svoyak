"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog } from "@/components/dialog";
import { ErrorMessage } from "@/components/error-message";
import { LoadingState } from "@/components/loading-state";
import { ScrollArea } from "@/components/scroll-area";
import {
  deleteQuiz,
  downloadQuizPackage,
  duplicateQuiz,
  importQuizPackage,
  listQuizzes,
  QuizApiError,
} from "@/shared/api/quizzes";
import type { QuizSummary } from "@/shared/types/quiz";

export function QuizLibrary() {
  const [deleteCandidate, setDeleteCandidate] = useState<QuizSummary | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [importConflictFile, setImportConflictFile] = useState<File | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);

  const load = async () => {
    setLoading(true);

    try {
      setQuizzes(await listQuizzes());
      setError(null);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить библиотеку",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    void listQuizzes()
      .then((items) => {
        if (active) {
          setQuizzes(items);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Не удалось загрузить библиотеку",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleDuplicate = async (quizId: string) => {
    try {
      await duplicateQuiz(quizId);
      await load();
    } catch (duplicateError: unknown) {
      setError(
        duplicateError instanceof Error
          ? duplicateError.message
          : "Не удалось создать копию",
      );
    }
  };

  const handleDelete = async () => {
    if (deleteCandidate === null) {
      return;
    }

    try {
      await deleteQuiz(deleteCandidate.id);
      setDeleteCandidate(null);
      await load();
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Не удалось удалить викторину",
      );
    }
  };

  const handleExport = async (quizId: string) => {
    try {
      const exported = await downloadQuizPackage(quizId);
      if (window.showSaveFilePicker !== undefined) {
        const handle = await window.showSaveFilePicker({
          suggestedName: exported.filename,
          types: [
            {
              accept: {
                "application/zip": [".zip"],
              },
              description: "Архив викторины",
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(exported.source);
        await writable.close();
      } else {
        const url = URL.createObjectURL(exported.source);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = exported.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (exportError: unknown) {
      if (
        exportError instanceof DOMException &&
        exportError.name === "AbortError"
      ) {
        return;
      }
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Не удалось экспортировать викторину",
      );
    }
  };

  const handleImport = async (
    file: File,
    strategy: "copy" | "error" | "replace" = "error",
  ) => {
    setImporting(true);
    try {
      await importQuizPackage(file, strategy);
      setImportConflictFile(null);
      setError(null);
      await load();
    } catch (importError: unknown) {
      if (
        importError instanceof QuizApiError &&
        importError.code === "QUIZ_SLUG_CONFLICT" &&
        strategy === "error"
      ) {
        setImportConflictFile(file);
      } else {
        setError(
          importError instanceof Error
            ? importError.message
            : "Не удалось импортировать викторину",
        );
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <main className="flex h-full flex-col overflow-hidden bg-slate-950 p-4 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-blue-300">Свояк</p>
          <h1 className="text-3xl font-semibold">Библиотека викторин</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600"
            href="/"
          >
            На главную
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2 font-medium hover:bg-blue-500"
            href="/editor/new"
          >
            Создать викторину
          </Link>
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-emerald-700 px-4 py-2 font-medium hover:bg-emerald-600">
            {importing ? "Импортируем…" : "Импортировать ZIP"}
            <input
              accept=".zip,application/zip"
              aria-label="Импортировать ZIP"
              className="sr-only"
              disabled={importing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) {
                  void handleImport(file);
                }
                event.target.value = "";
              }}
              type="file"
            />
          </label>
        </div>
      </header>

      {error === null ? null : (
        <ErrorMessage className="mt-4">{error}</ErrorMessage>
      )}

      {loading ? (
        <LoadingState className="flex-1 text-white">
          Загружаем викторины…
        </LoadingState>
      ) : (
        <ScrollArea className="mt-4 flex-1">
          {quizzes.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-300">
              <p>Сохранённых викторин пока нет.</p>
              <Link
                className="mt-4 inline-block text-blue-300 underline"
                href="/editor/new"
              >
                Создать первую
              </Link>
            </section>
          ) : (
            <ul className="grid gap-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
              {quizzes.map((quiz) => (
                <li
                  className="flex flex-col rounded-2xl bg-slate-900 p-5"
                  key={quiz.id}
                >
                  <h2 className="text-xl font-semibold">{quiz.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">{quiz.slug}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-400">Раундов</dt>
                      <dd>{quiz.roundCount}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Вопросов</dt>
                      <dd>{quiz.questionCount}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-slate-500">
                    Изменено: {new Date(quiz.updatedAt).toLocaleString("ru-RU")}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500"
                      href={`/editor/${quiz.id}`}
                    >
                      Открыть
                    </Link>
                    <Link
                      className="inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium hover:bg-emerald-600"
                      href={`/host?quizId=${quiz.id}`}
                    >
                      Создать комнату
                    </Link>
                    <Button
                      className="min-h-11 px-3 text-sm"
                      onClick={() => {
                        void handleDuplicate(quiz.id);
                      }}
                      variant="secondary"
                    >
                      Дублировать
                    </Button>
                    <Button
                      className="min-h-11 px-3 text-sm"
                      onClick={() => {
                        void handleExport(quiz.id);
                      }}
                      variant="secondary"
                    >
                      Экспорт ZIP
                    </Button>
                    <Button
                      className="min-h-11 px-3 text-sm"
                      onClick={() => {
                        setDeleteCandidate(quiz);
                      }}
                      variant="danger"
                    >
                      Удалить
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}

      <ConfirmDialog
        confirmLabel="Удалить"
        danger
        description={`Удалить викторину «${deleteCandidate?.title ?? ""}»?`}
        onCancel={() => {
          setDeleteCandidate(null);
        }}
        onConfirm={() => {
          void handleDelete();
        }}
        open={deleteCandidate !== null}
        title="Удаление викторины"
      />
      <Dialog
        actions={
          <>
            <Button
              disabled={importing}
              onClick={() => {
                setImportConflictFile(null);
              }}
              variant="secondary"
            >
              Отмена
            </Button>
            <Button
              disabled={importing}
              onClick={() => {
                if (importConflictFile !== null) {
                  void handleImport(importConflictFile, "copy");
                }
              }}
            >
              Создать копию
            </Button>
            <Button
              disabled={importing}
              onClick={() => {
                if (importConflictFile !== null) {
                  void handleImport(importConflictFile, "replace");
                }
              }}
              variant="danger"
            >
              Заменить
            </Button>
          </>
        }
        onClose={() => {
          setImportConflictFile(null);
        }}
        open={importConflictFile !== null}
        title="Конфликт slug"
      >
        <p className="text-slate-700">
          Викторина с таким slug уже существует. Замените её или импортируйте
          архив как независимую копию.
        </p>
      </Dialog>
    </main>
  );
}
