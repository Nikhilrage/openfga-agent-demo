// Names come only from data already visible to the signed-in person.
// Keep the original tuple identifiers unchanged for technical inspection.
export function labelChecks(checks = [], { user, agents = [], projects = [], project } = {}) {
  const names = new Map([
    ["tool:read-project", "Read Project"],
    ["tool:create-project", "Create Project"],
    ["tool:update-project", "Update Project"],
  ]);
  if (user) names.set("user:" + user.id, user.name);
  for (const org of user?.organizations ?? []) names.set("organization:" + org.id, org.name);
  for (const agent of agents) {
    names.set("agent:" + agent.id, agent.name);
    if (agent.organizationName) names.set("organization:" + agent.organizationId, agent.organizationName);
    for (const assigned of agent.projects ?? []) names.set("project:" + assigned.id, assigned.name);
  }
  for (const item of projects) names.set("project:" + item.id, item.name);
  // The operation result is freshest, particularly after renaming a project.
  if (project) names.set("project:" + project.id, project.name);
  const fallback = { user: "User", agent: "Agent", project: "Project", organization: "Organization", tool: "Tool" };
  const label = id => names.get(id) ?? (fallback[id.split(":")[0]] ?? "Resource") + " (name unavailable)";
  return checks.map(check => ({ ...check, userLabel: label(check.user), objectLabel: label(check.object) }));
}
