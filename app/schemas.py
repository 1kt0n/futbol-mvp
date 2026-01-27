from pydantic import BaseModel, Field

class RegisterRequest(BaseModel):
    court_id: str = Field(..., description="UUID de la cancha elegida")

class GuestRequest(BaseModel):
    guest_name: str = Field(..., min_length=2, max_length=60)
    court_id: str = Field(..., description="UUID de la cancha elegida")

class MoveRequest(BaseModel):
    to_court_id: str = Field(..., description="UUID de la cancha destino")

class PinRegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=120)
    phone: str = Field(..., min_length=6, max_length=30)
    pin: str = Field(..., min_length=4, max_length=6)

class PinLoginRequest(BaseModel):
    phone: str = Field(..., min_length=6, max_length=30)
    pin: str = Field(..., min_length=4, max_length=6)


# ========== ADMIN EVENTS ==========
class CreateEventRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    starts_at: str = Field(..., description="ISO 8601 timestamp")
    location_name: str = Field(..., min_length=2, max_length=120)
    close_at: str | None = Field(None, description="ISO 8601 timestamp opcional")


class CreateCourtRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=60)
    capacity: int = Field(..., gt=0, le=50)
    sort_order: int = Field(default=1, ge=1)
    is_open: bool = Field(default=True)


class UpdateCourtRequest(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=60)
    capacity: int | None = Field(None, gt=0, le=50)
    sort_order: int | None = Field(None, ge=1)
    is_open: bool | None = None


class AssignCaptainRequest(BaseModel):
    user_id: str = Field(..., description="UUID del usuario a asignar como capitán")


# ========== ADMIN USERS ==========
class CreateUserRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=120)
    phone: str = Field(..., min_length=6, max_length=30)
    email: str | None = Field(None, max_length=120)
    pin: str | None = Field(None, min_length=4, max_length=6, description="PIN inicial opcional")
    roles: list[str] | None = Field(None, description="Lista opcional de códigos de roles: ['admin', 'super_admin']")


class UpdateUserRequest(BaseModel):
    is_active: bool


class ResetPinRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6)


class UpdateUserRolesRequest(BaseModel):
    roles: list[str] = Field(..., description="Lista de códigos de roles: ['admin', 'super_admin']")