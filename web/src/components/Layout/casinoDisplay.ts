type DisplayTarget={
 isFullscreen:()=>boolean;
 isLandscape:()=>boolean;
 requestFullscreen:()=>Promise<void>|void;
 lockLandscape:()=>Promise<void>|void;
 unlock:()=>void;
 exitFullscreen:()=>Promise<void>|void;
};

/** One automatic native display attempt per game; the toolbar can explicitly retry. */
export function createCasinoDisplayController(target:DisplayTarget){
 let generation=0,automaticRequested=false,wantNative=false;
 let pending:Promise<void>|null=null,exiting:Promise<void>|null=null;
 const cleanIfUnwanted=()=>{
  if(wantNative)return;
  try{target.unlock();}catch{}
  try{
   if(target.isFullscreen()&&!exiting){
    const result=target.exitFullscreen();
    const task=Promise.resolve(result).catch(()=>{}).finally(()=>{if(exiting===task)exiting=null;});
    exiting=task;
   }
  }catch{}
 };
 const request=({retry=false}:{retry?:boolean}={})=>{
  if(pending)return pending;
  if(automaticRequested&&!retry)return Promise.resolve();
  automaticRequested=true;wantNative=true;
  const current=generation,barrier=exiting;
  const run=async()=>{
   if(barrier)await barrier;
   if(current!==generation){cleanIfUnwanted();return;}
   try{if(!target.isFullscreen())await target.requestFullscreen();}catch{/* CSS landscape remains available. */}
   if(current!==generation){cleanIfUnwanted();return;}
   try{if(!target.isLandscape())await target.lockLandscape();}catch{/* Unsupported or denied by the browser. */}
   if(current!==generation)cleanIfUnwanted();
  };
  const task=run().finally(()=>{if(pending===task)pending=null;});
  pending=task;
  return task;
 };
 const release=({keepSession=false}:{keepSession?:boolean}={})=>{
  // Back must remain usable even if a browser entry/lock/exit promise hangs.
  // Detached old work cleans itself when it settles, unless a newer game wants
  // native display. Only the newest intent owns fullscreen and orientation.
  generation++;automaticRequested=keepSession;wantNative=false;pending=null;
  cleanIfUnwanted();
  return Promise.resolve();
 };
 return {request,release};
}
