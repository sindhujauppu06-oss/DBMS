CREATE DATABASE IF NOT EXISTS dockflow CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE dockflow;
CREATE TABLE IF NOT EXISTS providers (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, name VARCHAR(160) NOT NULL,
 service_level VARCHAR(80) NOT NULL DEFAULT 'Standard', contact_email VARCHAR(190), active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, name VARCHAR(120) NOT NULL,
 email VARCHAR(190) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
 role ENUM('admin','warehouse','provider') NOT NULL DEFAULT 'warehouse', provider_id BIGINT UNSIGNED NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (provider_id) REFERENCES providers(id)
);
CREATE TABLE IF NOT EXISTS warehouses (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, code VARCHAR(30) NOT NULL UNIQUE,
 name VARCHAR(120) NOT NULL, city VARCHAR(100) NOT NULL, capacity_units INT UNSIGNED NOT NULL DEFAULT 0,
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, sku VARCHAR(50) NOT NULL UNIQUE,
 name VARCHAR(160) NOT NULL, department ENUM('Men','Women','Kids') NOT NULL,
 category VARCHAR(80) NOT NULL, size VARCHAR(24) NOT NULL, color VARCHAR(40) NOT NULL,
 warehouse_id BIGINT UNSIGNED NOT NULL,
 quantity INT NOT NULL DEFAULT 0, reorder_level INT NOT NULL DEFAULT 0, unit VARCHAR(24) NOT NULL DEFAULT 'units',
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (warehouse_id) REFERENCES warehouses(id), CHECK (quantity >= 0), INDEX idx_products_name(name)
);
CREATE TABLE IF NOT EXISTS customers (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, name VARCHAR(160) NOT NULL,
 email VARCHAR(190) NOT NULL UNIQUE, company VARCHAR(160), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, order_number VARCHAR(30) NOT NULL UNIQUE,
 customer_id BIGINT UNSIGNED NOT NULL, warehouse_id BIGINT UNSIGNED NOT NULL,
 status ENUM('New','Picking','Packed','Shipped','Delivered','On hold','Cancelled') NOT NULL DEFAULT 'New',
 priority ENUM('Normal','High','Urgent') NOT NULL DEFAULT 'Normal', due_date DATE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (customer_id) REFERENCES customers(id), FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
 INDEX idx_orders_status_created(status,created_at)
);
CREATE TABLE IF NOT EXISTS order_items (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, order_id BIGINT UNSIGNED NOT NULL,
 product_id BIGINT UNSIGNED NOT NULL, quantity INT UNSIGNED NOT NULL,
 FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS shipments (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, tracking_code VARCHAR(40) NOT NULL UNIQUE,
 order_id BIGINT UNSIGNED NOT NULL UNIQUE, provider_id BIGINT UNSIGNED,
 status ENUM('Label created','Ready for pickup','In transit','Out for delivery','Delivered','Exception') NOT NULL DEFAULT 'Label created',
 destination VARCHAR(180) NOT NULL, eta DATE, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (provider_id) REFERENCES providers(id), INDEX idx_shipments_status(status)
);
CREATE TABLE IF NOT EXISTS activity_log (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, actor_id BIGINT UNSIGNED,
 entity_type VARCHAR(40) NOT NULL, entity_id BIGINT UNSIGNED NOT NULL, action VARCHAR(80) NOT NULL,
 details JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL, INDEX idx_activity_created(created_at)
);
INSERT IGNORE INTO providers(id,name,service_level,contact_email) VALUES
(1,'Northstar Logistics','Express','ops@northstar.demo'),(2,'BlueRoute Freight','Standard','dispatch@blueroute.demo'),(3,'ParcelOne','Same day','hello@parcelone.demo');
-- Seed password for all demo users: DockFlow123!
INSERT IGNORE INTO users(id,name,email,password_hash,role,provider_id) VALUES
(1,'Morgan Lee','admin@dockflow.demo','SET_ON_FIRST_RUN','admin',NULL),
(2,'Avery Chen','warehouse@dockflow.demo','SET_ON_FIRST_RUN','warehouse',NULL),
(3,'Jordan Blake','carrier@dockflow.demo','SET_ON_FIRST_RUN','provider',1);
INSERT IGNORE INTO warehouses(id,code,name,city,capacity_units) VALUES
(1,'WH-NY01','North Hub','New York',12000),(2,'WH-CA02','West Distribution','Los Angeles',18000),(3,'WH-TX03','Central Fulfillment','Dallas',9500);
INSERT IGNORE INTO products(id,sku,name,department,category,size,color,warehouse_id,quantity,reorder_level,unit) VALUES
(1,'MN-DNM-32-IND','Slim Fit Denim Jeans','Men','Bottoms','32','Indigo',1,124,40,'pieces'),
(2,'WM-TEE-S-SAG','Ribbed Cotton T-Shirt','Women','Tops','S','Sage',2,38,50,'pieces'),
(3,'KD-HOD-08-RST','Printed Cotton Hoodie','Kids','Outerwear','8','Rust',3,216,60,'pieces'),
(4,'WM-DRS-M-NVY','Midi Dress','Women','Dresses','M','Navy',1,17,35,'pieces'),
(5,'MN-OXF-L-WHT','Oxford Cotton Shirt','Men','Shirts','L','White',2,92,30,'pieces'),
(6,'KD-JOG-06-GRY','Fleece Joggers','Kids','Bottoms','6','Grey',3,8,25,'pieces');
INSERT IGNORE INTO customers(id,name,email,company) VALUES
(1,'Olivia Carter','olivia@northwind.demo','Northwind Market'),(2,'Ethan Brooks','ethan@atelier.demo','Atelier Supply Co.'),
(3,'Mia Patel','mia@fieldhouse.demo','Fieldhouse Retail'),(4,'Noah Kim','noah@moderne.demo','Moderne Home');
INSERT IGNORE INTO orders(id,order_number,customer_id,warehouse_id,status,priority,due_date,created_at) VALUES
(1,'DF-2841',1,1,'Picking','High',CURDATE(),'2026-09-30 08:10:00'),(2,'DF-2840',2,2,'Packed','Normal',CURDATE(),'2026-09-30 07:45:00'),
(3,'DF-2839',3,3,'Shipped','Urgent',DATE_ADD(CURDATE(),INTERVAL 1 DAY),'2026-09-29 16:22:00'),
(4,'DF-2838',4,1,'New','Normal',DATE_ADD(CURDATE(),INTERVAL 1 DAY),'2026-09-29 14:08:00'),
(5,'DF-2837',1,2,'On hold','High',CURDATE(),'2026-09-29 12:30:00');
INSERT IGNORE INTO order_items(id,order_id,product_id,quantity) VALUES(1,1,1,2),(2,2,2,4),(3,3,3,3),(4,4,4,1),(5,5,5,2);
INSERT IGNORE INTO shipments(id,tracking_code,order_id,provider_id,status,destination,eta) VALUES
(1,'NS-8049231',3,1,'In transit','Austin, TX',DATE_ADD(CURDATE(),INTERVAL 1 DAY)),
(2,'BR-7730182',2,2,'Ready for pickup','San Diego, CA',DATE_ADD(CURDATE(),INTERVAL 1 DAY)),
(3,'PO-1145027',5,3,'Exception','Seattle, WA',CURDATE());
INSERT IGNORE INTO activity_log(id,actor_id,entity_type,entity_id,action,details,created_at) VALUES
(1,2,'shipment',1,'Shipment in transit',JSON_OBJECT('note','Departed regional hub'),'2026-09-30 08:32:00'),
(2,2,'order',1,'Picking started',JSON_OBJECT('note','Wave 04'),'2026-09-30 08:16:00'),
(3,1,'inventory',4,'Low stock flagged',JSON_OBJECT('note','Below reorder level'),'2026-09-30 08:00:00');
