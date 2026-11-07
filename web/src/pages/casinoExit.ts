type ExitTarget={
 releaseDisplay:()=>void|Promise<unknown>;
 closeWallet:()=>unknown|Promise<unknown>;
 refreshWallet:()=>unknown|Promise<unknown>;
 navigate:()=>void;
};

/** Navigation never waits for wallet HTTP or a browser fullscreen promise. */
export function createCasinoExitController(target:ExitTarget){
 let leaving=false;
 return ()=>{
  if(leaving)return;
  leaving=true;
  try{void Promise.resolve(target.releaseDisplay()).catch(()=>{});}catch{}
  let close:Promise<unknown>;
  try{close=Promise.resolve(target.closeWallet());}catch{close=Promise.resolve();}
  // Pending wins are durable and also collected at the next game launch.
  // Refresh after collection, without keeping the player trapped in the frame.
  void close.catch(()=>{}).then(()=>target.refreshWallet()).catch(()=>{});
  target.navigate();
 };
}
