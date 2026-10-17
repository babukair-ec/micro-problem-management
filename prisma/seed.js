const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EMPLOYEES = [
  { id: '11111111-1111-4111-8111-111111111111', username: 'ahmed', full_name: 'Ahmed Al-Mansoor', email: 'ahmed@company.com', job_title: 'Lead Architect & Engineering Director', employee_type: 'EMPLOYEE' },
  { id: '22222222-2222-4222-8222-222222222222', username: 'mohammed', full_name: 'Mohammed Al-Sayed', email: 'mohammed@company.com', job_title: 'Senior Full Stack Developer', employee_type: 'EMPLOYEE' },
  { id: '33333333-3333-4333-8333-333333333333', username: 'khaled', full_name: 'Khaled Al-Rashid', email: 'khaled@company.com', job_title: 'DevOps & Infrastructure Lead', employee_type: 'EMPLOYEE' },
  { id: '44444444-4444-4444-8444-444444444444', username: 'tariq', full_name: 'Tariq Al-Harbi', email: 'tariq@company.com', job_title: 'QA Automation Specialist', employee_type: 'TESTER' },
  { id: '55555555-5555-4555-8555-555555555555', username: 'sarah', full_name: 'Sarah Al-Otaibi', email: 'sarah@company.com', job_title: 'Product Manager & UX Lead', employee_type: 'EMPLOYEE' },
  { id: '66666666-6666-4666-8666-666666666666', username: 'fahad', full_name: 'Fahad Al-Ghamdi', email: 'fahad@company.com', job_title: 'Junior Frontend Developer', employee_type: 'EMPLOYEE' },
];

// Connected Task IDs matching Task Service seeds
const TASK_IDS = {
  BLOCK_1: 'a5000000-0000-4000-8000-000000000001', // Redis Cluster
  BLOCK_2: 'a5000000-0000-4000-8000-000000000002', // Stripe Webhooks
  BLOCK_3: 'a5000000-0000-4000-8000-000000000003', // Cypress Tests
  INPROG_1: 'a4000000-0000-4000-8000-000000000001', // MFA TOTP
  COMPL_1: 'a6000000-0000-4000-8000-000000000001', // PgBouncer
  COMPL_2: 'a6000000-0000-4000-8000-000000000002', // i18n
  COMPL_3: 'a6000000-0000-4000-8000-000000000003', // RabbitMQ
};

