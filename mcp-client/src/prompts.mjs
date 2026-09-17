const organizations = new Map([
  ["my homes", "my-homes"], ["my-homes", "my-homes"],
  ["green builders", "green-builders"], ["green-builders", "green-builders"],
]);
const unquote = value => value.trim().replace(/^["“']|["”']$/g, "").trim();
const clean = input => input.trim().replace(/[.!?]$/, "").replace(/^(?:(?:hi|hey|hello)[,!]?\s+)?(?:(?:can|could|would) you\s+|(?:i want|i would like|i'd like) to\s+)?(?:please\s+)?/i,"");
const names = {create_project:"create",get_project:"read",update_project:"update"};

function intent(input) {
  const command = clean(input).match(/^(create|add|read|get|show|fetch|update|edit|rename)\s+(?:me\s+)?(?:(?:a|the|new)\s+)*project\b\s*(.*)$/i);
  if (!command) throw new Error('Try: Read project "Sunrise Towers", Create project "Aurora Heights", or Update project "Sunrise Towers".');
  const verb=command[1].toLowerCase();
  const name=["create","add"].includes(verb)?"create_project":["update","edit","rename"].includes(verb)?"update_project":"get_project";
  let text=command[2].replace(/^(?:called|named)\s+/i,"").trim();
  const args={};
  const description=text.match(/\s+(?:with\s+|set\s+)?description\s+(?:to\s+)?(.+)$/i);
  if(description){args.description=unquote(description[1]);text=text.slice(0,description.index).trim();}
  if(name==="update_project"){
    const rename=text.match(verb==="rename"?/\s+to\s+(.+)$/i:/\s+(?:with\s+|set\s+)?(?:name|rename)\s+to\s+(.+)$/i);
    if(rename){args.name=unquote(rename[1]);text=text.slice(0,rename.index).trim();}
  }
  let project,target;
  const quoted=text.match(/^["“'](.+?)["”'](?:\s+in\s+(.+))?$/i);
  if(quoted){project=quoted[1];target=quoted[2];}
  else {const scoped=text.match(/^(.*?)\s+in\s+(.+)$/i);project=scoped?scoped[1]:text;target=scoped?.[2];}
  if(target){
    args.organizationId=organizations.get(unquote(target).toLowerCase());
    if(!args.organizationId)throw new Error("Use My Homes or Green Builders as the target organization.");
  }
  if(project?.trim())args[name==="create_project"?"name":"projectName"]=unquote(project);
  return {name,arguments:args};
}
export function parsePrompt(input){
  const call=intent(input);
  if(!call.arguments[call.name==="create_project"?"name":"projectName"])throw new Error("Please include a project name.");
  if(call.name==="update_project" && call.arguments.name===undefined && call.arguments.description===undefined)
    throw new Error("Please include the new name or description.");
  return call;
}
function nextStep(call,context){
  const args=call.arguments,field=call.name==="create_project"?"name":"projectName";
  if(!args[field])return {state:{call,stage:"project"},status:"INPUT NEEDED",reply:"Which project "+(call.name==="create_project"?"name would you like to use?":"would you like to "+names[call.name]+"?")+" Enter its exact name."};
  if(call.name==="get_project")return {state:null,call};
  if(call.name==="create_project" && args.description===undefined)
    return {state:{call,stage:"description"},status:"INPUT NEEDED",reply:"What description should I use for “"+args.name+"”? You can say skip."};
  if(call.name==="update_project" && args.name===undefined && args.description===undefined)
    return {state:{call,stage:"change"},status:"INPUT NEEDED",reply:"What would you like to change? Say description or name, or enter: description to your new text."};
  const org=[...organizations].find(([label,id])=>id===(args.organizationId??context.organizationId))?.[0]??context.organizationName;
  const target=args.projectName??args.name;
  const changes=[call.name==="update_project"&&args.name!==undefined?"New name: "+args.name:null,args.description!==undefined?"Description: "+(args.description||"(empty)"):null].filter(Boolean).join("\n");
  return {state:{call,stage:"confirm"},status:"CONFIRMATION",reply:"Please confirm: "+names[call.name]+" project “"+target+"” in "+org+".\n"+changes+"\nReply yes to proceed or cancel. OpenFGA will check permission before any change."};
}
// Local guided conversation, not an LLM. Pending requests never execute implicitly.
export function conversationTurn(input,pending,context={}){
  const text=input.trim();
  if(/^(cancel|stop|never mind|nevermind|no)$/i.test(text))
    return {state:null,status:"CANCELLED",reply:"Cancelled. Nothing was changed. What would you like to do next?"};
  if(/^(hi|hey|hello|help|what can you do)[!?.]?$/i.test(text))
    return {state:pending,status:"READY",reply:"I can help with "+(context.tools??[]).map(n=>names[n]+" projects").join(", ")+". Try “Can you update project Sunrise Towers?” I will ask for missing details and confirm changes. Say cancel to start over."};
  let call;
  const start=/^(create|add|read|get|show|fetch|update|edit|rename)\s+(?:me\s+)?(?:(?:a|the|new)\s+)*project\b/i.test(clean(text));
  if(/^(read|show|get)(?: me)? (it|that|the last project)[.!?]?$/i.test(clean(text)) && context.lastProject)
    call={name:"get_project",arguments:{projectName:context.lastProject.id,organizationId:context.lastProject.organizationId}};
  else if(start || !pending){
    try{call=intent(text);}catch(e){return {state:pending,status:"INPUT NEEDED",reply:e.message};}
  } else {
    call=structuredClone(pending.call);
    if(pending.stage==="confirm"){
      if(/^(yes|confirm|go ahead|proceed|yes please)[.!]?$/i.test(text))return {state:null,call};
      return {state:pending,status:"CONFIRMATION",reply:"Reply yes to approve the exact change above, or cancel. You can also start a new create/read/update request."};
    }
    if(pending.stage==="project"){
      // Reuse the parser for optional organization scoping on follow-up names.
      try{const parsed=intent(names[call.name]+" project "+text);Object.assign(call.arguments,parsed.arguments);}
      catch(e){return {state:pending,status:"INPUT NEEDED",reply:e.message};}
    } else if(pending.stage==="change"){
      if(/^(description|name)$/i.test(text))
        return {state:{call,stage:text.toLowerCase()==="name"?"newName":"description"},status:"INPUT NEEDED",reply:"What should the new "+text.toLowerCase()+" be?"};
      const change=text.match(/^(?:set\s+)?(description|name)\s+(?:to\s+)?(.+)$/i);
      if(!change)return {state:pending,status:"INPUT NEEDED",reply:"For this demo, choose name or description. For example: description to Construction starts in October."};
      call.arguments[change[1].toLowerCase()]=unquote(change[2]);
    } else if(pending.stage==="description")call.arguments.description=/^skip$/i.test(text)?"":unquote(text);
    else if(pending.stage==="newName")call.arguments.name=unquote(text);
  }
  if(context.tools && !context.tools.includes(call.name))
    return {state:null,status:"TOOL UNAVAILABLE",reply:"This agent does not expose "+call.name+". Select an agent with that tool permission. No tool was called."};
  return nextStep(call,context);
}
export function explainResult(result,call){
  if(result.status==="DENIED"){
    const failed=result.checks?.filter(c=>!c.allowed).map(c=>c.relation).join(", ");
    return "OpenFGA denied this request"+(failed?" ("+failed+")":"")+". No project was changed. Tool access and organization membership do not grant access to every project. Ask the administrator to assign the specific permission.";
  }
  if(result.status!=="ALLOWED")return result.message??"The request could not be completed.";
  const verb={create_project:"created",get_project:"retrieved",update_project:"updated"}[call.name];
  return "I "+verb+" “"+result.project.name+"” successfully. OpenFGA approved the required permissions."+
    (call.name==="update_project"?" Only the requested fields were changed.":"")+
    (call.name==="get_project"?" Here are its details.":" You can inspect the result in the platform.");
}
export function decodeResult(result) {
  const text = result.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "";
  let body;
  try { body = JSON.parse(text); } catch { return { status: "ERROR", message: text || "No result returned." }; }
  // A transport, validation, or missing-project error is not an OpenFGA denial.
  const status = body.allowed === false ? "DENIED" :
    body.allowed === true && !result.isError ? "ALLOWED" : "ERROR";
  return { ...body, status, message: body.message ?? (body.project ? body.project.name : text) };
}
