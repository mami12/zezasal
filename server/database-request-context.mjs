import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export function withDatabaseRequest(database,generation,fn){
  return Number.isInteger(generation)?context.run({database,generation},fn):fn();
}
export function assertDatabaseRequestCurrent(database,generation){
  const request=context.getStore();
  if(request?.database===database&&request.generation!==generation)throw Object.assign(new Error('Sesioni përfundoi pas zerimit financiar. Identifikohu përsëri.'),{status:401,code:'FINANCIAL_SESSION_RESET'});
}
export const outsideDatabaseRequest=fn=>context.exit(fn);
