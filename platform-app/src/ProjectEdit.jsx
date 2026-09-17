import { useState } from "react";
import { api } from "./api";
import { Dialog } from "./forms";
export function ProjectEdit({project,close,saved}) {
  const [name,setName]=useState(project.name),[description,setDescription]=useState(project.description??"");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e){
    e.preventDefault();setBusy(true);
    try{await saved(await api("/projects/"+project.id,{method:"PATCH",body:JSON.stringify({name,description})}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <Dialog title="Update project" subtitle={project.organizationName} close={()=>{if(!busy)close();}}><form className="dialog-body form-stack" onSubmit={submit}>
    <label>Project name<input required maxLength={150} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <p>OpenFGA checks your update permission. Organization and ownership stay unchanged.</p>{error&&<p role="alert" className="error">{error}</p>}
    <button disabled={busy} className="primary">{busy?"Saving…":"Save changes"}</button>
  </form></Dialog>;
}
