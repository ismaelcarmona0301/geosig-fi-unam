"""Normaliza las capas exportadas de QGIS y rellena los atributos faltantes.

Uso:  python scripts/preparar_capas.py

Entrada  (exportadas de QGIS, EPSG:4326):  data/qgis/edificios.geojson
                                            data/qgis/recintos.geojson
                                            data/qgis/areas_comunes.geojson
Salida   (las que lee el visor):            data/edificios.geojson
                                            data/recintos.geojson
                                            data/areas_comunes.geojson
Revisión (para el equipo):                  docs/revision_atributos.csv

Reglas:
- Si un campo viene capturado en QGIS, se respeta tal cual.
- Si falta, se calcula (superficie, edificio contenedor, conjunto) o se estima
  (tipo, capacidad, estado físico...). Cada objeto lleva `campos_estimados`
  con la lista de lo que se estimó, y el visor lo marca como "(estimado)".
"""
import csv
import json
import re
import unicodedata
import zlib
from pathlib import Path

import geo_utils as gu

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "data" / "qgis"
SALIDA = RAIZ / "data"
REVISION = RAIZ / "docs" / "revision_atributos.csv"

LAT_CORTE_CONJUNTOS = 19.3295

# Áreas de descanso (criterio del equipo): todas las áreas comunes y verdes, EXCEPTO estacionamientos,
# zonas restringidas, la entrada del Anexo, el Instituto de Ingeniería y el Área de Posgrado.
NO_DESCANSO = r"entrada anexo|instituto|[aá]rea de posgrado|restringid"
DESCANSO_PRINCIPAL = r"tren|jardineras fi|bicentenario"
# Wi-Fi estimado: m² por punto de acceso en exteriores (0 = sin cobertura)
M2_POR_AP = {"plaza": 1500, "pasillo": 1500, "acceso": 600, "descanso": 700, "cancha": 0, "jardin": 2500}   # norte de esta latitud = Conjunto Norte; al sur = Conjunto Sur (Anexo)

# Acentos que QGIS suele perder al capturar
# Uso de cada edificio según el croquis oficial de la FI (www.ingenieria.unam.mx/pdf/croquis.pdf)
USO_OFICIAL = {
    "A": ("mixto", "Edificio de la Dirección; Auditorio Javier Barros Sierra y Biblioteca Antonio Dovalí Jaime"),
    "B": ("aulas", "Edificio de salones"),
    "C": ("aulas", "Edificio de salones; laboratorios de Ingeniería Industrial y Ciencias de la Tierra"),
    "D": ("aulas", "Edificio de salones; laboratorios de Ingeniería Eléctrica y Civil; Aula Magna"),
    "E": ("administrativo", "UNICA / USECAD; EDUCAFI, Movilidad Estudiantil, Comunicación"),
    "F": ("laboratorios", "Laboratorios de Ingeniería de Minas y Metalurgia"),
    "G": ("laboratorios", "Laboratorios de la División de Ciencias Básicas"),
    "H": ("laboratorios", "Laboratorios de la División de Ciencias Básicas"),
    "I": ("aulas", "Torre de salones"),
    "J": ("mixto", "Ala poniente; coordinaciones académicas de la DCB"),
    "K": ("mixto", "Centro de Docencia Gilberto Borja Navarrete"),
    "L": ("biblioteca", "Biblioteca Enrique Rivero Borrell"),
    "M": ("mixto", "Auditorio Sotero Prieto; COPADI (becas, tutoría)"),
    "N": ("laboratorios", "Laboratorio de Termofluidos"),
    "O": ("laboratorios", "Centro de Diseño Mecánico e Innovación Tecnológica"),
    "P": ("administrativo", "División de Ingeniería Eléctrica"),
    "Q": ("laboratorios", "Edificio Luis G. Valdés Vallejo; laboratorios de Computación, Electrónica y Telecomunicaciones"),
    "R": ("mixto", "División de Ingenierías Civil y Geomática"),
    "S": ("aulas", "Edificio de posgrado"),
    "T": ("administrativo", "Edificio Bernardo Quintana Arrioja; Secretarías de Posgrado e Investigación y de Apoyo a la Docencia"),
    "U": ("aulas", "Salones para posgrado y tutorías"),
    "V": ("laboratorios", "Laboratorios de posgrado"),
    "W": ("biblioteca", "Biblioteca Enzo Levi"),
    "X": ("laboratorios", "Centro de Ingeniería Avanzada"),
    "Y": ("aulas", "Continuación ala poniente; nuevos salones"),
    "JCB": ("administrativo", "Jefatura de la División de Ciencias Básicas"),
}

