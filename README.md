# 🔐 SecureVault

A full-stack secrets management application — store, share, and audit access to sensitive credentials with AES-256-GCM encryption at rest, role-based workspaces, and a complete audit trail.

![Python](https://img.shields.io/badge/Python-3.11-3776ab?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-latest-336791?style=flat-square&logo=postgresql&logoColor=white)

> **Repository:** https://github.com/Hadishof/SecureVault

---

## What is SecureVault?

SecureVault lets teams store sensitive credentials (API keys, passwords, tokens) in encrypted workspaces. Every secret is encrypted with AES-256-GCM before it touches the database — a database breach exposes only ciphertext. Every action (read, write, delete) is permanently logged in an audit trail.

---

## Features

- **AES-256-GCM encryption** — secrets are encrypted at rest using a master key from the environment
- **Workspaces** — organize secrets into isolated workspaces, invite teammates by email
- **Role-based access** — `owner` can add/edit/delete secrets; `viewer` can only read
- **Secret request flow** — viewers request new secrets for owner approval; owner previews the value before approving
- **Invite accept/decline flow** — invites sit as pending until the recipient explicitly accepts or declines
- **Leave workspace** — non-owners can leave any workspace they've joined
- **Full audit log** — every action is logged with user, secret name, action type, and timestamp
- **Per-workspace activity** — each workspace has its own activity log; rows can be soft-deleted from workspace view while staying in the global log
- **JWT session timer** — live countdown in the navbar showing how long until your session expires
- **Change password** — users can update their password from the navbar at any time
- **Rate limiting** — login endpoint is limited to 5 attempts per minute per IP
- **Animated UI** — dark glassmorphism design with animated background blobs and gradient effects

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Backend framework | FastAPI | API routes, dependency injection |
| ORM | SQLAlchemy | Database models and queries |
| Database | PostgreSQL (Docker) | Data persistence |
| ASGI server | Uvicorn | Serving the FastAPI app |
| Authentication | python-jose + JWT | Token creation and verification |
| Password hashing | passlib + bcrypt | Secure password storage |
| Encryption | Python `cryptography` | AES-256-GCM for secrets at rest |
| Rate limiting | slowapi | Brute-force protection on login |
| Data validation | Pydantic v2 | Request/response schemas |
| Frontend framework | React 18 + Vite | UI |
| Routing | React Router DOM v6 | Client-side navigation |
| HTTP client | Axios | API calls with JWT interceptor |

---

## Project Structure

```
secure-vault/
├── .env                         #
├── .env.example                 # Template — Create .env like above and copy to it
├── .gitignore
├── requirements.txt
├── README.md
│
├── backend/
│   └── app/
│       ├── main.py              # All API routes + startup auto-migration
│       ├── models.py            # SQLAlchemy table definitions
│       ├── schemas.py           # Pydantic request/response schemas
│       ├── auth.py              # JWT creation, decoding, get_current_user dependency
│       ├── crypto.py            # AES-256-GCM encrypt() / decrypt()
│       └── database.py          # Engine, SessionLocal, Base
│
└── frontend/
    └── src/
        ├── App.jsx              # Router + global animated background
        ├── index.css            # All styles (glassmorphism, animations, responsive)
        ├── api/
        │   └── client.js        # Axios instance — baseURL + JWT Authorization header
        ├── context/
        │   └── AuthContext.jsx  # Auth state: isAuthenticated, login(), logout(), user
        ├── components/
        │   ├── Navbar.jsx       # Session timer, change password modal, sign out
        │   └── Toast.jsx        # Toast notification system
        └── pages/
            ├── LoginPage.jsx    # Sign in / Register
            ├── DashboardPage.jsx
            ├── WorkspacePage.jsx
            └── LogsPage.jsx
```

---

## Database Schema

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| email | String | unique |
| hashed_password | String | bcrypt |

### `workspaces`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| name | String | |
| owner_id | FK → users | |

### `workspace_members` (join table)
| Column | Type | Notes |
|--------|------|-------|
| user_id | FK → users | PK |
| workspace_id | FK → workspaces | PK |
| role | String | `owner` or `viewer` |
| status | String | `active` or `pending` |

### `secrets`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| key_name | String | |
| encrypted_value | String | AES-256-GCM ciphertext |
| workspace_id | FK → workspaces | CASCADE delete |
| created_at | DateTime | |

### `audit_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| user_id | FK → users | SET NULL on user delete |
| workspace_id | FK → workspaces | SET NULL on workspace delete |
| action | String | e.g. `create_secret`, `reveal_secret` |
| target_id | Integer | secret ID at time of action |
| secret_name | String | stored directly — persists after secret deletion |
| timestamp | DateTime | UTC |
| hidden_from_workspace | Boolean | soft-delete from workspace view |

### `secret_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| workspace_id | FK → workspaces | CASCADE delete |
| requester_email | String | |
| key_name | String | |
| encrypted_value | String | AES-256-GCM ciphertext |
| status | String | `pending`, `approved`, `rejected` |
| created_at | DateTime | |

---

## API Reference

### Auth
```
POST   /register                    { email, password }
POST   /login                       form: username, password  → { access_token, token_type }
POST   /change-password             { current_password, new_password }
```

### Workspaces
```
GET    /workspaces/                  list workspaces user belongs to
POST   /workspaces/                  create workspace
GET    /workspaces/{id}              get workspace + members
PUT    /workspaces/{id}              rename workspace (owner only)
DELETE /workspaces/{id}              delete workspace + all data (owner only)
DELETE /workspaces/{id}/leave        leave workspace (non-owners only)
```

### Members & Invites
```
POST   /workspaces/{id}/invite               invite user by email (owner only)
DELETE /workspaces/{id}/members/{user_id}    remove member (owner only)
GET    /invites                              list pending invites for current user
POST   /workspaces/{id}/accept-invite        accept invite
DELETE /workspaces/{id}/decline-invite       decline invite
```

### Secrets
```
GET    /workspaces/{id}/secrets              list + decrypt all secrets
POST   /workspaces/{id}/secrets             add secret (owner only)
PUT    /workspaces/{id}/secrets/{sid}        edit name or value (owner only)
DELETE /workspaces/{id}/secrets/{sid}        delete secret (owner only)
```

### Secret Requests (viewer → owner approval flow)
```
POST   /workspaces/{id}/secret-requests                       viewer submits request
GET    /workspaces/{id}/secret-requests                       owner views pending requests
GET    /workspaces/{id}/secret-requests/{rid}/preview         owner previews value
POST   /workspaces/{id}/secret-requests/{rid}/approve         owner approves → creates secret
DELETE /workspaces/{id}/secret-requests/{rid}/reject          owner rejects
```

### Audit Logs
```
GET    /workspaces/{id}/logs              workspace activity (respects hidden_from_workspace)
DELETE /workspaces/{id}/logs/{log_id}     soft-delete from workspace view (kept in global log)
GET    /logs                              global audit log for current user
DELETE /logs                              clear all global logs for current user
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Generate with: python -c "import secrets; print(secrets.token_hex(32))"
JWT_SECRET_KEY=your-long-random-secret-key

# Must be exactly 64 hex characters (32 bytes for AES-256)
# Generate with: python -c "import secrets; print(secrets.token_hex(32))"
MASTER_ENCRYPTION_KEY=your-64-char-hex-key

# PostgreSQL connection string
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/securevault
```

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Python 3.11+
- Node.js 18+

### 1. Clone the repository

```bash
git clone https://github.com/Hadishof/SecureVault.git
cd SecureVault
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the three values. To generate keys:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Run it twice — once for `JWT_SECRET_KEY`, once for `MASTER_ENCRYPTION_KEY`.

### 3. Start PostgreSQL with Docker

```bash
docker run --name securevault-db \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=securevault \
  -p 5432:5432 \
  -d postgres:latest
```

Make sure `yourpassword` matches what you put in `DATABASE_URL` in `.env`.

### 4. Run the backend

```bash
pip install -r requirements.txt
cd backend
uvicorn app.main:app --reload
```

The backend starts at **http://localhost:8000**. Database tables are created automatically on first start — no migrations needed.

### 5. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend starts at **http://localhost:5173**. Open it in your browser.

---

## How Encryption Works

Every secret value goes through this flow:

**Storing:**
```
plaintext → AES-256-GCM encrypt (random nonce + MASTER_ENCRYPTION_KEY) → base64 ciphertext → stored in DB
```

**Retrieving:**
```
base64 ciphertext from DB → AES-256-GCM decrypt (MASTER_ENCRYPTION_KEY) → plaintext → returned to user
```

The nonce (random 12 bytes) is prepended to the ciphertext so each encryption is unique even for identical values. If the database is breached, the attacker gets ciphertext they cannot decrypt without the `MASTER_ENCRYPTION_KEY` which lives only in your environment.

---

## Security Notes

- Passwords are hashed with **bcrypt** — plaintext passwords are never stored
- Login is **rate limited** to 5 attempts/minute per IP via slowapi
- **JWTs expire** after 30 minutes
- The `MASTER_ENCRYPTION_KEY` must never be committed to git — `.gitignore` already excludes `.env`
- Encryption protects data **at rest** (database breach) — authenticated users with valid JWTs can still access their own secrets through the API, which is by design

---

## Resetting the Database

To wipe all data (useful before demo or deployment):

```bash
# In Docker Desktop → securevault-db → Exec tab, or:
docker exec -it securevault-db psql -U postgres -d securevault
```

```sql
TRUNCATE users, workspaces, workspace_members, secrets, audit_logs, secret_requests CASCADE;
```
