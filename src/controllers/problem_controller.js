const problemService = require('../services/problem_service');

class ProblemController {
  async getProblem(req, res) {
    try {
      const problem = await problemService.getProblemById(req.params.id);
      if (!problem) return res.status(404).json({ error: 'Problem not found' });
      res.json(problem);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async listProblems(req, res) {
    try {
      const { task_id } = req.query;
      if (!task_id) {
        return res.status(400).json({ error: 'task_id query param is required' });
      }
      const problems = await problemService.listProblemsForTask(task_id);
      res.json(problems);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async reportProblem(req, res) {
    try {
      const { task_id, description } = req.body;
      if (!task_id) return res.status(400).json({ error: 'task_id is required' });
      const problem = await problemService.reportProblem(task_id, req.user.employeeId, description);
      res.status(201).json(problem);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async assignResolver(req, res) {
    try {
      const { resolver_id } = req.body;
      if (!resolver_id) return res.status(400).json({ error: 'resolver_id is required' });
      const problem = await problemService.assignProblemResolver(req.params.id, resolver_id);
      res.json(problem);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async startResolution(req, res) {
    try {
      const problem = await problemService.startProblemResolution(req.params.id, req.user.employeeId);
      res.json(problem);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async resolveProblem(req, res) {
    try {
      const { resolution } = req.body;
      const problem = await problemService.resolveProblem(req.params.id, req.user.employeeId, resolution);
      res.json(problem);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }

  async cancelProblem(req, res) {
    try {
      const problem = await problemService.cancelProblem(req.params.id);
      res.json(problem);
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: err.message });
    }
  }
}

module.exports = new ProblemController();
