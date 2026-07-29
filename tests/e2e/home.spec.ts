import { expect, test } from "@playwright/test";

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
