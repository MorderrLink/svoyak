import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/styles/bottom-progress.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Свояк",
  description: "Локальное приложение для проведения викторин",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ru">
      <body className="h-dvh overflow-hidden">
        <div className="h-full overflow-hidden" id="app-root">
          {children}
        </div>
      </body>
    </html>
  );
}
