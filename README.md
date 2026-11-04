# ASN360 Control Tower

Local prototype for supplier ASN journey visibility with synthetic checkpoint evidence persisted in MongoDB.

## Run locally

Prerequisites: Node.js and MongoDB running locally on `127.0.0.1:27017`.

1. Install dependencies: `npm install`
2. Seed or reset the demo journeys: `npm run seed:mock`
3. Start the API in one terminal: `npm run dev:api`
4. Start the frontend in another terminal: `npm run dev`
5. Open `http://127.0.0.1:5174`

The API listens on `http://127.0.0.1:3001`; Vite proxies `/api` requests to it. The API does not start unless it can connect to MongoDB.

## Local configuration

The defaults are:

| Variable | Default |
|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` |
| `MONGODB_DB` | `asn360_control_tower` |
| `API_PORT` | `3001` |

Set these as environment variables before starting the API if your local MongoDB uses different settings. Do not commit credentials.

## Demo data and persistence

`npm run seed:mock` writes 25 synthetic journeys to the `journeys` collection. The journeys include EDI source, Middleware (MS), SAP PI/PO, SAP B/M, GI, and WMS checkpoints, with business fields present only for systems that expose them. Middleware and SAP PI/PO records include technical message identifiers; SAP PI/PO also carries a linked IDoc in the demo data.

The frontend reads journeys from MongoDB. Simulated recovery updates are written back to MongoDB and remain after a page refresh. Running the seed command again resets those journeys to the original synthetic scenarios.

Useful local endpoints:

- `GET /api/health` — API and MongoDB connectivity
- `GET /api/journeys` — persisted mock journeys
- `POST /api/journeys/:asnId/recovery` — persist a simulated recovery for a recoverable journey

All records are mock data; the prototype has no live upstream system connectors.
