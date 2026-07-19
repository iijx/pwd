const encoder = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function generateSalt(length = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(length)));
}

export function generateIv() {
  return crypto.getRandomValues(new Uint8Array(12));
}

export async function deriveMasterKeyFromPin(pin: string, saltBase64: string, iterations = 310000): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltBase64),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can wrap it
    ["encrypt", "decrypt"]
  );
}

export async function wrapVaultKey(vaultKey: CryptoKey, wrappingKey: CryptoKey): Promise<{ wrappedBase64: string; ivBase64: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey(
    "raw",
    vaultKey,
    wrappingKey,
    { name: "AES-GCM", iv }
  );
  return {
    wrappedBase64: bytesToBase64(new Uint8Array(wrapped)),
    ivBase64: bytesToBase64(iv),
  };
}

export async function unwrapVaultKey(wrappedBase64: string, ivBase64: string, unwrappingKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    base64ToBytes(wrappedBase64),
    unwrappingKey,
    { name: "AES-GCM", iv: base64ToBytes(ivBase64) },
    { name: "AES-GCM", length: 256 },
    false, // unwrapped DEK should not be extractable
    ["encrypt", "decrypt"]
  );
}

export function generateRecoveryKeyStr(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes).replace(/[\/+=]/g, "X"); 
}

export async function importRecoveryKey(recoveryStr: string): Promise<CryptoKey> {
  const keyMaterial = encoder.encode(recoveryStr);
  const hash = await crypto.subtle.digest("SHA-256", keyMaterial);
  return crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

export async function hashRecoveryKeyStr(recoveryStr: string): Promise<string> {
  const keyMaterial = encoder.encode(recoveryStr);
  const hash = await crypto.subtle.digest("SHA-256", keyMaterial);
  return bytesToBase64(new Uint8Array(hash));
}
