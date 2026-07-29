import { networkInterfaces } from "node:os";

export function getLocalIPv4Addresses(): string[] {
  const addresses = new Set<string>();
  let interfaces: ReturnType<typeof networkInterfaces>;

  try {
    interfaces = networkInterfaces();
  } catch (error: unknown) {
    console.warn("Не удалось получить локальные сетевые адреса:", error);
    return [];
  }

  for (const networkInterface of Object.values(interfaces)) {
    if (networkInterface === undefined) {
      continue;
    }

    for (const address of networkInterface) {
      if (address.family === "IPv4" && !address.internal) {
        addresses.add(address.address);
      }
    }
  }

  return [...addresses].sort();
}

export function getApplicationUrls(port: number): string[] {
  return [
    `http://localhost:${port}`,
    ...getLocalIPv4Addresses().map((address) => `http://${address}:${port}`),
  ];
}
