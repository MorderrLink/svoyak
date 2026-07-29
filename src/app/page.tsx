import Link from "next/link";

export default function Home() {
  return (
    <main className="grid h-full place-items-center bg-slate-950 p-8 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-semibold">Свояк</h1>
        <p className="mt-3 text-slate-300">
          Локальное приложение для проведения викторин
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-emerald-700 px-5 py-2 font-medium hover:bg-emerald-600"
            href="/library"
          >
            Библиотека
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-5 py-2 font-medium hover:bg-blue-500"
            href="/host"
          >
            Создать комнату
          </Link>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg bg-slate-700 px-5 py-2 font-medium hover:bg-slate-600"
            href="/join"
          >
            Подключиться
          </Link>
        </div>
      </div>
    </main>
  );
}
