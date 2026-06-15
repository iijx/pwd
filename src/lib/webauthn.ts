import { bytesToBase64, base64ToBytes } from "@/features/auth/keyDerivation";

/**
 * Checks if the browser and platform authenticator support WebAuthn and the PRF extension.
 */
export async function isPrfSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    return false;
  }

  if (!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    return false;
  }

  try {
    const isPlatformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!isPlatformAvailable) return false;

    if (PublicKeyCredential.getClientCapabilities) {
      const caps = await PublicKeyCredential.getClientCapabilities();
      return !!caps.prf;
    }
  } catch (error) {
    console.error("Error checking client capabilities:", error);
  }

  return false;
}

/**
 * Registers a new platform authenticator (Touch ID/Face ID) credential using the WebAuthn PRF extension.
 * Derives a cryptographic key from the authenticator to encrypt the master password.
 */
export async function registerPasskey(masterPassword: string) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Floating Key Vault" },
      user: {
        id: userId,
        name: "vault-user",
        displayName: "Vault User",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 (ECDSA with SHA-256)
      authenticatorSelection: {
        authenticatorAttachment: "platform", // Enforces platform authenticator (Touch ID / Face ID)
        userVerification: "required",
      },
      extensions: {
        prf: {
          eval: {
            first: new Uint8Array(32), // 32-byte salt of all zeros
          },
        },
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("Credential creation failed.");
  }

  const extensionResults = credential.getClientExtensionResults();
  const prfResults = extensionResults.prf;
  if (!prfResults || !prfResults.results || !prfResults.results.first) {
    throw new Error("Your browser or hardware does not support the WebAuthn PRF extension for encryption keys.");
  }

  const prfKeyBytes = new Uint8Array(prfResults.results.first as any);

  // Import PRF bytes as an AES-GCM key
  const prfKey = await crypto.subtle.importKey(
    "raw",
    prfKeyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    prfKey,
    encoder.encode(masterPassword)
  );

  return {
    credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
    encryptedPassword: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    iv: bytesToBase64(iv),
  };
}

/**
 * Uses WebAuthn get assertion with PRF extension to retrieve the derived key,
 * decrypts the master password, and returns it.
 */
export async function decryptPasswordWithPasskey(
  credentialIdBase64: string,
  encryptedPasswordBase64: string,
  ivBase64: string
): Promise<string> {
  const credentialId = base64ToBytes(credentialIdBase64);
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          id: credentialId,
          type: "public-key",
        },
      ],
      userVerification: "required",
      extensions: {
        prf: {
          eval: {
            first: new Uint8Array(32), // Salt must match registration (32 bytes)
          },
        },
      },
    },
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error("Authentication assertion failed.");
  }

  const extensionResults = assertion.getClientExtensionResults();
  const prfResults = extensionResults.prf;
  if (!prfResults || !prfResults.results || !prfResults.results.first) {
    throw new Error("Unable to retrieve encryption key from authenticator.");
  }

  const prfKeyBytes = new Uint8Array(prfResults.results.first as any);

  // Import PRF bytes as an AES-GCM decryption key
  const prfKey = await crypto.subtle.importKey(
    "raw",
    prfKeyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const ciphertext = base64ToBytes(encryptedPasswordBase64);
  const iv = base64ToBytes(ivBase64);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    prfKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
