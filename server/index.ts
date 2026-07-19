import { router } from './route'
import { cors } from 'hono/cors'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.route('/api', router)

console.log('--- Environment Variables ---')
console.log('PORT:', process.env.PORT)
console.log('DB_PATH:', process.env.DB_PATH)
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '***REDACTED***' : 'Not Set')
console.log('NODE_ENV:', process.env.NODE_ENV)
console.log('PWD:', process.cwd())
console.log('---------------------------')
export default {
  port: 3006,
  fetch: app.fetch
}
