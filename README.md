#  OpenFGA Agent Demo

A local, hands-on demonstration of fine-grained authorization for MCP agents using OpenFGA, with project-level permissions and a live relationship graph.

**The focus is authorization, not AI model behavior.** Agents are registered identities with credentials and scoped tool permissions. The conversational MCP client uses a deterministic local parser, not an LLM or an external AI service.

## What this demonstrates

An organization boundary is not enough: an agent must also have permission to use a tool and access the exact project.

- **Create agents** create projects only in their assigned organization.
- **Read agents** read only assigned projects and cannot update them.
- **Update agents** read and update assigned projects, not every project in their organization.
- **Human administrators** can use only agents they own and are authorized to manage.
- **Read-only users** see their assigned projects without administrator capabilities.
- **OpenFGA** evaluates permissions before project operations.
- **Graph** visualizes stored relationships and runs real permission checks without changing projects.

This is a local proof of concept, not a production-ready service.

## Demo scenario

Aarav administers **My Homes**; Meera administers **Green Builders**.

| Identity and request | Expected result |
| --- | --- |
| Aarav's create agent creates in My Homes | Allowed |
| Aarav's create agent creates in Green Builders | Denied |
| Read agent assigned Project A reads Project A | Allowed |
| The same read agent reads Project B in My Homes | Denied |
| The same read agent attempts an update | Update tool unavailable; direct update requests denied |
| Update agent assigned Project B reads or updates Project B | Allowed |
| The same update agent updates Project A | Denied |
| Meera attempts to use Aarav's agent | Denied |

Tool discovery is filtered, but hiding a tool is not the security boundary: the backend still enforces authorization.

## Architecture

```text
Platform UI (5173) ────────────────► Backend API (4000)
  Login, projects, agent registration,       │
  permissions, activity, Graph              ├──► OpenFGA (8080)
                                            │      │
MCP client UI (5174)                         │      ▼
  Guided conversation                       └──► PostgreSQL (55432)
          │
          ▼
MCP server (3006) ─────────────────► Backend API (4000)
  Tool discovery and invocation
```

PostgreSQL and OpenFGA run in Docker. The backend, MCP server, and two UIs run locally through one root npm command.

### Main technologies

| Area | Technologies |
| --- | --- |
| Authorization | OpenFGA; model DSL and JSON; relationship tuples |
| Persistence | PostgreSQL, `pg` |
| Backend | Node.js, Express, `cors`, built-in crypto |
| MCP server and client | Official `@modelcontextprotocol/sdk`, Streamable HTTP |
| Tool input validation | Zod |
| User interfaces | React, Vite |
| Relationship graph | React and SVG; no hosted graph service |
| Development and tests | Concurrently, Node test runner, Playwright |

Dependency versions are recorded in [package.json](package.json) and locked in [package-lock.json](package-lock.json).

## Prerequisites

- Node.js **22.12 or later** and npm.
- Docker Desktop, or Docker Engine with the Compose plugin on Linux.
- Docker must be running before setup or startup.

The documented setup uses the supplied local demo defaults. No AI API key is required.

## First-time setup

From the cloned repository folder:

```bash
npm ci
npm run setup
npm start
```

- `npm ci` installs the locked dependencies.
- `npm run setup` starts Docker, installs the OpenFGA model, creates application tables, and seeds demo accounts and projects.
- `npm start` applies the non-seeding capability migration and starts all four application processes.

Initial setup needs internet access to download dependencies and Docker images.

### Open the applications

| Component | Address |
| --- | --- |
| Platform | http://localhost:5173 |
| MCP client | http://localhost:5174 |
| Backend health | http://localhost:4000/health |
| MCP endpoint for external clients | http://localhost:3006/mcp |
| MCP health | http://localhost:3006/health |
| OpenFGA HTTP API | http://localhost:8080 |
| Optional OpenFGA Playground | http://localhost:3000/playground |
| PostgreSQL host port | `localhost:55432` |

Use the same hostname for both UIs—prefer `localhost`—so they share the sign-in session. Opening the MCP endpoint in a browser is not a tool invocation; it uses MCP POST requests.

## Restart without restoring sample data

For every normal restart:

```bash
docker compose up -d
npm start
```

