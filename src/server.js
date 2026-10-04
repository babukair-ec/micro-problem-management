const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = require('./config/prisma');
const { startRabbitMQ } = require('./messaging/rabbitmq');
const problemRoutes = require('./routes/problem_routes');

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'problem-service', port: PORT });
});

app.use('/api/problems', problemRoutes);

app.use((err, req, res, next) => {
  console.error('[Problem Service Error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function startServer() {
  await prisma.$connect();
  console.log('[Problem Service] Connected to PostgreSQL via Prisma ORM.');
  startRabbitMQ().catch(() => {});
  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`  Problem Management Microservice on :${PORT}`);
    console.log(`  Base URL: http://localhost:${PORT}`);
    console.log(`===============================================`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