async function seed() {
  console.log('\n=======================================================');
  console.log(' [4/4] Seeding Problem Management Service...');
  console.log('=======================================================');

  // 1. Sync Employee Cache
  console.log(' -> Syncing EmployeeCache...');
  for (const emp of EMPLOYEES) {
    const { id, ...rest } = emp;
    await prisma.employeeCache.upsert({
      where: { outer_id: id },
      create: { outer_id: id, ...rest },
      update: rest,
    });
  }

  // 2. Seed Connected Problems across all statuses (OPEN, IN_PROGRESS, RESOLVED, CANCELLED)
  console.log(' -> Seeding Problems linked to Tasks...');
  const problemsData = [
    // --- OPEN Problems (Actively blocking tasks) ---
    {
      outer_id: 'b1000000-0000-4000-8000-000000000001',
      task_id: TASK_IDS.BLOCK_1, // Redis Cluster
      reported_by_id: EMPLOYEES[2].id, // Khaled
      description: 'Sentinel election quorum fails on subnet failover. Port 26379 packet drops detected between AWS eu-west-1 and me-south-1 VPC peering.',
      status: 'OPEN',
      resolver_id: null,
      created_at: new Date(Date.now() - 3 * 86400000),
    },
    {
      outer_id: 'b1000000-0000-4000-8000-000000000002',
      task_id: TASK_IDS.BLOCK_2, // Stripe Webhooks
      reported_by_id: EMPLOYEES[1].id, // Mohammed
      description: 'Webhook raw request body stream is pre-consumed by Express body-parser before cryptographic HMAC signature verification executes.',
      status: 'OPEN',
      resolver_id: null,
      created_at: new Date(Date.now() - 4 * 86400000),
    },
    {
      outer_id: 'b1000000-0000-4000-8000-000000000003',
      task_id: TASK_IDS.BLOCK_1, // Second problem on Redis Cluster
      reported_by_id: EMPLOYEES[0].id, // Ahmed
      description: 'TLS certificate expiration warning on Redis Sentinel node 3.',
      status: 'OPEN',
      resolver_id: null,
      created_at: new Date(Date.now() - 2 * 86400000),
    },

    // --- IN_PROGRESS Problems ---
    {
      outer_id: 'b2000000-0000-4000-8000-000000000001',
      task_id: TASK_IDS.BLOCK_3, // Cypress Tests
      reported_by_id: EMPLOYEES[3].id, // Tariq
      description: 'Cypress headless browser runner crashes intermittently with exit code 137 (OOM killed) during parallel task listing assertions.',
      status: 'IN_PROGRESS',
      resolver_id: EMPLOYEES[1].id, // Mohammed resolving
      created_at: new Date(Date.now() - 5 * 86400000),
    },
    {
      outer_id: 'b2000000-0000-4000-8000-000000000002',
      task_id: TASK_IDS.INPROG_1, // MFA TOTP
      reported_by_id: EMPLOYEES[1].id, // Mohammed
      description: 'Time drift skew of +-90 seconds on worker nodes causes TOTP code window validation failure during auth testing.',
      status: 'IN_PROGRESS',
      resolver_id: EMPLOYEES[2].id, // Khaled resolving (NTP sync)
      created_at: new Date(Date.now() - 3 * 86400000),
    },

    // --- RESOLVED Problems ---
    {
      outer_id: 'b3000000-0000-4000-8000-000000000001',
      task_id: TASK_IDS.COMPL_1, // PgBouncer
      reported_by_id: EMPLOYEES[2].id, // Khaled
      description: 'Prepared statements disabled in PgBouncer transaction mode caused Prisma connection dropouts.',
      status: 'RESOLVED',
      resolver_id: EMPLOYEES[0].id, // Ahmed resolved
      resolution: 'Configured pgbouncer=true query parameter on DATABASE_URL connection string and switched Prisma to advisory lock mode.',
      created_at: new Date(Date.now() - 11 * 86400000),
      resolved_at: new Date(Date.now() - 8 * 86400000),
    },
    {
      outer_id: 'b3000000-0000-4000-8000-000000000002',
      task_id: TASK_IDS.COMPL_2, // i18n
      reported_by_id: EMPLOYEES[5].id, // Fahad
      description: 'Bootstrap CSS direction stylesheet flip broke flexbox alignment of status badge icons in RTL view.',
      status: 'RESOLVED',
      resolver_id: EMPLOYEES[1].id, // Mohammed resolved
      resolution: 'Replaced directional margin-left/right utilities with logical Bootstrap start/end (ms-*, me-*) classes.',
      created_at: new Date(Date.now() - 7 * 86400000),
      resolved_at: new Date(Date.now() - 4 * 86400000),
    },
    {
      outer_id: 'b3000000-0000-4000-8000-000000000003',
      task_id: TASK_IDS.COMPL_3, // RabbitMQ
      reported_by_id: EMPLOYEES[0].id, // Ahmed
      description: 'RabbitMQ amqplib channel closes ungracefully during network reconnect loops.',
      status: 'RESOLVED',
      resolver_id: EMPLOYEES[2].id, // Khaled resolved
      resolution: 'Added channel error listeners and exponential backoff retry loop with max 10 reconnect attempts.',
      created_at: new Date(Date.now() - 16 * 86400000),
      resolved_at: new Date(Date.now() - 15 * 86400000),
    },

    // --- CANCELLED Problems ---
    {
      outer_id: 'b4000000-0000-4000-8000-000000000001',
      task_id: TASK_IDS.INPROG_1,
      reported_by_id: EMPLOYEES[1].id, // Mohammed
      description: 'Twilio SMS sandbox account reached daily verification limit for test numbers.',
      status: 'CANCELLED',
      resolver_id: EMPLOYEES[0].id,
      resolution: 'Discarded: SMS verification dropped in favor of RFC 6238 TOTP authenticator app tokens.',
      created_at: new Date(Date.now() - 2 * 86400000),
      resolved_at: new Date(Date.now() - 1 * 86400000),
    },
  ];

  for (const prob of problemsData) {
    await prisma.problem.upsert({
      where: { outer_id: prob.outer_id },
      create: prob,
      update: prob,
    });
    console.log(` -> [Problem] [${prob.status.padEnd(11)}] Task: ${(prob.task_id || '').slice(0, 8)}... - "${prob.description.slice(0, 48)}..."`);
  }

  console.log(' -> Problem Service seeding successfully completed.\n');
}

seed()
  .catch((e) => {
    console.error('Problem Service seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
