from typing import Literal

from pydantic import BaseModel, Field, model_validator


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
    user_id: str = Field(..., description="UUID del usuario a asignar como capitan")


# ========== ADMIN USERS ==========
class CreateUserRequest(BaseModel):
    full_name: str = Field(..., min_length=3, max_length=120)
    phone: str = Field(..., min_length=6, max_length=30)
    email: str | None = Field(None, max_length=120)
    pin: str | None = Field(None, min_length=4, max_length=6, description="PIN inicial opcional")
    roles: list[str] | None = Field(None, description="Lista opcional de codigos de roles: ['admin', 'super_admin']")


class UpdateUserRequest(BaseModel):
    is_active: bool


class ResetPinRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6)


class UpdateUserRolesRequest(BaseModel):
    roles: list[str] = Field(..., description="Lista de codigos de roles: ['admin', 'super_admin']")


# ========== PROFILE ==========
class UpdateProfileRequest(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    nickname: str | None = Field(None, max_length=30)
    email: str | None = Field(None, max_length=120)
    ranking_opt_in: bool | None = None
    player_level: Literal["INICIAL", "RECREATIVO", "COMPETITIVO"] | None = None


# ========== RATINGS ==========
class SingleRating(BaseModel):
    target_user_id: str = Field(..., description="UUID del jugador a calificar")
    rating: float = Field(..., ge=1.0, le=5.0, description="Calificacion 1.0-5.0, step 0.5")
    comment: str | None = Field(None, max_length=500)
    attributes: list[str] | None = Field(
        default=None,
        min_length=2,
        max_length=2,
        description="Dos atributos elegidos para el jugador.",
    )


class SaveRatingsRequest(BaseModel):
    event_id: str = Field(..., description="UUID del evento")
    court_id: str = Field(..., description="UUID de la cancha")
    ratings: list[SingleRating] | None = Field(None, max_length=50)
    votes: list[SingleRating] | None = Field(None, max_length=50)

    @model_validator(mode="after")
    def normalize_votes(self):
        if not self.ratings and self.votes:
            self.ratings = self.votes

        if not self.ratings:
            raise ValueError("Debe enviar al menos un voto en 'ratings' o 'votes'.")

        if len(self.ratings) > 50:
            raise ValueError("Se permiten como maximo 50 votos por request.")

        return self


class RatingMini(BaseModel):
    avg: float
    votes: int


class AttributeCount(BaseModel):
    code: str
    count: int


class PlayerCardViewer(BaseModel):
    user_id: str
    ranking_opt_in: bool


class PlayerCardItem(BaseModel):
    registration_id: str
    subject_type: Literal["USER", "GUEST"]
    user_id: str | None = None
    full_name: str | None = None
    guest_name: str | None = None
    player_level: Literal["INICIAL", "RECREATIVO", "COMPETITIVO"] | None = None
    participates: bool
    reason: Literal["VIEWER_OPT_OUT", "TARGET_OPT_OUT", "GUEST"] | None = None
    rating: RatingMini | None = None
    top_attributes: list[AttributeCount] | None = None


class PlayerCardsResponse(BaseModel):
    viewer: PlayerCardViewer
    cards: list[PlayerCardItem]


# ========== NOTIFICATIONS ==========
class CreateNotificationRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=140)
    message: str = Field(..., min_length=5, max_length=1200)
    action_url: str | None = Field(None, max_length=500)
    expires_in_days: int = Field(
        default=7,
        ge=1,
        le=30,
        description="Cantidad de dias de vigencia de la notificacion.",
    )
