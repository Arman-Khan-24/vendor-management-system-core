import { Router } from 'express';
import { z } from 'zod';
import { authenticate,requireRoles } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import type { LocalDemoService } from '../services/local-demo.service.js';

const messageSchema=z.object({customerId:z.string().uuid(),text:z.string().trim().max(10000).default(''),
  image:z.object({data:z.string().min(1).max(7*1024*1024),mimeType:z.enum(['image/jpeg','image/png'])}).strict().optional()
}).strict().refine(input=>!!input.image || !!input.text,'Enter a message or select a photo.');

export function createLocalDemoRouter(demo: LocalDemoService) {
  const router=Router();
  router.use((req,res,next)=>{
    const address=req.socket.remoteAddress;
    const host=req.hostname;
    const origin=req.get('Origin');
    const allowedOrigins=['http://127.0.0.1:5174','http://localhost:5174','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:5100','http://localhost:5100'];
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address||'') || !['localhost','127.0.0.1'].includes(host) || origin && !allowedOrigins.includes(origin))return next(new AppError('Local test access is limited to localhost.',403));
    res.set('Cache-Control','no-store');next();
  });
  router.get('/status',(_req,res)=>res.json(demo.status()));
  router.post('/session',(req,res,next)=>{
    if(req.get('X-OrderLedger-Local-Demo')!=='1')return next(new AppError('Open the local demo from the sign-in screen.',403));
    res.json(demo.session);
  });
  router.use(authenticate,requireRoles('OWNER'));
  router.post('/messages',validateBody(messageSchema),async(req,res,next)=>{
    try {
      if(req.businessId!==demo.session.business.id)throw new AppError('Choose the disposable local business.',403);
      res.status(202).json(await demo.enqueue(req.body.customerId,req.body.text,req.body.image));
    }catch(error){next(error);}
  });
  return router;
}
