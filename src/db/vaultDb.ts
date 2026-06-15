import { createCollection, localStorageCollectionOptions } from "@tanstack/db";
import type { EncryptedVaultRecord, VaultMeta } from "@/types/vault";

export const vaultMetaCollection = createCollection(
  localStorageCollectionOptions<VaultMeta, string>({
    id: "vault-meta",
    storageKey: "floating-key-vault:meta",
    getKey: (item) => item.id,
  }),
);

export const encryptedVaultCollection = createCollection(
  localStorageCollectionOptions<EncryptedVaultRecord, string>({
    id: "encrypted-vault",
    storageKey: "floating-key-vault:encrypted",
    getKey: (item) => item.id,
  }),
);

export async function preloadVaultDb() {
  await Promise.all([vaultMetaCollection.preload(), encryptedVaultCollection.preload()]);
}
