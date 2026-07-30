import { expect, test, type Locator } from "@playwright/test";

async function expectSameCellSize(cells: Locator, count: number) {
  await expect(cells).toHaveCount(count);
  const sizes = await cells.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { height: bounds.height, width: bounds.width };
    }),
  );
  const firstSize = sizes[0];

  if (firstSize === undefined) {
    throw new Error("Не найдены ячейки игровой сетки");
  }

  expect(
    sizes.every(
      (size) =>
        Math.abs(size.height - firstSize.height) < 1 &&
        Math.abs(size.width - firstSize.width) < 1,
    ),
  ).toBe(true);
}

test("стартовая страница открывается", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Свояк" })).toBeVisible();
});

test("полный цикл викторины из двух раундов", async ({
  browser,
  page: hostPage,
}) => {
  const quizTitle = `E2E викторина ${Date.now()}`;
  let quizId: string | null = null;

  await hostPage.goto("/editor/new");
  await hostPage.getByLabel("Название викторины").fill(quizTitle);
  await hostPage.getByLabel("Задержка перед вопросом").fill("0");
  await hostPage.getByLabel("Показ ответа").fill("0");
  await hostPage.getByLabel("Название темы 1").fill("Первый раунд");
  await hostPage.getByLabel("Текст вопроса 1").fill("Первый вопрос");
  await hostPage.getByLabel("Ответ вопроса 1").fill("Первый ответ");
  await hostPage.getByRole("button", { name: "Добавить раунд" }).click();
  await hostPage.getByLabel("Название темы 1").nth(1).fill("Второй раунд");
  await hostPage.getByLabel("Текст вопроса 1").nth(1).fill("Второй вопрос");
  await hostPage.getByLabel("Ответ вопроса 1").nth(1).fill("Второй ответ");
  await hostPage.getByRole("button", { name: "Сохранить" }).click();
  await expect(hostPage).toHaveURL(/\/editor\/[0-9a-f-]+$/);
  quizId = hostPage.url().split("/").at(-1) ?? null;

  if (quizId === null) {
    throw new Error("Редактор не вернул идентификатор викторины");
  }

  await hostPage.goto(`/host?quizId=${quizId}`);
  await hostPage.getByRole("button", { name: "Создать комнату" }).click();
  const roomCode = await hostPage.getByTestId("room-code").innerText();
  await expect(
    hostPage.getByAltText("QR-код для подключения к комнате"),
  ).toBeVisible();

  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPlayer = await firstContext.newPage();
  const secondPlayer = await secondContext.newPage();

  try {
    await firstPlayer.goto(`/join/${roomCode}`);
    await firstPlayer.getByLabel("Имя игрока").fill("Алексей");
    await firstPlayer.getByRole("button", { name: "Войти в комнату" }).click();
    await expect(firstPlayer.getByText("Алексей")).toBeVisible();

    await secondPlayer.goto(`/join/${roomCode}`);
    await secondPlayer.getByLabel("Имя игрока").fill("Мария");
    await secondPlayer.getByRole("button", { name: "Войти в комнату" }).click();
    await expect(secondPlayer.getByText("Мария")).toBeVisible();

    await hostPage.getByRole("button", { name: "Начать викторину" }).click();
    await hostPage.getByRole("button", { name: "Первый раунд, 100" }).click();
    await expect(
      firstPlayer.getByRole("button", { name: "НАЖАТЬ" }),
    ).toBeEnabled();
    await firstPlayer.getByRole("button", { name: "НАЖАТЬ" }).click();
    await hostPage.getByRole("button", { name: "Неверно" }).click();
    await expect(
      hostPage.getByRole("heading", {
        name: "Подтверждение баллов: Алексей",
      }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "Подтвердить" }).click();

    await expect(firstPlayer.getByText("Попытка использована")).toBeVisible();
    await expect(
      secondPlayer.getByRole("button", { name: "НАЖАТЬ" }),
    ).toBeEnabled();
    await secondPlayer.getByRole("button", { name: "НАЖАТЬ" }).click();
    await hostPage.getByRole("button", { exact: true, name: "Верно" }).click();
    await hostPage.getByRole("button", { name: "Подтвердить" }).click();

    await expect(
      hostPage.getByRole("button", { name: "Второй раунд, 100" }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "Второй раунд, 100" }).click();
    await expect(
      firstPlayer.getByRole("button", { name: "НАЖАТЬ" }),
    ).toBeEnabled();
    await firstPlayer.getByRole("button", { name: "НАЖАТЬ" }).click();
    await hostPage.getByRole("button", { exact: true, name: "Верно" }).click();
    await hostPage.getByRole("button", { name: "Подтвердить" }).click();

    await expect(
      hostPage.getByRole("heading", { name: "Итоговая таблица" }),
    ).toBeVisible();
    await expect(hostPage.getByText("1. Мария", { exact: true })).toBeVisible();
    await expect(
      hostPage.getByText("2. Алексей", { exact: true }),
    ).toBeVisible();
  } finally {
    await firstContext.close();
    await secondContext.close();
    if (quizId !== null) {
      await hostPage.request.delete(`/api/quizzes/${quizId}`);
    }
  }
});

