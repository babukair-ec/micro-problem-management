const prisma = require('../config/prisma');
const { publishProblemEvent } = require('../messaging/rabbitmq');

const TASK_SERVICE_URL = process.env.TASK_SERVICE_URL || 'http://localhost:5001';

class ProblemService {
  /**
   * Report a blocking problem on a task using Prisma
   */
  async reportProblem(taskId, reportedById, description) {
    const numericTaskId = parseInt(taskId, 10);
    const numericReportedById = parseInt(reportedById, 10);

    if (!description || !description.trim()) {
      throw new Error('Problem description is required');
    }

    const problem = await prisma.problem.create({
      data: {
        task_id: numericTaskId,
        reported_by_id: numericReportedById,
        description: description.trim(),
        status: 'OPEN',
      }
    });

    // Publish event for Task Service to transition task status to BLOCKED
    publishProblemEvent('problem.reported', {
      id: problem.id,
      task_id: numericTaskId,
      reported_by_id: numericReportedById,
      status: 'OPEN',
    });

    // Also attempt direct HTTP trigger to Task Service
    this.notifyTaskServiceBlock(numericTaskId, problem.id).catch(() => {});

    return problem;
  }

  /**
   * Assign designated colleague as resolver
   */
  async assignProblemResolver(problemId, resolverId) {
    const numericProblemId = parseInt(problemId, 10);
    const numericResolverId = parseInt(resolverId, 10);

    const problem = await prisma.problem.findUnique({
      where: { id: numericProblemId }
    });

    if (!problem || !['OPEN', 'IN_PROGRESS'].includes(problem.status)) {
      throw new Error('Problem not found or already closed');
    }

    return await prisma.problem.update({
      where: { id: numericProblemId },
      data: { resolver_id: numericResolverId }
    });
  }

  /**
   * Start resolution work: OPEN -> IN_PROGRESS
   */
  async startProblemResolution(problemId, employeeId) {
    const numericProblemId = parseInt(problemId, 10);
    const numericEmpId = parseInt(employeeId, 10);

    const problem = await prisma.problem.findUnique({
      where: { id: numericProblemId }
    });

    if (!problem) throw new Error('Problem not found');

    if (problem.status !== 'OPEN') {
      throw new Error(`Cannot start resolution on problem in status: ${problem.status}`);
    }

    const resolverId = problem.resolver_id || numericEmpId;
    return await prisma.problem.update({
      where: { id: numericProblemId },
      data: {
        status: 'IN_PROGRESS',
        resolver_id: resolverId,
      }
    });
  }

  /**
   * Resolve problem using Prisma transaction:
   * Sets RESOLVED, checks if remaining blockers exist, unblocks task
   */
  async resolveProblem(problemId, resolverId, resolutionText) {
    const numericProblemId = parseInt(problemId, 10);
    const numericResolverId = parseInt(resolverId, 10);

    if (!resolutionText || !resolutionText.trim()) {
      throw new Error('Resolution notes are required');
    }

    return await prisma.$transaction(async (tx) => {
      const problem = await tx.problem.findUnique({
        where: { id: numericProblemId }
      });

      if (!problem) throw new Error('Problem not found');

      if (!['OPEN', 'IN_PROGRESS'].includes(problem.status)) {
        throw new Error(`Cannot resolve problem with status: ${problem.status}`);
      }

      const resolvedProblem = await tx.problem.update({
        where: { id: numericProblemId },
        data: {
          status: 'RESOLVED',
          resolved_at: new Date(),
          resolution: resolutionText.trim(),
          resolver_id: problem.resolver_id || numericResolverId,
        }
      });

      // Check if any other active blockers remain on this task
      const remainingCount = await tx.problem.count({
        where: {
          task_id: problem.task_id,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          id: { not: numericProblemId },
        }
      });

      return { resolvedProblem, remainingCount, taskId: problem.task_id };
    }).then(({ resolvedProblem, remainingCount, taskId }) => {
      if (remainingCount === 0) {
        publishProblemEvent('problem.resolved', {
          id: resolvedProblem.id,
          task_id: taskId,
          resolver_id: numericResolverId,
          status: 'RESOLVED',
        });
        this.notifyTaskServiceUnblock(taskId, resolvedProblem.id).catch(() => {});
      }
      return resolvedProblem;
    });
  }

  /**
   * Cancel problem
   */
  async cancelProblem(problemId) {
    const numericProblemId = parseInt(problemId, 10);

    const problem = await prisma.problem.findUnique({
      where: { id: numericProblemId }
    });

    if (!problem || !['OPEN', 'IN_PROGRESS'].includes(problem.status)) {
      throw new Error('Problem not found or already closed');
    }

    const cancelledProblem = await prisma.problem.update({
      where: { id: numericProblemId },
      data: { status: 'CANCELLED' }
    });

    const remainingCount = await prisma.problem.count({
      where: {
        task_id: problem.task_id,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      }
    });

    if (remainingCount === 0) {
      publishProblemEvent('problem.cancelled', {
        id: cancelledProblem.id,
        task_id: problem.task_id,
      });
      this.notifyTaskServiceUnblock(problem.task_id, cancelledProblem.id).catch(() => {});
    }

    return cancelledProblem;
  }

  async getProblemById(problemId) {
    const numericProblemId = parseInt(problemId, 10);
    const problem = await prisma.problem.findUnique({
      where: { id: numericProblemId }
    });

    if (!problem) return null;

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    const reporter = empMap.get(problem.reported_by_id);
    const resolver = empMap.get(problem.resolver_id);

    return {
      ...problem,
      reporter_username: reporter?.username || '',
      reporter_name: reporter?.full_name || reporter?.username || '',
      resolver_username: resolver?.username || '',
      resolver_name: resolver?.full_name || resolver?.username || '',
    };
  }

  async listProblemsForTask(taskId) {
    const numericTaskId = parseInt(taskId, 10);
    const problems = await prisma.problem.findMany({
      where: { task_id: numericTaskId },
      orderBy: { created_at: 'desc' }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    return problems.map(p => {
      const reporter = empMap.get(p.reported_by_id);
      const resolver = empMap.get(p.resolver_id);
      return {
        ...p,
        reporter_username: reporter?.username || '',
        reporter_name: reporter?.full_name || reporter?.username || '',
        resolver_username: resolver?.username || '',
        resolver_name: resolver?.full_name || resolver?.username || '',
      };
    });
  }

  // Inter-service HTTP triggers
  async notifyTaskServiceBlock(taskId, problemId) {
    try {
      await fetch(`${TASK_SERVICE_URL}/api/tasks/${taskId}/block-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: problemId }),
      });
    } catch (_) {}
  }

  async notifyTaskServiceUnblock(taskId, problemId) {
    try {
      await fetch(`${TASK_SERVICE_URL}/api/tasks/${taskId}/unblock-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: problemId }),
      });
    } catch (_) {}
  }
}

module.exports = new ProblemService();
