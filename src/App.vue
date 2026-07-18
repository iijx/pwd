<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "@tanstack/vue-store";
import {
  Globe2,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Unlock,
  X,
} from "lucide-vue-next";
import { debounce } from "lodash-es";

import AccountTable from "@/components/vault/AccountTable.vue";
import SecureNoteEditor from "@/components/vault/SecureNoteEditor.vue";
import { copySecret } from "@/features/clipboard/clipboard";
import { generatePassword } from "@/features/vault/passwordGenerator";
import { persistVault, hasVault, initializeVault, unlockVault, unlockVaultWithRecovery, changePin, regenerateRecoveryKey, resetAllData } from "@/features/vault/vaultRepository";
import { filterServices } from "@/features/vault/search";
import { serviceInitial, sortServices } from "@/features/vault/ranking";
import { hostnameFromUrl, now, uid } from "@/lib/utils";
import { lockSession, sessionStore, setSessionState } from "@/stores/sessionStore";
import { showToast, uiStore } from "@/stores/uiStore";
import type { AccountItem, PlainVault, ServiceItem } from "@/types/vault";

const session = useStore(sessionStore);
const toast = useStore(uiStore, (state) => state.toast);

const booted = ref(false);
const initialized = ref(false);
const busy = ref(false);
const authError = ref("");
const bootError = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const pin = ref("");
const confirmPin = ref("");
const newRecoveryKeyStr = ref("");
const showRecovery = ref(false);
const recoveryKeyInput = ref("");
const editingNoteAccountId = ref<string | null>(null);

const serviceForm = ref({
  name: "",
  url: "",
});

const accountForm = ref({
  label: "",
  username: "",
  password: "",
});

const editingAccount = ref<AccountItem | null>(null);
const editAccountForm = ref({
  label: "",
  username: "",
  password: "",
});

const editingService = ref<ServiceItem | null>(null);
const editServiceForm = ref({
  name: "",
  url: "",
});

const showSettings = ref(false);
const settingsBusy = ref(false);
const settingsForm = ref({
  clipboardClearSeconds: 30,
  autoLockMinutes: 5,
});
const pinForm = ref({
  current: "",
  next: "",
  confirm: "",
});

const vault = computed(() => session.value.vault);
const services = computed(() => vault.value?.services ?? []);
const accounts = computed(() => vault.value?.accounts ?? []);
const selectedService = computed(() =>
  services.value.find((service) => service.id === session.value.selectedServiceId) ?? null,
);
const selectedAccounts = computed(() =>
  accounts.value
    .filter((account) => account.serviceId === session.value.selectedServiceId)
    .sort((left, right) => right.usageCount - left.usageCount || left.label.localeCompare(right.label)),
);
const selectedAccount = computed(() =>
  selectedAccounts.value.find((account) => account.id === session.value.selectedAccountId) ??
  selectedAccounts.value[0] ??
  null,
);
const visibleServices = computed(() =>
  sortServices(filterServices(services.value, accounts.value, session.value.searchKeyword)),
);

const editingNoteAccount = computed(() => {
  if (!editingNoteAccountId.value) return null;
  return accounts.value.find(a => a.id === editingNoteAccountId.value) || null;
});

const anyModalOpen = computed(() =>
  !!(editingNoteAccountId.value || editingAccount.value || editingService.value || showSettings.value || newRecoveryKeyStr.value),
);

function openNoteModal(accountId: string) {
  editingNoteAccountId.value = accountId;
}

function closeNoteModal() {
  debouncedUpdateNote.flush();
  editingNoteAccountId.value = null;
}

function openEditAccount(account: AccountItem) {
  editAccountForm.value = {
    label: account.label,
    username: account.username ?? "",
    password: "",
  };
  editingAccount.value = account;
}

function closeEditAccount() {
  editingAccount.value = null;
}

