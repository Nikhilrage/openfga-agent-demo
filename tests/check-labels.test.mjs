import { test } from "node:test";
import assert from "node:assert/strict";
import { labelChecks } from "../mcp-client/src/check-labels.mjs";

const user={id:"admin-1",name:"Aarav Sharma",organizations:[{id:"my-homes",name:"My Homes"}]};
const agents=[{id:"agent-1",name:"Project Reader",projects:[{id:"a",name:"Project A"}]}];
test("Readable names replace user, agent, tool and denied project IDs without changing decisions",()=>{
  const checks=[
    {user:"user:admin-1",relation:"can_use",object:"agent:agent-1",allowed:true},
    {user:"agent:agent-1",relation:"can_execute",object:"tool:read-project",allowed:true},
    {user:"agent:agent-1",relation:"can_view",object:"project:b",allowed:false},
  ];
  const result=labelChecks(checks,{user,agents,projects:[{id:"b",name:"Lake View"}]});
  assert.equal(result[0].userLabel,"Aarav Sharma");
  assert.equal(result[0].objectLabel,"Project Reader");
  assert.equal(result[1].objectLabel,"Read Project");
  assert.equal(result[2].objectLabel,"Lake View");
  assert.equal(result[2].allowed,false);
  assert.equal(result[2].object,"project:b");
  assert.equal(checks[0].userLabel,undefined);
});
test("Renamed result wins over cached name; organization names and unknown resources are safe",()=>{
  const checks=[{user:"agent:agent-1",relation:"can_update",object:"project:a",allowed:true}];
  assert.equal(labelChecks(checks,{user,agents,project:{id:"a",name:"Renamed Project"}})[0].objectLabel,"Renamed Project");
  assert.equal(labelChecks([{user:"agent:agent-1",object:"organization:my-homes"}],{user,agents})[0].objectLabel,"My Homes");
  assert.equal(labelChecks([{user:"agent:unknown",object:"project:secret-id"}],{user,agents})[0].objectLabel,"Project (name unavailable)");
});
