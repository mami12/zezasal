/** Password rules at account creation/change, not at login.
 * Existing password hashes remain valid; staff roles keep stronger minimums.
 * Player accounts accept an ASCII letter/digit code of 3–10 characters.
 */
export const PLAYER_PASSWORD_PATTERN=/^[A-Za-z0-9]{3,10}$/;
export function assertAccountPassword(value,role,{staffMin=6}={}){
 const password=String(value??'');
 if(role==='PLAYER'){
  if(!PLAYER_PASSWORD_PATTERN.test(password)){
   throw Object.assign(
    new Error('Fjalëkalimi i lojtarit duhet të ketë 3–10 shkronja ose shifra (pa hapësira apo simbole).'),
    {status:400,code:'PLAYER_PASSWORD_INVALID'});
  }
 }else if(password.length<staffMin){
  throw Object.assign(
   new Error('Fjalëkalimi i stafit duhet të ketë të paktën '+staffMin+' karaktere.'),
   {status:400,code:'STAFF_PASSWORD_TOO_SHORT'});
 }
 return password;
}
