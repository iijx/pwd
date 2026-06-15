import { encryptedVaultCollection, preloadVaultDb, vaultMetaCollection } from "@/db/vaultDb";
import { deriveVaultKey, generateSalt } from "@/features/auth/keyDerivation";
import { decryptVault, encryptVault } from "@/features/vault/vaultCrypto";
import { now } from "@/lib/utils";
import type { EncryptedVaultRecord, PlainVault, VaultDocument, VaultMeta } from "@/types/vault";

const DEFAULT_ITERATIONS = 310_000;

export function createEmptyVault(): PlainVault {
  return {
    version: 1,
    services: [],
    accounts: [],
    settings: {
      clipboardClearSeconds: 30,
      autoLockMinutes: 5,
    },
  };
}

export async function readVaultDocument(): Promise<VaultDocument | null> {
  await preloadVaultDb();
  const meta = vaultMetaCollection.get("default") as VaultMeta | undefined;
  const encrypted = encryptedVaultCollection.get("default") as EncryptedVaultRecord | undefined;
  if (!meta || !encrypted) return null;
  return { meta, encrypted };
}

export async function hasVault() {
  return Boolean(await readVaultDocument());
}

export async function initializeVault(masterPassword: string) {
  const salt = generateSalt();
  const vault = createEmptyVault();
  const key = await deriveVaultKey(masterPassword, salt, DEFAULT_ITERATIONS);
  const encryptedPayload = await encryptVault(vault, key);
  const timestamp = now();

  const meta: VaultMeta = {
    id: "default",
    version: 1,
    kdf: {
      name: "PBKDF2",
      salt,
      iterations: DEFAULT_ITERATIONS,
      hash: "SHA-256",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const encrypted: EncryptedVaultRecord = {
    id: "default",
    type: "vault",
    iv: encryptedPayload.iv,
    ciphertext: encryptedPayload.ciphertext,
    updatedAt: timestamp,
  };

  const existingMeta = vaultMetaCollection.has("default");
  const existingVault = encryptedVaultCollection.has("default");
  const metaTx = existingMeta
    ? vaultMetaCollection.update("default", (draft) => Object.assign(draft, meta))
    : vaultMetaCollection.insert(meta);
  const vaultTx = existingVault
    ? encryptedVaultCollection.update("default", (draft) => Object.assign(draft, encrypted))
    : encryptedVaultCollection.insert(encrypted);

  await Promise.all([metaTx.isPersisted.promise, vaultTx.isPersisted.promise]);
  return { key, vault };
}

export async function unlockVault(masterPassword: string) {
  const document = await readVaultDocument();
  if (!document) {
    throw new Error("Vault has not been initialized.");
  }

  const key = await deriveVaultKey(
    masterPassword,
    document.meta.kdf.salt,
    document.meta.kdf.iterations,
  );
  const vault = await decryptVault(document.encrypted.ciphertext, document.encrypted.iv, key);
  return { key, vault };
}

export async function persistVault(vault: PlainVault, key: CryptoKey) {
  const encryptedPayload = await encryptVault(vault, key);
  const timestamp = now();

  const vaultTx = encryptedVaultCollection.update("default", (draft) => {
    draft.iv = encryptedPayload.iv;
    draft.ciphertext = encryptedPayload.ciphertext;
    draft.updatedAt = timestamp;
  });

  const metaTx = vaultMetaCollection.update("default", (draft) => {
    draft.updatedAt = timestamp;
  });

  await Promise.all([vaultTx.isPersisted.promise, metaTx.isPersisted.promise]);
}