test("публичный экран синхронизируется без приватных данных", async ({
  browser,
  page: hostPage,
}) => {
  const timestamp = Date.now();
  const quizTitle = `E2E два экрана ${timestamp}`;
  const questionText = `Публичный вопрос ${timestamp}`;
  const answer = `Скрытый ответ ${timestamp}`;
  const hostComment = `Только ведущему ${timestamp}`;
  let quizId: string | null = null;

  await hostPage.goto("/editor/new");
  await hostPage.getByLabel("Название викторины").fill(quizTitle);
  await hostPage.getByLabel("Задержка перед вопросом").fill("2");
  await hostPage.getByLabel("Показ ответа").fill("2");
  await hostPage.getByLabel("Название темы 1").fill("Двойной экран");
  await hostPage.getByLabel("Текст вопроса 1").fill(questionText);
  await hostPage.getByLabel("Ответ вопроса 1").fill(answer);
  await hostPage.getByLabel("Комментарий вопроса 1").fill(hostComment);
  await hostPage.getByRole("button", { name: "Добавить вопрос" }).click();
  await hostPage.getByLabel("Текст вопроса 2").fill("Запасной вопрос");
  await hostPage.getByLabel("Ответ вопроса 2").fill("Запасной ответ");
  await hostPage.getByRole("button", { name: "Добавить тему" }).click();
  await hostPage.getByLabel("Название темы 2").fill("Короткая тема");
  await hostPage
    .getByLabel("Текст вопроса 1")
    .nth(1)
    .fill("Единственный вопрос");
  await hostPage
    .getByLabel("Ответ вопроса 1")
    .nth(1)
    .fill("Единственный ответ");
  await hostPage.getByRole("button", { name: "Сохранить" }).click();
  await expect(hostPage).toHaveURL(/\/editor\/[0-9a-f-]+$/);
  quizId = hostPage.url().split("/").at(-1) ?? null;

  if (quizId === null) {
    throw new Error("Редактор не вернул идентификатор викторины");
  }

  await hostPage.goto(`/host?quizId=${quizId}`);
  await hostPage.getByRole("button", { name: "Создать комнату" }).click();
  await expect(hostPage).toHaveURL(/\/host\/[A-HJ-NP-Z2-9]{4}$/);
  const roomCode = await hostPage.getByTestId("room-code").innerText();
  await expect(
    hostPage.getByRole("button", { name: "Открыть публичный экран" }),
  ).toBeVisible();

  const displayContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const displayPage = await displayContext.newPage();
  const playerPage = await playerContext.newPage();

  try {
    await displayPage.goto(`/display/${roomCode}`);
    await expect(displayPage.getByTestId("display-phase-lobby")).toBeVisible();
    await expect(
      displayPage.getByAltText("QR-код подключения игроков"),
    ).toBeVisible();

    await playerPage.goto(`/join/${roomCode}`);
    await playerPage.getByLabel("Имя игрока").fill("Игрок экрана");
    await playerPage.getByRole("button", { name: "Войти в комнату" }).click();
    await expect(displayPage.getByText("Игроков подключено: 1")).toBeVisible();

    await hostPage.getByRole("button", { name: "Начать викторину" }).click();
    await expect(displayPage.getByTestId("display-phase-board")).toBeVisible();
    await expectSameCellSize(displayPage.getByTestId("display-board-price"), 3);
    await expectSameCellSize(hostPage.getByTestId("host-board-price"), 3);

    await hostPage.getByRole("button", { name: "Двойной экран, 100" }).click();
    await expect(
      displayPage.getByTestId("display-phase-question-intro"),
    ).toBeVisible();
    await expect(displayPage.getByText("Двойной экран")).toBeVisible();
    await expect(displayPage.getByText(questionText)).toHaveCount(0);
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await expect(displayPage.getByText(hostComment)).toHaveCount(0);

    await expect(displayPage.getByTestId("display-phase-buzzing")).toBeVisible({
      timeout: 5_000,
    });
    await expect(displayPage.getByText(questionText)).toBeVisible();
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await expect(displayPage.getByText(hostComment)).toHaveCount(0);

    await playerPage.getByRole("button", { name: "НАЖАТЬ" }).click();
    await expect(
      displayPage.getByTestId("display-phase-answering"),
    ).toBeVisible();
    await expect(displayPage.getByText("Отвечает Игрок экрана")).toBeVisible();
    await expect(displayPage.getByText(answer)).toHaveCount(0);

    await hostPage.getByRole("button", { exact: true, name: "Верно" }).click();
    await expect(
      displayPage.getByTestId("display-phase-score-confirmation"),
    ).toBeVisible();
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await expect(hostPage.getByText(hostComment)).toBeVisible();
    await hostPage.getByRole("button", { name: "Подтвердить" }).click();

    await expect(
      displayPage.getByTestId("display-phase-answer-reveal"),
    ).toBeVisible();
    await expect(displayPage.getByText(answer)).toBeVisible();
    await expect(displayPage.getByText(hostComment)).toHaveCount(0);

    await expect(displayPage.getByTestId("display-phase-board")).toBeVisible({
      timeout: 5_000,
    });
    await expect(displayPage.getByText("200", { exact: true })).toBeVisible();
  } finally {
    await displayContext.close();
    await playerContext.close();
    if (quizId !== null) {
      await hostPage.request.delete(`/api/quizzes/${quizId}`);
    }
  }
});

