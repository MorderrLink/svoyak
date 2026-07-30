export {};

declare global {
  interface QuizPackageWritable {
    close: () => Promise<void>;
    write: (source: Blob) => Promise<void>;
  }

  interface QuizPackageFileHandle {
    createWritable: () => Promise<QuizPackageWritable>;
  }

  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{
        accept: Record<string, string[]>;
        description: string;
      }>;
    }) => Promise<QuizPackageFileHandle>;
  }
}
