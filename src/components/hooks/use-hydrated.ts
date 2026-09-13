import { useSyncExternalStore } from "react";

function subscribeToNothing() {
  return () => undefined;
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

// `false` in the server render and during hydration, `true` once React owns the DOM. Islands use it
// to keep server-rendered controls inert until then: anything typed into them before hydration never
// reaches React state, so a submit would validate stale defaults and wipe what the user entered.
export function useHydrated() {
  return useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot);
}
