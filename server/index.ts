import app from './route'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000

console.log(`🦊 Hono server is running at http://localhost:${PORT}`)

export default {
  port: PORT,
  fetch: app.fetch,
}
