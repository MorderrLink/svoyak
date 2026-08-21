import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectViewportIsContained(page: Page, scale = 1) {
  const layout = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("#app-root");
    if (root === null) {
      throw new Error("Не найден #app-root");
    }

    return {
      bodyOverflow: getComputedStyle(document.body).overflow,
      documentOverflow: getComputedStyle(document.documentElement).overflow,
      rootClientHeight: root.clientHeight,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(layout.bodyOverflow).toBe("hidden");
  expect(layout.documentOverflow).toBe("hidden");
  expect(layout.rootClientHeight * scale).toBe(layout.viewportHeight);
  expect(layout.rootClientWidth * scale).toBe(layout.viewportWidth);
  expect(layout.rootScrollWidth).toBeLessThanOrEqual(layout.rootClientWidth);
}

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

function createTestWav(durationSeconds = 0.8): Buffer {
  const sampleRate = 8_000;
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * 440);
    buffer.writeInt16LE(Math.round(sample * 20_000), 44 + index * 2);
  }
  return buffer;
}

test("стартовая страница открывается", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Свояк" })).toBeVisible();
});

test("несуществующая комната возвращает на главную", async ({ page }) => {
  await page.goto("/join/ZZZZ");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Свояк" })).toBeVisible();
});

test("основные экраны помещаются в адаптивные viewport", async ({ page }) => {
  const cases = [
    { height: 568, path: "/", width: 320 },
    { height: 844, path: "/editor/new", width: 390 },
    { height: 1_024, path: "/library", width: 768 },
    { height: 768, path: "/host", width: 1_366 },
    { height: 1_080, path: "/", width: 1_920 },
  ];

  for (const item of cases) {
    await page.setViewportSize({
      height: item.height,
      width: item.width,
    });
    await page.goto(item.path);
    await expect(page.locator("main")).toBeVisible();
    await expectViewportIsContained(page);
  }

  await page.setViewportSize({
    height: 844,
    width: 390,
  });
  await page.goto("/editor/new");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeVisible();
  await expectViewportIsContained(page, 2);
});

