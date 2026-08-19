function describeBrowser(userAgent: string): string {
  if (/CriOS|Chrome\//i.test(userAgent)) {
    return "Chrome";
  }
  if (/FxiOS|Firefox\//i.test(userAgent)) {
    return "Firefox";
  }
  if (/EdgiOS|EdgA|Edg\//i.test(userAgent)) {
    return "Edge";
  }
  if (/Safari\//i.test(userAgent)) {
    return "Safari";
  }
  return "Браузер";
}

export function describeDevice(userAgent: string | undefined): string {
  if (userAgent === undefined || userAgent.trim() === "") {
    return "Неизвестное устройство";
  }

  const browser = describeBrowser(userAgent);

  if (/iPhone/i.test(userAgent)) {
    return `iPhone · ${browser}`;
  }
  if (/iPad/i.test(userAgent)) {
    return `iPad · ${browser}`;
  }

  const androidModel = userAgent.match(
    /Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\))/i,
  )?.[1];
  if (androidModel !== undefined) {
    const normalizedModel = androidModel.replace(/\s+/g, " ").trim();
    return `${normalizedModel} · ${browser}`;
  }
  if (/Android/i.test(userAgent)) {
    return `Android · ${browser}`;
  }
  if (/Windows/i.test(userAgent)) {
    return `Компьютер Windows · ${browser}`;
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return `Mac · ${browser}`;
  }
  if (/Linux/i.test(userAgent)) {
    return `Компьютер Linux · ${browser}`;
  }

  return `Неизвестное устройство · ${browser}`;
}
