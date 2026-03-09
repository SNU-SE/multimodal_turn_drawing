import express from 'express'
import cors from 'cors'
import tokenRouter from './routes/token.js'
import egressRouter from './routes/egress.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/api/token', tokenRouter)
app.use('/api/egress', egressRouter)

app.listen(PORT, () => {
  console.log(`Egress controller running on port ${PORT}`)
})