test("редактор сворачивает блоки и защищает удаление данных", async ({
  page,
}) => {
  await page.goto("/editor/new");

  await expect(page.getByRole("button", { name: "Сохранить" })).toBeEnabled();
  await page.keyboard.press("Control+s");
  const saveError = page.getByText(
    "Добавьте текст, изображение, аудио или видео вопроса",
    { exact: true },
  );
  await expect(saveError).toBeVisible();
  const errorPosition = await saveError.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const editor = document.querySelector("main");
    if (editor === null) {
      throw new Error("Не найден редактор викторины");
    }
    return {
      editorBottom: editor.getBoundingClientRect().bottom,
      errorBottom: bounds.bottom,
    };
  });
  expect(errorPosition.errorBottom).toBeLessThanOrEqual(
    errorPosition.editorBottom,
  );

  const questionText = page.getByLabel("Текст вопроса 1");
  const initialHeight = (await questionText.boundingBox())?.height ?? 0;
  await questionText.fill(
    "Первая строка\nВторая строка\nТретья строка\nЧетвёртая строка\nПятая строка\nШестая строка",
  );
  await expect(questionText).toHaveCSS("resize", "none");
  expect((await questionText.boundingBox())?.height ?? 0).toBeGreaterThan(
    initialHeight,
  );

  await page.getByRole("button", { name: "Свернуть вопрос 1" }).click();
  await expect(page.locator('[data-collapsible-state="closed"]')).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Свернуть тему 1" }).click();
  await page.getByRole("button", { name: "Свернуть раунд 1" }).click();
  await page.getByRole("button", { name: "Развернуть раунд 1" }).click();
  await expect(
    page.getByRole("button", { name: "Развернуть тему 1" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Развернуть всё" }).click();
  await expect(questionText).toBeVisible();
  await page.getByRole("button", { name: "Свернуть всё" }).click();
  await expect(page.locator('[data-collapsible-state="closed"]')).toHaveCount(
    3,
  );
  await page.getByRole("button", { name: "Развернуть всё" }).click();

  await page.getByRole("button", { name: "Удалить вопрос" }).click();
  await expect(
    page.getByRole("dialog", { name: "Удалить вопрос?" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Удалить вопрос?" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Удалить вопрос" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Вопрос 1 · 100")).toHaveCount(0);

  await page.getByRole("button", { name: "Удалить тему" }).click();
  await expect(
    page.getByRole("dialog", { name: "Удалить тему?" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Удалить тему" }).click();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Тема 1", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Удалить раунд" }).click();
  await expect(
    page.getByRole("dialog", { name: "Удалить раунд?" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Раунд 1", { exact: true })).toHaveCount(0);
});

test("полный цикл викторины из двух раундов", async ({
  browser,
  page: hostPage,
}) => {
  const quizTitle = `E2E викторина ${Date.now()}`;
  let quizId: string | null = null;

  await hostPage.goto("/editor/new");
  await hostPage.getByLabel("Название викторины").fill(quizTitle);
  await hostPage.getByLabel("Задержка перед вопросом").fill("30");
  await hostPage.getByLabel("Показ ответа").fill("30");
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
    await expect(
      firstPlayer.getByRole("button", { name: /Эффекты/ }),
    ).toHaveCount(0);

    await secondPlayer.goto(`/join/${roomCode}`);
    await secondPlayer.getByLabel("Имя игрока").fill("Мария");
    await secondPlayer.getByRole("button", { name: "Войти в комнату" }).click();
    await expect(secondPlayer.getByText("Мария")).toBeVisible();
    await expect(hostPage.getByTestId("lobby-player-card")).toHaveCount(2);
    await expect(hostPage.getByText(/Компьютер .+ · Chrome/)).toHaveCount(2);
    await expect(hostPage.getByText(/\d+ мс/)).toHaveCount(2);

    await hostPage
      .getByRole("button", { name: "Изменить баллы игрока Мария" })
      .click();
    await expect(
      hostPage.getByRole("heading", { name: "Мария · 0 баллов" }),
    ).toBeVisible();
    await expect(
      hostPage.getByRole("spinbutton", { exact: true, name: "Баллы" }),
    ).toHaveValue("0");
    await expect(hostPage.getByLabel("Имя игрока")).toHaveValue("Мария");
    await hostPage.getByLabel("Имя игрока").fill("  Мария   ");
    await hostPage
      .getByRole("spinbutton", { exact: true, name: "Баллы" })
      .focus();
    await hostPage.keyboard.press("ArrowUp");
    await hostPage.keyboard.press("Enter");

    await hostPage.getByRole("button", { name: "Начать викторину" }).click();
    await expect(
      hostPage.getByAltText("QR-код для подключения к комнате"),
    ).toHaveCount(0);
    await expect(hostPage.getByLabel("Адрес локальной сети")).toHaveCount(0);
    await expect(hostPage.getByTestId("game-player-card")).toHaveCount(2);
    await expect(
      hostPage.getByRole("button", {
        name: "Изменить баллы игрока Мария",
      }),
    ).toContainText("100 баллов");
    await expect(
      hostPage
        .getByTestId("game-player-card")
        .first()
        .getByRole("status", { name: "Онлайн" }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "Следующий раунд" }).click();
    await expect(
      hostPage.getByRole("button", { name: "Второй раунд, 100" }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "Предыдущий раунд" }).click();
    await hostPage.getByRole("button", { name: "Первый раунд, 100" }).click();
    await expect(hostPage.getByText("Space — пропустить таймер")).toBeVisible();
    await hostPage.keyboard.press("Space");
    await expect(
      firstPlayer.getByRole("button", { name: "НАЖАТЬ" }),
    ).toBeEnabled();
    await firstPlayer.getByRole("button", { name: "НАЖАТЬ" }).click();
    await expect(
      firstPlayer.getByRole("button", {
        name: "Нажатие принято, вы в очереди 1",
      }),
    ).toContainText("ВЫ В ОЧЕРЕДИ: 1");
    await secondPlayer.getByRole("button", { name: "НАЖАТЬ" }).click();
    await expect(
      secondPlayer.getByRole("button", {
        name: "Нажатие принято, вы в очереди 2",
      }),
    ).toContainText("ВЫ В ОЧЕРЕДИ: 2");
    await expect(
      hostPage.getByRole("button", {
        name: "Выбрать Мария для ответа, нажатие 2",
      }),
    ).toBeVisible();
    await hostPage.keyboard.press("Space");
    await hostPage
      .getByRole("button", {
        name: "Выбрать Алексей для ответа, нажатие 1",
      })
      .click();
    await expect(
      hostPage.getByRole("heading", { name: "Отвечает Алексей" }),
    ).toBeVisible();
    await hostPage.keyboard.press("x");
    await expect(
      hostPage.getByRole("heading", {
        name: "Алексей · -100 баллов",
      }),
    ).toBeVisible();
    await expect(hostPage.getByText(/Стоимость .*результат:/)).toHaveCount(0);
    await expect(
      hostPage.getByText("Изменение баллов", { exact: true }),
    ).toHaveCount(0);
    await expect(
      hostPage.getByText("Клавиши ↑ и ↓ изменяют сумму на 100", {
        exact: true,
      }),
    ).toHaveCount(0);
    await hostPage.keyboard.press("ArrowUp");
    await expect(
      hostPage.getByRole("spinbutton", { exact: true, name: "Баллы" }),
    ).toHaveValue("0");
    await hostPage.keyboard.press("ArrowDown");
    await hostPage.keyboard.press("s");
    await expect(
      hostPage.getByRole("spinbutton", { exact: true, name: "Баллы" }),
    ).toHaveValue("100");
    await hostPage.keyboard.press("s");
    await hostPage.keyboard.press("0");
    await hostPage.keyboard.press("ArrowDown");
    await hostPage.keyboard.press("x");
    await expect(
      hostPage.getByRole("spinbutton", { exact: true, name: "Баллы" }),
    ).toHaveValue("-200");
    await hostPage.keyboard.press("ArrowUp");
    await hostPage.keyboard.press("Enter");

    const incorrectButton = firstPlayer.getByRole("button", {
      name: "Неверный ответ",
    });
    await expect(incorrectButton).toBeVisible();
    await expect(incorrectButton).toHaveClass(/bg-red-600/);
    await expect(incorrectButton).toContainText("-100 БАЛЛОВ");
    await expect(
      hostPage.getByRole("button", {
        name: "Алексей уже ответил неверно",
      }),
    ).toBeDisabled();
    await expect(
      secondPlayer.getByRole("button", {
        name: "Нажатие принято, вы в очереди 2",
      }),
    ).toBeVisible();
    await hostPage
      .getByRole("button", {
        name: "Выбрать Мария для ответа, нажатие 2",
      })
      .click();
    await expect(
      hostPage.getByRole("heading", { name: "Отвечает Мария" }),
    ).toBeVisible();
    await hostPage.keyboard.press("v");
    await expect(
      hostPage.getByRole("heading", { name: "Мария · +100 баллов" }),
    ).toBeVisible();
    await hostPage.keyboard.press("Enter");
    await expect(
      secondPlayer.getByRole("button", { name: "Верный ответ" }),
    ).toContainText("+100 БАЛЛОВ");
    await expect(hostPage.getByText("Space — пропустить таймер")).toBeVisible();
    await hostPage.keyboard.press("Space");

    await expect(
      hostPage.getByRole("button", { name: "Второй раунд, 100" }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "Второй раунд, 100" }).click();
    await expect(hostPage.getByText("Space — пропустить таймер")).toBeVisible();
    await hostPage.keyboard.press("Space");
    await expect(
      firstPlayer.getByRole("button", { name: "НАЖАТЬ" }),
    ).toBeEnabled();
    await firstPlayer.getByRole("button", { name: "НАЖАТЬ" }).click();
    await hostPage
      .getByRole("button", {
        name: "Выбрать Алексей для ответа, нажатие 1",
      })
      .click();
    await hostPage.getByRole("button", { name: "Верно, клавиша V" }).click();
    await expect(
      hostPage.getByRole("heading", { name: "Алексей · +100 баллов" }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: /^Ок/ }).click();
    await expect(hostPage.getByText("Space — пропустить таймер")).toBeVisible();
    await hostPage.keyboard.press("Space");

    await expect(
      hostPage.getByRole("heading", { name: "Итоговая таблица" }),
    ).toBeVisible();
    await expect(hostPage.getByText("1. Мария", { exact: true })).toBeVisible();
    await expect(
      hostPage.getByText("2. Алексей", { exact: true }),
    ).toBeVisible();
    await firstPlayer.getByRole("button", { name: "На главную" }).click();
    await expect(firstPlayer).toHaveURL("/");
    await hostPage.getByRole("button", { name: "На главную" }).click();
    await expect(hostPage).toHaveURL("/");
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
  test.setTimeout(90_000);
  const timestamp = Date.now();
  const quizTitle = `E2E два экрана ${timestamp}`;
  const questionText =
    "Не расслабляйся даже когда долго в теме\nТем более когда долго в теме\n...\nСделан в Китае, продан за рубль";
  const answer = `Скрытый ответ ${timestamp}`;
  const hostComment = `Только ведущему ${timestamp}`;
  const questionImageAlt = `Изображение вопроса ${timestamp}`;
  const answerImageAlt = `Изображение ответа ${timestamp}`;
  const imageOnlyQuestionAlt = `Вопрос только с изображением ${timestamp}`;
  const imageOnlyAnswerAlt = `Ответ только с изображением ${timestamp}`;
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  let quizId: string | null = null;

  await hostPage.goto("/editor/new");
  await hostPage.getByLabel("Название викторины").fill(quizTitle);
  await hostPage.getByLabel("Задержка перед вопросом").fill("2");
  await hostPage.getByLabel("Время на нажатие").fill("30");
  await hostPage.getByLabel("Показ ответа").fill("2");
  await hostPage.getByLabel("Название темы 1").fill("Двойной экран");
  await hostPage
    .getByLabel("Пояснение темы 1")
    .fill("Сначала прочитайте правила темы.\nЗатем выбирайте вопрос.");
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
  await expect(hostPage).toHaveURL(/\/editor\/[0-9a-f-]+$/, {
    timeout: 15_000,
  });
  quizId = hostPage.url().split("/").at(-1) ?? null;

  if (quizId === null) {
    throw new Error("Редактор не вернул идентификатор викторины");
  }

  await hostPage.getByLabel("Изображение вопроса 1").first().setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "question.png",
  });
  await expect(hostPage.getByLabel("Alt-текст вопроса 1")).toHaveValue(
    "Не удалось загрузить изображение",
  );
  await hostPage.getByLabel("Alt-текст вопроса 1").fill(questionImageAlt);
  await hostPage.getByLabel("Изображение ответа 1").first().setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "answer.png",
  });
  await expect(hostPage.getByLabel("Alt-текст ответа 1")).toHaveValue(
    "Не удалось загрузить изображение",
  );
  await hostPage.getByLabel("Alt-текст ответа 1").fill(answerImageAlt);
  await hostPage.getByLabel("Изображение вопроса 2").setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "image-only-question.png",
  });
  await expect(hostPage.getByLabel("Alt-текст вопроса 2")).toHaveValue(
    "Не удалось загрузить изображение",
  );
  await hostPage.getByLabel("Alt-текст вопроса 2").fill(imageOnlyQuestionAlt);
  await hostPage.getByLabel("Изображение ответа 2").setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "image-only-answer.png",
  });
  await expect(hostPage.getByLabel("Alt-текст ответа 2")).toHaveValue(
    "Не удалось загрузить изображение",
  );
  await hostPage.getByLabel("Alt-текст ответа 2").fill(imageOnlyAnswerAlt);
  await hostPage.getByLabel("Текст вопроса 2", { exact: true }).fill("");
  await hostPage.getByLabel("Ответ вопроса 2", { exact: true }).fill("");
  await hostPage.getByRole("button", { name: "Сохранить" }).click();
  await expect(hostPage.getByText("Сохранено", { exact: true })).toBeVisible();

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
      displayPage.getByRole("heading", { name: quizTitle }),
    ).toBeVisible();
    await expect(
      displayPage.getByRole("status", { name: "Онлайн" }),
    ).toBeVisible();
    await expect(displayPage.getByText(roomCode, { exact: true })).toHaveCount(
      0,
    );
    await expect(
      displayPage.getByRole("button", { name: "На весь экран" }),
    ).toHaveCount(0);
    await expect(
      displayPage.getByRole("link", { name: "На главную" }),
    ).toHaveCount(0);
    await expect(
      displayPage.getByAltText("QR-код подключения игроков"),
    ).toBeVisible();

    await playerPage.goto(`/join/${roomCode}`);
    await playerPage.getByLabel("Имя игрока").fill("Игрок экрана");
    await playerPage.getByRole("button", { name: "Войти в комнату" }).click();
    await expect(displayPage.getByText("Игроков подключено: 1")).toBeVisible();

    await hostPage.getByRole("button", { name: "Начать викторину" }).click();
    await expect(displayPage.getByTestId("display-phase-board")).toBeVisible();
    await expect(displayPage.getByText("Счёт", { exact: true })).toHaveCount(0);
    await expectSameCellSize(displayPage.getByTestId("display-board-price"), 3);
    await expectSameCellSize(hostPage.getByTestId("host-board-price"), 3);

    await hostPage
      .getByRole("button", {
        name: "Показать пояснение темы Двойной экран",
      })
      .click();
    await expect(
      displayPage.getByTestId("display-phase-theme-explanation"),
    ).toBeVisible();
    await expect(
      displayPage.getByRole("heading", { name: "Двойной экран" }),
    ).toBeVisible();
    await expect(
      displayPage.getByText(/Сначала прочитайте правила темы/),
    ).toBeVisible();
    await expect(hostPage.getByText("Space — закрыть пояснение")).toBeVisible();
    await hostPage.keyboard.press("Space");
    await expect(displayPage.getByTestId("display-phase-board")).toBeVisible();

    await hostPage.getByRole("button", { name: "Двойной экран, 100" }).click();
    await expect(
      displayPage.getByTestId("display-phase-question-intro"),
    ).toBeVisible();
    await expect(displayPage.getByText("Двойной экран")).toBeVisible();
    await expect(displayPage.getByText(questionText)).toHaveCount(0);
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await expect(displayPage.getByAltText(answerImageAlt)).toHaveCount(0);
    await expect(displayPage.getByText(hostComment)).toHaveCount(0);

    await expect(displayPage.getByTestId("display-phase-buzzing")).toBeVisible({
      timeout: 5_000,
    });
    await expect(displayPage.getByText(questionText)).toBeVisible();
    await expect(displayPage.getByAltText(questionImageAlt)).toBeVisible();
    await expect(displayPage.getByTestId("display-media-text")).toHaveCSS(
      "white-space",
      "pre-line",
    );
    const questionLayout = await displayPage
      .getByTestId("display-media-content")
      .evaluate((content) => {
        const text = content.querySelector<HTMLElement>(
          '[data-testid="display-media-text"]',
        );
        const image = content.querySelector<HTMLElement>(
          '[data-testid="display-media-image"]',
        );
        if (text === null || image === null) {
          throw new Error("Не найден текст или изображение вопроса");
        }
        const textBounds = text.getBoundingClientRect();
        const imageBounds = image.getBoundingClientRect();
        return {
          imageBottom: imageBounds.bottom,
          imageTop: imageBounds.top,
          textBottom: textBounds.bottom,
          textClientHeight: text.clientHeight,
          textScrollHeight: text.scrollHeight,
          viewportHeight: window.innerHeight,
        };
      });
    expect(questionLayout.textScrollHeight).toBeLessThanOrEqual(
      questionLayout.textClientHeight + 1,
    );
    expect(questionLayout.textBottom).toBeLessThanOrEqual(
      questionLayout.viewportHeight,
    );
    expect(questionLayout.imageTop).toBeGreaterThanOrEqual(
      questionLayout.textBottom,
    );
    expect(questionLayout.imageBottom).toBeLessThanOrEqual(
      questionLayout.viewportHeight,
    );
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await expect(displayPage.getByAltText(answerImageAlt)).toHaveCount(0);
    await expect(displayPage.getByText(hostComment)).toHaveCount(0);

    await displayPage.reload();
    await expect(
      displayPage.getByTestId("display-phase-buzzing"),
    ).toBeVisible();
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await playerPage.reload();
    await expect(
      playerPage.getByRole("button", { name: "НАЖАТЬ" }),
    ).toBeEnabled();
    await hostPage.reload();
    await expect(hostPage.getByText(questionText)).toBeVisible();
    await expect(hostPage.getByText(hostComment)).toBeVisible();

    await playerPage.getByRole("button", { name: "НАЖАТЬ" }).click();
    await expect(
      displayPage.getByTestId("display-phase-buzzing"),
    ).toBeVisible();
    await hostPage
      .getByRole("button", {
        name: "Выбрать Игрок экрана для ответа, нажатие 1",
      })
      .click();
    await expect(
      displayPage.getByTestId("display-phase-answering"),
    ).toBeVisible();
    await expect(displayPage.getByText("Отвечает Игрок экрана")).toBeVisible();
    await expect(displayPage.getByText(answer)).toHaveCount(0);

    await hostPage.getByRole("button", { name: "Верно, клавиша V" }).click();
    await expect(
      displayPage.getByTestId("display-phase-score-confirmation"),
    ).toBeVisible();
    await expect(displayPage.getByText(answer)).toHaveCount(0);
    await expect(hostPage.getByText(hostComment)).toBeVisible();
    await hostPage.getByRole("button", { name: /^Ок/ }).click();

    await expect(
      displayPage.getByTestId("display-phase-answer-reveal"),
    ).toBeVisible();
    const correctButton = playerPage.getByRole("button", {
      name: "Верный ответ",
    });
    await expect(correctButton).toBeVisible();
    await expect(correctButton).toHaveClass(/bg-emerald-600/);
    await expect(displayPage.getByText(answer)).toBeVisible();
    await expect(displayPage.getByAltText(answerImageAlt)).toBeVisible();
    const answerLayout = await displayPage
      .getByTestId("display-media-content")
      .evaluate((content) => {
        const text = content.querySelector<HTMLElement>(
          '[data-testid="display-media-text"]',
        );
        const image = content.querySelector<HTMLElement>(
          '[data-testid="display-media-image"]',
        );
        if (text === null || image === null) {
          throw new Error("Не найден текст или изображение ответа");
        }
        return {
          imageTop: image.getBoundingClientRect().top,
          textBottom: text.getBoundingClientRect().bottom,
        };
      });
    expect(answerLayout.imageTop).toBeGreaterThanOrEqual(
      answerLayout.textBottom,
    );
    await expect(displayPage.getByText(questionText)).toHaveCount(0);
    await expect(displayPage.getByText(hostComment)).toHaveCount(0);

    await expect(displayPage.getByTestId("display-phase-board")).toBeVisible({
      timeout: 5_000,
    });
    await expect(displayPage.getByText("200", { exact: true })).toBeVisible();

    await hostPage.getByRole("button", { name: "Двойной экран, 200" }).click();
    await expect(displayPage.getByTestId("display-phase-buzzing")).toBeVisible({
      timeout: 5_000,
    });
    await expect(displayPage.getByAltText(imageOnlyQuestionAlt)).toBeVisible();
    const imageOnlyQuestionBounds = await displayPage
      .getByAltText(imageOnlyQuestionAlt)
      .boundingBox();
    expect(imageOnlyQuestionBounds).not.toBeNull();
    expect(imageOnlyQuestionBounds?.y).toBeGreaterThanOrEqual(0);
    expect(
      (imageOnlyQuestionBounds?.y ?? 0) +
        (imageOnlyQuestionBounds?.height ?? 0),
    ).toBeLessThanOrEqual(720);
    await hostPage.getByRole("button", { name: "Никто не ответил" }).click();

    await expect(
      displayPage.getByTestId("display-phase-score-confirmation"),
    ).toBeVisible();
    await expect(
      hostPage.getByRole("heading", {
        name: "Все игроки · -200 каждому",
      }),
    ).toBeVisible();
    await expect(hostPage.getByLabel("Баллы каждому")).toHaveValue("-200");
    await expect(playerPage.getByText("100", { exact: true })).toBeVisible();

    await hostPage.getByRole("button", { name: /^Ок/ }).click();
    await expect(
      displayPage.getByTestId("display-phase-answer-reveal"),
    ).toBeVisible();
    await expect(displayPage.getByAltText(imageOnlyAnswerAlt)).toBeVisible();
    const imageOnlyAnswerBounds = await displayPage
      .getByAltText(imageOnlyAnswerAlt)
      .boundingBox();
    expect(imageOnlyAnswerBounds).not.toBeNull();
    expect(imageOnlyAnswerBounds?.y).toBeGreaterThanOrEqual(0);
    expect(
      (imageOnlyAnswerBounds?.y ?? 0) + (imageOnlyAnswerBounds?.height ?? 0),
    ).toBeLessThanOrEqual(720);
    await expect(playerPage.getByText("-100", { exact: true })).toBeVisible();
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
  await page.getByLabel("Ответ вопроса 1").fill("Точка");
  await page.getByLabel("Задержка перед вопросом").fill("0");
  await page.getByLabel("Показ ответа").fill("0");

  let releaseQuestionUpload: () => void = () => undefined;
  const questionUploadGate = new Promise<void>((resolve) => {
    releaseQuestionUpload = resolve;
  });
  await page.route("**/api/quizzes/*/images", async (route) => {
    await questionUploadGate;
    await route.continue();
  });
  await page.getByLabel("Изображение вопроса 1").setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "point.png",
  });
  await expect(
    page.getByRole("button", { name: "Загрузка изображения…" }),
  ).toBeDisabled();
  releaseQuestionUpload();
  await expect(page.getByLabel("Alt-текст вопроса 1")).toHaveValue(
    "Не удалось загрузить изображение",
  );
  await page.unroute("**/api/quizzes/*/images");
  await expect(page.getByLabel("Изображение вопроса 1")).toHaveCount(0);
  await page.getByLabel("Alt-текст вопроса 1").fill("Синяя точка");
  await page.getByLabel("Изображение ответа 1").setInputFiles({
    buffer: onePixelPng,
    mimeType: "image/png",
    name: "answer-point.png",
  });
  await expect(page.getByLabel("Alt-текст ответа 1")).toHaveValue(
    "Не удалось загрузить изображение",
  );
  await expect(page.getByLabel("Изображение ответа 1")).toHaveValue(
    /answer-point\.png$/,
  );
  await page.getByLabel("Alt-текст ответа 1").fill("Ответная точка");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page).toHaveURL(/\/editor\/[0-9a-f-]+$/);
  const quizId = page.url().split("/").at(-1);
  if (quizId === undefined) {
    throw new Error("Редактор не вернул идентификатор медиа-викторины");
  }
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
  await expect(page.getByAltText("Ответная точка")).toBeVisible();
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