test("викторина с изображением проходит экспорт и импорт ZIP", async ({
  browser,
  page,
}) => {
  const quizTitle = `E2E медиа ${Date.now()}`;
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

  await page.goto("/editor/new");
  await page.getByLabel("Название викторины").fill(quizTitle);
  await page.getByLabel("Название темы 1").fill("Изображения");
  await page.getByLabel("Текст вопроса 1").fill("Что изображено?");
  await page.getByLabel("Ответ вопроса 1").fill("Точка");
  await page.getByLabel("Задержка перед вопросом").fill("0");
  await page.getByLabel("Показ ответа").fill("0");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+$/);
  const quizId = page.url().split("/").at(-1);
  if (quizId === undefined) {
    throw new Error("Редактор не вернул идентификатор медиа-викторины");
  }

  await page.getByLabel("Изображение вопроса 1").setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "point.png",
  });
  await expect(page.getByAltText("Предпросмотр вопроса")).toBeVisible();
  await page.getByLabel("Alt-текст вопроса 1").fill("Синяя точка");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Сохранено", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "В библиотеку" }).click();

  const quizCard = page.locator("li").filter({
    has: page.getByRole("heading", { name: quizTitle }),
  });
  await expect(quizCard).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: undefined,
    });
  });
  const downloadPromise = page.waitForEvent("download");
  await quizCard.getByRole("button", { name: "Экспорт ZIP" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  if (archivePath === null) {
    throw new Error("Playwright не сохранил экспортированный ZIP");
  }

  await quizCard.getByRole("button", { name: "Удалить" }).click();
  await page
    .getByRole("dialog", { name: "Удаление викторины" })
    .getByRole("button", { name: "Удалить" })
    .click();
  await expect(quizCard).toHaveCount(0);

  await page.getByLabel("Импортировать ZIP").setInputFiles(archivePath);
  const importedCard = page.locator("li").filter({
    has: page.getByRole("heading", { name: quizTitle }),
  });
  await expect(importedCard).toBeVisible();
  await importedCard.getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByAltText("Синяя точка")).toBeVisible();
  await page.getByRole("button", { name: "В библиотеку" }).click();

  await importedCard.getByRole("link", { name: "Создать комнату" }).click();
  await page.getByRole("button", { name: "Создать комнату" }).click();
  const roomCode = await page.getByTestId("room-code").innerText();
  const playerContext = await browser.newContext();
  const player = await playerContext.newPage();

  try {
    await player.goto(`/join/${roomCode}`);
    await player.getByLabel("Имя игрока").fill("Медиа-игрок");
    await player.getByRole("button", { name: "Войти в комнату" }).click();
    await page.getByRole("button", { name: "Начать викторину" }).click();
    await page.getByRole("button", { name: "Изображения, 100" }).click();
    await expect(page.getByAltText("Синяя точка")).toBeVisible();
  } finally {
    await playerContext.close();
    await page.request.delete(`/api/quizzes/${quizId}`);
  }
});
