import { Store } from "@tanstack/vue-store";

export type ToastState = {
  message: string;
  kind: "default" | "success" | "error";
};

export const uiStore = new Store({
  toast: null as ToastState | null,
});

let toastTimer: number | undefined;

export function showToast(message: string, kind: ToastState["kind"] = "default") {
  uiStore.setState((state) => ({ ...state, toast: { message, kind } }));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    uiStore.setState((state) => ({ ...state, toast: null }));
  }, 3200);
}
