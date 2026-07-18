import { decryptVault, encryptVault } from "@/features/vault/vaultCrypto";
import { generateVaultKey, wrapVaultKey, generateRecoveryKeyStr, hashRecoveryKeyStr, importRecoveryKey, unwrapVaultKey, deriveMasterKeyFromPin, generateSalt } from "@/features/auth/keyDerivation";
import { apiRegister, apiLogin, apiLoginRecovery, apiSyncVault, apiHasUsers, apiResetAll, apiUpdateKeys } from "@/api/backend";
import type { PlainVault } from "@/types/vault";

const DEFAULT_ITERATIONS = 310_000;
const FIXED_USER_ID = "default"; // Because it's a local app, we use a fixed user ID

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

export async function resetAllData() {
  await apiResetAll();
}

export async function hasVault() {
  return await apiHasUsers();
}

export async function initializeVault(pin: string) {
  // 1. Generate salt and derive Master Key via PBKDF2
  const pbkdf2Salt = generateSalt(32);
  const masterKey = await deriveMasterKeyFromPin(pin, pbkdf2Salt, DEFAULT_ITERATIONS);

  // 2. Cryptographic Key Generation
  const vaultKey = await generateVaultKey();
  const recoveryKeyStr = generateRecoveryKeyStr();
  const recoveryKeyHash = await hashRecoveryKeyStr(recoveryKeyStr);
  const recoveryKeyCrypto = await importRecoveryKey(recoveryKeyStr);

  // 3. Wrap Vault Key
  const wrappedMaster = await wrapVaultKey(vaultKey, masterKey);
  const wrappedRecovery = await wrapVaultKey(vaultKey, recoveryKeyCrypto);

  // 4. Encrypt Initial Vault
  const vault = createEmptyVault();
  const encryptedPayload = await encryptVault(vault, vaultKey);

  // 5. Send to Backend
  await apiRegister({
    userId: FIXED_USER_ID,
    pbkdf2Salt,
    wrappedKeyMaster: JSON.stringify(wrappedMaster),
    wrappedKeyRecovery: JSON.stringify(wrappedRecovery),
    recoveryKeyHash,
    vaultCiphertext: encryptedPayload.ciphertext,
    vaultIv: encryptedPayload.iv,
  });

  return { key: vaultKey, vault, recoveryKeyStr };
}

export async function unlockVault(pin: string) {
  // 1. Fetch user data from backend
  const { pbkdf2Salt, wrappedKeyMaster, vaultCiphertext, vaultIv } = await apiLogin({ userId: FIXED_USER_ID });

  // 2. Derive Master Key from PIN
  const masterKey = await deriveMasterKeyFromPin(pin, pbkdf2Salt, DEFAULT_ITERATIONS);

  // 3. Unwrap Vault Key
  const wrappedMasterObj = JSON.parse(wrappedKeyMaster);
  let vaultKey: CryptoKey;
  try {
    vaultKey = await unwrapVaultKey(
      wrappedMasterObj.wrappedBase64,
      wrappedMasterObj.ivBase64,
      masterKey
    );
  } catch (err) {
    throw new Error("Invalid PIN. Failed to unwrap encryption key.");
  }

  // 4. Decrypt Vault
  let vault: PlainVault;
  try {
    vault = await decryptVault(vaultCiphertext, vaultIv, vaultKey);
  } catch (err) {
    throw new Error("Invalid PIN or corrupted vault. Decryption failed.");
  }
  
  return { key: vaultKey, vault };
}

export async function unlockVaultWithRecovery(recoveryKeyStr: string) {
  // 1. Hash the recovery key and fetch data from backend
  const recoveryKeyHash = await hashRecoveryKeyStr(recoveryKeyStr);
  const { wrappedKeyRecovery, vaultCiphertext, vaultIv } = await apiLoginRecovery({ recoveryKeyHash });

  // 2. Import recovery key as CryptoKey
  const recoveryKeyCrypto = await importRecoveryKey(recoveryKeyStr);

  // 3. Unwrap vault key
  const wrappedRecoveryObj = JSON.parse(wrappedKeyRecovery);
  let vaultKey: CryptoKey;
  try {
    vaultKey = await unwrapVaultKey(
      wrappedRecoveryObj.wrappedBase64,
      wrappedRecoveryObj.ivBase64,
      recoveryKeyCrypto
    );
  } catch (err) {
    throw new Error("Invalid recovery key. Failed to unwrap encryption key.");
  }

  // 4. Decrypt vault
  let vault: PlainVault;
  try {
    vault = await decryptVault(vaultCiphertext, vaultIv, vaultKey);
  } catch (err) {
    throw new Error("Failed to decrypt vault with recovery key.");
  }

  return { key: vaultKey, vault };
}

export async function persistVault(vault: PlainVault, key: CryptoKey) {
  // Save the current version to use as the concurrency check
  const baseVersion = vault.version;
  
  // Bump the version locally BEFORE encrypting, so the new version is persisted inside the ciphertext
  vault.version += 1;
  
  const encryptedPayload = await encryptVault(vault, key);

  // Send the updated vault to the backend
  await apiSyncVault({
    vaultCiphertext: encryptedPayload.ciphertext,
    vaultIv: encryptedPayload.iv,
    baseVersion: baseVersion, // optimistic locking against the old version
  });
}

export async function changePin(currentPin: string, newPin: string, vaultKey: CryptoKey) {
  // 1. Re-fetch the wrapped master key and verify the current PIN before re-wrapping
  const { pbkdf2Salt, wrappedKeyMaster } = await apiLogin({ userId: FIXED_USER_ID });
  const currentMasterKey = await deriveMasterKeyFromPin(currentPin, pbkdf2Salt, DEFAULT_ITERATIONS);
  const wrappedMasterObj = JSON.parse(wrappedKeyMaster);
  try {
    await unwrapVaultKey(wrappedMasterObj.wrappedBase64, wrappedMasterObj.ivBase64, currentMasterKey);
  } catch {
    throw new Error("Current PIN is incorrect.");
  }

  // 2. Derive a new master key from a fresh salt and re-wrap the existing vault key
  const newSalt = generateSalt(32);
  const newMasterKey = await deriveMasterKeyFromPin(newPin, newSalt, DEFAULT_ITERATIONS);
  const newWrappedMaster = await wrapVaultKey(vaultKey, newMasterKey);

  // 3. Persist the new salt + wrapped key on the backend
  await apiUpdateKeys({
    pbkdf2Salt: newSalt,
    wrappedKeyMaster: JSON.stringify(newWrappedMaster),
  });
}

export async function regenerateRecoveryKey(vaultKey: CryptoKey) {
  // 1. Generate a new recovery key and wrap the existing vault key with it
  const recoveryKeyStr = generateRecoveryKeyStr();
  const recoveryKeyHash = await hashRecoveryKeyStr(recoveryKeyStr);
  const recoveryKeyCrypto = await importRecoveryKey(recoveryKeyStr);
  const wrappedRecovery = await wrapVaultKey(vaultKey, recoveryKeyCrypto);

  // 2. Persist on the backend — the old recovery key is invalidated from this point
  await apiUpdateKeys({
    wrappedKeyRecovery: JSON.stringify(wrappedRecovery),
    recoveryKeyHash,
  });

  return recoveryKeyStr;
}
