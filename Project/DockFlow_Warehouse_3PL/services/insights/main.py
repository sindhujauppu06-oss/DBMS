import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import pymysql
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from pymongo import MongoClient, DESCENDING
from qdrant_client import QdrantClient, models
from fastembed import TextEmbedding

app = FastAPI(title="DockFlow Insights API", version="1.0.0", description="Authenticated semantic clothing search and flexible carrier event history.")
bearer = HTTPBearer(auto_error=False)
mongo = MongoClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"), serverSelectionTimeoutMS=3000)
events = mongo.dockflow.carrier_events
vectors = QdrantClient(url=os.getenv("QDRANT_URL", "http://localhost:6333"))
embedder = None
COLLECTION = "dockflow_warehouse_knowledge"
SECRET = os.getenv("JWT_SECRET", "local-only-replace-this-secret-before-deploying")

class EventInput(BaseModel):
    shipment_id: int
    tracking_code: str
    status: str
    destination: str | None = None
    actor: str | None = None
    source: str = "DockFlow"
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    carrier_payload: dict[str, Any] = Field(default_factory=dict)

class SearchInput(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    limit: int = Field(default=6, ge=1, le=20)

def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    try:
        return jwt.decode(credentials.credentials, SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")

def mysql_connection():
    return pymysql.connect(host=os.getenv("DB_HOST", "localhost"), port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "dockflow"), password=os.getenv("DB_PASSWORD", "dockflow_local"),
        database=os.getenv("DB_NAME", "dockflow"), cursorclass=pymysql.cursors.DictCursor, connect_timeout=5)

def wait_for_dependencies():
    global embedder
    for attempt in range(60):
        try:
            mongo.admin.command("ping")
            vectors.get_collections()
            with mysql_connection() as db:
                with db.cursor() as cur: cur.execute("SELECT 1")
            break
        except Exception:
            if attempt == 59: raise
            time.sleep(2)
    embedder = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
    with mysql_connection() as db:
        with db.cursor() as cur:
            cur.execute("SELECT sku,name,department,category,size,color,quantity,reorder_level,warehouse_id FROM products")
            products = cur.fetchall()
            cur.execute("SELECT code,name,city,capacity_units FROM warehouses")
            warehouses = cur.fetchall()
    documents = [
        {"id": f"product-{p['sku']}", "text": f"Clothing inventory {p['department']} {p['category']}: {p['name']}, size {p['size']}, color {p['color']}, SKU {p['sku']}, {p['quantity']} pieces available, reorder level {p['reorder_level']}.", "kind": "clothing", "sku": p["sku"]}
        for p in products
    ]
    documents += [
        {"id": f"warehouse-{w['code']}", "text": f"Warehouse {w['name']} in {w['city']}, code {w['code']}, clothing storage capacity {w['capacity_units']} pieces.", "kind": "warehouse", "sku": w["code"]}
        for w in warehouses
    ]
    documents += [
        {"id": f"guide-{i}", "text": t, "kind": "operations guide", "sku": None}
        for i, t in enumerate([
            "For apparel putaway, verify garment SKU, department, size and color, then scan the assigned warehouse bin before confirming receipt.",
            "For cycle counts, count each size and color variant independently; record adjustments with a reason and compare against the reorder level.",
            "For outbound picking, pick the exact apparel size and color, confirm quantity, pack the order, and hand off to the assigned 3PL carrier.",
            "When a carrier reports a delivery exception, record its flexible event payload, review destination and tracking code, then update the shipment after investigation."
        ])
    ]
    if vectors.collection_exists(COLLECTION): vectors.delete_collection(COLLECTION)
    vectors.create_collection(collection_name=COLLECTION, vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE))
    points=[]
    for doc, vector in zip(documents, embedder.embed([d["text"] for d in documents])):
        points.append(models.PointStruct(id=str(uuid.uuid5(uuid.NAMESPACE_URL, doc["id"])), vector=vector.tolist(), payload=doc))
    if points: vectors.upsert(collection_name=COLLECTION, points=points)

@app.on_event("startup")
def startup():
    wait_for_dependencies()

@app.get("/health")
def health():
    return {"status": "ok", "service": "DockFlow Insights", "stores": ["MySQL", "MongoDB", "Qdrant"]}

@app.post("/api/search")
def semantic_search(body: SearchInput, user=Depends(current_user)):
    vector = list(embedder.embed([body.query]))[0].tolist()
    result = vectors.query_points(collection_name=COLLECTION, query=vector, limit=body.limit, with_payload=True)
    return {"query": body.query, "results": [{**p.payload, "score": round(p.score, 4)} for p in result.points]}

@app.post("/internal/events", status_code=201)
def record_carrier_event(body: EventInput, x_service_key: str | None = Header(default=None)):
    if x_service_key != os.getenv("SERVICE_KEY", "dockflow-local-service-key"):
        raise HTTPException(status_code=401, detail="Service authentication failed.")
    doc = body.model_dump()
    doc["occurred_at"] = doc["occurred_at"].astimezone(timezone.utc)
    saved = events.insert_one(doc)
    return {"id": str(saved.inserted_id), "stored": True}

@app.get("/api/events")
def recent_events(limit: int = 20, user=Depends(current_user)):
    limit = max(1, min(limit, 100))
    return [{"id": str(row["_id"]), **{k:v for k,v in row.items() if k != "_id"}} for row in events.find({}, {"_id":1,"shipment_id":1,"tracking_code":1,"status":1,"destination":1,"actor":1,"source":1,"occurred_at":1,"carrier_payload":1}).sort("occurred_at", DESCENDING).limit(limit)]
