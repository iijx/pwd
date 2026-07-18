import { cors } from '@elysiajs/cors'
import { jwt } from '@elysiajs/jwt'
import { staticPlugin } from '@elysiajs/static'
import { Elysia, t } from 'elysia'
import { db, UserRow } from './db'

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me-in-production'
const PORT = process.env.PORT || 3000

const app = new Elysia()
  .use(cors())
  .use(staticPlugin({ assets: 'dist', prefix: '/' }))
  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET,
    })
  )
  .get('/api/has-users', async () => {
    const query = db.prepare(`SELECT count(*) as count FROM users`)
    const result = query.get() as { count: number }
    return { hasUsers: result.count > 0 }
  })
  .post('/api/reset-all', async () => {
    db.run(`DELETE FROM users`)
    return { success: true }
  })
  .post(
    '/api/register',
    async ({ body, set, jwt }) => {
      const {
        userId,
        pbkdf2Salt,
        wrappedKeyMaster,
        wrappedKeyRecovery,
        recoveryKeyHash,
        vaultCiphertext,
        vaultIv,
      } = body

      try {
        const insert = db.prepare(`
          INSERT INTO users (
            id, pbkdf2_salt, wrapped_key_master, wrapped_key_recovery, 
            recovery_key_hash, vault_ciphertext, vault_iv, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `)
        
        insert.run(
          userId,
          pbkdf2Salt,
          wrappedKeyMaster,
          wrappedKeyRecovery,
          recoveryKeyHash,
          vaultCiphertext,
          vaultIv
        )

        const token = await jwt.sign({ userId })

        return { success: true, token }
      } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('UNIQUE constraint failed')) {
          set.status = 400
          return { error: 'User already exists' }
        }
        set.status = 500
        return { error: 'Internal Server Error' }
      }
    },
    {
      body: t.Object({
        userId: t.String(),
        pbkdf2Salt: t.String(),
        wrappedKeyMaster: t.String(),
        wrappedKeyRecovery: t.String(),
        recoveryKeyHash: t.String(),
        vaultCiphertext: t.String(),
        vaultIv: t.String(),
      }),
    }
  )
  .post(
    '/api/login',
    async ({ body, jwt, set }) => {
      const { userId } = body

      const query = db.prepare(`SELECT * FROM users WHERE id = ?`)
      const user = query.get(userId) as UserRow | undefined

      if (!user) {
        set.status = 401
        return { error: 'User not found or incorrect PIN' }
      }

      const token = await jwt.sign({ userId: user.id })

      return {
        success: true,
        token,
        wrappedKeyMaster: user.wrapped_key_master,
        vaultCiphertext: user.vault_ciphertext,
        vaultIv: user.vault_iv,
        pbkdf2Salt: user.pbkdf2_salt,
      }
    },
    {
      body: t.Object({
        userId: t.String(),
      }),
    }
  )
  .post(
    '/api/login-recovery',
    async ({ body, jwt, set }) => {
      const { recoveryKeyHash } = body

      const query = db.prepare(`SELECT * FROM users WHERE recovery_key_hash = ?`)
      const user = query.get(recoveryKeyHash) as UserRow | undefined

      if (!user) {
        set.status = 401
        return { error: 'Invalid recovery key' }
      }

      const token = await jwt.sign({ userId: user.id })

      return {
        success: true,
        token,
        userId: user.id,
        wrappedKeyRecovery: user.wrapped_key_recovery,
        vaultCiphertext: user.vault_ciphertext,
        vaultIv: user.vault_iv,
        pbkdf2Salt: user.pbkdf2_salt,
      }
    },
    {
      body: t.Object({
        recoveryKeyHash: t.String(),
      }),
    }
  )
  // Protected routes
  .derive(async ({ headers, jwt }) => {
    const auth = headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) {
      return { user: null }
    }
    const token = auth.slice(7)
    const payload = await jwt.verify(token)
    if (!payload || !payload.userId) {
      return { user: null }
    }
    return { user: payload.userId as string }
  })
  .get('/api/vault', async ({ user, set }) => {
    if (!user) {
      set.status = 401
      return { error: 'Unauthorized' }
    }

    const query = db.prepare(`SELECT vault_ciphertext, vault_iv, version FROM users WHERE id = ?`)
    const record = query.get(user) as UserRow | undefined

    if (!record) {
      set.status = 404
      return { error: 'User not found' }
    }

    return {
      vaultCiphertext: record.vault_ciphertext,
      vaultIv: record.vault_iv,
      version: record.version,
    }
  })
  .put(
    '/api/vault',
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

      const { vaultCiphertext, vaultIv, baseVersion } = body

      const query = db.prepare(`SELECT version FROM users WHERE id = ?`)
      const record = query.get(user) as { version: number } | undefined

      if (!record) {
        set.status = 404
        return { error: 'User not found' }
      }

      if (record.version !== baseVersion) {
        set.status = 409
        return { error: 'Conflict: Vault has been modified on another device.' }
      }

      const update = db.prepare(`
        UPDATE users 
        SET vault_ciphertext = ?, vault_iv = ?, version = version + 1 
        WHERE id = ?
      `)
      update.run(vaultCiphertext, vaultIv, user)

      return { success: true }
    },
    {
      body: t.Object({
        vaultCiphertext: t.String(),
        vaultIv: t.String(),
        baseVersion: t.Number(),
      }),
    }
  )
  .put(
    '/api/keys',
    async ({ user, body, set }) => {
      if (!user) {
        set.status = 401
        return { error: 'Unauthorized' }
      }

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
        set.status = 400
        return { error: 'No fields to update' }
      }

      const update = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      update.run(...values, user)

      return { success: true }
    },
    {
      body: t.Object({
        pbkdf2Salt: t.Optional(t.String()),
        wrappedKeyMaster: t.Optional(t.String()),
        wrappedKeyRecovery: t.Optional(t.String()),
        recoveryKeyHash: t.Optional(t.String()),
      }),
    }
  )
  .listen(PORT)

console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`)
