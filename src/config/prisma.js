const { PrismaClient } = require('@prisma/client');

let prisma;

try {
  const url = process.env.PROBLEM_DATABASE_URL || 'postgresql://postgres:admin123@localhost:5433/task_mgmt_problems?schema=public';
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: url,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
  });
} catch (err) {
  console.warn('[Prisma Problem Service Warning]:', err.message);
}

module.exports = prisma;