test("аудиовопрос загружается, обрезается и управляется ведущим", async ({
  browser,
  page: hostPage,
}) => {
  test.setTimeout(90_000);
  const quizTitle = `E2E аудио ${Date.now()}`;
  await hostPage.goto("/editor/new");
  await hostPage.getByLabel("Название викторины").fill(quizTitle);
  await hostPage.getByLabel("Название темы 1").fill("Угадайте звук");
  await hostPage.getByLabel("Текст вопроса 1").fill("");
  await hostPage.getByLabel("Ответ вопроса 1").fill("Синусоида");
  await hostPage.getByLabel("Задержка перед вопросом").fill("0");
  await hostPage.getByLabel("Аудио вопроса 1").setInputFiles({
    buffer: createTestWav(),
    mimeType: "audio/wav",
    name: "tone.wav",
  });
  await expect(hostPage.getByLabel("Звуковая дорожка")).toBeVisible({
    timeout: 20_000,
  });
  await hostPage.getByRole("button", { name: "Предпросмотр" }).click();
  await expect(hostPage.getByRole("button", { name: "Пауза" })).toBeVisible();
  await hostPage.getByRole("button", { name: "Пауза" }).click();
  await expect(
    hostPage.getByRole("button", { name: "Продолжить" }),
  ).toBeVisible();
  await hostPage.getByRole("button", { name: "Продолжить" }).click();
  await expect(hostPage.getByRole("button", { name: "Пауза" })).toBeVisible();
  await hostPage.getByRole("button", { name: "Пауза" }).click();
  await hostPage.getByLabel("Начало обрезки вопроса 1").fill("100");
  await hostPage.getByRole("button", { name: "Сохранить" }).click();
  await expect(hostPage).toHaveURL(/\/editor\/[0-9a-f-]+$/);
  const quizId = hostPage.url().split("/").at(-1);
  if (quizId === undefined) throw new Error("Не получен id аудиовикторины");

  await hostPage.goto(`/host?quizId=${quizId}`);
  await hostPage.getByRole("button", { name: "Создать комнату" }).click();
  const roomCode = await hostPage.getByTestId("room-code").innerText();
  const displayContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const displayPage = await displayContext.newPage();
  const playerPage = await playerContext.newPage();
  try {
    await displayPage.goto(`/display/${roomCode}`);
    await playerPage.goto(`/join/${roomCode}`);
    await playerPage.getByLabel("Имя игрока").fill("Аудио-игрок");
    await playerPage.getByRole("button", { name: "Войти в комнату" }).click();
    await hostPage.getByRole("button", { name: "Начать викторину" }).click();
    await hostPage.getByRole("button", { name: "Угадайте звук, 100" }).click();
    await expect(
      displayPage.getByLabel("Звуковая дорожка вопроса"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(hostPage.getByRole("button", { name: "Пауза" })).toBeVisible();
    await hostPage.getByRole("button", { name: "Пауза" }).click();
    await expect(
      hostPage.getByRole("button", { name: "Продолжить" }),
    ).toBeVisible();
    await hostPage.getByRole("button", { name: "Продолжить" }).click();
    await expect(hostPage.getByRole("button", { name: "Пауза" })).toBeVisible();
    await hostPage.getByRole("button", { name: "С начала" }).click();
  } finally {
    await displayContext.close();
    await playerContext.close();
    await hostPage.goto("/");
    await hostPage.request.delete(`/api/quizzes/${quizId}`);
  }
});

test("ставка игрока и денежный модификатор проходят полный игровой цикл", async ({
  browser,
  page: hostPage,
}) => {
  test.setTimeout(60_000);
  const quizTitle = `E2E ставки ${Date.now()}`;
  let quizId: string | null = null;
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();

  try {
    await hostPage.goto("/editor/new");
    await hostPage.getByLabel("Название викторины").fill(quizTitle);
    await hostPage.getByLabel("Название темы 1").fill("Тема ставок");
    await hostPage.getByLabel("Текст вопроса 1").fill("Вопрос со ставкой");
    await hostPage.getByLabel("Ответ вопроса 1").fill("Ответ");
    await hostPage.getByLabel("Задержка перед вопросом").fill("0");
    await hostPage.getByLabel("Показ ответа").fill("0");
    await hostPage.getByText("Со ставкой", { exact: true }).click();
    await hostPage.getByLabel("Максимальная ставка вопроса 1").fill("500");
    await hostPage
      .getByRole("button", { name: "+ Операция с деньгами" })
      .click();
    await hostPage.getByRole("button", { name: "Сохранить" }).click();
    await expect(hostPage).toHaveURL(/\/editor\/[0-9a-f-]+$/);
    quizId = hostPage.url().split("/").at(-1) ?? null;
    if (quizId === null) throw new Error("Редактор не вернул id викторины");

    await hostPage.goto(`/host?quizId=${quizId}`);
    await hostPage.getByRole("button", { name: "Создать комнату" }).click();
    const roomCode = await hostPage.getByTestId("room-code").innerText();
    await playerPage.goto(`/join/${roomCode}`);
    await playerPage.getByLabel("Имя игрока").fill("Ставочник");
    await playerPage.getByRole("button", { name: "Войти в комнату" }).click();
    await hostPage.getByRole("button", { name: "Начать викторину" }).click();

    await hostPage.getByRole("button", { name: "Тема ставок, 100" }).click();
    await expect(playerPage.getByLabel("Ставка")).toBeVisible();
    await playerPage.getByLabel("Ставка").fill("500");
    await playerPage
      .getByRole("button", { name: "Подтвердить ставку" })
      .click();
    await playerPage.getByRole("button", { name: "НАЖАТЬ" }).click();
    await hostPage
      .getByRole("button", { name: /Выбрать Ставочник для ответа/ })
      .click();
    await expect(
      hostPage.getByRole("heading", { name: "Отвечает Ставочник" }),
    ).toBeVisible();
    await hostPage.keyboard.press("v");
    await expect(
      hostPage.getByRole("heading", { name: "Ставочник · +500 баллов" }),
    ).toBeVisible();
    await hostPage.keyboard.press("Enter");

    await expect(
      hostPage.getByRole("button", {
        name: "Тема ставок, Модификатор",
      }),
    ).toBeVisible();
    await hostPage
      .getByRole("button", { name: "Тема ставок, Модификатор" })
      .click();
    await playerPage.getByRole("button", { name: "НАЖАТЬ" }).click();
    await expect(
      hostPage.getByRole("heading", { name: "Ставочник · +1000 баллов" }),
    ).toBeVisible();
    await hostPage.keyboard.press("Enter");
    await expect(playerPage.getByText("1500", { exact: true })).toBeVisible();
  } finally {
    await playerContext.close();
    await hostPage.goto("/");
    if (quizId !== null) {
      await hostPage.request.delete(`/api/quizzes/${quizId}`);
    }
  }
});
