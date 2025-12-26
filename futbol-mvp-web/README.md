# Futbol MVP

## Requisitos
- Python 3.11+ (recomendado)
- Node 18+ / npm

---

## Backend (API)
```bash
cd futbol-mvp-api
python -m venv venv
source venv/bin/activate   # (Windows: venv\Scripts\activate)
pip install -r requirements.txt

cp .env.example .env
# editar DATABASE_URL en .env

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload