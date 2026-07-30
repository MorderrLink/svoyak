export function getFileErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    const code: unknown = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function describeFileError(error: unknown): string {
  switch (getFileErrorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "нет прав доступа к файлу или каталогу";
    case "EROFS":
      return "файловая система доступна только для чтения";
    case "ENOSPC":
      return "на диске закончилось свободное место";
    case "ENOENT":
      return "файл или каталог не найден";
    case "EIO":
      return "операционная система сообщила об ошибке ввода-вывода";
    case "EMFILE":
    case "ENFILE":
      return "превышен системный предел открытых файлов";
    default:
      return error instanceof Error ? error.message : String(error);
  }
}
