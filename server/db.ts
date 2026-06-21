import { Database } from 'bun:sqlite'

// Create or open the SQLite database in the project root
const dbPath = process.env.DB_PATH || 'vault.sqlite'
const db = new Database(dbPath, { create: true })

// Initialize the users table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    pbkdf2_salt TEXT NOT NULL,
    wrapped_key_master TEXT NOT NULL,
    wrapped_key_recovery TEXT NOT NULL,
    recovery_key_hash TEXT NOT NULL,
    vault_ciphertext TEXT NOT NULL,
    vault_iv TEXT NOT NULL,
    version INTEGER NOT NULL
  )
`)

export interface UserRow {
  id: string
  pbkdf2_salt: string
  wrapped_key_master: string
  wrapped_key_recovery: string
  recovery_key_hash: string
  vault_ciphertext: string
  vault_iv: string
  version: number
}

export { db }
