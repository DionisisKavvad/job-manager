const TASK_ID_PATTERN = /^[a-zA-Z0-9-_]{1,128}$/;

export function validateDag(tasks, options = {}) {
  const errors = [];
  const existingIds = options.existingIds || new Set();

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { valid: false, errors: ['tasks must be a non-empty array'] };
  }

  if (tasks.length > 50) {
    return { valid: false, errors: [`Too many tasks: ${tasks.length} (max 50)`] };
  }

  const taskIds = new Set();
  for (const task of tasks) {
    if (!task.taskId || !TASK_ID_PATTERN.test(task.taskId)) {
      errors.push(`Invalid taskId: "${task.taskId}" — must match ${TASK_ID_PATTERN}`);
      continue;
    }
    if (taskIds.has(task.taskId) || existingIds.has(task.taskId)) {
      errors.push(`Duplicate taskId: ${task.taskId}`);
    }
    taskIds.add(task.taskId);

    if (!task.name || typeof task.name !== 'string') {
      errors.push(`Task ${task.taskId}: name is required`);
    }
    if (!task.description || typeof task.description !== 'string') {
      errors.push(`Task ${task.taskId}: description is required`);
    }
    if (!task.tag || typeof task.tag !== 'string') {
      errors.push(`Task ${task.taskId}: tag is required`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Dependency reference validation
  const allKnownIds = new Set([...taskIds, ...existingIds]);

  for (const task of tasks) {
    for (const depId of (task.dependsOn || [])) {
      if (!allKnownIds.has(depId)) {
        errors.push(`Task ${task.taskId} depends on "${depId}" which does not exist`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Cycle detection — Kahn's algorithm
  const inDegree = {};
  const adjacency = {};

  for (const task of tasks) {
    inDegree[task.taskId] = 0;
    adjacency[task.taskId] = [];
  }

  for (const task of tasks) {
    for (const depId of (task.dependsOn || [])) {
      if (taskIds.has(depId)) {
        adjacency[depId].push(task.taskId);
        inDegree[task.taskId]++;
      }
    }
  }

  const queue = [];
  for (const task of tasks) {
    if (inDegree[task.taskId] === 0) {
      queue.push(task.taskId);
    }
  }

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);

    for (const neighbor of adjacency[current]) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (order.length !== tasks.length) {
    const inCycle = tasks
      .filter(t => !order.includes(t.taskId))
      .map(t => t.taskId);
    errors.push(`Cycle detected involving: ${inCycle.join(', ')}`);
    return { valid: false, errors };
  }

  // At least one root task
  const hasRoot = tasks.some(t => !t.dependsOn || t.dependsOn.length === 0);
  if (!hasRoot && existingIds.size === 0) {
    errors.push('At least one root task (empty dependsOn) is required');
    return { valid: false, errors };
  }

  return { valid: true, errors: [], order };
}