ACENTOS = {"Biblioteca Antonio D": "Biblioteca Antonio Dovalí Jaime", "computo": "cómputo", "Computo": "Cómputo", "Fotogrametria": "Fotogrametría", "fotogrametria": "fotogrametría",
           "Raul": "Raúl", "Ingenieria": "Ingeniería", "Area": "Área", "area": "área", "Jardin": "Jardín",
           "Geomatico": "Geomático", "Lab.": "Laboratorio de", "Javier B. ": "Javier B."}

# Clasificación por palabras clave del nombre: (patrón, tipo, subtipo)
REGLAS_RECINTO = [
    (r"pc.?puma", "sala_computo", "computo"),
    (r"sala de c[oó]mputo", "sala_computo", "computo"),
    (r"lab", "laboratorio", "laboratorio"),
    (r"biblioteca", "biblioteca", "biblioteca"),
    (r"auditorio|aula magna", "instalacion_general", "auditorio"),
    (r"cafeter", "instalacion_general", "cafeteria"),
    (r"sanitario|ba[nñ]o", "instalacion_general", "sanitarios"),
]
REGLAS_AREA = [
    (r"estacionamiento de motos", "estacionamiento", "motos"),
    (r"estacionamiento", "estacionamiento", "estacionamiento"),
    (r"jard[ií]n", "area_verde", "jardin"),   # se simula: el usuario confirma que son áreas de descanso
    (r"instituto", "otro", "contexto"),
    (r"restringid", "otro", "restringida"),
    (r"pasillo|parte trasera|andador", "area_comun", "pasillo"),
    (r"entrada|acceso", "area_comun", "acceso"),
    (r"cancha", "area_comun", "cancha"),
    (r"tren|descanso|banca", "area_comun", "descanso"),
    (r"plaza|explanada|[aá]rea de", "area_comun", "plaza"),
]
# Capacidad estimada: m² por unidad (persona o vehículo)
# En exteriores: capacidad "cómoda" (no aglomeración); los polígonos incluyen superficie de paso y jardín.
# Exteriores: no tienen un "cupo"; la capacidad de referencia es la superficie × densidad de congestión
# (0.7 personas/m² en circulaciones, 0.6 en estancias), y el estado se lee por nivel de servicio (personas/m²).
M2_POR_UNIDAD = {"pasillo": 1 / 0.7, "acceso": 1 / 0.7, "plaza": 1 / 0.6, "descanso": 1 / 0.6, "cancha": 1 / 0.6,
                 "estacionamiento": 25.0, "motos": 3.0,
                 "computo": 3.5, "laboratorio": 4.5, "biblioteca": 4.0, "auditorio": 1.2,
                 "cafeteria": 2.5, "sanitarios": 3.0, "jardin": 1 / 0.6}
MATERIAL = {"pasillo": "concreto", "acceso": "concreto", "plaza": "concreto", "descanso": "adoquin",
            "cancha": "concreto", "estacionamiento": "asfalto", "motos": "asfalto", "jardin": "pasto"}
ID_CONOCIDOS = {r"fotogrametr": "LAB_FOTO", r"\bsig\b": "LAB_SIG",
                r"c[oó]mputo geom": "LAB_CG", r"pc.?puma": "PCPUMA", r"biblioteca": "BIB"}

revision = []


def limpiar(txt):
    txt = re.sub(r"\s+", " ", str(txt or "")).strip()
    txt = re.sub(r"(?i)\bedific[iI]o\b", "Edificio", txt)
    for a, b in ACENTOS.items():
        txt = re.sub(rf"(?<!\w){re.escape(a)}(?!\w)", b, txt) if a[-1].isalnum() else txt.replace(a, b)
    return txt.strip()


def sin_acentos(t):
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")


def slug(t, prefijo="", largo=32):
    t = sin_acentos(t).upper()
    t = re.sub(r"\b(DE|DEL|LA|EL|LOS|LAS|Y)\b", " ", t)
    if prefijo:  # quitar la palabra que ya dice el prefijo (EST_ESTACIONAMIENTO... -> EST_...)
        t2 = re.sub(r"\b(ESTACIONAMIENTOS?|JARDINERAS?|JARDINES|JARDIN|ZONA)\b", " ", t)
        t = t2 if t2.strip() else t
    t = re.sub(r"[^A-Z0-9]+", "_", t).strip("_")
    return (prefijo + t)[:largo].rstrip("_")


def azar(clave, n):
    return zlib.crc32(clave.encode()) % n


def hora(v, defecto):
    if not v:
        return defecto, True
    m = re.match(r"^\s*(\d{1,2}):(\d{2})", str(v))
    return (f"{int(m.group(1)):02d}:{m.group(2)}", False) if m else (defecto, True)


