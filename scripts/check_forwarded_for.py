"""
¿El proxy de adelante deja pasar un X-Forwarded-For inventado por el cliente?

`app/utils/ratelimit.py::client_ip` arma la clave de los límites por IP con la primera
entrada de X-Forwarded-For. Eso es seguro solo si el proxy descarta la del cliente (el
borde de Railway lo hace: comprobado el 18/10/2026). Este script lo vuelve a comprobar
contra un deploy, usando el propio límite de /auth/pin/reset (10 por IP por hora):

  1. 11 POST con un X-Forwarded-For falso (203.0.113.x, rango de documentación);
  2. 1 POST sin el header.

Si el header falso se respeta, el cupo gastado es el de la IP falsa y el paso 2 da 403
(VULNERABLE). Si se descarta, el paso 2 cae en la misma clave y da 429 (OK).

Un OK solo prueba que el cliente no elige la clave, no que la clave sea SU IP: con un
proxy adelante que Railway vea como el cliente (p. ej. Cloudflare), la clave es la IP de
ese proxy, compartida por todos, y también da 429. Para descartarlo, repetir dentro de la
hora un POST sin el header desde otra red (p. ej. datos del celular): tiene que dar 403.

Usa un teléfono imposible (18 dígitos): siempre da 403 y no escribe nada en la base.
Efecto secundario: si da OK, tu IP queda limitada en /auth/pin/reset hasta 1 hora
(solo ese endpoint, que se usa después de un desbloqueo aprobado).

Uso (la URL es obligatoria para no pegarle a producción sin querer):
  python3 scripts/check_forwarded_for.py https://futbol-mvp-production.up.railway.app
"""
import json
import random
import sys
import urllib.error
import urllib.request

LIMIT = 10  # max_hits de pin-reset en app/routers/auth.py
BODY = json.dumps({"phone": "+999999999999999999", "pin": "4826"}).encode()


def post(base: str, headers: dict) -> int:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/auth/pin/reset",
        data=BODY,
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("http"):
        print(__doc__)
        return 2
    base = sys.argv[1]
    fake = f"203.0.113.{random.randint(1, 254)}"

    first = [post(base, {"X-Forwarded-For": fake}) for _ in range(LIMIT + 1)]
    print(f"1) {LIMIT + 1} con X-Forwarded-For {fake}: {first}")
    if 429 in first[:LIMIT]:
        print("   Ya había cupo gastado en esa clave: esperá 1 hora o probá desde otra red.")
        return 1
    plain = post(base, {})
    print(f"2) sin el header: {plain}")

    if plain == 429:
        print("OK: el X-Forwarded-For del cliente se descarta (el cliente no elige la clave).")
        print("   Falta ver que la clave sea por cliente: antes de 1 hora, desde otra red, un POST")
        print("   sin el header tiene que dar 403. Si da 429, la clave es la IP de un proxy compartido.")
        return 0
    if plain == 403:
        print("VULNERABLE: el X-Forwarded-For del cliente llega a la app y elige la clave del límite.")
        return 1
    print("No concluyente: respuesta inesperada.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
