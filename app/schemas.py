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


# ========== TOURNAMENTS ==========
TournamentStatus = Literal["DRAFT", "LIVE", "FINISHED", "ARCHIVED"]
TournamentFormat = Literal["ROUND_ROBIN", "KNOCKOUT", "GROUPS_PLAYOFFS"]
MatchStatus = Literal["PENDING", "LIVE", "FINISHED"]
MemberType = Literal["USER", "GUEST"]
PlayerLevel = Literal["INICIAL", "RECREATIVO", "COMPETITIVO"]


class TournamentCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=160)
    location_name: str | None = Field(None, max_length=160)
    starts_at: str | None = Field(None, description="ISO 8601 timestamp opcional")
    format: TournamentFormat = "ROUND_ROBIN"
    teams_count: int = Field(default=4, ge=2, le=16)
    minutes_per_match: int = Field(default=20, ge=5, le=120)


class TournamentUpdateRequest(BaseModel):
    title: str | None = Field(None, min_length=3, max_length=160)
    location_name: str | None = Field(None, max_length=160)
    starts_at: str | None = Field(None, description="ISO 8601 timestamp opcional")
    format: TournamentFormat | None = None
    teams_count: int | None = Field(default=None, ge=2, le=16)
    minutes_per_match: int | None = Field(default=None, ge=5, le=120)


class TournamentUpdateStatusRequest(BaseModel):
    status: TournamentStatus


class TournamentCreateTeamRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    logo_emoji: str | None = Field(default=None, max_length=8)
    is_guest: bool = False


class TournamentCreateMemberRequest(BaseModel):
    member_type: MemberType
    user_id: str | None = None
    guest_name: str | None = Field(default=None, min_length=2, max_length=120)
    level_override: PlayerLevel | None = None

    @model_validator(mode="after")
    def validate_member_payload(self):
        if self.member_type == "USER":
            if not self.user_id:
                raise ValueError("Para member_type=USER, user_id es obligatorio.")
            self.guest_name = None
        else:
            if not self.guest_name:
                raise ValueError("Para member_type=GUEST, guest_name es obligatorio.")
            self.user_id = None
        return self


class TournamentScorePatchRequest(BaseModel):
    home_goals: int = Field(..., ge=0)
    away_goals: int = Field(..., ge=0)


class TournamentOut(BaseModel):
    id: str
    title: str
    location_name: str | None
    starts_at: str | None
    status: TournamentStatus
    format: TournamentFormat
    teams_count: int
    minutes_per_match: int
    public_token: str
    public_url: str
    created_at: str
    updated_at: str


class TeamOut(BaseModel):
    id: str
    tournament_id: str
    name: str
    logo_emoji: str | None
    is_guest: bool
    created_at: str


class MemberOut(BaseModel):
    id: str
    tournament_id: str
    team_id: str
    member_type: MemberType
    user_id: str | None
    guest_name: str | None
    level_override: PlayerLevel | None
    created_at: str


class MatchTeamRef(BaseModel):
    id: str | None
    name: str
    emoji: str | None


class MatchOut(BaseModel):
    id: str
    tournament_id: str
    round: int
    sort_order: int
    status: MatchStatus
    home_goals: int
    away_goals: int
    home: MatchTeamRef
    away: MatchTeamRef
    started_at: str | None
    ended_at: str | None
    next_match_id: str | None = None
    next_slot: Literal["HOME", "AWAY"] | None = None


class PublicStandingRow(BaseModel):
    team_id: str
    team_name: str
    emoji: str | None
    pts: int
    pj: int
    pg: int
    pe: int
    pp: int
    gf: int
    gc: int
    dg: int


class PublicNowMatch(BaseModel):
    match_id: str
    round: int


class PublicBracketRound(BaseModel):
    round: int
    matches: list[MatchOut]


class PublicTournamentInfo(BaseModel):
    id: str
    title: str
    location_name: str | None
    starts_at: str | None
    status: TournamentStatus
    format: TournamentFormat
    minutes_per_match: int


class PublicTournamentLiveResponse(BaseModel):
    tournament: PublicTournamentInfo
    standings: list[PublicStandingRow]
    matches: list[MatchOut]
    now: PublicNowMatch | None
    bracket: list[PublicBracketRound]
    tiebreak_note: str | None = None


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