def estado_estimado(clave):
    return ["bueno", "bueno", "regular", "regular", "malo"][azar(clave, 5)]


def obtener(pr, *nombres):
    for n in nombres:
        if pr.get(n) not in (None, ""):
            return pr[n]
    return None


def anotar(capa, obj_id, campo, valor, fuente):
    revision.append({"capa": capa, "id": obj_id, "campo": campo, "valor": valor, "fuente": fuente})


def cargar(nombre):
    return json.loads((ENTRADA / f"{nombre}.geojson").read_text(encoding="utf-8"))


def escribir(nombre, feats):
    fc = {"type": "FeatureCollection", "name": nombre, "features": feats}
    (SALIDA / f"{nombre}.geojson").write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def redondear_geom(geom):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], list) else [round(c[0], 7), round(c[1], 7)]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def conjunto_de(geom):
    lon, lat = gu.centroide(gu.poligonos(geom))
    return "norte" if lat > LAT_CORTE_CONJUNTOS else "sur"


def unico(ids, base):
    i, cand = 2, base
    while cand in ids:
        cand = f"{base}_{i}"
        i += 1
    ids.add(cand)
    return cand


# ------------------------------------------------------------------ edificios
def preparar_edificios():
    fc = cargar("edificios")
    salida, ids = [], set()
    for f in fc["features"]:
        pr = f["properties"]
        est = []
        nombre = limpiar(obtener(pr, "nombre", "Nombre") or "Edificio sin nombre")
        m = re.match(r"^Edificio\s+([A-Z0-9]{1,3})$", nombre)
        id_ed = obtener(pr, "id_edificio")
        if not id_ed:
            id_ed = m.group(1) if m else "".join(w if (w.isupper() and len(w) <= 3) else w[0].upper() for w in sin_acentos(nombre).split() if w.lower() not in ("de", "del", "la", "el"))
        id_ed = unico(ids, str(id_ed))
        niveles = obtener(pr, "niveles", "nivel")
        if niveles is None:
            niveles, _ = 2, est.append("niveles")
        estado = obtener(pr, "estado_fisico")
        if not estado:
            estado = estado_estimado("ed" + id_ed)
            est.append("estado_fisico")
        uso = obtener(pr, "uso_principal")
        descripcion = obtener(pr, "descripcion")
        if not uso and id_ed in USO_OFICIAL:
            uso, d_of = USO_OFICIAL[id_ed]
            descripcion = descripcion or d_of
        if not uso:
            uso = "aulas"
            est.append("uso_principal")
        props = {
            "id_edificio": id_ed, "nombre": nombre, "niveles": int(float(niveles)),
            "conjunto": obtener(pr, "conjunto") or conjunto_de(f["geometry"]),
            "uso_principal": uso, "descripcion": descripcion, "division": obtener(pr, "division"),
            "superficie_m2": round(gu.area_m2(f["geometry"]), 1), "estado_fisico": estado,
            "anio_construccion": obtener(pr, "anio_construccion"), "accesible": obtener(pr, "accesible"),
            "observaciones": obtener(pr, "observaciones"), "campos_estimados": est,
            "punto_etiqueta": [round(v, 7) for v in gu.centroide(gu.poligonos(f["geometry"]))],
        }
        for c in ("id_edificio", "nombre", "niveles", "conjunto", "uso_principal", "superficie_m2", "estado_fisico"):
            anotar("edificios", id_ed, c, props[c], "estimado" if c in est else ("calculado" if c in ("superficie_m2", "conjunto") else "capturado"))
        salida.append({"type": "Feature", "properties": props, "geometry": redondear_geom(f["geometry"])})
    return salida


# ------------------------------------------------------------------ recintos
def clasificar(nombre, reglas, defecto):
    n = sin_acentos(nombre).lower()
    for patron, tipo, sub in reglas:
        if re.search(sin_acentos(patron), n):
            return tipo, sub
    return defecto


def id_recinto(nombre, prefijo, ids):
    for patron, rid in ID_CONOCIDOS.items():
        if re.search(patron, sin_acentos(nombre).lower()):
            return unico(ids, rid)
    return unico(ids, slug(nombre, prefijo))


