# Course outcome evidence

| CO | Working project evidence | Where to demonstrate it |
|---|---|---|
| **CO1 — SQL** | Normalized MySQL tables, foreign keys, joins, parameterized API queries, transaction-based order creation with row locking and stock reservation, and transactional cancellation that returns reserved stock once. | `database/init.sql`, `server/src/index.js` (`/api/dashboard`, `/api/orders`) |
| **CO2 — SQL + NoSQL + vector search** | The FastAPI service reads the SQL clothing/warehouse catalog, stores flexible carrier status payloads in MongoDB, and indexes clothing and warehouse guidance as embeddings in Qdrant for meaning-based search. | `services/insights/main.py`; **Insights** in the app; MongoDB and Qdrant in Compose |
| **CO3 — FastAPI** | Separate asynchronous FastAPI REST service with Pydantic request models, `Depends` authentication injection, shared JWT verification, automatic OpenAPI/Swagger docs, and authenticated search endpoints. | `services/insights/main.py`; http://localhost:8000/docs |
| **CO4 — Node/Express** | Existing Node.js/Express core API handles login, inventory, order creation, SQL data, and role-based access. | `server/src/index.js` |
| **CO5 — Microservices + REST + Kafka** | Shipment tracking is an independently built Node service. The Express API delegates shipment REST calls to it; status updates publish Kafka events, and a consumer stores an audit copy in MySQL. The shipment service also sends flexible event details to the Insights API, which stores them in MongoDB. | `services/shipments/src/index.js`; `docker-compose.yml`; MySQL `shipment_events`; MongoDB `carrier_events` |
| **CO6 — Docker + CI/CD + C4** | Compose runs MySQL, MongoDB, Qdrant, Kafka, Express, FastAPI, the shipment service, and React as one application. GitHub Actions validates the web build and service syntax on pushes and pull requests. C4 context and container views document the boundaries. | `docker-compose.yml`, `.github/workflows/ci.yml`, `docs/C4.md` |

## Demo sequence

1. Run `docker compose up --build` from the folder containing `docker-compose.yml`.
2. Sign in to the web app using the demo admin account shown in the README.
3. In **Insights**, search naturally, for example: `warm kids outerwear running low`. Explain that FastAPI validates and authorizes the query, Qdrant ranks vectors, and the indexed text comes from MySQL plus operational guides.
4. In **Shipments**, change a shipment status. The shipment service updates MySQL, emits `shipment.status.updated` to Kafka, stores the consumed event in `shipment_events`, and forwards a flexible carrier event to MongoDB.
5. Open http://localhost:8000/docs to demonstrate the generated FastAPI OpenAPI interface.

## Boundaries to state in the presentation

This project demonstrates a single-node local Kafka broker for coursework, not a production cluster. The shipment service owns shipment lifecycle updates; MySQL stays authoritative for inventory and shipment status, MongoDB holds flexible carrier-event documents, and Qdrant holds searchable vectors. Spring Boot is not part of this implementation; Node.js/Express provides the CO4 backend-service evidence. CI checks and C4 context/container views are included, while automated deployment and lower-level C4 views can be added if the rubric requires them.
