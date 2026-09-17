import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt, decodeResult, conversationTurn } from "../mcp-client/src/prompts.mjs";
test("Names and explicit organization survive prompt parsing",()=>{
  assert.deepEqual(parsePrompt('Read project "Project 1" in My Homes'),{name:"get_project",arguments:{projectName:"Project 1",organizationId:"my-homes"}});
  assert.deepEqual(parsePrompt("Get project Sunrise Towers"),{name:"get_project",arguments:{projectName:"Sunrise Towers"}});
  assert.deepEqual(parsePrompt('Create a project called "Aurora Heights" in Green Builders with description "New tower"'),{name:"create_project",arguments:{name:"Aurora Heights",description:"New tower",organizationId:"green-builders"}});
});

const context={tools:["get_project","update_project","create_project"],organizationId:"my-homes",organizationName:"My Homes"};
test("Update conversation gathers details and requires explicit confirmation",()=>{
  let turn=conversationTurn("Can you update project Sunrise Towers?",null,context);
  assert.equal(turn.state.stage,"change");assert.equal(turn.call,undefined);
  turn=conversationTurn("description",turn.state,context);
  assert.equal(turn.state.stage,"description");
  turn=conversationTurn("Construction starts in October.",turn.state,context);
  assert.equal(turn.state.stage,"confirm");assert.equal(turn.call,undefined);
  assert.equal(conversationTurn("maybe",turn.state,context).call,undefined);
  const result=conversationTurn("yes",turn.state,context);
  assert.deepEqual(result.call,{name:"update_project",arguments:{projectName:"Sunrise Towers",description:"Construction starts in October."}});
});
test("Create conversation supports missing name, description, cancellation and explicit cross-org intent",()=>{
  let turn=conversationTurn("I want to create a project",null,context);
  assert.equal(turn.state.stage,"project");
  turn=conversationTurn('"New Homes" in Green Builders',turn.state,context);
  assert.equal(turn.state.stage,"description");
  turn=conversationTurn("skip",turn.state,context);
  assert.equal(turn.state.call.arguments.organizationId,"green-builders");
  assert.equal(conversationTurn("cancel",turn.state,context).state,null);
  assert.equal(conversationTurn("yes in My Homes",turn.state,context).call,undefined);
  assert.equal(conversationTurn("yes",turn.state,context).call.arguments.organizationId,"green-builders");
});
test("Read-only agents cannot enter update workflow and previous project references keep their ID",()=>{
  assert.equal(conversationTurn("Update project A",null,{...context,tools:["get_project"]}).status,"TOOL UNAVAILABLE");
  assert.deepEqual(conversationTurn("read it",null,{...context,lastProject:{id:"project-123",organizationId:"my-homes"}}).call,
    {name:"get_project",arguments:{projectName:"project-123",organizationId:"my-homes"}});
  assert.deepEqual(parsePrompt('Rename project "Sunrise Towers" to "Sunrise Gardens"'),{name:"update_project",arguments:{name:"Sunrise Gardens",projectName:"Sunrise Towers"}});
});
test("Incomplete and unknown organization prompts do not silently create projects",()=>{
  assert.throws(()=>parsePrompt("Create project"),/name/);
  assert.throws(()=>parsePrompt("Create project Aurora in Unknown Org"),/My Homes/);
  assert.throws(()=>parsePrompt("Do something"),/Try/);
});
test("Operational errors are not displayed as OpenFGA denials",()=>{
  assert.equal(decodeResult({isError:true,content:[{type:"text",text:JSON.stringify({message:"Service unavailable"})}]}).status,"ERROR");
  assert.equal(decodeResult({isError:true,content:[{type:"text",text:JSON.stringify({allowed:false,checks:[]})}]}).status,"DENIED");
});
