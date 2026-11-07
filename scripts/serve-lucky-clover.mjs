import express from 'express';
import { fileURLToPath } from 'node:url';
import { createCtProtocolRouter } from '../server/casino/clover-ct-router.mjs';
const app=express();
app.use('/app/api/casino/luckycloverx3',createCtProtocolRouter());
app.use('/app',express.static(fileURLToPath(new URL('../web/public/',import.meta.url))));
app.get('/',(_req,res)=>res.redirect('/app/casino-original/lucky-clover-x3/index.html'));
const port=Number(process.env.CLOVER_PORT||3317);
app.listen(port,'127.0.0.1',()=>console.log(`Lucky Clover X3: http://127.0.0.1:${port}/`));
