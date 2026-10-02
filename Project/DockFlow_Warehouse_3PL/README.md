# DockFlow | Warehouse & 3PL Operations

A professional full-stack application for clothing warehousing and 3PL operations. It includes a React dashboard, Node/Express operations API, FastAPI Insights API, independent shipment microservice, MySQL, MongoDB carrier events, Qdrant semantic search, Kafka status events, JWT sign-in, and Docker Compose.

## Quick start
1. Install Docker Desktop and VS Code.
2. Extract this ZIP and open the `dockflow-3pl` folder in VS Code.
3. In the VS Code terminal, make sure the current folder contains `docker-compose.yml`, then run `docker compose up --build`.
4. Visit http://localhost:5173. API health: http://localhost:4000/api/health.

Demo logins (all use `DockFlow123!`): `admin@dockflow.demo`, `warehouse@dockflow.demo`, and `carrier@dockflow.demo`. Local coursework use only. Change credentials and secrets before deployment.

Stop with `docker compose down`. Reset sample data with `docker compose down -v`.

## Included
- Operations dashboard, low-stock watchlist, order queue, shipment pulse
- Warehouse, customer, and 3PL provider directories backed by MySQL
- Admin can add warehouse facilities; inventory shows warehouse-load errors and offers retry/navigation if none are available
- Searchable clothing inventory with create, edit, and remove actions
- Size and color variants with per-warehouse quantities and reorder alerts
- Inventory opens with separate Men, Women, and Kids photo collections; select a collection to see its items
- Create orders that reserve clothing stock, then update order and shipment status through delivery
- Cancel an order before shipment and return its reserved stock exactly once; shipped and delivered orders cannot be cancelled
- Export the visible department inventory or order list as CSV
- Review a shared activity history of stock, order, warehouse, and shipment changes
- Admin can create individual warehouse staff logins; warehouse staff can receive stock, process orders, and update delivery statuses
- Admin, warehouse, and provider demo roles
- Normalized MySQL schema, parameterized API queries, input validation, transactional stock reservation
- **CO2:** FastAPI reads the MySQL catalog; MongoDB keeps flexible carrier-event payloads; Qdrant stores embedding vectors for meaning-based apparel and warehouse guide search
- **CO3:** FastAPI validates requests with Pydantic, injects JWT authentication dependencies, and provides generated OpenAPI docs at http://localhost:8000/docs
- **CO5:** Independent shipment service serves REST endpoints, publishes shipment status events to Kafka, consumes them into a MySQL event audit table, and forwards carrier event details to MongoDB
- Insights page for semantic search and latest carrier events
- Docker Compose includes MySQL, MongoDB, Qdrant, Kafka, Express, FastAPI, shipment service, and web UI
- Architecture, C4 diagrams, API reference, and course outcome mapping under `docs/`
- GitHub Actions CI checks frontend build, backend syntax, Python syntax, and Docker Compose configuration

## Structure
`client/` React + Vite UI · `server/` Express API · `services/insights/` FastAPI + MongoDB + Qdrant · `services/shipments/` shipment REST + Kafka service · `database/init.sql` schema and sample records · `docs/` project documentation

## Course outcome roadmap
The catalog is limited to apparel for men, women, and kids. Track each size/color variant separately so stock counts and reorder alerts stay accurate. `docs/COURSE_OUTCOME_MAP.md` maps working features to each outcome and lists remaining scope honestly: Spring Boot, CI/CD, and full C4 documentation are not implemented in this version.

## Scope
The first Insights service start downloads the small `all-MiniLM-L6-v2` text embedding model for semantic vector search; allow a few minutes and an internet connection on first startup. Kafka is configured as a local single-node coursework broker. Change demo passwords and secrets and add production deployment controls before real use. Payment processing and live GPS are not enabled.
