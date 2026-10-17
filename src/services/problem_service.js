const prisma = require('../config/prisma');
const { publishProblemEvent } = require('../messaging/rabbitmq');

const TASK_SERVICE_URL = process.env.TASK_SERVICE_URL || 'http://localhost:5001';

function getProblemWhereClause(problemId) {
  if (typeof problemId === 'number') {
    return { id: problemId };
  }
  const strId = String(problemId);
  if (!isNaN(strId) && !strId.includes('-')) {
    return { id: parseInt(strId, 10) };
  }
  return { outer_id: strId };
}

class ProblemService {
  /**
   * Report a problem: can be linked to a Task (Task Problem) or a Project (Project Problem), or both.
   */
  async reportProblem({ taskId = null, projectId = null, reportedById, description }) {
    const strReportedById = String(reportedById);

    if (!description || !description.trim()) {
      throw new Error('Problem description is required');
    }

    if (!taskId && !projectId) {
      const err = new Error('A problem must be associated with a Task or a Project (or both)');
      err.status = 400;
      throw err;
    }

    const strTaskId = taskId ? String(taskId) : null;
    const strProjectId = projectId ? String(projectId) : null;

    const problem = await prisma.problem.create({
      data: {
        task_id: strTaskId,
        project_id: strProjectId,
        reported_by_id: strReportedById,
        description: description.trim(),
        status: 'OPEN',
      }
    });

    // If linked to a task, trigger task blocking
    if (strTaskId) {
      publishProblemEvent('problem.reported', {
        id: problem.id,
        outer_id: problem.outer_id,
        task_id: strTaskId,
        project_id: strProjectId,
        reported_by_id: strReportedById,
        status: 'OPEN',
      });
      this.notifyTaskServiceBlock(strTaskId, problem.outer_id || problem.id).catch(() => {});
    } else {
      publishProblemEvent('problem.reported', {
        id: problem.id,
        outer_id: problem.outer_id,
        project_id: strProjectId,
        reported_by_id: strReportedById,
        status: 'OPEN',
      });
    }

    return problem;
  }

