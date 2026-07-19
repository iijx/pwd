let sessionToken: string | null = null;

const basePath = import.meta.env.BASE_URL || '/';

function getApiUrl(path: string) {
  // 如果 basePath 是 /pwd/，这里会自动拼接出 /password-vision/api/...
  return `${basePath}${path}`;
}

export async function apiHasUsers(): Promise<boolean> {
  const res = await fetch(getApiUrl('api/has-users'));
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const data = await res.json();
  return data.hasUsers;
}

export async function apiRegister(payload: {
  userId: string;
  pbkdf2Salt: string;
  wrappedKeyMaster: string;
  wrappedKeyRecovery: string;
  recoveryKeyHash: string;
  vaultCiphertext: string;
  vaultIv: string;
}) {
  const res = await fetch(getApiUrl('api/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to register');

  sessionToken = data.token;

  return data;
}

export async function apiLogin(payload: { userId: string }) {
  const res = await fetch(getApiUrl('api/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Login failed');

  sessionToken = data.token;

  return {
    wrappedKeyMaster: data.wrappedKeyMaster,
    vaultCiphertext: data.vaultCiphertext,
    vaultIv: data.vaultIv,
    pbkdf2Salt: data.pbkdf2Salt,
  };
}

export async function apiLoginRecovery(payload: { recoveryKeyHash: string }) {
  const res = await fetch(getApiUrl('api/login-recovery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Recovery login failed');

  sessionToken = data.token;

  return {
    userId: data.userId,
    wrappedKeyRecovery: data.wrappedKeyRecovery,
    vaultCiphertext: data.vaultCiphertext,
    vaultIv: data.vaultIv,
    pbkdf2Salt: data.pbkdf2Salt,
  };
}

export async function apiSyncVault(payload: {
  vaultCiphertext: string;
  vaultIv: string;
  baseVersion: number;
}) {
  if (!sessionToken) throw new Error("Not authenticated");

  const res = await fetch(getApiUrl('api/vault'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to sync vault');
  return data;
}

export async function apiUpdateKeys(payload: {
  pbkdf2Salt?: string;
  wrappedKeyMaster?: string;
  wrappedKeyRecovery?: string;
  recoveryKeyHash?: string;
}) {
  if (!sessionToken) throw new Error("Not authenticated");

  const res = await fetch(getApiUrl('api/keys'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update keys');
  return data;
}

// Deletes all vault data on the server, then clears local state
export async function apiResetAll() {
  try {
    const res = await fetch(getApiUrl('api/reset-all'), { method: 'POST' });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  } finally {
    sessionToken = null;
    localStorage.clear();
  }
}
