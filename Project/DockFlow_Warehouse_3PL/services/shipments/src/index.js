import express from 'express';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Kafka } from 'kafkajs';

const app=express();app.use(express.json());
const pool=mysql.createPool({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'dockflow',password:process.env.DB_PASSWORD||'dockflow_local',database:process.env.DB_NAME||'dockflow',waitForConnections:true,connectionLimit:5});
const kafka=new Kafka({clientId:'dockflow-shipments',brokers:[process.env.KAFKA_BROKER||'localhost:9092'],retry:{initialRetryTime:500,maxRetryTime:10000,retries:12}});
const producer=kafka.producer();
const secret=()=>process.env.JWT_SECRET||'local-only-replace-this-secret-before-deploying';
function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||'').replace(/^Bearer\s+/i,''),secret());next()}catch{return res.status(401).json({error:'Please sign in to continue.'})}}
function allow(...roles){return(req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'Your role cannot perform this action.'})}
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

async function start(){
  for(let n=0;n<60;n++)try{await pool.query('SELECT 1');await producer.connect();break}catch(e){if(n===59)throw e;await new Promise(r=>setTimeout(r,2000))}
  await pool.query(`CREATE TABLE IF NOT EXISTS shipment_events (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, shipment_id BIGINT UNSIGNED NOT NULL, tracking_code VARCHAR(40) NOT NULL, status VARCHAR(40) NOT NULL, actor_email VARCHAR(190), payload JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_shipment_events_created(created_at), FOREIGN KEY (shipment_id) REFERENCES shipments(id))`);
  const consumer=kafka.consumer({groupId:'dockflow-shipment-audit'});
  await consumer.connect();await consumer.subscribe({topic:'shipment.status.updated',fromBeginning:true});
  await consumer.run({eachMessage:async({message})=>{if(!message.value)return;const event=JSON.parse(message.value.toString());await pool.execute('INSERT INTO shipment_events(shipment_id,tracking_code,status,actor_email,payload) VALUES(?,?,?,?,?)',[event.shipment_id,event.tracking_code,event.status,event.actor_email,JSON.stringify(event)]);}});
  app.listen(Number(process.env.PORT||4100),()=>console.log('DockFlow shipment service listening'));
}

app.get('/health',route(async(_req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',service:'DockFlow Shipment Service',events:'Kafka'});}));
app.get('/shipments',auth,route(async(req,res)=>{
  let sql=`SELECT s.id,s.tracking_code,s.status,s.destination,s.eta,o.order_number,p.name provider,p.id provider_id FROM shipments s JOIN orders o ON o.id=s.order_id LEFT JOIN providers p ON p.id=s.provider_id`;
  const params=[];if(req.user.role==='provider'){sql+=' WHERE s.provider_id=?';params.push(req.user.providerId)}
  sql+=' ORDER BY s.updated_at DESC LIMIT 200';const [rows]=await pool.execute(sql,params);res.json(rows);
}));
app.patch('/shipments/:id/status',auth,allow('admin','warehouse','provider'),route(async(req,res)=>{
  const parsed=z.object({status:z.enum(['Label created','Ready for pickup','In transit','Out for delivery','Delivered','Exception'])}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Choose a valid shipment status.'});
  const [rows]=await pool.execute('SELECT s.id,s.tracking_code,s.provider_id,s.order_id,s.destination FROM shipments s WHERE s.id=?',[req.params.id]);
  if(!rows.length)return res.status(404).json({error:'Shipment not found.'});
  const shipment=rows[0];if(req.user.role==='provider'&&shipment.provider_id!==req.user.providerId)return res.status(403).json({error:'This shipment is not assigned to your provider.'});
  await pool.execute('UPDATE shipments SET status=? WHERE id=?',[parsed.data.status,shipment.id]);
  if(parsed.data.status==='Delivered')await pool.execute("UPDATE orders SET status='Delivered' WHERE id=?",[shipment.order_id]);
  const event={event_id:`shipment-${shipment.id}-${Date.now()}`,shipment_id:shipment.id,tracking_code:shipment.tracking_code,status:parsed.data.status,destination:shipment.destination,actor:req.user.email,actor_email:req.user.email,occurred_at:new Date().toISOString(),source:'DockFlow shipment service'};
  await producer.send({topic:'shipment.status.updated',messages:[{key:String(shipment.id),value:JSON.stringify(event)}]});
  try{await fetch(`${process.env.INSIGHTS_URL||'http://localhost:8000'}/internal/events`,{method:'POST',headers:{'content-type':'application/json','x-service-key':process.env.SERVICE_KEY||'dockflow-local-service-key'},body:JSON.stringify(event)})}catch(e){console.error('Mongo carrier event sync deferred:',e.message)}
  await pool.execute('INSERT INTO activity_log(actor_id,entity_type,entity_id,action,details) VALUES(?,?,?,?,?)',[req.user.id,'shipment',shipment.id,'Shipment status updated',JSON.stringify({status:parsed.data.status})]);
  res.json({ok:true,event_id:event.event_id});
}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Shipment service request failed.'})});
start().catch(e=>{console.error('Shipment service could not start:',e);process.exit(1)});