  /**
   * Create a resolution task for a problem in Task Service
   */
  async createResolutionTask(problemId, employeeId, taskOverrides = {}) {
    const problem = await prisma.problem.findFirst({
      where: getProblemWhereClause(problemId)
    });

    if (!problem) {
      throw new Error('Problem not found');
    }

    if (['RESOLVED', 'CANCELLED'].includes(problem.status)) {
      throw new Error(`Cannot create resolution task for problem in status: ${problem.status}`);
    }

    const taskTitle = taskOverrides.title || `Resolution: ${problem.description.slice(0, 60)}...`;
    const taskDescription = taskOverrides.description || `Task created to resolve problem #${problem.id}:\n${problem.description}`;
    const directAssigneeId = taskOverrides.direct_assignee_id || problem.resolver_id || String(employeeId);

    let resolutionTaskId = null;
    let resolutionTask = null;

    try {
      const resp = await fetch(`${TASK_SERVICE_URL}/api/tasks/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': taskOverrides.authHeader || '',
          'x-user-id': String(employeeId),
        },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          priority: taskOverrides.priority || 'HIGH',
          assignment_mode: 'DIRECT',
          direct_assignee_id: directAssigneeId,
          project_id: problem.project_id || null,
          problem_id: problem.outer_id || String(problem.id),
        }),
      });

      if (resp.ok) {
        resolutionTask = await resp.json();
        resolutionTaskId = resolutionTask.outer_id || String(resolutionTask.id);
      }
    } catch (err) {
      console.warn('[Problem Service] Could not reach Task Service:', err.message);
    }

    if (!resolutionTaskId) {
      const { v4: uuidv4 } = require('crypto');
      resolutionTaskId = uuidv4 ? uuidv4() : String(Date.now());
      resolutionTask = { id: resolutionTaskId, title: taskTitle, problem_id: problem.id };
    }

    const updatedProblem = await prisma.problem.update({
      where: { id: problem.id },
      data: { resolution_task_id: resolutionTaskId }
    });

    return {
      problem: updatedProblem,
      resolutionTask: resolutionTask,
    };
  }

  /**
   * Assign designated colleague as resolver
   */
  async assignProblemResolver(problemId, resolverId) {
    const strResolverId = String(resolverId);

    const problem = await prisma.problem.findFirst({
      where: getProblemWhereClause(problemId)
    });

    if (!problem || !['OPEN', 'IN_PROGRESS'].includes(problem.status)) {
      throw new Error('Problem not found or already closed');
    }

    return await prisma.problem.update({
      where: { id: problem.id },
      data: { resolver_id: strResolverId }
    });
  }

  /**
   * Start resolution work: OPEN -> IN_PROGRESS
   */
  async startProblemResolution(problemId, employeeId) {
    const strEmpId = String(employeeId);

    const problem = await prisma.problem.findFirst({
      where: getProblemWhereClause(problemId)
    });

    if (!problem) throw new Error('Problem not found');

    if (problem.status !== 'OPEN') {
      throw new Error(`Cannot start resolution on problem in status: ${problem.status}`);
    }

    const resolverId = problem.resolver_id || strEmpId;
    return await prisma.problem.update({
      where: { id: problem.id },
      data: {
        status: 'IN_PROGRESS',
        resolver_id: resolverId,
      }
    });
  }

  /**
   * Resolve problem using Prisma transaction:
   * Sets RESOLVED, checks if remaining blockers exist on task, unblocks task
   */
  async resolveProblem(problemId, resolverId, resolutionText) {
    const strResolverId = String(resolverId);

    if (!resolutionText || !resolutionText.trim()) {
      throw new Error('Resolution notes are required');
    }

    const targetProblem = await prisma.problem.findFirst({
      where: getProblemWhereClause(problemId)
    });

    if (!targetProblem) throw new Error('Problem not found');

    if (!['OPEN', 'IN_PROGRESS'].includes(targetProblem.status)) {
      throw new Error(`Cannot resolve problem with status: ${targetProblem.status}`);
    }

    return await prisma.$transaction(async (tx) => {
      const resolvedProblem = await tx.problem.update({
        where: { id: targetProblem.id },
        data: {
          status: 'RESOLVED',
          resolved_at: new Date(),
          resolution: resolutionText.trim(),
          resolver_id: targetProblem.resolver_id || strResolverId,
        }
      });

      let remainingCount = 0;
      if (targetProblem.task_id) {
        remainingCount = await tx.problem.count({
          where: {
            task_id: targetProblem.task_id,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
            id: { not: targetProblem.id },
          }
        });
      }

      return { resolvedProblem, remainingCount, taskId: targetProblem.task_id };
    }).then(({ resolvedProblem, remainingCount, taskId }) => {
      if (taskId && remainingCount === 0) {
        publishProblemEvent('problem.resolved', {
          id: resolvedProblem.id,
          outer_id: resolvedProblem.outer_id,
          task_id: taskId,
          resolver_id: strResolverId,
          status: 'RESOLVED',
        });
        this.notifyTaskServiceUnblock(taskId, resolvedProblem.outer_id || resolvedProblem.id).catch(() => {});
      }
      return resolvedProblem;
    });
  }

  /**
   * Cancel problem
   */
  async cancelProblem(problemId) {
    const problem = await prisma.problem.findFirst({
      where: getProblemWhereClause(problemId)
    });

    if (!problem || !['OPEN', 'IN_PROGRESS'].includes(problem.status)) {
      throw new Error('Problem not found or already closed');
    }

    const cancelledProblem = await prisma.problem.update({
      where: { id: problem.id },
      data: { status: 'CANCELLED' }
    });

    let remainingCount = 0;
    if (problem.task_id) {
      remainingCount = await prisma.problem.count({
        where: {
          task_id: problem.task_id,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        }
      });

      if (remainingCount === 0) {
        publishProblemEvent('problem.cancelled', {
          id: cancelledProblem.id,
          outer_id: cancelledProblem.outer_id,
          task_id: problem.task_id,
        });
        this.notifyTaskServiceUnblock(problem.task_id, cancelledProblem.outer_id || cancelledProblem.id).catch(() => {});
      }
    }

    return cancelledProblem;
  }

  async getProblemById(problemId) {
    const problem = await prisma.problem.findFirst({
      where: getProblemWhereClause(problemId)
    });

    if (!problem) return null;

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

    const reporter = empMap.get(String(problem.reported_by_id));
    const resolver = empMap.get(String(problem.resolver_id));

    return {
      ...problem,
      reporter_username: reporter?.username || '',
      reporter_name: reporter?.full_name || reporter?.username || '',
      resolver_username: resolver?.username || '',
      resolver_name: resolver?.full_name || resolver?.username || '',
    };
  }

  async listProblems({ taskId, projectId, status }) {
    const where = {};
    if (taskId) where.task_id = String(taskId);
    if (projectId) where.project_id = String(projectId);
    if (status) where.status = status;

    const problems = await prisma.problem.findMany({
      where,
      orderBy: { created_at: 'desc' }
    });

    const employees = await prisma.employeeCache.findMany();
    const empMap = new Map();
    employees.forEach(e => {
      empMap.set(String(e.id), e);
      if (e.outer_id) empMap.set(String(e.outer_id), e);
    });

    return problems.map(p => {
      const reporter = empMap.get(String(p.reported_by_id));
      const resolver = empMap.get(String(p.resolver_id));
      return {
        ...p,
        reporter_username: reporter?.username || '',
        reporter_name: reporter?.full_name || reporter?.username || '',
        resolver_username: resolver?.username || '',
        resolver_name: resolver?.full_name || resolver?.username || '',
      };
    });
  }

  async listProblemsForTask(taskId) {
    return this.listProblems({ taskId });
  }

  async notifyTaskServiceBlock(taskId, problemId) {
    try {
      await fetch(`${TASK_SERVICE_URL}/api/tasks/${taskId}/block/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: String(problemId) }),
      });
    } catch (e) {
      // Best-effort HTTP notification
    }
  }

  async notifyTaskServiceUnblock(taskId, problemId) {
    try {
      await fetch(`${TASK_SERVICE_URL}/api/tasks/${taskId}/unblock/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem_id: String(problemId) }),
      });
    } catch (e) {
      // Best-effort HTTP notification
    }
  }
}

module.exports = new ProblemService();
