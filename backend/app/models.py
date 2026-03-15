from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, ForeignKey, Table, DateTime, Boolean, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

workspace_members = Table(
    "workspace_members",
    Base.metadata,
    Column("user_id", ForeignKey("users.id"), primary_key=True),
    Column("workspace_id", ForeignKey("workspaces.id"), primary_key=True),
    Column("role", String, server_default="viewer"),
    Column("status", String, server_default="active")  # active | pending
)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    workspaces = relationship("Workspace", secondary=workspace_members, back_populates="members")

class Workspace(Base):
    __tablename__ = "workspaces"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    members = relationship("User", secondary=workspace_members, back_populates="workspaces")
    secrets = relationship("Secret", back_populates="workspace")

class Secret(Base):
    __tablename__ = "secrets"
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=False, index=True)
    key_name = Column(String, nullable=False)
    encrypted_value = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    workspace = relationship("Workspace", back_populates="secrets")

class SecretRequest(Base):
    __tablename__ = "secret_requests"
    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_email = Column(String, nullable=False)
    key_name = Column(String, nullable=False)
    encrypted_value = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending / approved / rejected
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now(), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False)
    target_id = Column(Integer)
    workspace_id = Column(Integer, ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), server_default=func.now(), nullable=False)
    secret_name = Column(String, nullable=True)
    hidden_from_workspace = Column(Boolean, default=False, server_default="false", nullable=False)
