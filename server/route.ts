import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt, sign } from 'hono/jwt'
import { db, UserRow } from './db'

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me-in-production'

const app = new Hono()

app.use('*', cors())

async function generateToken(userId: string) {
  const payload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
  }
  return await sign(payload, JWT_SECRET)
}

app.get('/api/has-users', (c) => {
  const query = db.prepare(`SELECT count(*) as count FROM users`)
  const result = query.get() as { count: number }
  return c.json({ hasUsers: result.count > 0 })
})

app.post('/api/reset-all', (c) => {
  db.run(`DELETE FROM users`)
  return c.json({ success: true })
})

app.post('/api/register', async (c) => {
  const body = await c.req.json()
  const { userId, pbkdf2Salt, wrappedKeyMaster, wrappedKeyRecovery, recoveryKeyHash, vaultCiphertext, vaultIv } = body

  if (!userId || !pbkdf2Salt || !wrappedKeyMaster || !wrappedKeyRecovery || !recoveryKeyHash || !vaultCiphertext || !vaultIv) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  try {
    const insert = db.prepare(`
      INSERT INTO users (
        id, pbkdf2_salt, wrapped_key_master, wrapped_key_recovery, 
        recovery_key_hash, vault_ciphertext, vault_iv, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `)
    insert.run(userId, pbkdf2Salt, wrappedKeyMaster, wrappedKeyRecovery, recoveryKeyHash, vaultCiphertext, vaultIv)

    const token = await generateToken(userId)
    return c.json({ success: true, token })
  } catch (e: any) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'User already exists' }, 400)
    }
    console.error(e)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

app.post('/api/login', async (c) => {
  const body = await c.req.json()
  const { userId } = body

  if (!userId) return c.json({ error: 'Missing user ID' }, 400)

  const query = db.prepare(`SELECT * FROM users WHERE id = ?`)
  const user = query.get(userId) as UserRow | undefined

  if (!user) return c.json({ error: 'User not found or incorrect PIN' }, 401)

  const token = await generateToken(user.id)
  return c.json({
    success: true,
    token,
    wrappedKeyMaster: user.wrapped_key_master,
    vaultCiphertext: user.vault_ciphertext,
    vaultIv: user.vault_iv,
    pbkdf2Salt: user.pbkdf2_salt,
  })
})

app.post('/api/login-recovery', async (c) => {
  const body = await c.req.json()
  const { recoveryKeyHash } = body

  if (!recoveryKeyHash) return c.json({ error: 'Missing recovery key hash' }, 400)

  const query = db.prepare(`SELECT * FROM users WHERE recovery_key_hash = ?`)
  const user = query.get(recoveryKeyHash) as UserRow | undefined

  if (!user) return c.json({ error: 'Invalid recovery key' }, 401)

  const token = await generateToken(user.id)
  return c.json({
    success: true,
    token,
    userId: user.id,
    wrappedKeyRecovery: user.wrapped_key_recovery,
    vaultCiphertext: user.vault_ciphertext,
    vaultIv: user.vault_iv,
    pbkdf2Salt: user.pbkdf2_salt,
  })
})

// Protected routes
app.use('/api/vault', jwt({ secret: JWT_SECRET, alg: 'HS256' }))
app.use('/api/keys', jwt({ secret: JWT_SECRET, alg: 'HS256' }))

app.get('/api/vault', (c) => {
  const payload = c.get('jwtPayload') as { userId: string }
  const user = payload.userId

  const query = db.prepare(`SELECT vault_ciphertext, vault_iv, version FROM users WHERE id = ?`)
  const record = query.get(user) as UserRow | undefined

  if (!record) return c.json({ error: 'User not found' }, 404)

  return c.json({
    vaultCiphertext: record.vault_ciphertext,
    vaultIv: record.vault_iv,
    version: record.version,
  })
})

app.put('/api/vault', async (c) => {
  const payload = c.get('jwtPayload') as { userId: string }
  const user = payload.userId

  const body = await c.req.json()
  const { vaultCiphertext, vaultIv, baseVersion } = body

  if (vaultCiphertext === undefined || vaultIv === undefined || baseVersion === undefined) {
     return c.json({ error: 'Missing fields' }, 400)
  }

  const query = db.prepare(`SELECT version FROM users WHERE id = ?`)
  const record = query.get(user) as { version: number } | undefined

  if (!record) return c.json({ error: 'User not found' }, 404)

  if (record.version !== baseVersion) {
    return c.json({ error: 'Conflict: Vault has been modified on another device.' }, 409)
  }

  const update = db.prepare(`
    UPDATE users 
    SET vault_ciphertext = ?, vault_iv = ?, version = version + 1 
    WHERE id = ?
  `)
  update.run(vaultCiphertext, vaultIv, user)

  return c.json({ success: true })
})

app.put('/api/keys', async (c) => {
  const payload = c.get('jwtPayload') as { userId: string }
  const user = payload.userId

  const body = await c.req.json()

  const fields: string[] = []
  const values: string[] = []

  if (body.pbkdf2Salt !== undefined) {
    fields.push('pbkdf2_salt = ?')
    values.push(body.pbkdf2Salt)
  }
  if (body.wrappedKeyMaster !== undefined) {
    fields.push('wrapped_key_master = ?')
    values.push(body.wrappedKeyMaster)
  }
  if (body.wrappedKeyRecovery !== undefined) {
    fields.push('wrapped_key_recovery = ?')
    values.push(body.wrappedKeyRecovery)
  }
  if (body.recoveryKeyHash !== undefined) {
    fields.push('recovery_key_hash = ?')
    values.push(body.recoveryKeyHash)
  }

  if (!fields.length) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  const update = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
  update.run(...values, user)

  return c.json({ success: true })
})

export default app