import { Store } from "@tanstack/vue-store";
import type { FocusArea, PlainVault } from "@/types/vault";

type SessionState = {
  unlocked: boolean;
  vault: PlainVault | null;
  vaultKey: CryptoKey | null;
  selectedServiceId: string | null;
  selectedAccountId: string | null;
  focusArea: FocusArea;
  searchKeyword: string;
  revealedAccountIds: string[];
  clipboardCountdown: number;
  lockReason: string | null;
};

export const sessionStore = new Store<SessionState>({
  unlocked: false,
  vault: null,
  vaultKey: null,
  selectedServiceId: null,
  selectedAccountId: null,
  focusArea: "search",
  searchKeyword: "",
  revealedAccountIds: [],
  clipboardCountdown: 0,
  lockReason: null,
});

export function setSessionState(patch: Partial<SessionState>) {
  sessionStore.setState((state) => ({ ...state, ...patch }));
}

export function lockSession(reason = "Vault locked") {
  setSessionState({
    unlocked: false,
    vault: null,
    vaultKey: null,
    selectedServiceId: null,
    selectedAccountId: null,
    focusArea: "search",
    searchKeyword: "",
    revealedAccountIds: [],
    clipboardCountdown: 0,
    lockReason: reason,
  });
}
