# Futbol MVP API

API backend para organizar partidos de fútbol, gestionar inscripciones de jugadores, invitados y listas de espera.

## Características

- **Autenticación por PIN**: Login simple usando teléfono + PIN (4 o 6 dígitos)
- **Gestión de Eventos**: Ver eventos activos, canchas disponibles y cupos
- **Inscripciones**: Registrarse como usuario o agregar invitados
- **Lista de Espera**: Manejo automático cuando las canchas están llenas
- **Administración**: Mover jugadores entre canchas y cancelar inscripciones (requiere rol admin/capitán)

## Stack Tecnológico

- **FastAPI** - Framework web moderno para Python
- **SQLAlchemy** - ORM para PostgreSQL
- **PostgreSQL** - Base de datos
- **Pydantic** - Validación de datos
- **PBKDF2** - Hashing seguro de PINs

## Estructura del Proyecto

```
futbol-mvp-api/
├── app/
│   ├── main.py              # Aplicación FastAPI + routers
│   ├── settings.py          # Configuración DB + CORS
│   ├── schemas.py           # Modelos Pydantic
│   │
│   ├── utils/
│   │   ├── security.py      # Funciones de hash/verify PIN
│   │   └── phone.py         # Normalización de teléfonos
│   │
│   └── routers/
│       ├── auth.py          # Endpoints de autenticación
│       └── events.py        # Endpoints de eventos y registraciones
│
├── requirements.txt         # Dependencias Python
├── .env                     # Variables de entorno (no versionado)
├── .env.example             # Template de variables de entorno
├── .gitignore
└── README.md
```

## Requisitos Previos

- Python 3.10+
- PostgreSQL 14+
- Git

## Instalación

### 1. Clonar el repositorio

```bash
git clone <repo-url>
cd futbol-mvp-api
```

### 2. Crear entorno virtual

