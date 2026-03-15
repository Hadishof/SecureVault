from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import text
from jose import JWTError, jwt
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from . import models, schemas, crypto, database, auth

models.Base.metadata.create_all(bind=database.engine)

# Auto-migrate
with database.engine.connect() as _conn:
    _conn.execute(text(
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL"
    ))
    _conn.execute(text(
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hidden_from_workspace BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    _conn.execute(text(
        "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS secret_name VARCHAR"
    ))
    _conn.execute(text(
        "ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'active'"
    ))
    _conn.execute(text(
        "UPDATE audit_logs SET timestamp = NOW() WHERE timestamp IS NULL"
    ))
    _conn.commit()

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="SecureVault API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(database.get_db)):
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")

    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_active_member_row(db, workspace_id, user_id):
    """Returns the membership row only if status='active', else None."""
    return db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == user_id)
        .where(models.workspace_members.c.status == "active")
    ).fetchone()


# --- AUTH ROUTES ---

@app.get("/")
def read_root():
    return {"status": "Online", "msg": "SecureVault API is running"}


@app.post("/register", response_model=schemas.UserResponse)
def register(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    if db.query(models.User).filter(models.User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = models.User(email=user.email, hashed_password=auth.hash_password(user.password))
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.post("/login", response_model=schemas.Token)
@limiter.limit("5/minute")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not db_user or not auth.verify_password(form_data.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = auth.create_access_token(data={"sub": db_user.email})
    return {"access_token": token, "token_type": "bearer"}


@app.post("/change-password")
def change_password(
    data: schemas.ChangePassword,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    if not auth.verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = auth.hash_password(data.new_password)
    db.commit()
    return {"msg": "Password changed successfully"}


# --- WORKSPACE ROUTES ---

@app.post("/workspaces/", response_model=schemas.WorkspaceResponse)
def create_workspace(
    workspace: schemas.WorkspaceCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    new_workspace = models.Workspace(name=workspace.name)
    new_workspace.members.append(current_user)
    db.add(new_workspace)
    db.flush()
    db.execute(
        models.workspace_members.update()
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.workspace_id == new_workspace.id)
        .values(role="owner")
    )
    db.commit()
    db.refresh(new_workspace)
    return new_workspace


@app.get("/workspaces/", response_model=list[schemas.WorkspaceResponse])
def list_workspaces(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    rows = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.status == "active")
    ).fetchall()
    if not rows:
        return []
    role_map = {r.workspace_id: r.role for r in rows}
    ws_ids = list(role_map.keys())
    workspaces = db.query(models.Workspace).filter(models.Workspace.id.in_(ws_ids)).all()
    return [
        schemas.WorkspaceResponse(id=ws.id, name=ws.name, role=role_map.get(ws.id))
        for ws in workspaces
    ]


@app.get("/workspaces/{workspace_id}", response_model=schemas.WorkspaceDetailResponse)
def get_workspace(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not get_active_member_row(db, workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")

    member_rows = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
    ).fetchall()

    members = []
    for row in member_rows:
        user = db.query(models.User).filter(models.User.id == row.user_id).first()
        if user:
            members.append(schemas.MemberResponse(
                id=user.id, email=user.email,
                role=row.role or "viewer",
                status=row.status or "active"
            ))

    return schemas.WorkspaceDetailResponse(id=workspace.id, name=workspace.name, members=members)


@app.get("/workspaces/{workspace_id}/secrets", response_model=list[schemas.SecretResponse])
def list_secrets(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not get_active_member_row(db, workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")
    return workspace.secrets


@app.patch("/workspaces/{workspace_id}", response_model=schemas.WorkspaceResponse)
def update_workspace(
    workspace_id: int,
    update: schemas.WorkspaceUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can rename this workspace")

    workspace.name = update.name
    db.commit()
    db.refresh(workspace)
    return workspace


@app.delete("/workspaces/{workspace_id}")
def delete_workspace(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can delete this workspace")

    db.delete(workspace)
    db.commit()
    return {"msg": f"Workspace '{workspace.name}' deleted"}


@app.post("/workspaces/{workspace_id}/invite")
def invite_user(
    workspace_id: int,
    invite: schemas.InviteUser,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not get_active_member_row(db, workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="You are not a member of this workspace")

    user_to_invite = db.query(models.User).filter(models.User.email == invite.email).first()
    if not user_to_invite:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == user_to_invite.id)
    ).fetchone()
    if existing:
        if existing.status == "pending":
            raise HTTPException(status_code=400, detail="User already has a pending invite")
        raise HTTPException(status_code=400, detail="User is already a member")

    db.execute(
        models.workspace_members.insert().values(
            user_id=user_to_invite.id,
            workspace_id=workspace_id,
            role="viewer",
            status="pending"
        )
    )
    db.commit()
    return {"msg": f"Invite sent to {invite.email}"}


@app.delete("/workspaces/{workspace_id}/members")
def remove_member(
    workspace_id: int,
    invite: schemas.InviteUser,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can remove members")

    if invite.email == current_user.email:
        raise HTTPException(status_code=400, detail="Owner cannot remove themselves")

    user_to_remove = db.query(models.User).filter(models.User.email == invite.email).first()
    if not user_to_remove:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == user_to_remove.id)
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="User not found in this workspace")

    db.execute(
        models.workspace_members.delete()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == user_to_remove.id)
    )
    db.commit()
    return {"msg": f"{invite.email} removed from workspace"}


@app.delete("/workspaces/{workspace_id}/leave")
def leave_workspace(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    row = get_active_member_row(db, workspace_id, current_user.id)
    if not row:
        raise HTTPException(status_code=404, detail="You are not a member of this workspace")
    if row.role == "owner":
        raise HTTPException(status_code=400, detail="Owner cannot leave — delete the workspace instead")

    db.execute(
        models.workspace_members.delete()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
    )
    db.commit()
    return {"msg": "You have left the workspace"}


# --- INVITE ACCEPT/DECLINE ---

@app.get("/invites", response_model=list[schemas.PendingInviteResponse])
def list_pending_invites(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    rows = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.status == "pending")
    ).fetchall()
    result = []
    for row in rows:
        ws = db.query(models.Workspace).filter(models.Workspace.id == row.workspace_id).first()
        if ws:
            result.append(schemas.PendingInviteResponse(workspace_id=ws.id, workspace_name=ws.name))
    return result


@app.post("/workspaces/{workspace_id}/accept-invite")
def accept_invite(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.status == "pending")
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No pending invite found")

    db.execute(
        models.workspace_members.update()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .values(status="active")
    )
    db.commit()
    return {"msg": "Invite accepted"}


@app.delete("/workspaces/{workspace_id}/decline-invite")
def decline_invite(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.status == "pending")
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No pending invite found")

    db.execute(
        models.workspace_members.delete()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
    )
    db.commit()
    return {"msg": "Invite declined"}


# --- SECRET ROUTES ---

@app.post("/secrets/", response_model=schemas.SecretResponse)
def create_secret(
    secret: schemas.SecretCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == secret.workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == secret.workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
        .where(models.workspace_members.c.status == "active")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the workspace owner can add secrets")

    encrypted = crypto.encrypt_value(secret.plaintext_value)
    db_secret = models.Secret(
        key_name=secret.key_name,
        encrypted_value=encrypted,
        workspace_id=secret.workspace_id
    )
    db.add(db_secret)
    db.flush()
    log = models.AuditLog(user_email=current_user.email, action="CREATED_SECRET", target_id=db_secret.id, workspace_id=secret.workspace_id, secret_name=db_secret.key_name)
    db.add(log)
    db.commit()
    db.refresh(db_secret)
    return db_secret


@app.patch("/secrets/{secret_id}", response_model=schemas.SecretResponse)
def update_secret(
    secret_id: int,
    update: schemas.SecretUpdate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_secret = db.query(models.Secret).filter(models.Secret.id == secret_id).first()
    if not db_secret:
        raise HTTPException(status_code=404, detail="Secret not found")
    if not get_active_member_row(db, db_secret.workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == db_secret.workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the workspace owner can edit secrets")

    if update.key_name is not None and update.key_name.strip():
        db_secret.key_name = update.key_name.strip()
    if update.plaintext_value is not None:
        db_secret.encrypted_value = crypto.encrypt_value(update.plaintext_value)

    log = models.AuditLog(user_email=current_user.email, action="UPDATED_SECRET", target_id=db_secret.id, workspace_id=db_secret.workspace_id, secret_name=db_secret.key_name)
    db.add(log)
    db.commit()
    db.refresh(db_secret)
    return db_secret


@app.delete("/secrets/{secret_id}")
def delete_secret(
    secret_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_secret = db.query(models.Secret).filter(models.Secret.id == secret_id).first()
    if not db_secret:
        raise HTTPException(status_code=404, detail="Secret not found")
    if not get_active_member_row(db, db_secret.workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == db_secret.workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the workspace owner can delete secrets")

    key_name = db_secret.key_name
    workspace_id = db_secret.workspace_id
    log = models.AuditLog(user_email=current_user.email, action="DELETED_SECRET", target_id=secret_id, workspace_id=workspace_id, secret_name=key_name)
    db.add(log)
    db.delete(db_secret)
    db.commit()
    return {"msg": f"Secret '{key_name}' deleted"}


# --- SECRET REQUEST ROUTES ---

@app.post("/workspaces/{workspace_id}/secret-requests", response_model=schemas.SecretRequestResponse)
def create_secret_request(
    workspace_id: int,
    req: schemas.SecretRequestCreate,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    workspace = db.query(models.Workspace).filter(models.Workspace.id == workspace_id).first()
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if not get_active_member_row(db, workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")

    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if owner_row:
        raise HTTPException(status_code=400, detail="Owners can add secrets directly")

    encrypted = crypto.encrypt_value(req.plaintext_value)
    secret_req = models.SecretRequest(
        workspace_id=workspace_id,
        requester_email=current_user.email,
        key_name=req.key_name,
        encrypted_value=encrypted,
        status="pending"
    )
    db.add(secret_req)
    db.commit()
    db.refresh(secret_req)
    return secret_req


@app.get("/workspaces/{workspace_id}/secret-requests", response_model=list[schemas.SecretRequestResponse])
def list_secret_requests(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can view secret requests")

    return db.query(models.SecretRequest).filter(
        models.SecretRequest.workspace_id == workspace_id,
        models.SecretRequest.status == "pending"
    ).order_by(models.SecretRequest.id.desc()).all()


@app.get("/workspaces/{workspace_id}/secret-requests/{req_id}/preview")
def preview_secret_request(
    workspace_id: int,
    req_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can preview requests")

    secret_req = db.query(models.SecretRequest).filter(
        models.SecretRequest.id == req_id,
        models.SecretRequest.workspace_id == workspace_id
    ).first()
    if not secret_req:
        raise HTTPException(status_code=404, detail="Request not found")

    plaintext = crypto.decrypt_value(secret_req.encrypted_value)
    return {"key_name": secret_req.key_name, "plaintext": plaintext}


@app.post("/workspaces/{workspace_id}/secret-requests/{req_id}/approve", response_model=schemas.SecretResponse)
def approve_secret_request(
    workspace_id: int,
    req_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can approve requests")

    secret_req = db.query(models.SecretRequest).filter(
        models.SecretRequest.id == req_id,
        models.SecretRequest.workspace_id == workspace_id,
        models.SecretRequest.status == "pending"
    ).first()
    if not secret_req:
        raise HTTPException(status_code=404, detail="Request not found")

    new_secret = models.Secret(
        key_name=secret_req.key_name,
        encrypted_value=secret_req.encrypted_value,
        workspace_id=workspace_id
    )
    db.add(new_secret)
    db.flush()
    log = models.AuditLog(user_email=current_user.email, action="APPROVED_REQUEST", target_id=new_secret.id, workspace_id=workspace_id, secret_name=secret_req.key_name)
    db.add(log)
    secret_req.status = "approved"
    db.commit()
    db.refresh(new_secret)
    return new_secret


@app.delete("/workspaces/{workspace_id}/secret-requests/{req_id}")
def reject_secret_request(
    workspace_id: int,
    req_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can reject requests")

    secret_req = db.query(models.SecretRequest).filter(
        models.SecretRequest.id == req_id,
        models.SecretRequest.workspace_id == workspace_id,
        models.SecretRequest.status == "pending"
    ).first()
    if not secret_req:
        raise HTTPException(status_code=404, detail="Request not found")

    secret_req.status = "rejected"
    db.commit()
    return {"msg": "Request rejected"}


@app.get("/secrets/{secret_id}/reveal")
def reveal_secret(
    secret_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    db_secret = db.query(models.Secret).filter(models.Secret.id == secret_id).first()
    if not db_secret:
        raise HTTPException(status_code=404, detail="Secret not found")

    if not get_active_member_row(db, db_secret.workspace_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied")

    log = models.AuditLog(user_email=current_user.email, action="REVEALED_SECRET", target_id=secret_id, workspace_id=db_secret.workspace_id, secret_name=db_secret.key_name)
    db.add(log)
    db.commit()

    try:
        plaintext = crypto.decrypt_value(db_secret.encrypted_value)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"key_name": db_secret.key_name, "plaintext": plaintext}


# --- AUDIT LOG ROUTES ---

@app.get("/logs", response_model=list[schemas.AuditLogResponse])
def get_logs(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    # Get workspace IDs where current user is owner (direct query, no ORM lazy loading)
    owned_ws_rows = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchall()
    owned_ws_ids = [row.workspace_id for row in owned_ws_rows]

    # Get secret IDs from those workspaces
    owned_secret_ids = []
    if owned_ws_ids:
        owned_secrets = db.query(models.Secret).filter(
            models.Secret.workspace_id.in_(owned_ws_ids)
        ).all()
        owned_secret_ids = [s.id for s in owned_secrets]

    if owned_secret_ids:
        logs = db.query(models.AuditLog).filter(
            (models.AuditLog.user_email == current_user.email) |
            (models.AuditLog.target_id.in_(owned_secret_ids))
        ).order_by(models.AuditLog.id.desc()).all()
    else:
        logs = db.query(models.AuditLog).filter(
            models.AuditLog.user_email == current_user.email
        ).order_by(models.AuditLog.id.desc()).all()
    return logs


@app.get("/workspaces/{workspace_id}/logs", response_model=list[schemas.WorkspaceLogResponse])
def get_workspace_logs(
    workspace_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can view workspace logs")

    logs = db.query(models.AuditLog).filter(
        models.AuditLog.workspace_id == workspace_id,
        models.AuditLog.hidden_from_workspace == False
    ).order_by(models.AuditLog.id.desc()).all()

    return [
        schemas.WorkspaceLogResponse(
            id=log.id,
            user_email=log.user_email,
            action=log.action,
            secret_name=log.secret_name or f"secret #{log.target_id}",
            target_id=log.target_id,
            timestamp=log.timestamp
        )
        for log in logs
    ]


@app.delete("/workspaces/{workspace_id}/logs/{log_id}")
def hide_workspace_log(
    workspace_id: int,
    log_id: int,
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owner_row = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.workspace_id == workspace_id)
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchone()
    if not owner_row:
        raise HTTPException(status_code=403, detail="Only the owner can delete workspace logs")

    log = db.query(models.AuditLog).filter(
        models.AuditLog.id == log_id,
        models.AuditLog.workspace_id == workspace_id
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found")

    log.hidden_from_workspace = True
    db.commit()
    return {"msg": "Log entry removed from workspace activity"}


@app.delete("/logs")
def clear_all_logs(
    db: Session = Depends(database.get_db),
    current_user: models.User = Depends(get_current_user)
):
    owned_ws_rows = db.execute(
        models.workspace_members.select()
        .where(models.workspace_members.c.user_id == current_user.id)
        .where(models.workspace_members.c.role == "owner")
    ).fetchall()
    owned_ws_ids = [row.workspace_id for row in owned_ws_rows]

    if owned_ws_ids:
        db.query(models.AuditLog).filter(
            (models.AuditLog.user_email == current_user.email) |
            (models.AuditLog.workspace_id.in_(owned_ws_ids))
        ).delete(synchronize_session=False)
    else:
        db.query(models.AuditLog).filter(
            models.AuditLog.user_email == current_user.email
        ).delete(synchronize_session=False)

    db.commit()
    return {"msg": "Audit logs cleared"}
