export interface AutoCardUpdaterAPI {
  exportTableAsJson?: () => Record<string, unknown> | null;
  registerTableUpdateCallback?: (cb: () => void) => void;
}

export function getDatabaseApi(): AutoCardUpdaterAPI | null {
  try {
    const api = (window.parent as Window & { AutoCardUpdaterAPI?: AutoCardUpdaterAPI }).AutoCardUpdaterAPI;
    return api ?? null;
  } catch {
    return null;
  }
}

export interface DataSnapshot {
  tablesJson: Record<string, unknown> | null;
  capturedAt: number;
}

export function captureDataSnapshot(): DataSnapshot {
  const api = getDatabaseApi();
  let tablesJson: Record<string, unknown> | null = null;
  try {
    tablesJson = (api?.exportTableAsJson?.() as Record<string, unknown> | null) ?? null;
  } catch {
    tablesJson = null;
  }
  return { tablesJson, capturedAt: Date.now() };
}
