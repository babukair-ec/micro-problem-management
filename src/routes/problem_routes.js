const express = require('express');
const router = express.Router();
const problemController = require('../controllers/problem_controller');
const { authenticateJwt } = require('../middleware/auth');

router.use(authenticateJwt);

router.get('/', (req, res) => problemController.listProblems(req, res));
router.post('/', (req, res) => problemController.reportProblem(req, res));
router.get('/:id', (req, res) => problemController.getProblem(req, res));
router.post('/:id/create-resolution-task', (req, res) => problemController.createResolutionTask(req, res));
router.post('/:id/assign-resolver', (req, res) => problemController.assignResolver(req, res));
router.post('/:id/start', (req, res) => problemController.startResolution(req, res));
router.post('/:id/resolve', (req, res) => problemController.resolveProblem(req, res));
router.post('/:id/cancel', (req, res) => problemController.cancelProblem(req, res));

module.exports = router;
