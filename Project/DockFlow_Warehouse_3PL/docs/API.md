# API quick reference
After login, send `Authorization: Bearer <token>` to each operational endpoint.

FastAPI OpenAPI documentation is available at `http://localhost:8000/docs`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | API and database readiness |
| POST | `/api/auth/login` | Sign in and receive an 8-hour JWT |
| GET | `/api/dashboard` | KPI counts, order queue, low stock, recent shipments |
| GET | `/api/inventory?q=` | Search SKU and product name |
| POST | `/api/inventory` | Add a clothing variant |
| PATCH | `/api/inventory/:id` | Edit variant details or adjust stock |
| DELETE | `/api/inventory/:id` | Remove a variant not referenced by an order |
| GET | `/api/orders` | Recent order queue |
| POST | `/api/orders` | Create an order and reserve available clothing stock |
| PATCH | `/api/orders/:id/status` | Change fulfillment status; cancelling an eligible order restores its stock transactionally |
| GET | `/api/warehouses` | Facility capacity and stock position |
| POST | `/api/warehouses` | Admin creates a warehouse location |
| GET | `/api/customers` | Customer directory and order activity |
| GET | `/api/shipments` | List shipments, filtered for provider users |
| PATCH | `/api/shipments/:id/status` | Change delivery status with provider ownership check |
| GET | `/api/providers` | Logistics partners and shipment counts |
| POST | `/api/users` | Admin creates a warehouse staff login |
| GET | `/api/activity` | Latest workspace changes and the user who made them |
| POST | `http://localhost:8000/api/search` | JWT-protected semantic search over apparel, warehouses, and handling guides |
| GET | `http://localhost:8000/api/events` | JWT-protected latest flexible carrier events from MongoDB |

Shipment service routes (normally accessed through the Express API gateway) are `GET /shipments` and `PATCH /shipments/:id/status`. A status update publishes the `shipment.status.updated` Kafka event. The service consumes the event into MySQL `shipment_events` and forwards the flexible event document to the service-key-protected FastAPI `POST /internal/events` endpoint for MongoDB storage.

Responses use JSON. Errors return `{ "error": "Readable explanation" }`.
