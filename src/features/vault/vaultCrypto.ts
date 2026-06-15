import type { PlainVault } from "@/types/vault";
import { base64ToBytes, bytesToBase64, generateIv } from "@/features/auth/keyDerivation";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptVault(vault: PlainVault, key: CryptoKey) {
  const iv = generateIv();
  const plaintext = encoder.encode(JSON.stringify(vault));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptVault(ciphertext: string, iv: string, key: CryptoKey): Promise<PlainVault> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );

  return JSON.parse(decoder.decode(decrypted)) as PlainVault;
}
