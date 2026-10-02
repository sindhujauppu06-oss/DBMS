# Architecture

## Runtime
- React + Vite provides the role-aware browser UI.
- Express provides JSON REST endpoints, JWT authentication, validation, and access checks.
- MySQL stores normalized operational entities and activity history.
- Docker Compose starts the database, API, and web client for a local demonstration.

## Data flow
`React client → Express REST API → MySQL`

The Insights page also calls a separate FastAPI service. It reads the SQL catalog, stores flexible carrier event documents in MongoDB, and runs semantic search over Qdrant vectors generated from clothing and warehouse guidance. Shipment REST calls pass through Express to the independently deployable shipment service. Shipment status changes publish Kafka events; the shipment service consumes them into an SQL audit table and posts the flexible carrier event to Insights for MongoDB storage.

MySQL owns product quantities, warehouse records, customer orders, shipment assignments, and provider records. Dashboard queries join those records into an operational view. Status and inventory changes also write activity history.

## Roles
- `admin`: broad workspace access
- `warehouse`: inventory and order updates, shipment visibility
- `provider`: sees shipments assigned to its provider account and can update their statuses

## Extension path
The shipment tracking bounded context is extracted as a Node service and communicates through REST and Kafka. MongoDB holds flexible carrier event payloads while MySQL remains authoritative for orders and inventory. Qdrant vector search covers clothing and warehouse procedure discovery, not stock counts. FastAPI exposes the semantic search and event ingestion APIs. Kafka uses a single-node broker in the local course demonstration; production use needs resilient brokers and idempotent event handling.
