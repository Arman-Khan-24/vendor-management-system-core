import type { Express } from 'express';
import { IncomingMessage,ServerResponse } from 'node:http';
import { Duplex } from 'node:stream';

/** Exercise real Express middleware and raw-body parsing without a listening socket. */
export async function requestInProcess(app: Express,method: string,path: string,body='',headers: Record<string,string>={},remoteAddress='127.0.0.1') {
  const chunks: Buffer[]=[];
  const socket=new Duplex({read(){},write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});
  Object.defineProperty(socket,'remoteAddress',{value:remoteAddress});
  const req=new IncomingMessage(socket as any);
  req.method=method;req.url=path;req.headers={host:'localhost',...headers};
  // A real HTTP parser marks the message complete before stream auto-destruction.
  req.complete=true;
  if(body){req.headers['content-type']='application/json';req.headers['content-length']=String(Buffer.byteLength(body));}
  const res=new ServerResponse(req);res.assignSocket(socket as any);
  const finished=new Promise<void>((resolve,reject)=>{res.once('finish',resolve);res.once('error',reject);});
  app(req,res);
  req.push(body?Buffer.from(body):null);if(body)req.push(null);
  await finished;
  const output=Buffer.concat(chunks).toString('utf8');socket.destroy();
  return {status:res.statusCode,body:output.slice(output.indexOf('\r\n\r\n')+4),headers:res.getHeaders()};
}