async function saveEditedAccount() {
  const target = editingAccount.value;
  if (!target) return;

  try {
    await updateVault((draft) => {
      const account = draft.accounts.find((item) => item.id === target.id);
      if (!account) return draft;
      account.label = editAccountForm.value.label.trim() || "Primary";
      account.username = editAccountForm.value.username.trim() || undefined;
      if (editAccountForm.value.password) {
        account.password = editAccountForm.value.password;
      }
      account.updatedAt = now();
      return draft;
    });
    closeEditAccount();
    showToast("Account updated.", "success");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

function openEditService() {
  if (!selectedService.value) return;
  editServiceForm.value = {
    name: selectedService.value.name,
    url: selectedService.value.url ?? "",
  };
  editingService.value = selectedService.value;
}

function closeEditService() {
  editingService.value = null;
}

async function saveEditedService() {
  const target = editingService.value;
  const name = editServiceForm.value.name.trim();
  if (!target || !name) return;

  try {
    await updateVault((draft) => {
      const service = draft.services.find((item) => item.id === target.id);
      if (!service) return draft;
      service.name = name;
      service.url = editServiceForm.value.url.trim() || undefined;
      service.updatedAt = now();
      return draft;
    });
    closeEditService();
    showToast("Service updated.", "success");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

async function deleteSelectedService() {
  const target = selectedService.value;
  if (!target) return;
  const accountCount = accounts.value.filter((account) => account.serviceId === target.id).length;
  if (!confirm(`Delete service "${target.name}" and its ${accountCount} account(s)? This cannot be undone.`)) return;

  try {
    await updateVault((draft) => {
      draft.services = draft.services.filter((service) => service.id !== target.id);
      draft.accounts = draft.accounts.filter((account) => account.serviceId !== target.id);
      return draft;
    });
    showToast("Service deleted.");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

async function copyAccountUsername(account: AccountItem) {
  if (!account.username) return;
  await navigator.clipboard.writeText(account.username);
  showToast("Username copied.", "success");
}

function openSettings() {
  if (!vault.value) return;
  settingsForm.value = {
    clipboardClearSeconds: vault.value.settings.clipboardClearSeconds,
    autoLockMinutes: vault.value.settings.autoLockMinutes,
  };
  pinForm.value = { current: "", next: "", confirm: "" };
  showSettings.value = true;
}

function closeSettings() {
  showSettings.value = false;
}

async function saveSettings() {
  const clipboardClearSeconds = Math.min(Math.max(Math.round(settingsForm.value.clipboardClearSeconds) || 30, 5), 300);
  const autoLockMinutes = Math.min(Math.max(Math.round(settingsForm.value.autoLockMinutes) || 0, 0), 120);

  try {
    await updateVault((draft) => {
      draft.settings.clipboardClearSeconds = clipboardClearSeconds;
      draft.settings.autoLockMinutes = autoLockMinutes;
      return draft;
    });
    showToast("Settings saved.", "success");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

async function submitChangePin() {
  if (pinForm.value.next.length !== 6 || !/^\d+$/.test(pinForm.value.next)) {
    showToast("New PIN must be exactly 6 digits.", "error");
    return;
  }
  if (pinForm.value.next !== pinForm.value.confirm) {
    showToast("New PINs do not match.", "error");
    return;
  }
  if (!session.value.vaultKey) return;

  settingsBusy.value = true;
  try {
    await changePin(pinForm.value.current, pinForm.value.next, session.value.vaultKey);
    pinForm.value = { current: "", next: "", confirm: "" };
    showToast("PIN changed successfully.", "success");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to change PIN.", "error");
  } finally {
    settingsBusy.value = false;
  }
}

async function regenerateRecovery() {
  if (!session.value.vaultKey) return;
  if (!confirm("Regenerating will invalidate your current recovery key. Continue?")) return;

  settingsBusy.value = true;
  try {
    newRecoveryKeyStr.value = await regenerateRecoveryKey(session.value.vaultKey);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to regenerate recovery key.", "error");
  } finally {
    settingsBusy.value = false;
  }
}

watch(visibleServices, (nextServices) => {
  if (!nextServices.length) {
    if (session.value.selectedServiceId || session.value.selectedAccountId) {
      setSessionState({ selectedServiceId: null, selectedAccountId: null });
    }
    return;
  }

  if (!nextServices.some((service) => service.id === session.value.selectedServiceId)) {
    setSessionState({ selectedServiceId: nextServices[0].id, selectedAccountId: null });
  }
});

watch(selectedAccounts, (nextAccounts) => {
  if (!nextAccounts.length) {
    if (session.value.selectedAccountId) {
      setSessionState({ selectedAccountId: null });
    }
    return;
  }

  if (!nextAccounts.some((account) => account.id === session.value.selectedAccountId)) {
    setSessionState({ selectedAccountId: nextAccounts[0].id });
  }
});

watch(() => session.value.unlocked, (unlocked) => {
  if (unlocked) {
    nextTick(() => searchInput.value?.focus());
    armAutoLock();
  } else {
    clearAutoLock();
  }
});

watch(
  () => vault.value?.settings.autoLockMinutes,
  () => {
    if (session.value.unlocked) armAutoLock();
  },
);

let autoLockTimer: number | undefined;
let lastAutoLockArm = 0;

function clearAutoLock() {
  window.clearTimeout(autoLockTimer);
  autoLockTimer = undefined;
}

function armAutoLock() {
  clearAutoLock();
  if (!sessionStore.state.unlocked) return;
  const minutes = sessionStore.state.vault?.settings.autoLockMinutes ?? 5;
  if (minutes <= 0) return; // 0 = never auto-lock
  autoLockTimer = window.setTimeout(() => {
    lockSession("Locked due to inactivity.");
  }, minutes * 60_000);
}

// Throttled activity handler — resets the inactivity timer at most once every 5s
function onUserActivity() {
  const nowTs = Date.now();
  if (nowTs - lastAutoLockArm < 5000) return;
  lastAutoLockArm = nowTs;
  armAutoLock();
}

onMounted(async () => {
  try {
    initialized.value = await hasVault();
  } catch (e) {
    bootError.value = e instanceof Error ? e.message : "Failed to connect to server";
  }
  booted.value = true;
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("pointermove", onUserActivity, { passive: true });
  window.addEventListener("pointerdown", onUserActivity, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("pointermove", onUserActivity);
  window.removeEventListener("pointerdown", onUserActivity);
  clearAutoLock();
  debouncedUpdateNote.cancel();
});

async function setupVault() {
  authError.value = "";
  if (pin.value.length !== 6 || !/^\d+$/.test(pin.value)) {
    authError.value = "PIN must be exactly 6 digits.";
    return;
  }
  if (pin.value !== confirmPin.value) {
    authError.value = "PINs do not match.";
    return;
  }
  busy.value = true;
  try {
    const result = await initializeVault(pin.value);
    setUnlocked(result.vault, result.key);
    initialized.value = true;
    pin.value = "";
    confirmPin.value = "";
    newRecoveryKeyStr.value = result.recoveryKeyStr;
    showToast("Vault initialized successfully.", "success");
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "Unable to initialize vault.";
  } finally {
    busy.value = false;
  }
}

async function unlock() {
  authError.value = "";
  busy.value = true;
  try {
    const result = await unlockVault(pin.value);
    setUnlocked(result.vault, result.key);
    pin.value = "";
    showToast("Vault unlocked.", "success");
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "Authentication failed.";
  } finally {
    busy.value = false;
  }
}

async function unlockWithRecovery() {
  authError.value = "";
  if (!recoveryKeyInput.value.trim()) {
    authError.value = "Please enter your recovery key.";
    return;
  }
  busy.value = true;
  try {
    const result = await unlockVaultWithRecovery(recoveryKeyInput.value.trim());
    setUnlocked(result.vault, result.key);
    recoveryKeyInput.value = "";
    showRecovery.value = false;
    showToast("Vault recovered successfully.", "success");
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "Recovery failed.";
  } finally {
    busy.value = false;
  }
}

async function resetApp() {
  if (!confirm("Are you sure you want to delete all vault data? This cannot be undone!")) return;
  try {
    await resetAllData();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Failed to reset server data.", "error");
    return;
  }
  const dbs = await indexedDB.databases();
  dbs.forEach((db) => {
    if (db.name) indexedDB.deleteDatabase(db.name);
  });
  window.location.reload();
}

function setUnlocked(nextVault: PlainVault, key: CryptoKey) {
  const firstService = sortServices(nextVault.services)[0];
  const firstAccount = firstService
    ? nextVault.accounts.find((account) => account.serviceId === firstService.id) ?? null
    : null;

  setSessionState({
    unlocked: true,
    vault: nextVault,
    vaultKey: key,
    selectedServiceId: firstService?.id ?? null,
    selectedAccountId: firstAccount?.id ?? null,
    focusArea: "search",
    lockReason: null,
  });
}

let updateQueue: Promise<void> = Promise.resolve();

async function updateVault(updater: (draft: PlainVault) => PlainVault) {
  // Chain updates sequentially to prevent race conditions on vault version
  const task = updateQueue.then(async () => {
    if (!session.value.vault || !session.value.vaultKey) return;
    const previousVault = session.value.vault;
    const nextVault = updater(JSON.parse(JSON.stringify(previousVault)) as PlainVault);
    setSessionState({ vault: nextVault });

    try {
      await persistVault(nextVault, session.value.vaultKey);
    } catch (error) {
      // Revert state if backend sync fails
      setSessionState({ vault: previousVault });
      const message = error instanceof Error ? error.message : "Failed to save vault";
      showToast(message, "error");
      console.error("Vault sync failed:", error);
      throw error; // Re-throw so callers know the operation failed
    }
  });
  updateQueue = task.catch(() => {}); // Prevent unhandled rejection from breaking the chain
  return task;
}


async function addService() {
  const name = serviceForm.value.name.trim();
  if (!name) return;

  const service: ServiceItem = {
    id: uid("svc"),
    name,
    url: serviceForm.value.url.trim() || undefined,
    usageCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await updateVault((draft) => {
      draft.services.push(service);
      return draft;
    });
    serviceForm.value = { name: "", url: "" };
    setSessionState({ selectedServiceId: service.id, selectedAccountId: null });
    showToast("Service added.", "success");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

async function addAccount() {
  if (!selectedService.value) return;
  const password = accountForm.value.password || generatePassword();

  const account: AccountItem = {
    id: uid("acct"),
    serviceId: selectedService.value.id,
    label: accountForm.value.label.trim() || "Primary",
    username: accountForm.value.username.trim() || undefined,
    password,
    customFields: [],
    usageCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };

  try {
    await updateVault((draft) => {
      draft.accounts.push(account);
      return draft;
    });
    accountForm.value = {
      label: "",
      username: "",
      password: "",
    };
    setSessionState({ selectedAccountId: account.id, focusArea: "accounts" });
    showToast("Account added.", "success");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

const debouncedUpdateNote = debounce(async (accountId: string, newNote: string) => {
  try {
    await updateVault((draft) => {
      const acc = draft.accounts.find((a) => a.id === accountId);
      if (acc && acc.note !== newNote) {
        acc.note = newNote;
      }
      return draft;
    });
  } catch {
    // Error already handled by updateVault
  }
}, 1000);

function updateNote(newNote: string) {
  if (!editingNoteAccountId.value) return;
  debouncedUpdateNote(editingNoteAccountId.value, newNote);
}

async function deleteAccount(accountId: string) {
  try {
    await updateVault((draft) => {
      draft.accounts = draft.accounts.filter((account) => account.id !== accountId);
      return draft;
    });
    showToast("Account deleted.");
  } catch {
    // Error already handled by updateVault (rollback + toast)
  }
}

async function copyAccountPassword(account: AccountItem) {
  await copySecret(account.password, vault.value?.settings.clipboardClearSeconds ?? 30);
  try {
    await updateVault((draft) => {
      const target = draft.accounts.find((item) => item.id === account.id);
      const service = draft.services.find((item) => item.id === account.serviceId);
      if (target) target.usageCount += 1;
      if (service) service.usageCount += 1;
      return draft;
    });
  } catch {
    // Error already handled by updateVault
  }
}

function toggleReveal(accountId: string) {
  const current = session.value.revealedAccountIds;
  setSessionState({
    revealedAccountIds: current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId],
  });
}



function moveSelection(direction: 1 | -1) {
  if (session.value.focusArea === "accounts") {
    const currentIndex = selectedAccounts.value.findIndex(
      (account) => account.id === session.value.selectedAccountId,
    );
    const next = selectedAccounts.value[Math.max(0, Math.min(selectedAccounts.value.length - 1, currentIndex + direction))];
    if (next) setSessionState({ selectedAccountId: next.id });
    return;
  }

  const currentIndex = visibleServices.value.findIndex(
    (service) => service.id === session.value.selectedServiceId,
  );
  const next = visibleServices.value[Math.max(0, Math.min(visibleServices.value.length - 1, currentIndex + direction))];
  if (next) setSessionState({ selectedServiceId: next.id, selectedAccountId: null });
}

function handleKeydown(event: KeyboardEvent) {
  if (!sessionStore.state.unlocked) return;
  const target = event.target as HTMLElement | null;
  const isTyping =
    target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

  if (event.key === "/" && !isTyping) {
    event.preventDefault();
    setSessionState({ focusArea: "search" });
    searchInput.value?.focus();
    return;
  }

  if (event.key === "Escape") {
    if (document.activeElement === searchInput.value) {
      searchInput.value?.blur();
      setSessionState({ searchKeyword: "", focusArea: "services" });
    } else if (editingNoteAccountId.value) {
      closeNoteModal();
    } else if (editingAccount.value) {
      closeEditAccount();
    } else if (editingService.value) {
      closeEditService();
    } else if (showSettings.value) {
      closeSettings();
    } else if (newRecoveryKeyStr.value) {
      // Keep the recovery key modal open — it must be dismissed explicitly
    } else {
      lockSession("Locked with Esc.");
    }
    return;
  }

  if (isTyping || anyModalOpen.value) return;

  if (event.key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
  }
  if (event.key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
  }
  if (event.key === "ArrowRight" || event.key === "Tab") {
    event.preventDefault();
    setSessionState({ focusArea: "accounts", selectedAccountId: selectedAccount.value?.id ?? null });
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    setSessionState({ focusArea: "services" });
  }
  if (event.key === " " && session.value.focusArea === "accounts" && selectedAccount.value) {
    event.preventDefault();
    toggleReveal(selectedAccount.value.id);
  }
  if (event.key === "Enter" && session.value.focusArea === "accounts" && selectedAccount.value) {
    event.preventDefault();
    void copyAccountPassword(selectedAccount.value);
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    lockSession("Locked from shortcut.");
  }
}

function openSelectedUrl() {
  if (!selectedService.value?.url) return;
  window.open(selectedService.value.url, "_blank", "noopener,noreferrer");
}

function reloadPage() {
  window.location.reload();
}
</script>

<template>
  <main class="vault-app">
    <section v-if="!booted" class="auth-panel">
      <ShieldCheck :size="34" />
      <h1 v-if="!bootError">Loading vault</h1>
      <template v-else>
        <h1>Connection Error</h1>
        <p class="muted">{{ bootError }}</p>
        <button class="primary-btn" @click="reloadPage">
          <RefreshCw :size="17" />
          Retry
        </button>
      </template>
    </section>

    <section v-else-if="!session.unlocked" class="auth-panel">
      <div class="brand-mark">
        <KeyRound :size="30" />
      </div>
      <h1>Floating Key Vault</h1>
      <p class="muted">
        Local-first password manager. Secrets are encrypted before entering TanStack DB.
      </p>

      <form v-if="!initialized" class="auth-form" @submit.prevent="setupVault">
        <input v-model="pin" type="password" maxlength="6" inputmode="numeric" placeholder="Create 6-digit PIN" autocomplete="new-password" />
        <input v-model="confirmPin" type="password" maxlength="6" inputmode="numeric" placeholder="Confirm 6-digit PIN" autocomplete="new-password" />
        <button class="primary-btn" :disabled="busy">
          <ShieldCheck :size="17" />
          Create My Vault
        </button>
      </form>

      <form v-else-if="!showRecovery" class="auth-form" @submit.prevent="unlock">
        <input v-model="pin" type="password" maxlength="6" inputmode="numeric" placeholder="Enter 6-digit PIN" autocomplete="current-password" autofocus />
        <button class="primary-btn" :disabled="busy">
          <Unlock :size="17" />
          Unlock
        </button>
        <button type="button" class="text-btn" @click="showRecovery = true">
          <RefreshCw :size="15" />
          Recover with recovery key
        </button>
        <button type="button" class="danger-btn" style="margin-top: 1rem;" @click="resetApp">
          <Trash2 :size="17" />
          Reset All Data
        </button>
      </form>

      <form v-else class="auth-form" @submit.prevent="unlockWithRecovery">
        <textarea
          v-model="recoveryKeyInput"
          placeholder="Paste your recovery key here"
          autocomplete="off"
          rows="3"
        ></textarea>
        <button class="primary-btn" :disabled="busy">
          <KeyRound :size="17" />
          Recover Vault
        </button>
        <button type="button" class="text-btn" @click="showRecovery = false">
          Back to PIN unlock
        </button>
      </form>

      <p v-if="authError" class="error-text">{{ authError }}</p>
      <p v-else-if="session.lockReason" class="muted small">{{ session.lockReason }}</p>
    </section>

    <section v-else class="vault-shell">
      <header class="vault-header">
        <div class="search-wrap">
          <Search :size="17" />
          <input
            ref="searchInput"
            :value="session.searchKeyword"
            placeholder="Search services, accounts, notes..."
            @input="setSessionState({ searchKeyword: ($event.target as HTMLInputElement).value })"
            @focus="setSessionState({ focusArea: 'search' })"
          />
          <kbd>/</kbd>
        </div>

        <div class="status-strip">
          <span><ShieldCheck :size="15" /> Unlocked</span>
          <span v-if="session.clipboardCountdown">Clipboard {{ session.clipboardCountdown }}s</span>

          <button class="ghost-btn" title="Settings" @click="openSettings">
            <Settings :size="16" />
          </button>
          <button class="ghost-btn" title="Lock vault" @click="lockSession('Locked manually.')">
            <Lock :size="16" />
          </button>
        </div>
      </header>

      <div class="workspace">
        <aside class="services-pane">
          <div class="pane-head">
            <div>
              <p class="eyebrow">Services</p>
              <h2>{{ visibleServices.length }} items</h2>
            </div>
          </div>

          <div class="service-list">
            <button
              v-for="service in visibleServices"
              :key="service.id"
              class="service-row"
              :class="{ selected: service.id === session.selectedServiceId, focused: session.focusArea === 'services' }"
              @click="setSessionState({ selectedServiceId: service.id, selectedAccountId: null, focusArea: 'services' })"
            >
              <span class="service-icon">{{ serviceInitial(service.name) }}</span>
              <span class="service-copy">
                <strong>{{ service.name }}</strong>
                <small>{{ hostnameFromUrl(service.url) || service.category || "Local credential" }}</small>
              </span>
            </button>
          </div>

          <form class="mini-form" @submit.prevent="addService">
            <input v-model="serviceForm.name" placeholder="Service name" />
            <input v-model="serviceForm.url" placeholder="https://example.com" />
            <button class="secondary-btn">
              <Plus :size="16" />
              Add service
            </button>
          </form>
        </aside>

        <section class="inspector">
          <template v-if="selectedService">
            <div class="inspector-head">
              <div>
                <p class="eyebrow">{{ selectedService.category || "Credential" }}</p>
                <h2>{{ selectedService.name }}</h2>
                <p class="muted">{{ selectedService.url || "No website configured" }}</p>
              </div>
              <div class="head-actions">
                <button class="ghost-btn" :disabled="!selectedService.url" title="Open website" @click="openSelectedUrl">
                  <Globe2 :size="17" />
                </button>
                <button class="ghost-btn" title="Edit service" @click="openEditService">
                  <Pencil :size="17" />
                </button>
                <button class="danger-btn" title="Delete service" @click="deleteSelectedService">
                  <Trash2 :size="17" />
                </button>
              </div>
            </div>

            <AccountTable
              :accounts="selectedAccounts"
              :selected-account-id="session.selectedAccountId"
              :revealed-ids="session.revealedAccountIds"
              @select="setSessionState({ selectedAccountId: $event, focusArea: 'accounts' })"
              @copy="copyAccountPassword"
              @copy-username="copyAccountUsername"
              @toggle-reveal="toggleReveal"
              @edit="openEditAccount"
              @delete="deleteAccount"
              @open-note="openNoteModal"
            />

            <form class="account-form" @submit.prevent="addAccount">
              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Account Label</label>
                  <input v-model="accountForm.label" placeholder="e.g. Admin" />
                </div>
                <div class="form-group">
                  <label class="form-label">Username</label>
                  <input v-model="accountForm.username" placeholder="e.g. you@example.com" />
                </div>
                <div class="form-group">
                  <label class="form-label">Password</label>
                  <div class="password-input">
                    <input v-model="accountForm.password" placeholder="Password" />
                    <button type="button" title="Generate password" class="flex items-center justify-center" @click="accountForm.password = generatePassword()">
                      <RefreshCw :size="15" />
                    </button>
                  </div>
                </div>
              </div>
              <button class="secondary-btn">
                <Plus :size="16" />
                Add account
              </button>
            </form>

          </template>

          <div v-else class="empty-state">
            <KeyRound :size="28" />
            <h2>No service selected</h2>
            <p class="muted">Create a service on the left to start storing encrypted credentials.</p>
          </div>
        </section>
      </div>
    </section>

    <div v-if="toast" class="toast" :class="toast.kind">{{ toast.message }}</div>

    <div v-if="newRecoveryKeyStr" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-8 max-w-md shadow-2xl flex flex-col gap-4">
        <h2 class="text-xl font-semibold text-white">Save Your Recovery Key</h2>
        <p class="text-slate-400 text-sm">
          This key is the ONLY way to recover your vault if you lose your device or switch to a new one. We cannot recover it for you!
        </p>
        <div class="bg-slate-950 border border-slate-800 p-4 rounded-lg text-slate-300 font-mono text-sm break-all">
          {{ newRecoveryKeyStr }}
        </div>
        <button class="primary-btn mt-2" @click="newRecoveryKeyStr = ''">
          I have saved it securely
        </button>
      </div>
    </div>

    <!-- Secure Note Modal -->
    <div v-if="editingNoteAccount" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" @click="closeNoteModal">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh]" @click.stop>
        <div class="flex justify-between items-center mb-4">
          <div>
            <span class="eyebrow block mb-1">Secure Note</span>
            <h2 class="text-xl font-semibold text-white">{{ editingNoteAccount.label || 'Primary' }}</h2>
          </div>
          <button class="ghost-btn" title="Close Note" @click="closeNoteModal">
            <X :size="20" />
          </button>
        </div>
        <div class="overflow-y-auto flex-1 custom-scrollbar">
          <SecureNoteEditor
            :model-value="editingNoteAccount.note"
            @update:model-value="updateNote"
          />
        </div>
      </div>
    </div>

    <!-- Edit Account Modal -->
    <div v-if="editingAccount" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" @click="closeEditAccount">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl flex flex-col gap-4 w-full max-w-md" @click.stop>
        <div class="flex justify-between items-center">
          <h2 class="text-xl font-semibold text-white">Edit Account</h2>
          <button class="ghost-btn" title="Close" @click="closeEditAccount">
            <X :size="20" />
          </button>
        </div>
        <form class="flex flex-col gap-4" @submit.prevent="saveEditedAccount">
          <div class="form-group">
            <label class="form-label">Account Label</label>
            <input v-model="editAccountForm.label" placeholder="e.g. Admin" />
          </div>
          <div class="form-group">
            <label class="form-label">Username</label>
            <input v-model="editAccountForm.username" placeholder="e.g. you@example.com" />
          </div>
          <div class="form-group">
            <label class="form-label">New Password (leave empty to keep current)</label>
            <div class="password-input">
              <input v-model="editAccountForm.password" placeholder="••••••••" />
              <button type="button" title="Generate password" class="flex items-center justify-center" @click="editAccountForm.password = generatePassword()">
                <RefreshCw :size="15" />
              </button>
            </div>
          </div>
          <button class="primary-btn" type="submit">Save Changes</button>
        </form>
      </div>
    </div>

    <!-- Edit Service Modal -->
    <div v-if="editingService" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" @click="closeEditService">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl flex flex-col gap-4 w-full max-w-md" @click.stop>
        <div class="flex justify-between items-center">
          <h2 class="text-xl font-semibold text-white">Edit Service</h2>
          <button class="ghost-btn" title="Close" @click="closeEditService">
            <X :size="20" />
          </button>
        </div>
        <form class="flex flex-col gap-4" @submit.prevent="saveEditedService">
          <div class="form-group">
            <label class="form-label">Service Name</label>
            <input v-model="editServiceForm.name" placeholder="Service name" />
          </div>
          <div class="form-group">
            <label class="form-label">Website URL</label>
            <input v-model="editServiceForm.url" placeholder="https://example.com" />
          </div>
          <button class="primary-btn" type="submit">Save Changes</button>
        </form>
      </div>
    </div>

    <!-- Settings Modal -->
    <div v-if="showSettings" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" @click="closeSettings">
      <div class="bg-slate-900 border border-slate-700 rounded-xl p-6 shadow-2xl flex flex-col w-full max-w-md max-h-[90vh]" @click.stop>
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold text-white">Settings</h2>
          <button class="ghost-btn" title="Close" @click="closeSettings">
            <X :size="20" />
          </button>
        </div>
        <div class="overflow-y-auto flex-1 custom-scrollbar flex flex-col gap-6">
          <section class="flex flex-col gap-3">
            <span class="eyebrow">Vault</span>
            <div class="form-group">
              <label class="form-label">Clipboard clear delay (seconds)</label>
              <input v-model.number="settingsForm.clipboardClearSeconds" type="number" min="5" max="300" />
            </div>
            <div class="form-group">
              <label class="form-label">Auto-lock after inactivity</label>
              <select v-model.number="settingsForm.autoLockMinutes">
                <option :value="1">1 minute</option>
                <option :value="5">5 minutes</option>
                <option :value="15">15 minutes</option>
                <option :value="30">30 minutes</option>
                <option :value="60">1 hour</option>
                <option :value="0">Never</option>
              </select>
            </div>
            <button class="secondary-btn" @click="saveSettings">Save Settings</button>
          </section>

          <section class="flex flex-col gap-3 border-t border-slate-800 pt-4">
            <span class="eyebrow">Change PIN</span>
            <form class="flex flex-col gap-3" @submit.prevent="submitChangePin">
              <input v-model="pinForm.current" type="password" maxlength="6" inputmode="numeric" placeholder="Current PIN" autocomplete="current-password" />
              <input v-model="pinForm.next" type="password" maxlength="6" inputmode="numeric" placeholder="New 6-digit PIN" autocomplete="new-password" />
              <input v-model="pinForm.confirm" type="password" maxlength="6" inputmode="numeric" placeholder="Confirm new PIN" autocomplete="new-password" />
              <button class="secondary-btn" type="submit" :disabled="settingsBusy">Change PIN</button>
            </form>
          </section>

          <section class="flex flex-col gap-3 border-t border-slate-800 pt-4">
            <span class="eyebrow">Recovery Key</span>
            <p class="muted small">Regenerating invalidates your current recovery key and shows the new one once.</p>
            <button class="secondary-btn" :disabled="settingsBusy" @click="regenerateRecovery">
              <RefreshCw :size="15" />
              Regenerate Recovery Key
            </button>
          </section>

          <section class="flex flex-col gap-3 border-t border-slate-800 pt-4">
            <span class="eyebrow">Danger Zone</span>
            <button class="danger-btn" style="min-height: 38px;" @click="resetApp">
              <Trash2 :size="15" />
              Reset All Data
            </button>
          </section>
        </div>
      </div>
    </div>
  </main>
</template>