def preparar_recintos(edificios, ids):
    fc = cargar("recintos")
    por_nombre = {sin_acentos(e["properties"]["nombre"]).lower(): e["properties"]["id_edificio"] for e in edificios}
    geom_ed = {e["properties"]["id_edificio"]: gu.poligonos(e["geometry"]) for e in edificios}
    salida = []
    for f in fc["features"]:
        pr = f["properties"]
        est = []
        nombre = limpiar(obtener(pr, "nombre", "Nombre") or "Recinto sin nombre")
        rid = obtener(pr, "id_recinto") or id_recinto(nombre, "", ids)
        tipo = obtener(pr, "tipo")
        subtipo = obtener(pr, "subtipo")
        if not tipo or not subtipo:
            t, s = clasificar(nombre, REGLAS_RECINTO, ("instalacion_general", "otro"))
            if not tipo:
                tipo = t
                est.append("tipo")
            if not subtipo:
                subtipo = s
                est.append("subtipo")
        sup = round(gu.area_m2(f["geometry"]), 1)
        # Edificio: por nombre capturado; si falta, el que contiene al recinto
        polis = gu.poligonos(f["geometry"])
        pts = gu.muestras(polis, 1.0)
        dentro = {eid: gu.traslape_m2(pts, g) / max(len(pts), 1) for eid, g in geom_ed.items()}
        mejor = max(dentro, key=dentro.get) if dentro else None
        id_ed = obtener(pr, "id_edificio")
        if not id_ed:
            id_ed = por_nombre.get(sin_acentos(limpiar(obtener(pr, "edificio") or "")).lower()) or mejor
            if not obtener(pr, "edificio"):
                est.append("id_edificio")
        cap = obtener(pr, "capacidad_max", "capacidad", "cap_max")
        if cap is None:
            cap = max(4, round(sup / M2_POR_UNIDAD.get(subtipo, 3.0)))
            est.append("capacidad_max")
        equipos = obtener(pr, "equipos")
        if equipos is None and tipo in ("sala_computo", "laboratorio"):
            equipos = int(cap) if tipo == "sala_computo" else max(1, round(int(cap) * 0.8))
            est.append("equipos")
        h_ap, e1 = hora(obtener(pr, "hora_apertura"), "07:00")
        h_ci, e2 = hora(obtener(pr, "hora_cierre"), "21:00")
        est += ["hora_apertura"] * e1 + ["hora_cierre"] * e2
        if int(h_ci[:2]) - int(h_ap[:2]) < 6:   # p. ej. 07:00–09:00: casi seguro quiso decir 21:00
            anotar("recintos", rid, "hora_cierre (capturada)", h_ci, "corregido a 21:00, confirmar")
            h_ci = "21:00"
            est.append("hora_cierre")
        estado = obtener(pr, "estado_fisico")
        if not estado:
            estado = estado_estimado(rid)
            est.append("estado_fisico")
        wifi = obtener(pr, "wifi_ap")
        if wifi is None:
            wifi = max(1, -(-int(cap) // 45))
            est.append("wifi_ap")
        nivel = obtener(pr, "nivel")
        if nivel is None:
            nivel = 0
            est.append("nivel")
        props = {
            "id_recinto": rid, "nombre": nombre, "tipo": tipo, "subtipo": subtipo, "id_edificio": id_ed,
            "nivel": int(float(nivel)), "capacidad_max": int(cap), "unidad": "personas", "superficie_m2": sup,
            "equipos": equipos, "hora_apertura": h_ap, "hora_cierre": h_ci, "responsable": obtener(pr, "responsable"),
            "estado_fisico": estado, "ultima_revision": obtener(pr, "ultima_revision"), "accesible": obtener(pr, "accesible"),
            "observaciones": obtener(pr, "observaciones"), "simular": True, "wifi_ap": int(wifi), "descanso": None,
            "campos_estimados": est, "_dentro_edificio": round(dentro.get(id_ed, 0), 2) if id_ed else 0,
        }
        for c in ("id_recinto", "nombre", "tipo", "subtipo", "id_edificio", "nivel", "capacidad_max", "superficie_m2",
                  "equipos", "hora_apertura", "hora_cierre", "estado_fisico", "wifi_ap"):
            anotar("recintos", rid, c, props[c], "estimado" if c in est else ("calculado" if c == "superficie_m2" else "capturado"))
        salida.append({"type": "Feature", "properties": props, "geometry": redondear_geom(f["geometry"])})
    return salida


# ------------------------------------------------------------------ áreas comunes
def preparar_areas(ids):
    fc = cargar("areas_comunes")
    salida = []
    for f in fc["features"]:
        pr = f["properties"]
        est = []
        nombre = limpiar(obtener(pr, "nombre", "Nombre") or "Área común sin nombre")
        tipo, subtipo = obtener(pr, "tipo"), obtener(pr, "subtipo")
        if not tipo or not subtipo:
            t, s = clasificar(nombre, REGLAS_AREA, ("area_comun", "plaza"))
            if not tipo:
                tipo = t
                est.append("tipo")
            if not subtipo:
                subtipo = s
                est.append("subtipo")
        prefijo = {"estacionamiento": "EST_", "area_verde": "AV_", "otro": "ZN_"}.get(tipo, "AC_")
        rid = obtener(pr, "id_recinto") or id_recinto(nombre, prefijo, ids)
        sup = round(gu.area_m2(f["geometry"]), 1)
        simular = obtener(pr, "simular")
        if simular is None:
            simular = tipo in ("area_comun", "estacionamiento", "area_verde")
            est.append("simular")
        unidad = obtener(pr, "unidad") or ("vehiculos" if tipo == "estacionamiento" else "personas")
        cap = obtener(pr, "capacidad_max", "capacidad")
        if cap is None and simular:
            cap = max(5, round(sup / M2_POR_UNIDAD.get(subtipo, 3.0)))
            est.append("capacidad_max")
        estado = obtener(pr, "estado_fisico")
        if not estado:
            estado = estado_estimado(rid)
            est.append("estado_fisico")
        material = obtener(pr, "material_piso")
        if not material and subtipo in MATERIAL:
            material = MATERIAL[subtipo]
            est.append("material_piso")
        h_ap, e1 = hora(obtener(pr, "hora_apertura"), "07:00")
        h_ci, e2 = hora(obtener(pr, "hora_cierre"), "21:00")
        n_low = sin_acentos(nombre).lower()
        descanso = obtener(pr, "descanso")
        if descanso is None:
            if tipo in ("area_comun", "area_verde") and not re.search(sin_acentos(NO_DESCANSO), n_low):
                descanso = "principal" if re.search(DESCANSO_PRINCIPAL, n_low) else "secundaria"
            est.append("descanso")
        wifi = obtener(pr, "wifi_ap")
        if wifi is None and simular:
            m2 = M2_POR_AP.get(subtipo, 0)
            wifi = 0 if not m2 or tipo == "estacionamiento" else max(1, round(sup / m2))
            if descanso == "principal":
                wifi = max(wifi, round(sup / 700))
            est.append("wifi_ap")
        props = {
            "id_recinto": rid, "descanso": descanso, "wifi_ap": int(wifi) if wifi is not None else None, "nombre": nombre, "tipo": tipo, "subtipo": subtipo, "simular": bool(simular),
            "capacidad_max": int(cap) if cap is not None else None, "unidad": unidad, "superficie_m2": sup,
            "nivel": int(float(obtener(pr, "nivel") or 0)), "id_edificio": None,
            "conjunto": obtener(pr, "conjunto") or conjunto_de(f["geometry"]),
            "hora_apertura": h_ap, "hora_cierre": h_ci,
            "cubierta": obtener(pr, "cubierta"), "material_piso": material, "mobiliario": obtener(pr, "mobiliario"),
            "iluminacion": obtener(pr, "iluminacion"), "estado_fisico": estado,
            "observaciones": obtener(pr, "observaciones"), "campos_estimados": est,
        }
        for c in ("id_recinto", "nombre", "tipo", "subtipo", "simular", "capacidad_max", "unidad", "superficie_m2",
                  "conjunto", "material_piso", "estado_fisico", "descanso", "wifi_ap"):
            anotar("areas_comunes", rid, c, props[c], "estimado" if c in est else ("calculado" if c in ("superficie_m2", "conjunto") else "capturado"))
        salida.append({"type": "Feature", "properties": props, "geometry": redondear_geom(f["geometry"])})
    return salida


def main():
    edificios = preparar_edificios()
    ids = set()
    recintos = preparar_recintos(edificios, ids)
    areas = preparar_areas(ids)
    # conjunto de los recintos = el de su edificio
    conj = {e["properties"]["id_edificio"]: e["properties"]["conjunto"] for e in edificios}
    for r in recintos:
        r["properties"]["conjunto"] = conj.get(r["properties"]["id_edificio"])
    escribir("edificios", edificios)
    escribir("recintos", recintos)
    escribir("areas_comunes", areas)
    REVISION.parent.mkdir(exist_ok=True)
    with REVISION.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["capa", "id", "campo", "valor", "fuente"])
        w.writeheader()
        w.writerows(revision)
    n_est = sum(1 for r in revision if r["fuente"] == "estimado")
    print(f"Edificios {len(edificios)} · recintos {len(recintos)} · áreas comunes {len(areas)} "
          f"({sum(a['properties']['simular'] for a in areas)} simuladas)")
    print(f"{n_est} valores estimados; revisión en {REVISION.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
