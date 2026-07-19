import { router } from './route'
import { cors } from 'hono/cors'
import { Hono } from 'hono'

const app = new Hono()
app.use('*', cors())

app.route('/api', router)

export default {
  port: parseInt(process.env.PORT || '3006'),
  fetch: app.fetch
}
