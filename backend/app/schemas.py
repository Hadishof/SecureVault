from pydantic import BaseModel, EmailStr, field_validator
from datetime import datetime


class SecretCreate(BaseModel):
    key_name: str
    plaintext_value: str
    workspace_id: int

    @field_validator("key_name")
    @classmethod
    def key_name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("key_name cannot be empty")
        return v.strip()


class SecretResponse(BaseModel):
    id: int
    key_name: str
    workspace_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class MemberResponse(BaseModel):
    id: int
    email: str
    role: str
    status: str


class PendingInviteResponse(BaseModel):
    workspace_id: int
    workspace_name: str


class WorkspaceCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Workspace name cannot be empty")
        return v.strip()


class WorkspaceResponse(BaseModel):
    id: int
    name: str
    role: str | None = None

    class Config:
        from_attributes = True


class WorkspaceDetailResponse(BaseModel):
    id: int
    name: str
    members: list[MemberResponse] = []


class UserCreate(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class UserResponse(BaseModel):
    id: int
    email: EmailStr

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str


class ChangePassword(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_min_length(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class WorkspaceUpdate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Workspace name cannot be empty")
        return v.strip()


class SecretUpdate(BaseModel):
    key_name: str | None = None
    plaintext_value: str | None = None


class InviteUser(BaseModel):
    email: EmailStr


class AuditLogResponse(BaseModel):
    id: int
    user_email: str
    action: str
    target_id: int | None
    secret_name: str | None
    timestamp: datetime | None

    class Config:
        from_attributes = True


class SecretRequestCreate(BaseModel):
    key_name: str
    plaintext_value: str

    @field_validator("key_name")
    @classmethod
    def key_name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("key_name cannot be empty")
        return v.strip()


class SecretRequestResponse(BaseModel):
    id: int
    workspace_id: int
    requester_email: str
    key_name: str
    status: str
    created_at: datetime | None

    class Config:
        from_attributes = True


class WorkspaceLogResponse(BaseModel):
    id: int
    user_email: str
    action: str
    secret_name: str
    target_id: int | None
    timestamp: datetime | None
