import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pool } from './db.js';
import { auth, allow } from './auth.js';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 60000, max: 30 }));
const route = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

app.get('/api/health', route(async (_req,res) => {
  await pool.query('SELECT 1'); res.json({ status: 'ok', service: 'DockFlow API' });
}));
app.post('/api/auth/login', route(async (req,res) => {
  const p = z.object({ email: z.string().email(), password: z.string().min(8) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const [rows] = await pool.execute('SELECT id,name,email,password_hash,role,provider_id FROM users WHERE email=? AND active=1', [p.data.email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(p.data.password,u.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const token = jwt.sign({ id:u.id,name:u.name,email:u.email,role:u.role,providerId:u.provider_id }, process.env.JWT_SECRET || 'local-only-replace-this-secret-before-deploying', { expiresIn:'8h' });
  res.json({ token, user:{ id:u.id,name:u.name,email:u.email,role:u.role } });
}));
app.get('/api/dashboard', auth, allow('admin','warehouse'), route(async (_req,res) => {
  const [[counts]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM products) products,
    (SELECT COUNT(*) FROM orders WHERE status NOT IN ('Delivered','Cancelled')) openOrders,
    (SELECT COUNT(*) FROM shipments WHERE status IN ('Exception','Out for delivery')) attentionShipments,
    (SELECT COUNT(*) FROM products WHERE quantity<=reorder_level) lowStock`);
  const [lowStock] = await pool.query('SELECT p.id,p.sku,p.name,p.quantity,p.reorder_level,w.code warehouse FROM products p JOIN warehouses w ON w.id=p.warehouse_id WHERE p.quantity<=p.reorder_level ORDER BY p.quantity LIMIT 5');
  const [orders] = await pool.query(`SELECT o.id,o.order_number,o.status,o.priority,o.due_date,c.name customer,w.code warehouse FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id ORDER BY FIELD(o.priority,'Urgent','High','Normal'),o.created_at DESC LIMIT 6`);
  const [shipments] = await pool.query(`SELECT s.id,s.tracking_code,s.status,s.destination,s.eta,p.name provider FROM shipments s LEFT JOIN providers p ON p.id=s.provider_id ORDER BY s.updated_at DESC LIMIT 5`);
  res.json({ counts, lowStock, orders, shipments });
}));
app.get('/api/inventory', auth, allow('admin','warehouse'), route(async (req,res) => {
  const q = `%${String(req.query.q || '').slice(0,80)}%`;
  const [rows] = await pool.execute('SELECT p.id,p.sku,p.name,p.department,p.category,p.size,p.color,p.warehouse_id,p.quantity,p.reorder_level,p.unit,w.code warehouse FROM products p JOIN warehouses w ON w.id=p.warehouse_id WHERE p.name LIKE ? OR p.sku LIKE ? OR p.color LIKE ? ORDER BY p.department,p.name,p.size LIMIT 500',[q,q,q]);
  res.json(rows);
}));
const productInput = z.object({sku:z.string().trim().min(2).max(50),name:z.string().trim().min(2).max(160),department:z.enum(['Men','Women','Kids']),category:z.string().trim().min(2).max(80),size:z.string().trim().min(1).max(24),color:z.string().trim().min(2).max(40),warehouse_id:z.coerce.number().int().positive(),quantity:z.coerce.number().int().min(0),reorder_level:z.coerce.number().int().min(0),unit:z.string().trim().min(2).max(24)});
app.post('/api/inventory', auth, allow('admin','warehouse'), route(async (req,res) => {
  const p=productInput.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Check the clothing details and try again.'});
  try{const d=p.data;const [r]=await pool.execute('INSERT INTO products(sku,name,department,category,size,color,warehouse_id,quantity,reorder_level,unit) VALUES(?,?,?,?,?,?,?,?,?,?)',[d.sku,d.name,d.department,d.category,d.size,d.color,d.warehouse_id,d.quantity,d.reorder_level,d.unit]);
    await pool.execute('INSERT INTO activity_log(actor_id,entity_type,entity_id,action,details) VALUES(?,?,?,?,?)',[req.user.id,'inventory',r.insertId,'Clothing variant added',JSON.stringify({sku:d.sku})]);res.status(201).json({id:r.insertId});
  }catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That SKU already exists. Give this size and color combination its own SKU.'});throw e;}
}));
app.patch('/api/inventory/:id', auth, allow('admin','warehouse'), route(async (req,res) => {
  const p=productInput.partial().safeParse(req.body);if(!p.success||!Object.keys(p.data||{}).length)return res.status(400).json({error:'Enter valid clothing details to update.'});
  const [[existing]]=await pool.execute('SELECT id FROM products WHERE id=?',[req.params.id]);if(!existing)return res.status(404).json({error:'Clothing variant not found.'});
  const fields=Object.keys(p.data);const values=fields.map(k=>p.data[k]);
  try{await pool.execute(`UPDATE products SET ${fields.map(k=>`${k}=?`).join(',')} WHERE id=?`,[...values,req.params.id]);
    await pool.execute('INSERT INTO activity_log(actor_id,entity_type,entity_id,action,details) VALUES(?,?,?,?,?)',[req.user.id,'inventory',req.params.id,'Clothing variant updated',JSON.stringify(p.data)]);res.json({ok:true});
  }catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That SKU already exists. Each size and color combination needs a unique SKU.'});throw e;}
}));
app.delete('/api/inventory/:id', auth, allow('admin','warehouse'), route(async (req,res) => {
  const [[linked]]=await pool.execute('SELECT COUNT(*) total FROM order_items WHERE product_id=?',[req.params.id]);if(linked.total)return res.status(409).json({error:'This item is part of an order and cannot be removed.'});
  const [result]=await pool.execute('DELETE FROM products WHERE id=?',[req.params.id]);if(!result.affectedRows)return res.status(404).json({error:'Clothing variant not found.'});res.json({ok:true});
}));
app.get('/api/orders', auth, allow('admin','warehouse'), route(async (_req,res) => {
  const [rows] = await pool.query(`SELECT o.id,o.order_number,o.status,o.priority,o.due_date,o.created_at,c.name customer,w.code warehouse,COUNT(oi.id) item_count FROM orders o JOIN customers c ON c.id=o.customer_id JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 200`);
  res.json(rows);
}));
app.post('/api/orders', auth, allow('admin','warehouse'), route(async (req,res) => {
  const p=z.object({customer_id:z.coerce.number().int().positive(),product_id:z.coerce.number().int().positive(),quantity:z.coerce.number().int().positive(),priority:z.enum(['Normal','High','Urgent']),due_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(''))}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Enter a customer, clothing variant, quantity, priority, and valid due date.'});
  const c=await pool.getConnection();
  try{await c.beginTransaction();const [[customer]]=await c.execute('SELECT id FROM customers WHERE id=?',[p.data.customer_id]);if(!customer){await c.rollback();return res.status(404).json({error:'Customer not found.'});}
    const [[product]]=await c.execute('SELECT id,warehouse_id,quantity FROM products WHERE id=? FOR UPDATE',[p.data.product_id]);if(!product){await c.rollback();return res.status(404).json({error:'Clothing variant not found.'});}
    if(product.quantity<p.data.quantity){await c.rollback();return res.status(409).json({error:`Only ${product.quantity} pieces are available for this variant.`});}
    const orderNo=`DF-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const [created]=await c.execute("INSERT INTO orders(order_number,customer_id,warehouse_id,status,priority,due_date) VALUES(?,?,?,'New',?,?)",[orderNo,p.data.customer_id,product.warehouse_id,p.data.priority,p.data.due_date||null]);
    await c.execute('INSERT INTO order_items(order_id,product_id,quantity) VALUES(?,?,?)',[created.insertId,product.id,p.data.quantity]);
    await c.execute('UPDATE products SET quantity=quantity-? WHERE id=?',[p.data.quantity,product.id]);
    await c.execute('INSERT INTO activity_log(actor_id,entity_type,entity_id,action,details) VALUES(?,?,?,?,?)',[req.user.id,'order',created.insertId,'Order created',JSON.stringify({order_number:orderNo,quantity:p.data.quantity})]);
    await c.commit();res.status(201).json({id:created.insertId,order_number:orderNo});
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}));
app.get('/api/warehouses', auth, allow('admin','warehouse'), route(async (_req,res) => {
  const [rows] = await pool.query(`SELECT w.id,w.code,w.name,w.city,w.capacity_units,COUNT(p.id) product_count,COALESCE(SUM(p.quantity),0) stock_units FROM warehouses w LEFT JOIN products p ON p.warehouse_id=w.id GROUP BY w.id ORDER BY w.name`);
  res.json(rows);
}));
app.post('/api/warehouses', auth, allow('admin'), route(async (req,res) => {
  const p=z.object({code:z.string().trim().min(2).max(30),name:z.string().trim().min(2).max(120),city:z.string().trim().min(2).max(100),capacity_units:z.coerce.number().int().positive()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Enter a warehouse code, name, city, and positive capacity.'});
  try{const d=p.data;const [r]=await pool.execute('INSERT INTO warehouses(code,name,city,capacity_units) VALUES(?,?,?,?)',[d.code.toUpperCase(),d.name,d.city,d.capacity_units]);await pool.execute('INSERT INTO activity_log(actor_id,entity_type,entity_id,action,details) VALUES(?,?,?,?,?)',[req.user.id,'warehouse',r.insertId,'Warehouse created',JSON.stringify(d)]);res.status(201).json({id:r.insertId,...d});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'That warehouse code is already in use.'});throw e;}
}));
app.get('/api/customers', auth, allow('admin','warehouse'), route(async (_req,res) => {
  const [rows] = await pool.query(`SELECT c.id,c.name,c.email,c.company,COUNT(o.id) order_count,MAX(o.created_at) last_order FROM customers c LEFT JOIN orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.name`);
  res.json(rows);
}));
app.get('/api/activity', auth, allow('admin','warehouse'), route(async (_req,res) => {
  const [rows]=await pool.query(`SELECT a.id,a.entity_type,a.entity_id,a.action,CAST(a.details AS CHAR) details,DATE_FORMAT(a.created_at,'%Y-%m-%d %H:%i:%s') created_at,COALESCE(u.name,'System') actor FROM activity_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT 100`);
  res.json(rows);
}));
app.patch('/api/orders/:id/status', auth, allow('admin','warehouse'), route(async (req,res) => {
  const p = z.object({ status:z.enum(['New','Picking','Packed','Shipped','Delivered','On hold','Cancelled']) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error:'Choose a valid order status.' });
  const c=await pool.getConnection();
  try{await c.beginTransaction();const [[existing]]=await c.execute('SELECT id,status FROM orders WHERE id=? FOR UPDATE',[req.params.id]);
    if(!existing){await c.rollback();return res.status(404).json({error:'Order not found.'});}
    if(existing.status==='Cancelled'&&p.data.status!=='Cancelled'){await c.rollback();return res.status(409).json({error:'A cancelled order cannot be reopened. Create a new order instead.'});}
    if(p.data.status==='Cancelled'&&['Shipped','Delivered'].includes(existing.status)){await c.rollback();return res.status(409).json({error:'A shipped or delivered order cannot be cancelled.'});}
    if(existing.status==='Cancelled'){await c.commit();return res.json({ok:true,alreadyCancelled:true});}
    if(p.data.status==='Cancelled'){
      const [items]=await c.execute('SELECT product_id,quantity FROM order_items WHERE order_id=?',[req.params.id]);
      for(const item of items)await c.execute('UPDATE products SET quantity=quantity+? WHERE id=?',[item.quantity,item.product_id]);
    }
    await c.execute('UPDATE orders SET status=? WHERE id=?',[p.data.status,req.params.id]);
    await c.execute('INSERT INTO activity_log(actor_id,entity_type,entity_id,action,details) VALUES(?,?,?,?,?)',[req.user.id,'order',req.params.id,p.data.status==='Cancelled'?'Order cancelled; stock restored':'Order status updated',JSON.stringify({status:p.data.status,previous_status:existing.status})]);
    await c.commit();res.json({ok:true,stockRestored:p.data.status==='Cancelled'});
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}));
app.get('/api/shipments', auth, route(async (req,res) => {
  const r=await fetch(`${process.env.SHIPMENT_SERVICE_URL||'http://localhost:4100'}/shipments`,{headers:{authorization:req.headers.authorization||''}});
  res.status(r.status).json(await r.json());
}));
app.patch('/api/shipments/:id/status', auth, allow('admin','warehouse','provider'), route(async (req,res) => {
  const r=await fetch(`${process.env.SHIPMENT_SERVICE_URL||'http://localhost:4100'}/shipments/${req.params.id}/status`,{method:'PATCH',headers:{authorization:req.headers.authorization||'','content-type':'application/json'},body:JSON.stringify(req.body)});
  res.status(r.status).json(await r.json());
}));
app.get('/api/providers', auth, allow('admin','warehouse'), route(async (_req,res) => {
  const [rows] = await pool.query(`SELECT p.id,p.name,p.service_level,p.contact_email,COUNT(s.id) shipment_count FROM providers p LEFT JOIN shipments s ON s.provider_id=p.id WHERE p.active=1 GROUP BY p.id ORDER BY p.name`); res.json(rows);
}));
app.post('/api/users', auth, allow('admin'), route(async (req,res) => {
  const p=z.object({name:z.string().trim().min(2).max(120),email:z.string().email().max(190),password:z.string().min(8).max(100),role:z.literal('warehouse')}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:'Enter a name, valid warehouse email, and password with at least 8 characters.'});
  try{const hash=await bcrypt.hash(p.data.password,10);const [r]=await pool.execute('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',[p.data.name,p.data.email,hash,'warehouse']);res.status(201).json({id:r.insertId,name:p.data.name,email:p.data.email,role:'warehouse'});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return res.status(409).json({error:'An account already uses that email.'});throw e;}
}));
app.use((err,_req,res,_next) => { console.error(err); res.status(500).json({ error:'Something went wrong. Please try again.' }); });
const port = Number(process.env.PORT || 4000);
async function start() {
  const [columns]=await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products'");
  const existing=new Set(columns.map(c=>c.COLUMN_NAME));
  if(!existing.has('department'))await pool.query("ALTER TABLE products ADD COLUMN department ENUM('Men','Women','Kids') NOT NULL DEFAULT 'Men' AFTER name");
  if(!existing.has('size'))await pool.query("ALTER TABLE products ADD COLUMN size VARCHAR(24) NOT NULL DEFAULT 'One size' AFTER category");
  if(!existing.has('color'))await pool.query("ALTER TABLE products ADD COLUMN color VARCHAR(40) NOT NULL DEFAULT 'Black' AFTER size");
  const [[orderStatus]]=await pool.query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='status'");
  if(orderStatus&&!orderStatus.COLUMN_TYPE.includes('Cancelled'))await pool.query("ALTER TABLE orders MODIFY status ENUM('New','Picking','Packed','Shipped','Delivered','On hold','Cancelled') NOT NULL DEFAULT 'New'");
  const demos=[['EL-2048','MN-DNM-32-IND','Slim Fit Denim Jeans','Men','Bottoms','32','Indigo'],['HM-3102','WM-TEE-S-SAG','Ribbed Cotton T-Shirt','Women','Tops','S','Sage'],['OF-1180','KD-HOD-08-RST','Printed Cotton Hoodie','Kids','Outerwear','8','Rust'],['EL-2091','WM-DRS-M-NVY','Midi Dress','Women','Dresses','M','Navy'],['HM-4410','MN-OXF-L-WHT','Oxford Cotton Shirt','Men','Shirts','L','White'],['SP-5503','KD-JOG-06-GRY','Fleece Joggers','Kids','Bottoms','6','Grey']];
  for(const [oldSku,sku,name,department,category,size,color] of demos)await pool.execute('UPDATE products SET sku=?,name=?,department=?,category=?,size=?,color=?,unit=\'pieces\' WHERE sku=?',[sku,name,department,category,size,color,oldSku]);
  const [demoUsers] = await pool.execute("SELECT id FROM users WHERE password_hash='SET_ON_FIRST_RUN'");
  if (demoUsers.length) {
    const hash = await bcrypt.hash('DockFlow123!', 10);
    await pool.execute("UPDATE users SET password_hash=? WHERE password_hash='SET_ON_FIRST_RUN'", [hash]);
  }
  app.listen(port, () => console.log(`DockFlow API listening on ${port}`));
}
start().catch(error => { console.error('DockFlow could not start:', error); process.exit(1); });
