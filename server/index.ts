import { db, UserRow } from './db'
import { SignJWT, jwtVerify } from 'jose'

const JWT_SECRET_STRING = process.env.JWT_SECRET || 'super-secret-key-change-me-in-production'
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING)
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

async function signToken(payload: { userId: string }) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload
  } catch {
    return null
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function handleCors(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse

    const url = new URL(req.url)
    const method = req.method
    const path = url.pathname

    if (!path.startsWith('/api/')) {
      let filePath = path === '/' ? '/index.html' : path
      let file = Bun.file(`./dist${filePath}`)
      
      if (!(await file.exists()) && path !== '/') {
        // Fallback for SPA routing if needed
        file = Bun.file('./dist/index.html')
      }

      if (await file.exists()) {
        return new Response(file)
      } else {
        return new Response('Not Found', { status: 404 })
      }
    }

    const getAuthUser = async () => {
      const auth = req.headers.get('authorization')
      if (!auth || !auth.startsWith('Bearer ')) return null
      const token = auth.slice(7)
      const payload = await verifyToken(token)
      return payload ? payload.userId as string : null
    }

    try {
      if (method === 'GET' && path === '/api/has-users') {
        const query = db.prepare(`SELECT count(*) as count FROM users`)
        const result = query.get() as { count: number }
        return json({ hasUsers: result.count > 0 })
      }

      if (method === 'POST' && path === '/api/reset-all') {
        db.run(`DELETE FROM users`)
        return json({ success: true })
      }

      if (method === 'POST' && path === '/api/register') {
        const body = await req.json()
        const {
          userId,
          pbkdf2Salt,
          wrappedKeyMaster,
          wrappedKeyRecovery,
          recoveryKeyHash,
          vaultCiphertext,
          vaultIv,
        } = body

        if (!userId || !pbkdf2Salt || !wrappedKeyMaster || !wrappedKeyRecovery || !recoveryKeyHash || !vaultCiphertext || !vaultIv) {
           return json({ error: 'Missing required fields' }, 400)
        }

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

          const token = await signToken({ userId })
          return json({ success: true, token })
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e)
          if (msg.includes('UNIQUE constraint failed')) {
            return json({ error: 'User already exists' }, 400)
          }
          console.error(e)
          return json({ error: 'Internal Server Error' }, 500)
        }
      }

      if (method === 'POST' && path === '/api/login') {
        const body = await req.json()
        const { userId } = body

        if (!userId) {
          return json({ error: 'Missing user ID' }, 400)
        }

        const query = db.prepare(`SELECT * FROM users WHERE id = ?`)
        const user = query.get(userId) as UserRow | undefined

        if (!user) {
          return json({ error: 'User not found or incorrect PIN' }, 401)
        }

        const token = await signToken({ userId: user.id })

        return json({
          success: true,
          token,
          wrappedKeyMaster: user.wrapped_key_master,
          vaultCiphertext: user.vault_ciphertext,
          vaultIv: user.vault_iv,
          pbkdf2Salt: user.pbkdf2_salt,
        })
      }

      if (method === 'POST' && path === '/api/login-recovery') {
        const body = await req.json()
        const { recoveryKeyHash } = body

        if (!recoveryKeyHash) {
          return json({ error: 'Missing recovery key hash' }, 400)
        }

        const query = db.prepare(`SELECT * FROM users WHERE recovery_key_hash = ?`)
        const user = query.get(recoveryKeyHash) as UserRow | undefined

        if (!user) {
          return json({ error: 'Invalid recovery key' }, 401)
        }

        const token = await signToken({ userId: user.id })

        return json({
          success: true,
          token,
          userId: user.id,
          wrappedKeyRecovery: user.wrapped_key_recovery,
          vaultCiphertext: user.vault_ciphertext,
          vaultIv: user.vault_iv,
          pbkdf2Salt: user.pbkdf2_salt,
        })
      }

      if (method === 'GET' && path === '/api/vault') {
        const user = await getAuthUser()
        if (!user) return json({ error: 'Unauthorized' }, 401)

        const query = db.prepare(`SELECT vault_ciphertext, vault_iv, version FROM users WHERE id = ?`)
        const record = query.get(user) as UserRow | undefined

        if (!record) return json({ error: 'User not found' }, 404)

        return json({
          vaultCiphertext: record.vault_ciphertext,
          vaultIv: record.vault_iv,
          version: record.version,
        })
      }

      if (method === 'PUT' && path === '/api/vault') {
        const user = await getAuthUser()
        if (!user) return json({ error: 'Unauthorized' }, 401)

        const body = await req.json()
        const { vaultCiphertext, vaultIv, baseVersion } = body

        if (vaultCiphertext === undefined || vaultIv === undefined || baseVersion === undefined) {
           return json({ error: 'Missing fields' }, 400)
        }

        const query = db.prepare(`SELECT version FROM users WHERE id = ?`)
        const record = query.get(user) as { version: number } | undefined

        if (!record) return json({ error: 'User not found' }, 404)

        if (record.version !== baseVersion) {
          return json({ error: 'Conflict: Vault has been modified on another device.' }, 409)
        }

        const update = db.prepare(`
          UPDATE users 
          SET vault_ciphertext = ?, vault_iv = ?, version = version + 1 
          WHERE id = ?
        `)
        update.run(vaultCiphertext, vaultIv, user)

        return json({ success: true })
      }

      if (method === 'PUT' && path === '/api/keys') {
        const user = await getAuthUser()
        if (!user) return json({ error: 'Unauthorized' }, 401)

        const body = await req.json()

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
          return json({ error: 'No fields to update' }, 400)
        }

        const update = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
        update.run(...values, user)

        return json({ success: true })
      }

      return json({ error: 'Not Found' }, 404)
    } catch (err) {
      console.error(err)
      return json({ error: 'Internal Server Error' }, 500)
    }
  },
})

console.log(`🦊 Bun server is running at http://localhost:${PORT}`)
