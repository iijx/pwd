import { sessionStore, setSessionState } from "@/stores/sessionStore";
import { showToast } from "@/stores/uiStore";

let countdownTimer: number | undefined;

export async function copySecret(value: string, seconds = 30) {
  await navigator.clipboard.writeText(value);
  showToast(`Copied. Attempting clipboard clear in ${seconds}s.`, "success");

  window.clearInterval(countdownTimer);
  setSessionState({ clipboardCountdown: seconds });

  countdownTimer = window.setInterval(async () => {
    const next = sessionStore.state.clipboardCountdown - 1;
    setSessionState({ clipboardCountdown: Math.max(next, 0) });

    if (next <= 0) {
      window.clearInterval(countdownTimer);
      try {
        await navigator.clipboard.writeText("");
        showToast("Clipboard cleared.", "success");
      } catch {
        showToast("Browser blocked clipboard clearing. Please clear it manually.", "error");
      }
    }
  }, 1000);
}
