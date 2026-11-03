"use client";
import{FormEvent,useEffect,useRef,useState}from"react";
// The privacy screens' own dialog, in place of the browser's prompt/confirm: labelled fields, required reasons with a
// minimum length, a summary of what will happen and, for large deletions, a typed confirmation.
export type DialogField={key:string;label:string;type?:"text"|"textarea"|"number"|"select"|"email";min?:number;required?:boolean;options?:Array<[string,string]>;inputMode?:"numeric"|"text";placeholder?:string;hint?:string;initial?:string};
export type DialogSpec={title:string;description?:string;fields?:DialogField[];submitLabel?:string;summary?:Array<[string,string|number]>;confirmPhrase?:string;danger?:boolean};
export type DialogValues=Record<string,string>;

export function DecisionDialog({spec,onClose}:{spec:DialogSpec;onClose:(values:DialogValues|null)=>void}){
  const fields=spec.fields||[],[values,setValues]=useState<DialogValues>(()=>Object.fromEntries(fields.map(f=>[f.key,f.initial??(f.type==="select"?f.options?.[0]?.[0]||"":"")]))),[typed,setTyped]=useState(""),[error,setError]=useState("");
  const box=useRef<HTMLDivElement>(null),previous=useRef<Element|null>(null);
  useEffect(()=>{previous.current=document.activeElement;const first=box.current?.querySelector<HTMLElement>("input,textarea,select,button");first?.focus();return()=>{(previous.current as HTMLElement|null)?.focus?.()}},[]);
  // Tab stays inside the dialog and Esc cancels, so keyboard and screen reader users never land behind it.
  function onKey(e:React.KeyboardEvent){if(e.key==="Escape"){e.preventDefault();onClose(null);return}
    if(e.key!=="Tab"||!box.current)return;const items=[...box.current.querySelectorAll<HTMLElement>("input,textarea,select,button")].filter(x=>!x.hasAttribute("disabled"));if(!items.length)return;
    const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
  function submit(e:FormEvent){e.preventDefault();
    for(const f of fields){const v=String(values[f.key]||"").trim();if((f.required??Boolean(f.min))&&!v){setError(`Preencha: ${f.label}.`);return}if(f.min&&v.length<f.min){setError(`${f.label}: escreva pelo menos ${f.min} caracteres.`);return}if(f.type==="number"&&v&&!/^\d+$/.test(v)){setError(`${f.label}: use só números.`);return}if(f.type==="email"&&v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)){setError(`${f.label}: e-mail inválido.`);return}}
    if(spec.confirmPhrase&&typed.trim().toUpperCase()!==spec.confirmPhrase){setError(`Digite ${spec.confirmPhrase} para confirmar.`);return}
    onClose(Object.fromEntries(Object.entries(values).map(([k,v])=>[k,String(v).trim()])))}
  const titleId="privacy-dialog-title",descId="privacy-dialog-desc";
  return <div className="soc-modal" onKeyDown={onKey}><div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={spec.description?descId:undefined}>
    <header><h2 id={titleId}>{spec.title}</h2><button type="button" aria-label="Fechar" onClick={()=>onClose(null)}>×</button></header>
    {spec.description&&<p id={descId} className="soc-muted">{spec.description}</p>}
    {spec.summary&&<dl className="privacy-summary">{spec.summary.map(([k,v])=><div key={k} className="soc-row"><dt>{k}</dt><dd><b>{v}</b></dd></div>)}</dl>}
    <form className="soc-form" onSubmit={submit} noValidate>
      {fields.map(f=>{const id=`privacy-field-${f.key}`,common={id,value:values[f.key]||"",onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>setValues({...values,[f.key]:e.target.value}),"aria-describedby":f.hint?`${id}-hint`:undefined,required:f.required??Boolean(f.min)};
        return <label key={f.key} htmlFor={id}>{f.label}{f.type==="textarea"?<textarea {...common} rows={4} placeholder={f.placeholder}/>:f.type==="select"?<select {...common}>{(f.options||[]).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>:<input {...common} type={f.type==="email"?"email":"text"} inputMode={f.type==="number"?"numeric":f.inputMode} placeholder={f.placeholder}/>}{f.hint&&<small id={`${id}-hint`} className="soc-muted">{f.hint}</small>}</label>})}
      {spec.confirmPhrase&&<label htmlFor="privacy-confirm-phrase">Para confirmar, digite <strong>{spec.confirmPhrase}</strong><input id="privacy-confirm-phrase" value={typed} onChange={e=>setTyped(e.target.value)} autoComplete="off"/></label>}
      <p role="alert" aria-live="assertive" className={error?"soc-notice":"soc-muted"}>{error}</p>
      <div className="soc-toolbar"><button type="button" onClick={()=>onClose(null)}>Cancelar</button><button type="submit" className={spec.danger?"primary":"active"}>{spec.submitLabel||"Confirmar"}</button></div>
    </form>
  </div></div>;
}