```bash
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Configurar variables de entorno

Copia el archivo de ejemplo y editalo con tus credenciales:

```bash
cp .env.example .env
```

Edita `.env`:

```env
DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/futbol_mvp
```

### 5. Configurar la base de datos

Asegurate de tener PostgreSQL corriendo y las siguientes tablas creadas:

- `users`
- `roles`
- `user_roles`
- `events`
- `event_courts`
- `event_registrations`
- `event_captains`
- `event_audit_log`

(Ver sección de base de datos más abajo)

## Ejecutar la aplicación

### Desarrollo

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

La API estará disponible en:
- http://localhost:8000
- http://127.0.0.1:8000
- http://192.168.0.57:8000 (o tu IP local)

### Documentación Interactiva

Una vez que la API esté corriendo, podés acceder a:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Endpoints Disponibles

### Auth (`/auth/*`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/auth/pin/register` | Registrar nuevo usuario con PIN |
| POST | `/auth/pin/login` | Login con teléfono + PIN |
| GET | `/auth/me` | Info básica del usuario autenticado |
| GET | `/me` | Info detallada del usuario autenticado |

### Events (`/events/*`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/events/active` | Obtener evento activo con canchas y jugadores |
| POST | `/events/{event_id}/register` | Auto-inscribirse en un evento |
| POST | `/events/{event_id}/guests` | Registrar invitado (máx 10 por usuario) |

### Registrations (`/registrations/*`)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/registrations/{id}/move` | Mover inscripción entre canchas (admin/capitán) |
| POST | `/registrations/{id}/cancel` | Cancelar inscripción (admin/capitán) |

### Health

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Status básico de la API |
| GET | `/db-check` | Verificar conectividad con DB |
| GET | `/__whoami` | Versión del código |

## Autenticación

La API usa un header personalizado para autenticación:

```
X-Actor-User-Id: <uuid-del-usuario>
```

**Flujo de autenticación:**

1. Usuario se registra o hace login → recibe `actor_user_id`
2. Frontend guarda el `actor_user_id` (localStorage/state)
3. Cada request incluye el header `X-Actor-User-Id`

**Ejemplo con cURL:**

```bash
curl -X GET http://localhost:8000/me \
  -H "X-Actor-User-Id: 123e4567-e89b-12d3-a456-426614174000"
```

## Base de Datos

### Schema Principal (PostgreSQL)

```sql
-- Usuarios
users (id, full_name, email, phone_e164, phone_login, is_active, pin_salt, pin_hash, created_at, updated_at)

-- Roles
roles (id, code)
user_roles (user_id, role_id)

-- Eventos
events (id, title, starts_at, location_name, status, close_at)
event_courts (id, event_id, name, capacity, is_open, sort_order)
event_registrations (id, event_id, registration_type, status, court_id, created_by_user_id, user_id, guest_name, created_at, updated_at, cancelled_at)
event_captains (event_id, user_id)
event_audit_log (id, event_id, actor_user_id, action, target_registration_id, metadata, created_at)
```

### Estados de Inscripción

- **CONFIRMED**: Jugador confirmado en una cancha
- **WAITLIST**: En lista de espera (sin cancha asignada)
- **CANCELLED**: Inscripción cancelada

### Lógica de Negocio

- Si hay cupo → inscripción CONFIRMED
- Si no hay cupo → inscripción WAITLIST
- Al cancelar/mover → promueve automáticamente desde waitlist
- Límite: 10 invitados por usuario por evento

## CORS

Por defecto, la API acepta requests desde:

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://192.168.0.57:5173`

Para modificar los orígenes permitidos, edita `app/settings.py`:

```python
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://tu-dominio.com",
]
```

## Desarrollo

### Estructura de Código

- **[app/main.py](app/main.py)**: Inicialización de FastAPI + registro de routers
- **[app/settings.py](app/settings.py)**: Configuración centralizada (DB, CORS)
- **[app/schemas.py](app/schemas.py)**: Modelos Pydantic para request/response
- **[app/routers/auth.py](app/routers/auth.py)**: Endpoints de autenticación
- **[app/routers/events.py](app/routers/events.py)**: Endpoints de eventos y registraciones
- **[app/utils/security.py](app/utils/security.py)**: Hash y verificación de PINs
- **[app/utils/phone.py](app/utils/phone.py)**: Normalización de números telefónicos

### Agregar Nuevos Endpoints

1. Crear/editar router en `app/routers/`
2. Agregar schema en `app/schemas.py` si es necesario
3. Registrar router en `app/main.py` si es nuevo

Ejemplo:

```python
# app/routers/nuevo.py
from fastapi import APIRouter
router = APIRouter()

@router.get("/nuevo/endpoint")
def nuevo_endpoint():
    return {"mensaje": "hola"}

# app/main.py
from app.routers import nuevo
app.include_router(nuevo.router, tags=["Nuevo"])
```

## Seguridad

- **PINs hasheados**: PBKDF2-SHA256 con 120,000 iteraciones
- **Salt único**: Cada usuario tiene su propio salt aleatorio (32 caracteres hex)
- **Comparación segura**: Usa `hmac.compare_digest()` para prevenir timing attacks
- **Validación de roles**: Admin/Capitán requerido para operaciones sensibles

## Deployment

### Variables de Entorno en Producción

```env
DATABASE_URL=postgresql+psycopg2://user:pass@prod-host:5432/db
```

### Comando de Inicio

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Para producción, considera usar:
- **Gunicorn** + Uvicorn workers
- **Docker** para containerización
- **Reverse proxy** (Nginx/Caddy)
- **HTTPS** con certificados SSL

## Frontend

El frontend está en el directorio `futbol-mvp-web/`:

```bash
cd futbol-mvp-web
npm install
npm run dev -- --host
```

## Troubleshooting

### Error: "DATABASE_URL no está definida"

Asegurate de tener el archivo `.env` en la raíz del proyecto con la variable `DATABASE_URL`.

### Error: CORS

Si el frontend no puede conectarse, verifica que el origen esté en `CORS_ORIGINS` en [app/settings.py](app/settings.py).

### Error: "Usuario ya está inscripto"

Cada usuario solo puede tener una inscripción USER por evento. Los invitados son independientes.

### Puerto 8000 ya en uso

```bash
# Buscar proceso usando el puerto
lsof -i :8000

# O usar otro puerto
uvicorn app.main:app --port 8001
```

## Licencia

MIT

## Contacto

Para preguntas o sugerencias, abrir un issue en el repositorio.

---

Desarrollado con FastAPI
