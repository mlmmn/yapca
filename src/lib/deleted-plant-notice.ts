const STORAGE_KEY = "yapca:deleted-plant-name";

export function setDeletedPlantNotice(name: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Storage unavailable (private mode, quota exceeded, etc.) — ignore gracefully
  }
}

export function takeDeletedPlantNotice(): string | null {
  try {
    const name = sessionStorage.getItem(STORAGE_KEY);

    sessionStorage.removeItem(STORAGE_KEY);

    return name ?? null;
  } catch {
    // Storage unavailable — ignore gracefully
    return null;
  }
}