**Do not rerun setup or reset if you want a cleared workspace to stay empty.** Setup restores sample projects and tuples. `npm start` does not reseed projects or agents.

To stop, press **Ctrl+C** in the application terminal, then:

```bash
docker compose down
```

The named PostgreSQL volume preserves data. Removing Docker volumes removes that persistence.

## Demo accounts

| Person | Email | Role | Organization |
| --- | --- | --- | --- |
| Aarav Sharma | `aarav@myhomes.demo` | Administrator | My Homes |
| Meera Nair | `meera@greenbuilders.demo` | Administrator | Green Builders |
| Riya Patel | `riya@myhomes.demo` | Project viewer | My Homes |

All seeded accounts use the intentionally public **demo-only password**: `Demo@1234`.

Selecting an account card fills its email; enter the password to sign in. Passwords are stored as salted scrypt hashes. Sessions use opaque tokens and an HttpOnly cookie, not a caller-supplied user ID.

Riya's initial project grant is for **Sunrise Towers**. If projects and their tuples were cleared, she has no project access until grants are restored. There is no general human project-grant editor in this POC.

## End-to-end walkthrough

### 1. Prepare projects

1. Sign in to the platform as Aarav.
2. Create **Project A** and **Project B** in My Homes, using **Create as → Me**.
3. Open **Agents → Register agent**.

### 2. Register three agents

| Agent name | Capability | Project selection |
| --- | --- | --- |
| My Homes Creator | Create projects | Organization-scoped; no project assignment |
| Project A Reader | Read projects | Project A only |
| Project B Editor | Update projects | Project B only |

Update agents receive both read and update tools. Read agents never automatically receive update access.

Registration displays connection configuration with a one-time API key. Save it only if connecting an external MCP client; do not commit or share it.

### 3. Test the MCP client

Open http://localhost:5174. If already signed in on the platform, the same session is used. Select an agent and click **Connect agent**.

Only agents the signed-in person can manage appear. The client discovers that agent's permitted tools.

**With Project A Reader:**

```text
Read project Project A
Read project Project B
```

The first is allowed; the second is denied, despite both projects belonging to My Homes.

**With My Homes Creator:**

```text
Create project "Project C" in My Homes with description "Residential development"
yes
```

Then demonstrate the organization boundary:

```text
Create project "Boundary Test" in Green Builders with description "Should be denied"
yes
```

**With Project B Editor, demonstrate a conversation:**

```text
Can you update project Project B?
description
Construction starts in October
yes
```

Then demonstrate project-specific denial:

```text
Update project Project A with description "Should not change"
yes
```

Additional supported interactions:

```text
Rename project "Project B" to "Project B Phase Two"
yes
Read it
```

Say `cancel` to abandon a pending change. Create requests without a description ask for one; `skip` leaves it empty. Updates support **name and description only**; organization and ownership remain unchanged.

This is a guided parser with supported patterns, not unrestricted natural-language understanding. Write confirmation is a client feature; external MCP clients must implement their own confirmation UX.

### 4. Explain the decisions

Expand a tool result to see permission checks with readable person, agent, tool, and project names. **Technical details** retains the raw identifiers and request.

An unknown or inaccessible resource name is not fetched by bypassing authorization.

### 5. Show the graph

In the platform, select **Graph**:

- Nodes represent users, organizations, agents, tools, and projects.
- Arrows represent live OpenFGA relationship tuples.
- Click a node or choose **Focus entity** to inspect its connections.
- The view refreshes every 10 seconds; **Refresh graph** updates it immediately.
- Select an agent, permission, and target to run an actual OpenFGA check without executing a project operation.

The graph is administrator-only and scoped to the current organization. It reads all tuple pages, rather than using a static diagram. It is a custom React/SVG view, not an embedded Playground or an exact visualization of OpenFGA's internal evaluation trace.

### 6. Switch organizations

Sign out and sign in as Meera. Her workspace and agent selection are separate from Aarav's. Repeat the creation and denial examples with Green Builders as the allowed organization.

## How authorization works

Authentication establishes the caller's identity. OpenFGA decides what that identity can do.

| Resource | Important relations and permissions |
| --- | --- |
| Organization | `admin`, `member`, `assigned_agent`, `project_creator`, `can_create_project` |
| Agent | `owner`, `organization`, `can_manage`, `can_use` |
| Tool | `executor`, `can_execute` |
| Project | `organization`, `creator`, `viewer`, `editor`, `can_view`, `can_update` |

