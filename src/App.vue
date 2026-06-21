<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "@tanstack/vue-store";
import {
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
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
import { persistVault, hasVault, initializeVault, unlockVault } from "@/features/vault/vaultRepository";
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
const searchInput = ref<HTMLInputElement | null>(null);
const pin = ref("");
const confirmPin = ref("");
const newRecoveryKeyStr = ref("");
const editingNoteAccountId = ref<string | null>(null);

const serviceForm = ref({
  name: "",
  url: "",
});

const accountForm = ref({
  label: "",
  password: "",
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

function openNoteModal(accountId: string) {
  editingNoteAccountId.value = accountId;
}

function closeNoteModal() {
  editingNoteAccountId.value = null;
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

onMounted(async () => {
  initialized.value = await hasVault();
  booted.value = true;
  await nextTick();
  searchInput.value?.focus();
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
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

function resetApp() {
  if (confirm("Are you sure you want to delete all vault data? This cannot be undone!")) {
    localStorage.clear();
    indexedDB.databases().then((dbs) => {
      dbs.forEach((db) => {
        if (db.name) indexedDB.deleteDatabase(db.name);
      });
      window.location.reload();
    });
  }
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

async function updateVault(updater: (draft: PlainVault) => PlainVault) {
  if (!session.value.vault || !session.value.vaultKey) return;
  const nextVault = updater(JSON.parse(JSON.stringify(session.value.vault)) as PlainVault);
  setSessionState({ vault: nextVault });
  await persistVault(nextVault, session.value.vaultKey);
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

  await updateVault((draft) => {
    draft.services.push(service);
    return draft;
  });

  serviceForm.value = { name: "", url: "" };
  setSessionState({ selectedServiceId: service.id, selectedAccountId: null });
  showToast("Service added.", "success");
}

async function addAccount() {
  if (!selectedService.value) return;
  const password = accountForm.value.password || generatePassword();

  const account: AccountItem = {
    id: uid("acct"),
    serviceId: selectedService.value.id,
    label: accountForm.value.label.trim() || "Primary",
    password,
    usageCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };

  await updateVault((draft) => {
    draft.accounts.push(account);
    return draft;
  });

  accountForm.value = {
    label: "",
    password: "",
  };
  setSessionState({ selectedAccountId: account.id, focusArea: "accounts" });
  showToast("Account added.", "success");
}

const debouncedUpdateNote = debounce(async (accountId: string, newNote: string) => {
  await updateVault((draft) => {
    const acc = draft.accounts.find((a) => a.id === accountId);
    if (acc && acc.note !== newNote) {
      acc.note = newNote;
    }
    return draft;
  });
}, 1000);

function updateNote(newNote: string) {
  if (!editingNoteAccountId.value) return;
  debouncedUpdateNote(editingNoteAccountId.value, newNote);
}

async function deleteAccount(accountId: string) {
  await updateVault((draft) => {
    draft.accounts = draft.accounts.filter((account) => account.id !== accountId);
    return draft;
  });
  showToast("Account deleted.");
}

async function copyAccountPassword(account: AccountItem) {
  await copySecret(account.password, vault.value?.settings.clipboardClearSeconds ?? 30);
  await updateVault((draft) => {
    const target = draft.accounts.find((item) => item.id === account.id);
    const service = draft.services.find((item) => item.id === account.serviceId);
    if (target) target.usageCount += 1;
    if (service) service.usageCount += 1;
    return draft;
  });
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
    } else {
      lockSession("Locked with Esc.");
    }
    return;
  }

  if (isTyping) return;

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
</script>

<template>
  <main class="vault-app">
    <section v-if="!booted" class="auth-panel">
      <ShieldCheck :size="34" />
      <h1>Loading vault</h1>
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

      <form v-else class="auth-form" @submit.prevent="unlock">
        <input v-model="pin" type="password" maxlength="6" inputmode="numeric" placeholder="Enter 6-digit PIN" autocomplete="current-password" autofocus />
        <button class="primary-btn" :disabled="busy">
          <Unlock :size="17" />
          Unlock
        </button>
        <button type="button" class="danger-btn" style="margin-top: 1rem;" @click="resetApp">
          <Trash2 :size="17" />
          Reset All Data
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
            placeholder="Search services, usernames, custom fields..."
            @input="setSessionState({ searchKeyword: ($event.target as HTMLInputElement).value })"
            @focus="setSessionState({ focusArea: 'search' })"
          />
          <kbd>/</kbd>
        </div>

        <div class="status-strip">
          <span><ShieldCheck :size="15" /> Unlocked</span>
          <span v-if="session.clipboardCountdown">Clipboard {{ session.clipboardCountdown }}s</span>

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
              </div>
            </div>

            <AccountTable
              :accounts="selectedAccounts"
              :selected-account-id="session.selectedAccountId"
              :revealed-ids="session.revealedAccountIds"
              @select="setSessionState({ selectedAccountId: $event, focusArea: 'accounts' })"
              @copy="copyAccountPassword"
              @toggle-reveal="toggleReveal"
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
  </main>
</template>
