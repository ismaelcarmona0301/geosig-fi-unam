"""Valida las tres capas del visor y su enlace con kpi_data.json (QA/QC, paquetes 1.2.4 y 1.5.1).

Uso:  python scripts/validar_geojson.py
Sale con código 1 si hay errores.

Revisa: campos obligatorios y dominios, coordenadas dentro de CU, anillos cerrados,
auto-intersecciones, ids únicos, recintos dentro de su edificio, traslapes
(recintos del mismo nivel, áreas comunes entre sí y contra edificios) y que cada
zona simulada tenga serie en kpi_data.json sin rebasar su capacidad.
"""
import json
import sys
from pathlib import Path

import geo_utils as gu

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
BBOX_CU = (-99.200, 19.300, -99.170, 19.340)
TOL_TRASLAPE_M2 = 5.0      # tolerancia para astillas de digitalización

OBLIG = {
    "edificios": {"id_edificio": str, "nombre": str, "niveles": int, "superficie_m2": (int, float)},
    "recintos": {"id_recinto": str, "nombre": str, "tipo": str, "id_edificio": str, "nivel": int,
                 "capacidad_max": int, "superficie_m2": (int, float)},
    "areas_comunes": {"id_recinto": str, "nombre": str, "tipo": str, "subtipo": str, "superficie_m2": (int, float)},
}
DOMINIOS = {
    "recintos": {"tipo": {"sala_computo", "biblioteca", "laboratorio", "instalacion_general"}},
    "areas_comunes": {"tipo": {"area_comun", "estacionamiento", "area_verde", "otro"}},
}

errores, avisos = [], []


def cargar(nombre):
    ruta = DATA / f"{nombre}.geojson"
    if not ruta.exists():
        errores.append(f"Falta data/{nombre}.geojson (corre scripts/preparar_capas.py)")
        return []
    return json.loads(ruta.read_text(encoding="utf-8"))["features"]


def revisar_capa(nombre, feats, clave):
    ids = set()
    for i, f in enumerate(feats):
        pr, geom = f["properties"], f.get("geometry") or {}
        et = f"{nombre}/{pr.get(clave, f'#{i}')}"
        for campo, tipo in OBLIG[nombre].items():
            if pr.get(campo) in (None, ""):
                errores.append(f"{et}: falta '{campo}'")
            elif not isinstance(pr[campo], tipo):
                errores.append(f"{et}: '{campo}' es {type(pr[campo]).__name__}")
        for campo, dom in DOMINIOS.get(nombre, {}).items():
            if pr.get(campo) not in dom:
                errores.append(f"{et}: {campo}='{pr.get(campo)}' fuera del dominio {sorted(dom)}")
        if pr.get(clave) in ids:
            errores.append(f"{et}: {clave} duplicado")
        ids.add(pr.get(clave))
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            errores.append(f"{et}: geometría {geom.get('type')}")
            continue
        bruto = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poli in bruto:
            for anillo in poli:
                if anillo[0] != anillo[-1]:
                    errores.append(f"{et}: anillo sin cerrar")
                if any(not (BBOX_CU[0] <= p[0] <= BBOX_CU[2] and BBOX_CU[1] <= p[1] <= BBOX_CU[3]) for p in anillo):
                    errores.append(f"{et}: coordenadas fuera de CU (¿exportado en EPSG:6369 en vez de 4326?)")
                    break
        for p in gu.poligonos(geom):
            for anillo in p:
                if gu.auto_interseccion(anillo):
                    errores.append(f"{et}: auto-intersección")
        if pr.get("campos_estimados"):
            avisos.append(f"{et}: estimados → {', '.join(pr['campos_estimados'])}")
    return ids


