# Orbital — Document Q&A

A document Q&A tool for commercial real estate lawyers. Upload legal documents (leases, title reports, environmental assessments) and ask questions grounded in the document content. The AI assistant answers with citations to specific sections and clauses.

---

## Stack

- **Frontend** — React (Vite + Tailwind + shadcn/Radix UI)
- **Backend** — FastAPI (Python 3.12 + SQLAlchemy + PydanticAI)
- **Database** — PostgreSQL
- **AI** — Anthropic Claude (via PydanticAI)

---

## Setup

### Prerequisites

- Docker and Docker Compose
- [just](https://github.com/casey/just) — `brew install just` or `cargo install just`

### Getting Started

1. Run setup:
```
just setup
```
This copies `.env.example` to `.env` and builds the Docker images.

2. Add your Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=your_key_here
```

3. Start everything:
```
just dev
```
Starts PostgreSQL, the FastAPI backend (port 8000), and the React frontend (port 5173). Database migrations run automatically on startup.

4. Open [http://localhost:5173](http://localhost:5173).

Local `backend/src/` and `frontend/src/` directories are mounted into the containers — changes hot-reload automatically.

---

## Project Structure

```
backend/        FastAPI backend
frontend/       React frontend
alembic/        Database migrations
data/           Product analytics and customer feedback
sample-docs/    Sample PDF documents for testing
uploads/        Uploaded files (gitignored)
```

---

## Commands

| Command | Description |
|---|---|
| `just dev` | Start full stack (Postgres + backend + frontend) |
| `just stop` | Stop all services |
| `just reset` | Stop everything and clear database |
| `just check` | Run all linters and type checks |
| `just fmt` | Format all code |
| `just db-init` | Run database migrations |
| `just db-shell` | Open a psql shell |
| `just shell-backend` | Shell into backend container |
| `just logs-backend` | Tail backend logs |
| `just add-dep <pkg>` | Add a Python dependency |
| `just add-dep-frontend <pkg>` | Add a frontend dependency |
