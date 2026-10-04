const amqp = require('amqplib');
const prisma = require('../config/prisma');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';
const EXCHANGE_NAME = 'task_management_events';
const QUEUE_NAME = 'problem_service_queue';

let channel = null;
let connection = null;

async function startRabbitMQ() {
  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    const q = await channel.assertQueue(QUEUE_NAME, { durable: true });
    await channel.bindQueue(q.queue, EXCHANGE_NAME, 'employee.*');

    console.log('[RabbitMQ Problem Service] Connected and listening on exchange:', EXCHANGE_NAME);

    channel.consume(q.queue, async (msg) => {
      if (msg !== null) {
        try {
          const content = JSON.parse(msg.content.toString());
          if (content.event === 'employee.created' || content.event === 'employee.updated') {
            const emp = content.data;
            await prisma.employeeCache.upsert({
              where: { id: parseInt(emp.id, 10) },
              create: {
                id: parseInt(emp.id, 10),
                username: emp.username,
                full_name: emp.full_name || emp.username,
                email: emp.email || '',
                department: emp.department || '',
                job_title: emp.job_title || '',
                is_active: emp.is_active !== false,
              },
              update: {
                username: emp.username,
                full_name: emp.full_name || emp.username,
                email: emp.email || '',
                department: emp.department || '',
                job_title: emp.job_title || '',
                is_active: emp.is_active !== false,
              }
            });
          }
          channel.ack(msg);
        } catch (err) {
          console.error('[RabbitMQ Problem Service] Message processing error:', err.message);
          channel.nack(msg, false, false);
        }
      }
    });

    connection.on('error', (err) => console.warn('[RabbitMQ Problem Service] Error:', err.message));
    connection.on('close', () => {
      console.warn('[RabbitMQ Problem Service] Connection closed. Retrying in 10s...');
      setTimeout(startRabbitMQ, 10000);
    });
  } catch (err) {
    console.warn('[RabbitMQ Problem Service] Offline or unreachable, will retry in 15s:', err.message);
    setTimeout(startRabbitMQ, 15000);
  }
}

async function publishProblemEvent(eventType, data) {
  try {
    if (!channel) return false;
    const msg = { event: eventType, data };
    channel.publish(
      EXCHANGE_NAME,
      eventType,
      Buffer.from(JSON.stringify(msg)),
      { persistent: true, contentType: 'application/json' }
    );
    console.log(`[RabbitMQ Problem Service] Dispatched event ${eventType} for problem ${data.id}`);
    return true;
  } catch (err) {
    console.warn(`[RabbitMQ Problem Service] Failed to publish ${eventType}:`, err.message);
    return false;
  }
}

module.exports = {
  startRabbitMQ,
  publishProblemEvent,
};
