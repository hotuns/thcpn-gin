import { afterEach, beforeEach } from "vitest";
import { notifyManager } from "@tanstack/react-query";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// Keep query notifications inside async act, without arbitrary timer delays.
notifyManager.setScheduler(queueMicrotask);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  document.documentElement.lang = "zh-CN";
});

afterEach(() => {
  document.body.replaceChildren();
});
