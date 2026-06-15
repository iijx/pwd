<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useStore } from "@tanstack/vue-store";
import {
  Cloud,
  CloudOff,
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
} from "lucide-vue-next";
import { isPrfSupported, registerPasskey, decryptPasswordWithPasskey } from "@/lib/webauthn";
import { isICloudSignedIn, signInToICloud, signOutFromICloud, syncWithICloud } from "@/features/sync/cloudkitSync";
import AccountTable from "@/components/vault/AccountTable.vue";
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
const masterPassword = ref("");
const confirmPassword = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const prfSupported = ref(false);
const hasPasskey = ref(false);
const cloudSignedIn = ref(false);

const serviceForm = ref({
  name: "",
  url: "",
});

const accountForm = ref({
  label: "",
  username: "",
  password: "",
  notes: "",
  customFields: [] as Array<{ name: string; value: string }>,
});

function addCustomField() {
  accountForm.value.customFields.push({ name: "", value: "" });
}

function removeCustomField(index: number) {
  accountForm.value.customFields.splice(index, 1);
}

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
  prfSupported.value = await isPrfSupported();
  hasPasskey.value = !!localStorage.getItem("floating-key-vault:passkey");
  cloudSignedIn.value = !!localStorage.getItem("mock_icloud_signed_in") || await isICloudSignedIn();
  booted.value = true;
  await nextTick();
  searchInput.value?.focus();
  window.addEventListener("keydown", handleKeydown);

  if (initialized.value && hasPasskey.value) {
    void unlockWithPasskey();
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

async function setupVault() {
  authError.value = "";
  if (masterPassword.value.length < 6) {
    authError.value = "Use at least 6 characters for the master password.";
    return;
  }
  if (masterPassword.value !== confirmPassword.value) {
    authError.value = "The confirmation does not match.";
    return;
  }

  busy.value = true;
  try {
    const result = await initializeVault(masterPassword.value);
    setUnlocked(result.vault, result.key);
    initialized.value = true;
    masterPassword.value = "";
    confirmPassword.value = "";
    showToast("Vault initialized.", "success");
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
    const result = await unlockVault(masterPassword.value);
    setUnlocked(result.vault, result.key);
    masterPassword.value = "";
    showToast("Vault unlocked.", "success");
  } catch {
    authError.value = "Master password is incorrect or the vault is corrupted.";
  } finally {
    busy.value = false;
  }
}

async function togglePasskey() {
  if (hasPasskey.value) {
    localStorage.removeItem("floating-key-vault:passkey");
    hasPasskey.value = false;
    showToast("Touch ID unlock disabled.");
    return;
  }

  const pw = prompt("Enter your master password to enable Touch ID unlock:");
  if (!pw) return;

  busy.value = true;
  try {
    const result = await unlockVault(pw);
    if (!result) {
      throw new Error("Password verification failed.");
    }
    const metadata = await registerPasskey(pw);
    localStorage.setItem("floating-key-vault:passkey", JSON.stringify(metadata));
    hasPasskey.value = true;
    showToast("Touch ID unlock enabled.", "success");
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to enable Touch ID.");
  } finally {
    busy.value = false;
  }
}

async function unlockWithPasskey() {
  const stored = localStorage.getItem("floating-key-vault:passkey");
  if (!stored) return;

  busy.value = true;
  authError.value = "";
  try {
    const { credentialId, encryptedPassword, iv } = JSON.parse(stored);
    const masterPasswordDecrypted = await decryptPasswordWithPasskey(credentialId, encryptedPassword, iv);
    const result = await unlockVault(masterPasswordDecrypted);
    setUnlocked(result.vault, result.key);
    showToast("Vault unlocked with Touch ID.", "success");
  } catch (error) {
    authError.value = "Touch ID authentication failed or was cancelled.";
    console.error("Passkey unlock error:", error);
  } finally {
    busy.value = false;
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

  if (cloudSignedIn.value) {
    void syncWithICloud(nextVault, session.value.vaultKey);
  }
}

async function handleCloudAction() {
  if (!cloudSignedIn.value) {
    busy.value = true;
    try {
      const ok = await signInToICloud();
      if (ok) {
        cloudSignedIn.value = true;
        if (session.value.vault && session.value.vaultKey) {
          await syncWithICloud(session.value.vault, session.value.vaultKey);
        }
      }
    } finally {
      busy.value = false;
    }
  } else {
    if (confirm("iCloud is connected. Do you want to sync now? Cancel to sign out instead.")) {
      if (session.value.vault && session.value.vaultKey) {
        busy.value = true;
        try {
          await syncWithICloud(session.value.vault, session.value.vaultKey);
        } finally {
          busy.value = false;
        }
      }
    } else {
      await signOutFromICloud();
      cloudSignedIn.value = false;
    }
  }
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

async function deleteService(serviceId: string) {
  await updateVault((draft) => {
    draft.services = draft.services.filter((service) => service.id !== serviceId);
    draft.accounts = draft.accounts.filter((account) => account.serviceId !== serviceId);
    return draft;
  });
  showToast("Service deleted.");
}

async function addAccount() {
  if (!selectedService.value) return;
  const password = accountForm.value.password || generatePassword();
  const customFields = accountForm.value.customFields
    .filter((f) => f.name.trim() || f.value.trim())
    .map((f) => ({
      id: uid("field"),
      name: f.name.trim() || "Custom field",
      value: f.value.trim(),
      type: "secret" as const,
    }));

  const account: AccountItem = {
    id: uid("acct"),
    serviceId: selectedService.value.id,
    label: accountForm.value.label.trim() || "Primary",
    username: accountForm.value.username.trim(),
    password,
    notes: accountForm.value.notes.trim() || undefined,
    customFields,
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
    username: "",
    password: "",
    notes: "",
    customFields: [],
  };
  setSessionState({ selectedAccountId: account.id, focusArea: "accounts" });
  showToast("Account added.", "success");
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

async function copyCustomFieldValue(value: string) {
  await copySecret(value, vault.value?.settings.clipboardClearSeconds ?? 30);
  showToast("Value copied to clipboard.", "success");
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
        <input v-model="masterPassword" type="password" placeholder="Create master password" autocomplete="new-password" />
        <input v-model="confirmPassword" type="password" placeholder="Confirm master password" autocomplete="new-password" />
        <button class="primary-btn" :disabled="busy">
          <ShieldCheck :size="17" />
          Initialize vault
        </button>
      </form>

      <form v-else class="auth-form" @submit.prevent="unlock">
        <input v-model="masterPassword" type="password" placeholder="Master password" autocomplete="current-password" />
        <button class="primary-btn" :disabled="busy">
          <Unlock :size="17" />
          Unlock
        </button>
        <button v-if="hasPasskey" type="button" class="secondary-btn" :disabled="busy" @click="unlockWithPasskey">
          <Fingerprint :size="17" />
          Unlock with Touch ID
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
          <button
            v-if="prfSupported"
            class="ghost-btn"
            :class="{ active: hasPasskey }"
            :title="hasPasskey ? 'Disable Touch ID Unlock' : 'Enable Touch ID Unlock'"
            @click="togglePasskey"
          >
            <Fingerprint :size="16" />
          </button>
          <button
            class="ghost-btn"
            :class="{ active: cloudSignedIn }"
            :title="cloudSignedIn ? 'iCloud Sync: Click to Sync' : 'Sign in to iCloud'"
            :disabled="busy"
            @click="handleCloudAction"
          >
            <component :is="cloudSignedIn ? Cloud : CloudOff" :size="16" />
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
                <button class="danger-btn" title="Delete service" @click="deleteService(selectedService.id)">
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
              @toggle-reveal="toggleReveal"
              @delete="deleteAccount"
            />

            <form class="account-form" @submit.prevent="addAccount">
              <div class="form-grid">
                <div class="form-group">
                  <label class="form-label">Account</label>
                  <input v-model="accountForm.label" placeholder="e.g. Admin" />
                </div>
                <div class="form-group">
                  <label class="form-label">Username</label>
                  <input v-model="accountForm.username" placeholder="Username or email" />
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
                <div class="form-group">
                  <label class="form-label">Notes</label>
                  <input v-model="accountForm.notes" placeholder="Notes" />
                </div>

                <div class="custom-fields-header">
                  <span class="eyebrow">Custom Fields</span>
                  <button type="button" class="secondary-btn compact-btn" @click="addCustomField">
                    <Plus :size="14" /> Add Field
                  </button>
                </div>

                <div
                  v-for="(field, index) in accountForm.customFields"
                  :key="index"
                  class="custom-field-row"
                >
                  <div class="form-group">
                    <label class="form-label">Field Name</label>
                    <input v-model="field.name" placeholder="Label, e.g. Pin" />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Field Value</label>
                    <input v-model="field.value" placeholder="Value" />
                  </div>
                  <button
                    type="button"
                    class="danger-btn delete-field-btn"
                    title="Remove field"
                    @click="removeCustomField(index)"
                  >
                    <Trash2 :size="15" />
                  </button>
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
  </main>
</template>
