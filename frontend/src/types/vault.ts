export type FocusArea = "search" | "services" | "accounts";

export type ServiceItem = {
  id: string;
  name: string;
  url?: string;
  category?: string;
  notes?: string;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type AccountCustomField = {
  name: string;
  value: string;
};

export type AccountItem = {
  id: string;
  serviceId: string;
  label: string;
  username?: string;
  password: string;
  note?: string; // Tiptap Markdown Note
  notes?: string; // Plain-text search fallback / legacy
  customFields: AccountCustomField[];
  usageCount: number;
  createdAt: number;
  updatedAt: number;
};

export type VaultSettings = {
  clipboardClearSeconds: number;
  autoLockMinutes: number;
};

export type PlainVault = {
  version: number;
  services: ServiceItem[];
  accounts: AccountItem[];
  settings: VaultSettings;
};

export type VaultMeta = {
  id: "default";
  version: number;
  kdf: {
    name: "PBKDF2";
    salt: string;
    iterations: number;
    hash: "SHA-256";
  };
  createdAt: number;
  updatedAt: number;
};

export type EncryptedVaultRecord = {
  id: "default";
  type: "vault";
  iv: string;
  ciphertext: string;
  updatedAt: number;
};

export type VaultDocument = {
  meta: VaultMeta;
  encrypted: EncryptedVaultRecord;
};