def traslapes(grupo_a, grupo_b, etiqueta, misma_capa=False, condicion=lambda a, b: True):
    """Compara geometrías por muestreo de 1 m; ignora bordes compartidos."""
    for i, (ida, pa, pts, fa) in enumerate(grupo_a):
        candidatos = grupo_b[i + 1:] if misma_capa else grupo_b
        for idb, pb, _, fb in candidatos:
            if ida == idb or not condicion(fa, fb):
                continue
            ax0, ay0, ax1, ay1 = gu.bbox(pa)
            bx0, by0, bx1, by1 = gu.bbox(pb)
            if ax1 < bx0 or bx1 < ax0 or ay1 < by0 or by1 < ay0:
                continue
            m2 = gu.traslape_m2(pts, pb)
            if m2 > TOL_TRASLAPE_M2:
                errores.append(f"Traslape {etiqueta}: {ida} y {idb} (~{m2:.0f} m²)")


def main():
    ed = cargar("edificios")
    rc = cargar("recintos")
    ac = cargar("areas_comunes")
    ids_ed = revisar_capa("edificios", ed, "id_edificio")
    ids_rc = revisar_capa("recintos", rc, "id_recinto")
    ids_ac = revisar_capa("areas_comunes", ac, "id_recinto")
    for d in ids_rc & ids_ac:
        errores.append(f"id_recinto repetido en recintos y áreas comunes: {d}")

    prep = lambda feats, clave: [(f["properties"][clave], gu.poligonos(f["geometry"]),
                                  gu.muestras(gu.poligonos(f["geometry"]), 1.0), f["properties"]) for f in feats]
    G_ed, G_rc, G_ac = prep(ed, "id_edificio"), prep(rc, "id_recinto"), prep(ac, "id_recinto")
    geo_ed = {g[0]: g[1] for g in G_ed}

    # Recintos dentro de su edificio
    for rid, polis, pts, pr in G_rc:
        e = pr.get("id_edificio")
        if e not in geo_ed:
            errores.append(f"recintos/{rid}: id_edificio '{e}' no existe en edificios")
            continue
        frac = gu.traslape_m2(pts, geo_ed[e]) / max(len(pts), 1)
        if frac < 0.9:
            errores.append(f"recintos/{rid}: solo el {frac:.0%} cae dentro del edificio {e}")
        if pr.get("nivel", 0) >= next(f["properties"]["niveles"] for f in ed if f["properties"]["id_edificio"] == e):
            avisos.append(f"recintos/{rid}: nivel {pr['nivel']} ≥ niveles del edificio {e}")

    traslapes(G_rc, G_rc, "entre recintos del mismo nivel", True, lambda a, b: a.get("nivel") == b.get("nivel"))
    traslapes(G_ac, G_ac, "entre áreas comunes", True)
    traslapes(G_ac, G_ed, "área común sobre edificio")

    # Enlace con el dataset
    kpi_ruta = DATA / "kpi_data.json"
    if kpi_ruta.exists():
        kpi = json.loads(kpi_ruta.read_text(encoding="utf-8"))
        n = len(kpi["meta"]["horas"])
        simuladas = {f["properties"]["id_recinto"] for f in rc + ac if f["properties"].get("simular", True)}
        for d in simuladas - set(kpi["recintos"]):
            errores.append(f"{d}: se simula pero no está en kpi_data.json (corre scripts/generar_kpi.py)")
        for d in set(kpi["recintos"]) - simuladas:
            errores.append(f"{d}: está en kpi_data.json pero no en las capas")
        for rid, r in kpi["recintos"].items():
            for esc, dias in r["perfiles"].items():
                for dia, p in dias.items():
                    if len(p["ocupacion"]) != n or max(p["ocupacion"]) > r["capacidad_max"] or min(p["ocupacion"]) < 0:
                        errores.append(f"{rid}/{esc}/{dia}: serie inválida o fuera de capacidad")
    else:
        avisos.append("Sin data/kpi_data.json todavía")

    for a in avisos:
        print("AVISO  ", a)
    for e in errores:
        print("ERROR  ", e)
    print(f"\n{len(ed)} edificios · {len(rc)} recintos · {len(ac)} áreas comunes · {len(errores)} errores · {len(avisos)} avisos")
    sys.exit(1 if errores else 0)


if __name__ == "__main__":
    main()
