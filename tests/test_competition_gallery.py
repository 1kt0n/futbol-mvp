"""
Tests de "Reviví tu partido" (app/utils/competition_gallery.py): a qué partido o equipo se vincula
cada carpeta de Drive según su nombre, y el armado de la galería. Sin red ni base de datos.

Correr:  ./.venv/bin/python tests/test_competition_gallery.py
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "postgresql://x/x")  # app.settings exige la variable (no se conecta)

from app.utils import competition_gallery as g  # noqa: E402

ART = dt.timezone(dt.timedelta(hours=-3))
SAT, SUN = dt.date(2026, 10, 10), dt.date(2026, 10, 11)
T = {name: f"00000000-0000-0000-0000-{i:012d}" for i, name in enumerate([
    "Dogos", "Dogos Seniors", "Zorros", "Rayos.cba", "Rayos.cba II", "Grindr FC", "Lux Fútbol Club I", "Real Players",
])}


def _m(code, day, hhmm, court, home=None, away=None, status="SCHEDULED"):
    h, mi = map(int, hhmm.split(":"))
    return {"code": code, "venue_id": f"v{court}", "status": status,
            "scheduled_at": dt.datetime(day.year, day.month, day.day, h, mi, tzinfo=ART),
            "home_team_id": T.get(home), "away_team_id": T.get(away)}


STATE = {
    "venues": [{"id": f"v{n}", "number": n} for n in (9, 10, 11, 13, 14, 15)],
    "teams": [{"id": tid, "name": name, "short_name": None} for name, tid in T.items()],
    "matches": [
        _m("A-1v2", SAT, "11:00", 9, "Dogos", "Zorros", "FINISHED"),
        _m("A-3v4", SAT, "11:00", 10, "Rayos.cba", "Grindr FC", "FINISHED"),
        _m("B-1v2", SAT, "11:50", 9, "Dogos Seniors", "Rayos.cba II", "LIVE"),
        _m("B-3v4", SAT, "11:30", 13, "Lux Fútbol Club I", "Real Players"),
        _m("ORO-O1", SUN, "11:00", 9),
        _m("ORO-C1", SUN, "15:00", 13, "Dogos", "Zorros"),
        _m("ORO-F", SUN, "18:10", 9),
    ],
}
CTX = g.link_context(STATE, "-03:00")


def link(name, **kw):
    return g.auto_link(name, CTX, **kw)


def test_court_and_time_with_day_in_the_name():
    assert link("Sáb 11:00 · Cancha 9") == "M:A-1v2"
    assert link("SABADO - C10 - 11hs") == "M:A-3v4"
    assert link("10/10 Cancha 9 11.50") == "M:B-1v2"
    assert link("Dom 11:00 C9") == "M:ORO-O1"
    assert link("domingo cancha 9 18:10 FINAL") == "M:ORO-F"


def test_day_from_parent_folder_or_creation_date():
    assert link("Cancha 13 11.30", parent="Sábado") == "M:B-3v4"
    assert link("C9 11:00", created_at="2026-10-11T14:05:00Z") == "M:ORO-O1"  # 11:05 en Argentina
    # Sin día por ningún lado y con partido a esa hora en las dos fechas: no adivina
    assert link("Cancha 9 11:00") is None


def test_time_tolerance_and_dotted_date_is_not_a_time():
    assert link("Sáb C9 11:10") == "M:A-1v2"            # dentro de los 25 min
    assert link("Sáb C9 12:30") is None                  # lejos de todo partido de esa cancha
    assert link("10.10 C9 11.50") == "M:B-1v2"           # "10.10" es la fecha, no la hora


def test_match_code_wins():
    assert link("a-1v2 fotos") == "M:A-1v2"
    assert link("ORO-C1") == "M:ORO-C1"
    assert link("X-9v9") is None


def test_two_teams_and_longest_name_wins():
    # Dogos y Zorros jugaron dos veces: sin día, el ya jugado; con día, el de ese día.
    assert link("Dogos vs Zorros") == "M:A-1v2"
    assert link("Domingo · Dogos vs Zorros") == "M:ORO-C1"
    assert link("Dogos Seniors vs Rayos.cba II") == "M:B-1v2"
    assert link("Lux Futbol Club I - Real Players") == "M:B-3v4"


def test_single_team_album():
    assert link("Dogos Seniors") == f"T:{T['Dogos Seniors']}"
    assert link("Grindr") == f"T:{T['Grindr FC']}"
    assert link("Ambiente y premiación") is None


def test_parse_folder_id():
    fid = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345"
    assert g.parse_folder_id(f"https://drive.google.com/drive/folders/{fid}?usp=sharing") == fid
    assert g.parse_folder_id(f"https://drive.google.com/drive/u/1/folders/{fid}") == fid
    assert g.parse_folder_id(f"https://drive.google.com/open?id={fid}") == fid
    assert g.parse_folder_id(fid) == fid
    assert g.parse_folder_id("https://example.com/nada") is None
    assert g.parse_folder_id("") is None


def test_valid_link():
    assert g.valid_link(None, CTX)
    assert g.valid_link("M:A-1v2", CTX) and g.valid_link("M:ORO-F", CTX)
    assert g.valid_link(f"T:{T['Zorros']}", CTX)
    assert g.valid_link("G", CTX) and g.valid_link("X", CTX)
    assert not g.valid_link("M:Z-1v2", CTX)
    assert not g.valid_link("T:00000000-0000-0000-0000-999999999999", CTX)
    assert not g.valid_link("algo", CTX)


def _photo(i, w=3000, h=2000, t=None):
    return {"id": f"photo{i:06d}xx", "w": w, "h": h, "t": t, "c": f"2026-10-10T14:{i:02d}:00Z"}


def test_resolve_manual_beats_auto_and_hidden():
    tree = {"root": {"id": "rootfolder00", "name": "Fotos"}, "fetched_at": 1.0, "albums": [
        {"id": "rootfolder00", "name": "Fotos", "path": "Fotos", "parent": None, "created_at": None,
         "is_root": True, "photos": [_photo(1)]},
        {"id": "albumcancha9", "name": "Sáb 11:00 Cancha 9", "path": "Sáb 11:00 Cancha 9", "parent": None,
         "created_at": None, "is_root": False, "photos": [_photo(2, 2000, 3000), _photo(3)]},
        {"id": "albumdogos00", "name": "Dogos vs Zorros", "path": "Dogos vs Zorros", "parent": None,
         "created_at": None, "is_root": False, "photos": [_photo(4)]},
        {"id": "albumoculto0", "name": "Backstage", "path": "Backstage", "parent": None,
         "created_at": None, "is_root": False, "photos": [_photo(5)]},
    ]}
    links = {"albumdogos00": "M:ORO-C1", "albumoculto0": "X", "albumcancha9": "M:NO-EXISTE"}
    albums = {a["id"]: a for a in g.resolve_albums(tree, CTX, links)}
    assert albums["rootfolder00"]["link"] is None and albums["rootfolder00"]["auto"] is None
    assert albums["albumcancha9"]["link"] == {"type": "match", "code": "A-1v2"}  # manual inválido → automático
    assert albums["albumdogos00"]["link"] == {"type": "match", "code": "ORO-C1"}  # manual gana
    assert albums["albumdogos00"]["auto"] == "M:A-1v2"
    assert albums["albumoculto0"]["hidden"] is True

    s = g.album_summary(albums["albumcancha9"])
    assert s["count"] == 2 and s["cover"]["id"] == "photo000003xx"  # portada: la primera horizontal
    assert s["last_photo_at"] == "2026-10-10T14:03:00Z"
    assert set(g.public_photo(_photo(1))) == {"id", "w", "h", "t"}


def test_photo_metadata_rotation_and_order():
    rotated = g._photo({"id": "a", "imageMediaMetadata": {"width": 4000, "height": 3000, "rotation": 1,
                                                          "time": "2026:10:10 11:05:00"}})
    assert (rotated["w"], rotated["h"], rotated["t"]) == (3000, 4000, "2026-10-10T11:05:00")
    photos = g._sort_photos([
        {"id": "b", "t": "2026-10-10T11:07:00", "c": "x"},
        {"id": "a", "t": None, "c": "2026-10-10T11:06:00Z"},
        {"id": "c", "t": "2026-10-10T11:01:00", "c": "x"},
    ])
    assert [p["id"] for p in photos] == ["c", "a", "b"]


def test_drive_cache_serves_stale_and_refreshes_in_background():
    import threading
    import time

    calls = []
    fail = {"on": False}
    done = threading.Event()

    def fake_fetch(root_id):
        calls.append(root_id)
        if fail["on"]:
            done.set()
            raise g.DriveError("DRIVE_UNAVAILABLE")
        tree = {"root": {"id": root_id, "name": "x"}, "albums": [], "fetched_at": time.time(), "n": len(calls)}
        done.set()
        return tree

    real = g.fetch_tree
    g.fetch_tree = fake_fetch
    try:
        g.forget()
        t1 = g.drive_tree("rootAAAAAAAA")                     # en frío: lee en el momento
        assert t1["n"] == 1 and g.drive_tree("rootAAAAAAAA") is t1 and len(calls) == 1  # fresco: caché

        g._drive["rootAAAAAAAA"]["checked"] -= g.DRIVE_TTL + 1  # vencido
        done.clear()
        assert g.drive_tree("rootAAAAAAAA") is t1               # devuelve lo viejo al instante…
        assert done.wait(2)                                     # …y refresca en segundo plano
        for _ in range(50):
            if "rootAAAAAAAA" not in g._refreshing:
                break
            time.sleep(0.02)
        assert g.drive_tree("rootAAAAAAAA")["n"] == 2

        # Drive caído: se sigue mostrando lo último y no se reintenta en cada request
        fail["on"] = True
        g._drive["rootAAAAAAAA"]["checked"] -= g.DRIVE_TTL + 1
        done.clear()
        assert g.drive_tree("rootAAAAAAAA")["n"] == 2
        assert done.wait(2)
        for _ in range(50):
            if "rootAAAAAAAA" not in g._refreshing:
                break
            time.sleep(0.02)
        n = len(calls)
        assert g.drive_tree("rootAAAAAAAA")["n"] == 2 and len(calls) == n  # espera RETRY_AFTER_ERROR

        # En frío y con Drive caído: error explícito (el sitio pasa a la carpeta embebida)
        g.forget()
        try:
            g.drive_tree("rootBBBBBBBB")
            raise AssertionError("debió fallar")
        except g.DriveError as e:
            assert e.code == "DRIVE_UNAVAILABLE"
    finally:
        g.fetch_tree = real
        g.forget()


def test_no_api_key_means_drive_not_configured():
    old = os.environ.pop("GOOGLE_DRIVE_API_KEY", None)
    try:
        g._get("files", {})
        raise AssertionError("debió fallar")
    except g.DriveError as e:
        assert e.code == "DRIVE_NOT_CONFIGURED"
    finally:
        if old is not None:
            os.environ["GOOGLE_DRIVE_API_KEY"] = old


def _run_all():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  ✓ {t.__name__}")
    print(f"\nOK: {len(tests)}/{len(tests)} tests de la galería pasaron")


if __name__ == "__main__":
    _run_all()