A typical update verifies:

1. The signed-in human can use the selected agent.
2. The agent can execute `tool:update-project`.
3. The agent has update permission on the exact project, within the organization boundary.
4. Only then does the backend update the database.

The model allows organization administrators to manage their projects. Agent project permissions are constrained by organization assignment. A create agent's resource-level creator relationship alone is insufficient to invoke read or update tools: the corresponding tool grants are also required.

The backend records permission decisions for **Activity** and fails closed if authorization cannot be completed.

- [Readable OpenFGA model](openfga/model.fga)
- [API model definition](openfga/model.json)
- [Initial demo tuples](openfga/demo-tuples.json)

## Repository structure

```text
backend/src/          Authentication, APIs, persistence, OpenFGA checks
mcp-server/src/       MCP tools and backend integration
mcp-client/src/       Guided conversation and readable permission checks
platform-app/src/     Login, projects, agents, permissions, activity, Graph
openfga/             Authorization model and seed tuples
infrastructure/      PostgreSQL initialization
scripts/             Setup, migration, reset, and integration checks
tests/               Unit and browser tests
compose.yaml         Local PostgreSQL and OpenFGA
```

## Configuration

Defaults are shown in [.env.example](.env.example). Default local setup does not require creating an `.env` file.

Docker Compose reads `.env`, but the Node processes currently use exported environment variables and built-in defaults; they do not automatically load `.env`. If overriding database settings, keep Docker, setup scripts, and application connection settings consistent.

The generated `.openfga-state.json` records local store/model identifiers and is recreated by setup. It is intentionally excluded from Git.

## Validation

With dependencies installed:

```bash
node --test tests/prompts.test.mjs tests/check-labels.test.mjs
npm run platform:build
npm run client:build
```

With the full stack running, install the browser once and run the self-cleaning enhancement tests:

```bash
npx playwright install chromium
npx playwright test tests/browser/enhancements.spec.mjs
```

These cover project-level update permissions, cross-organization denial, graph access, registration, real MCP calls, confirmation, cancellation, and multi-turn interaction. They create temporary fixtures and remove only their own data afterward.

The broader seeded-demo suites are also available:

```bash
npm run demo:verify
npm run platform:test
```

Those suites expect the original seeded projects and may leave additional named test projects/agents. Do not run them just before a clean-workspace demo. Screenshots and traces are saved under ignored `test-results/`.

On Ubuntu, Playwright may also require browser OS dependencies; follow its installation output.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Platform or client does not load | Keep `npm start` running; check its output and that ports 5173/5174 are free |
| Docker connection error | Start Docker Desktop or Docker Engine |
| Missing OpenFGA state on a new clone | Run first-time `npm run setup` |
| Vite warns about Node version | Use Node 22.12 or later |
| No agents in the MCP client | Register one as the current admin, then click **Refresh agents** |
| Update tool is unavailable | Select an update agent; read-only agents cannot update |
| Project exists but access is denied | Check both the tool grant and the agent's assignment to that specific project |
| Old configuration fails | Reset/deletion invalidates old agent credentials; use a newly registered agent |
| Workspace unexpectedly has sample projects | Setup/reset restores seed data; use normal restart commands instead |

Inspect infrastructure logs with:

```bash
docker compose logs --tail=100 openfga postgres
```

## Reset — destructive

Stop the application processes and leave Docker running before using:

```bash
npm run demo:reset
npm start
```

Reset removes registered agents, generated projects, sessions, audit history, and the old OpenFGA store, then restores the seeded baseline. Existing agent API keys cease to work. It is **not** an empty-workspace cleanup command.

## Local-only security notes

- Demo credentials are intentionally public and must never be reused elsewhere.
- Node services bind to loopback. The supplied Docker port mappings publish database/OpenFGA ports on host interfaces; do not expose this stack to an untrusted network.
- Do not forward the database, OpenFGA API, or Playground publicly.
- The built-in graph and conversation require no external AI service. The optional OpenFGA Playground uses a hosted UI; it is not required for this demo.
- Git should contain source, lockfiles, model definitions, and sample configuration—not `node_modules`, builds, runtime state, database volumes, backups, or live API keys.
