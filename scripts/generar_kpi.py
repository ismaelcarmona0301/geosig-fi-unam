"""Genera el dataset sintético data/kpi_data.json (paquetes 1.3.1 y 1.3.2).

Uso:  python scripts/generar_kpi.py [--semilla 2026]

- Lee data/recintos.geojson y data/areas_comunes.geojson (las zonas con simular = true)
  y data/edificios.geojson (para los indicadores por edificio).
- Perfiles cada 15 min de 07:00 a 21:00 h, lunes a sábado, escenarios "ordinario" y "examenes".
- El comportamiento depende del subtipo (pasillo, plaza, acceso, cómputo, laboratorio,
  biblioteca, auditorio, estacionamiento...), del horario de cada zona y de su capacidad.
- Nunca supera la capacidad instalada. Reproducible: misma semilla, mismo archivo.
"""
import argparse
import json
import zlib
from datetime import datetime
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
SALIDA = DATA / "kpi_data.json"

H_INICIO, H_FIN, PASO_MIN = 7.0, 21.0, 15
HORAS = np.arange(H_INICIO, H_FIN + 1e-9, PASO_MIN / 60)
DIAS = ["lun", "mar", "mie", "jue", "vie", "sab"]
FACTOR_DIA = {"lun": 1.0, "mar": 1.05, "mie": 1.05, "jue": 1.0, "vie": 0.8, "sab": 0.35}
UMBRALES = {"moderado": 0.50, "alto": 0.75, "critico": 0.90}
ESTADOS = ["bajo", "moderado", "alto", "critico"]
PUNTAJE_ESTADO = {"bueno": 0.0, "regular": 0.5, "malo": 1.0}

MULT_EXAMENES = {"biblioteca": 1.35, "computo": 1.30, "laboratorio": 0.85, "estudio": 1.40, "descanso": 1.25,
                 "cafeteria": 1.05, "plaza": 0.90, "pasillo": 1.0, "acceso": 1.0, "auditorio": 0.60,
                 "sanitarios": 1.10, "cancha": 0.50, "jardin": 1.0}
# Clases fijas conocidas (ejemplo del plan: Fotogrametría se satura los martes a las 10:00 h)
CLASES_FIJAS = {("LAB_FOTO", "mar", 9)}
# Permanencia media (min) por subtipo: convierte ocupación en flujo (personas que pasan por hora)
PERMANENCIA_MIN = {"pasillo": 4, "acceso": 2, "plaza": 15, "descanso": 30, "jardin": 35, "cancha": 45, "auditorio": 90,
                   "computo": 80, "laboratorio": 110, "biblioteca": 90, "cafeteria": 25, "sanitarios": 5,
                   "estacionamiento": 240, "motos": 240}
# Conectividad (Wi-Fi) aproximada
WIFI = {"clientes_por_ap": 40, "dispositivos_por_persona": {"interior": 1.2, "computo": 0.6, "exterior": 0.5},
        "nota": "Aproximación: puntos de acceso estimados por capacidad (interiores) o superficie (exteriores)."}
PRESTAMOS_POR_VISITA = 0.18   # Biblioteca: préstamos por visita
# Histórico sintético: semanas del semestre 2027-1 (lunes)
SEMANAS = ["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12",
           "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]

# Infografía oficial "Estadísticas de uso de la red PC Puma, febrero–abril" (Transformación Digital FI-UNAM)
ESTADISTICAS_RED = {"periodo": "febrero–abril", "clientes_unicos": 107380, "clientes_promedio_dia": 14823,
                    "gb_promedio_por_cliente": 3.71,
                    "trafico_tb": {"Google Services": 55.71, "Facebook": 33.11, "Instagram": 32.72, "WhatsApp": 12.38, "Otros": 67.23}}

# Exteriores (áreas comunes y verdes): nivel de servicio por densidad, personas/m² [cómodo, concurrido, congestionado]
UMBRALES_DENSIDAD = {"circulacion": [0.15, 0.40, 0.70], "estancia": [0.10, 0.30, 0.60]}
# pasillos muy concurridos en los cambios de salón; jardineras y descanso nunca llenos (observación del equipo)
DENSIDAD_PICO = {"pasillo": 0.40, "acceso": 0.40, "plaza": 0.12, "descanso": 0.10, "jardin": 0.05, "cancha": 0.08}

# Ocupación de edificios completos: m² construidos (huella × niveles) por persona, según uso principal
M2_POR_PERSONA_EDIFICIO = {"aulas": 4.0, "laboratorios": 6.0, "biblioteca": 4.5, "administrativo": 10.0, "mixto": 5.0}
MULT_EXAMENES_EDIFICIO = {"biblioteca": 1.30, "aulas": 0.95, "laboratorios": 0.85, "administrativo": 1.0, "mixto": 1.05}
# Población presente simultánea máxima de la FI usada para calibrar capacidades (≈ 14,823 clientes de red por día, dato oficial)
POBLACION_CALIBRACION = 13695   # matrícula de licenciatura 2024-1 (Memoria UNAM 2024)
PICO_POR_USO = {"aulas": (0.70, 0.10), "laboratorios": (0.48, 0.10), "biblioteca": (0.88, 0.12),
                "administrativo": (0.40, 0.08), "mixto": (0.55, 0.10)}   # (base, + según intensidad de red)

CALENDARIO = {"nota": "Periodo de exámenes supuesto; confirmar con el calendario escolar oficial.",
              "examenes": [{"inicio": "2026-11-30", "fin": "2026-12-11"}]}


def g(h, mu, sigma, amp):
    return amp * np.exp(-0.5 * ((h - mu) / sigma) ** 2)


# Bloques de clase de la FI: 2 h, inicio en hora impar (horarios oficiales por grupo de la DCB, 2026-2).
# Peso de cada bloque = proporción de grupos que inician a esa hora en la muestra oficial (7:00 3, 9:00 4, 11:00 3,
# 13:00 3, 15:00 4, 17:00 4, 19:00 2 grupos), suavizado.
BLOQUES = [7, 9, 11, 13, 15, 17, 19]
PESO_BLOQUE = {7: 0.78, 9: 1.00, 11: 0.92, 13: 0.82, 15: 0.95, 17: 0.92, 19: 0.55}


def cambios_de_clase(h, amp, sigma=0.12):
    """Picos breves en los cambios de clase: al inicio de cada bloque (hora impar), con el peso de ese bloque."""
    return sum(g(h, c, sigma, amp * (PESO_BLOQUE.get(c, 0.6))) for c in range(9, 22, 2))


def patron_bloques(h, profundidad=0.35):
    """Ocupación de salones: escalón por bloque con caída breve (~10 min) en cada cambio de clase."""
    p = np.zeros_like(h)
    for b in BLOQUES:
        p = p + bloque(h, b - 0.1, b + 2 - 0.12, PESO_BLOQUE[b], 0.04)
    caidas = sum(g(h, c, 0.07, profundidad) for c in range(9, 22, 2))
    return np.clip(p * (1 - caidas), 0, 1)


def bloque(h, ini, fin, nivel, suave=0.12):
    return nivel / (1 + np.exp(-(h - ini) / suave)) / (1 + np.exp((h - fin) / suave))


def sig(h, centro, ancho):
    return 1 / (1 + np.exp(-(h - centro) / ancho))


def rng_de(semilla, *partes):
    return np.random.default_rng([semilla, zlib.crc32("|".join(partes).encode())])


def perfil_base(z, dia, semilla):
    """Fracción de la capacidad ocupada a lo largo del día, según el subtipo."""
    h, rid, sub = HORAS, z["id_recinto"], z["subtipo"]
    r_z = rng_de(semilla, rid)                 # rasgos propios de la zona (fijos toda la semana)
    r_d = rng_de(semilla, rid, dia)            # variación del día
    s, a = r_z.uniform(-0.6, 0.6), r_z.uniform(0.85, 1.15)
    if sub == "biblioteca":
        # las bibliotecas sí se saturan (observación del equipo): pico 90–100 %
        p = 0.12 + g(h, 11 + s, 1.5, 0.50 * a) + g(h, 13.5, 1.0, 0.30) + g(h, 17 + s, 1.6, 0.55 * a)
        p = p / p.max() * r_z.uniform(0.90, 1.0)
    elif sub == "computo":
        # salas de cómputo de uso libre: se llenan en los huecos entre clases y en la tarde
        p = 0.10 + g(h, 10.2 + s / 2, 1.0, 0.50 * a) + g(h, 13.2 + s / 2, 1.0, 0.75 * a) + g(h, 16.2 + s / 2, 1.1, 0.65 * a) \
            + g(h, 18.5, 0.9, 0.35) + cambios_de_clase(h, 0.08, 0.15)
        p = p / p.max() * r_z.uniform(0.70, 0.82)   # nunca se llenan: máximo ~80 % (observación del equipo)
    elif sub == "laboratorio":
        # Labs de Geomática (observación del equipo): grupos de 4 a 12 personas, clase solo en algunos bloques;
        # fuera de clase, 0 a 2 personas trabajando.
        cap = max(1, int(z["capacidad_max"]))
        p = np.full_like(h, 0.0)
        for ini in range(7, 21, 2):
            fija = (rid, dia, ini) in CLASES_FIJAS
            if fija or (dia != "sab" and r_d.random() < 0.32):
                grupo = 12 if fija else r_d.integers(4, 13)
                p = p + bloque(h, ini + 0.05, ini + 1.9, min(1.0, grupo / cap), 0.06)
            else:
                p = p + bloque(h, ini + 0.05, ini + 1.9, r_d.integers(0, 3) / cap, 0.1)
    elif sub == "auditorio":
        p = np.zeros_like(h)
        if dia != "sab":
            for _ in range(r_d.integers(0, 3)):
                ini = float(r_d.choice([9, 11, 13, 16, 18]))
                p = p + bloque(h, ini, ini + 2, r_d.uniform(0.55, 0.97))
    elif sub == "cafeteria":
        p = 0.08 + g(h, 9.5, 0.8, 0.45) + g(h, 14, 0.9, 0.90) + g(h, 17.5, 0.9, 0.35)
    elif sub == "sanitarios":
        p = 0.25 + g(h, 14, 1.5, 0.25) + cambios_de_clase(h, 0.55, 0.15)
    elif sub == "pasillo":
        p = 0.06 + g(h, 13.5, 2.0, 0.10) + cambios_de_clase(h, 0.75 * a, 0.12)
    elif sub == "acceso":
        # llegadas unos minutos antes de cada bloque (sobre todo 7:00 y 15:00) y salidas al terminar
        p = 0.04 + sum(g(h, (7.1 if b == 7 else b - 0.15), (0.2 if b == 7 else 0.13), PESO_BLOQUE[b] * (1.25 if b == 7 else 0.85 if b == 15 else 0.45)) for b in BLOQUES) * a \
            + g(h, 15.1, 0.2, 0.35) + g(h, 19.1, 0.25, 0.45) + g(h, 21.0, 0.15, 0.5)
    elif sub == "plaza":
        # plazas: comida (13–16 h) y ratos entre clases
        p = 0.05 + g(h, 14.5 + s / 3, 1.0, 0.30 * a) + cambios_de_clase(h, 0.45, 0.16)
    elif sub in ("descanso", "estudio"):
        p = 0.10 + g(h, 13.5 + s / 2, 1.6, 0.45 * a) + g(h, 17, 1.2, 0.25) + cambios_de_clase(h, 0.12, 0.2)
    elif sub == "jardin":
        p = 0.04 + g(h, 14 + s / 2, 1.2, 0.30 * a) + cambios_de_clase(h, 0.35, 0.18)
    elif sub == "cancha":
        p = 0.05 + g(h, 14, 1.2, 0.70) + g(h, 17.5, 1.2, 0.60)
    elif sub in ("estacionamiento", "motos"):
        llenado = r_z.uniform(7.7, 8.8)
        tope = (r_z.uniform(0.78, 0.9) if "PROFESORES" in rid else r_z.uniform(0.55, 0.75)) * (0.75 if sub == "motos" else 1)
        p = 0.04 + tope * sig(h, llenado, 0.4)
        p = p * (1 - 0.30 * sig(h, 15, 0.6)) * (1 - 0.6 * sig(h, 19.3, 0.5))
    else:
        p = 0.15 + g(h, 12, 2.5, 0.45) + g(h, 17, 1.5, 0.30)
    # Exteriores: forma normalizada y escalada a una densidad pico realista
    if not z.get("id_edificio") and z["tipo"] in ("area_comun", "area_verde") and sub in DENSIDAD_PICO:
        cap_dens = 1 / {"pasillo": 1 / 0.7, "acceso": 1 / 0.7}.get(sub, 1 / 0.6)
        p = p / max(p.max(), 1e-6) * DENSIDAD_PICO[sub] * r_z.uniform(0.85, 1.35) / cap_dens
    # Horario propio de la zona
    ap, ci = (int(x[:2]) + int(x[3:]) / 60 for x in (z["hora_apertura"], z["hora_cierre"]))
    return p * np.clip((h - ap) / 0.5 + 0.5, 0, 1) * np.clip((ci - h) / 0.5 + 0.5, 0, 1) * (h >= ap) * (h <= ci)


def perfil_edificio(e, dia, semilla, rel_oficial, pico):
    """Fracción de ocupación del edificio completo. Si hay curva oficial de la Red PC-PUMA, se usa su forma."""
    h = HORAS
    uso = e.get("uso_principal") or "aulas"
    if rel_oficial:
        # 60 % forma oficial + 40 % forma típica de aulas (el mapa de calor se satura y aplana los picos)
        horas_of = np.arange(7, 22)
        tipica = 0.15 + g(h, 10.5, 1.6, 0.55) + g(h, 13, 1.3, 0.75) + g(h, 16.5, 1.6, 0.6)
        tipica = tipica / tipica.max()
        env = np.interp(h, horas_of, rel_oficial)
        if uso == "biblioteca":
            tipica = 0.3 + g(h, 11, 1.6, 0.5) + g(h, 17, 1.8, 0.7)
            tipica = tipica / tipica.max()
            p = (0.6 * env + 0.4 * tipica) * pico
        elif uso in ("aulas", "mixto", "laboratorios"):
            # salones al ritmo de los bloques de clase; la curva oficial modula la intensidad del día
            peso = {"aulas": 1.0, "mixto": 0.6, "laboratorios": 0.5}[uso]
            p = (peso * patron_bloques(h) * (0.65 + 0.35 * env) + (1 - peso) * env) * pico
        else:
            p = (0.6 * env + 0.4 * tipica) * pico
        p = p + cambios_de_clase(h, 0.05, 0.15) * (p > 0.2)
    else:
        r = rng_de(semilla, e["id_edificio"])
        a = r.uniform(0.85, 1.1)
        if uso == "biblioteca":
            p = (0.15 + g(h, 11, 1.5, 0.45 * a) + g(h, 13.5, 1.0, 0.25) + g(h, 17, 1.6, 0.5 * a)) * (pico or 0.6) / 0.75
        elif uso == "administrativo":
            p = (0.05 + bloque(h, 8.5, 15, 0.6 * a) + bloque(h, 16, 19, 0.35 * a)) * (pico or 0.5) / 0.65
        else:
            p = patron_bloques(h) * (pico or 0.8) * a
    p = p * FACTOR_DIA[dia]
    return p * np.clip((h - 7) / 0.5 + 0.3, 0, 1) * np.clip((21 - h) / 0.5 + 0.3, 0, 1)


def ruido_suave(n, rng, sigma=0.06):
    k = np.array([0.25, 0.5, 0.25])
    return np.exp(np.convolve(rng.normal(0, sigma, n), k, mode="same"))


def estado(sat):
    return 3 if sat >= UMBRALES["critico"] else 2 if sat >= UMBRALES["alto"] else 1 if sat >= UMBRALES["moderado"] else 0


def estado_densidad(d, umb):
    return 3 if d >= umb[2] else 2 if d >= umb[1] else 1 if d >= umb[0] else 0


def fmt_hora(x):
    return f"{int(x):02d}:{int(round((x - int(x)) * 60)):02d}"


def norm(v):
    v = np.asarray(v, dtype=float)
    return (v - v.min()) / (v.max() - v.min()) if len(v) and v.max() > v.min() else v * 0


def carga_red(ocups, r):
    """Uso de la red Wi-Fi (0–1), coherente con la ocupación: sigue el % de ocupación
    (o la densidad, en áreas abiertas, llevada a la misma escala) × un factor por zona (0.92–1.08)."""
    if r.get("umbrales_densidad"):
        u = r["umbrales_densidad"]
        eq = np.interp(ocups / r["superficie_m2"], [0, u[0], u[1], u[2], u[2] * 1.5],
                       [0, UMBRALES["moderado"], UMBRALES["alto"], UMBRALES["critico"], 1.0])
    else:
        eq = ocups / r["capacidad_max"]
    return np.clip(eq * r["wifi_factor"], 0, 1)


def prioridad(ix):
    return "alta" if ix >= 0.60 else "media" if ix >= 0.35 else "baja"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--semilla", type=int, default=2026)
    sem = ap.parse_args().semilla

    cargar = lambda n: [f["properties"] for f in json.loads((DATA / f"{n}.geojson").read_text(encoding="utf-8"))["features"]]
    edificios = {e["id_edificio"]: e for e in cargar("edificios")}
    zonas = [z for z in cargar("recintos") + cargar("areas_comunes") if z.get("simular", True) and z.get("capacidad_max")]

    # Red PC-PUMA oficial (si ya se extrajo de los videos con extraer_red_pcpuma.py)
    ap_ed, ap_zona, n_fuera, uso_red = {}, {}, 0, None
    if (DATA / "red_pcpuma_ap.geojson").exists():
        for f in json.loads((DATA / "red_pcpuma_ap.geojson").read_text(encoding="utf-8"))["features"]:
            p = f["properties"]
            if p["id_edificio"]:
                ap_ed[p["id_edificio"]] = ap_ed.get(p["id_edificio"], 0) + p["num_ap"]
            elif p["id_zona"]:
                ap_zona[p["id_zona"]] = ap_zona.get(p["id_zona"], 0) + p["num_ap"]
            else:
                n_fuera += p["num_ap"]
    if (DATA / "red_pcpuma_uso.json").exists():
        uso_red = json.loads((DATA / "red_pcpuma_uso.json").read_text(encoding="utf-8"))

    recintos = {}
    for z in zonas:
        rid, cap = z["id_recinto"], int(z["capacidad_max"])
        exterior = not z.get("id_edificio") and z["tipo"] in ("area_comun", "area_verde")
        umb = UMBRALES_DENSIDAD["circulacion" if z["subtipo"] in ("pasillo", "acceso") else "estancia"] if exterior else None
        mult = 1.0 if z["tipo"] == "estacionamiento" else MULT_EXAMENES.get(z["subtipo"], 1.0)
        perfiles = {}
        for esc in ("ordinario", "examenes"):
            perfiles[esc] = {}
            for dia in DIAS:
                fd = FACTOR_DIA[dia] * (0.85 if z["tipo"] == "estacionamiento" and dia == "sab" else 1)
                base = perfil_base(z, dia, sem) * fd * (mult if esc == "examenes" else 1)
                frac = np.clip(base * ruido_suave(len(HORAS), rng_de(sem, rid, dia, esc)), 0, 1)
                ocup = np.minimum(np.round(frac * cap).astype(int), cap)
                sat = ocup / cap
                if umb:
                    est_ = [estado_densidad(o / z["superficie_m2"], umb) for o in ocup]
                elif z["tipo"] == "estacionamiento":   # sin máximo: solo poca o mucha demanda, nunca alerta
                    est_ = [0 if x < 0.45 else 1 for x in sat]
                else:
                    est_ = [estado(x) for x in sat]
                perfiles[esc][dia] = {"ocupacion": ocup.tolist(), "saturacion": [round(float(x), 2) for x in sat], "estado": est_}
        # Puntos de acceso: oficiales si hay datos de la Red PC-PUMA, si no, estimados
        ap, fuente_wifi = z.get("wifi_ap"), "estimado"
        e = edificios.get(z.get("id_edificio") or "")
        if e and ap_ed.get(e["id_edificio"]):
            dens = ap_ed[e["id_edificio"]] / (e["superficie_m2"] * max(1, e["niveles"]))
            # reparto por superficie, con un mínimo de 1 AP por cada 60 lugares (salas de alta densidad)
            ap, fuente_wifi = max(1, round(z["superficie_m2"] * dens), -(-int(z["capacidad_max"]) // 60)), "oficial (AP del edificio repartidos por superficie)"
        elif ap_zona.get(rid):
            ap, fuente_wifi = ap_zona[rid], "oficial"
        clave_red = e["id_edificio"] if e else rid
        red_rel = uso_red["zonas"].get(clave_red, {}).get("relativo") if uso_red else None
        recintos[rid] = {
            "nombre": z["nombre"], "tipo": z["tipo"], "subtipo": z["subtipo"], "unidad": z.get("unidad", "personas"),
            "capacidad_max": cap, "superficie_m2": z["superficie_m2"], "equipos": z.get("equipos"),
            "id_edificio": z.get("id_edificio"), "nivel": z.get("nivel", 0), "estado_fisico": z.get("estado_fisico"),
            "horario": {"apertura": z["hora_apertura"], "cierre": z["hora_cierre"]}, "perfiles": perfiles,
            "permanencia_min": PERMANENCIA_MIN.get(z["subtipo"], 20), "descanso": z.get("descanso"), "umbrales_densidad": umb,
            "sin_maximo": bool(umb) or z["tipo"] == "estacionamiento",
            "wifi_ap": ap, "wifi_fuente": fuente_wifi if ap or not red_rel else "señal de antenas cercanas (Red PC-PUMA)", "wifi_cobertura": bool(ap or red_rel or z["tipo"] == "estacionamiento"), "wifi_factor": round((0.35 if z["tipo"] == "estacionamiento" else 1) * (0.92 + 0.16 * (zlib.crc32(rid.encode()) % 1000) / 1000), 3), "red_oficial_relativo": red_rel,
            "wifi_dispositivos_por_persona": 0.3 if z["tipo"] == "estacionamiento" else WIFI["dispositivos_por_persona"][
                "computo" if z["subtipo"] in ("computo", "laboratorio") else ("interior" if z.get("id_edificio") else "exterior")],
        }

    # ---------------- Ocupación de los edificios completos ----------------
    cap_rec = {}
    for r in recintos.values():
        if r["id_edificio"]:
            cap_rec[r["id_edificio"]] = cap_rec.get(r["id_edificio"], 0) + r["capacidad_max"]
    cruda = {eid: e["superficie_m2"] * max(1, e["niveles"]) / M2_POR_PERSONA_EDIFICIO.get(e.get("uso_principal") or "aulas", 4.0)
             for eid, e in edificios.items()}
    escala = POBLACION_CALIBRACION / sum(cruda.values())
    intens = {eid: (uso_red["zonas"].get(eid, {}).get("intensidad_pico", 0) if uso_red else 0) for eid in edificios}
    imax = max(intens.values()) or 1
    edificios_sim = {}
    for eid, e in edificios.items():
        cap = max(int(round(cruda[eid] * escala)), int(round(cap_rec.get(eid, 0) * 1.2)), 20)
        z_of = uso_red["zonas"].get(eid) if uso_red else None
        rel = z_of["relativo"] if z_of and z_of.get("intensidad_pico", 0) >= 0.02 else None
        uso = e.get("uso_principal") or "aulas"
        b0, b1 = PICO_POR_USO.get(uso, (0.6, 0.15))
        pico = b0 + b1 * (intens[eid] / imax) ** 0.7
        perfiles = {}
        for esc in ("ordinario", "examenes"):
            perfiles[esc] = {}
            for dia in DIAS:
                base = perfil_edificio(e, dia, sem, rel, pico) * (MULT_EXAMENES_EDIFICIO.get(uso, 1.0) if esc == "examenes" else 1)
                frac = np.clip(base * ruido_suave(len(HORAS), rng_de(sem, "ED", eid, dia, esc), 0.04), 0, 1)
                ocup = np.minimum(np.round(frac * cap).astype(int), cap)
                sat = ocup / cap
                perfiles[esc][dia] = {"ocupacion": ocup.tolist(), "saturacion": [round(float(x), 2) for x in sat],
                                      "estado": [estado(x) for x in sat]}
        edificios_sim[eid] = {
            "nombre": e["nombre"], "tipo": "edificio", "subtipo": "edificio", "uso_principal": uso, "unidad": "personas",
            "capacidad_max": cap, "superficie_m2": round(e["superficie_m2"] * max(1, e["niveles"]), 1), "niveles": e["niveles"],
            "id_edificio": eid, "nivel": 0, "estado_fisico": e.get("estado_fisico"),
            "horario": {"apertura": "07:00", "cierre": "21:00"}, "perfiles": perfiles, "permanencia_min": 120,
            "wifi_ap": ap_ed.get(eid, 0), "wifi_factor": round(0.92 + 0.16 * (zlib.crc32(eid.encode()) % 1000) / 1000, 3), "wifi_fuente": "oficial" if ap_ed.get(eid) else ("señal de antenas cercanas (Red PC-PUMA)" if rel else "señal de antenas cercanas (estimado)"),
            "wifi_cobertura": True,
            "wifi_dispositivos_por_persona": 0.8, "perfil_fuente": "curva oficial Red PC-PUMA" if rel else f"perfil típico ({uso})",
            "red_oficial_relativo": rel,
        }

    # ---------------- Indicadores de resumen (promedio lunes a viernes) ----------------
    paso_h = PASO_MIN / 60
    resumen_ed = {}
    for esc in ("ordinario", "examenes"):
        filas = {}
        todos = {**recintos, **{("ED:" + k): v for k, v in edificios_sim.items()}}
        for rid, r in todos.items():
            sats = np.array([r["perfiles"][esc][d]["saturacion"] for d in DIAS[:5]])
            ocups = np.array([r["perfiles"][esc][d]["ocupacion"] for d in DIAS[:5]])
            ests = np.array([r["perfiles"][esc][d]["estado"] for d in DIAS[:5]])
            media = sats.mean(axis=0)
            f = {
                "sat_media": round(float(sats[sats > 0].mean()) if (sats > 0).any() else 0, 3),
                "sat_max": round(float(sats.max()), 3),
                "hora_pico": fmt_hora(HORAS[int(media.argmax())]),
                "horas_alto_dia": round(float((ests >= 2).sum() * paso_h / 5), 2),
                "horas_critico_dia": round(float((ests >= 3).sum() * paso_h / 5), 2),
                "personas_hora_dia": round(float(ocups.sum() * paso_h / 5), 1),
            }
            f["densidad_uso"] = round(f["personas_hora_dia"] / r["superficie_m2"], 3)
            if r.get("umbrales_densidad"):
                f["densidad_pico"] = round(float(ocups.max(axis=1).mean()) / r["superficie_m2"], 3)
            llenos = np.where(media >= UMBRALES["critico"])[0]
            f["hora_llenado"] = fmt_hora(HORAS[llenos[0]]) if len(llenos) else None
            # Tráfico y conectividad
            # flujo por hora = suma de ocupación en la hora (cortes de 15 min) × 15 / permanencia
            por_hora = np.array([[o[i:i + 4].sum() * PASO_MIN / r["permanencia_min"] for i in range(0, len(o) - 3, 4)] for o in ocups])
            f["flujo_pico_h"] = round(float(por_hora.max(axis=1).mean()))
            f["flujo_dia"] = round(float(ocups.sum()) * paso_h * 60 / r["permanencia_min"] / 5)
            if r["wifi_dispositivos_por_persona"]:
                disp = ocups * r["wifi_dispositivos_por_persona"]
                f["wifi_dispositivos_pico"] = round(float(disp.max(axis=1).mean()))
                if r["wifi_cobertura"]:
                    uso = carga_red(ocups, r)
                    f["wifi_sat_pico"] = round(float(uso.max(axis=1).mean()), 2)
                    f["wifi_horas_saturado"] = round(float((uso >= UMBRALES["critico"]).sum() * paso_h / 5), 2)
                else:
                    f["wifi_sat_pico"] = None
                    f["wifi_horas_saturado"] = None
            if r["subtipo"] == "biblioteca":
                f["visitas_dia"] = f["flujo_dia"]
                f["prestamos_dia"] = round(f["flujo_dia"] * PRESTAMOS_POR_VISITA)
            if r.get("equipos"):
                f["personas_por_equipo_pico"] = round(float(ocups.max(axis=1).mean()) / r["equipos"], 2)
            filas[rid] = f
        # Índice de prioridad: 50 % densidad de uso, 50 % horas en saturación alta (solo datos de ocupación).
        # Se normaliza por separado para personas y para vehículos (no son comparables).
        for unidad in ("personas", "vehiculos"):
            ids = [i for i in filas if not i.startswith("ED:") and recintos[i]["unidad"] == unidad]
            if not ids:
                continue
            ix = 0.5 * norm([filas[i]["densidad_uso"] for i in ids]) + 0.5 * norm([filas[i]["horas_alto_dia"] for i in ids])
            for i, v in zip(ids, ix):
                filas[i]["indice_prioridad"] = round(float(v), 3)
                filas[i]["prioridad"] = prioridad(v)
        for rid, f in filas.items():
            if not rid.startswith("ED:"):
                recintos[rid].setdefault("resumen", {})[esc] = f

        # Por edificio: ocupación del edificio completo + suma de sus recintos simulados
        por_ed = {}
        for rid, r in recintos.items():
            if r["id_edificio"]:
                por_ed.setdefault(r["id_edificio"], []).append(rid)
        eids = sorted(edificios_sim)
        agg = {}
        for e in eids:
            f = filas["ED:" + e]
            rs = por_ed.get(e, [])
            f.update({"recintos": rs, "superficie_construida_m2": edificios_sim[e]["superficie_m2"],
                      "capacidad_total": edificios_sim[e]["capacidad_max"],
                      "personas_hora_recintos": round(sum(filas[i]["personas_hora_dia"] for i in rs), 1)})
            agg[e] = f
        ix = 0.5 * norm([agg[e]["densidad_uso"] for e in eids]) + 0.5 * norm([agg[e]["horas_alto_dia"] for e in eids])
        for e, v in zip(eids, ix):
            agg[e]["indice_prioridad"] = round(float(v), 3)
            agg[e]["prioridad"] = prioridad(v)
            edificios_sim[e].setdefault("resumen", {})[esc] = agg[e]
        for e, a in agg.items():
            resumen_ed.setdefault(e, {})[esc] = a

    # ---------------- Histórico semanal sintético (semestre 2027-1) ----------------
    n = len(SEMANAS)
    for rid, r in list(recintos.items()) + list(edificios_sim.items()):
        base = r["resumen"]["ordinario"]
        rng = rng_de(sem, rid, "historico")
        # el uso crece a lo largo del semestre y repunta en la semana de parciales (8.ª)
        tendencia = np.linspace(0.80, 1.05, n)
        tendencia[7] *= 1.12 if r["subtipo"] in ("biblioteca", "computo", "estudio", "descanso", "jardin") else 1.0
        f = tendencia * rng.normal(1, 0.04, n)
        r["historico"] = {
            "sat_media": [round(min(1.0, base["sat_media"] * x), 3) for x in f],
            "horas_alto_dia": [round(max(0.0, base["horas_alto_dia"] * (x ** 3)), 2) for x in f],
            "personas_hora_dia": [round(base["personas_hora_dia"] * x, 1) for x in f],
        }

    # ---------------- Red PC-PUMA: resumen y validación del modelo ----------------
    red = None
    if uso_red:
        conj_ed = {k: v["conjunto"] for k, v in edificios.items()}
        validacion = {}
        for conj, datos in uso_red["conjuntos"].items():
            ids = [i for i, r in recintos.items() if r["unidad"] == "personas" and
                   (conj_ed.get(r["id_edificio"]) == conj or (not r["id_edificio"] and
                    next((z.get("conjunto") for z in zonas if z["id_recinto"] == i), None) == conj))]
            # Personas en el conjunto: edificios completos + zonas exteriores (los recintos ya están dentro de su edificio)
            fuentes = [edificios_sim[e] for e in edificios_sim if conj_ed.get(e) == conj] + \
                      [recintos[i] for i in ids if not recintos[i]["id_edificio"]]
            sim = np.zeros(15)
            for r_ in fuentes:
                o = np.mean([r_["perfiles"]["ordinario"][d]["ocupacion"] for d in DIAS[:5]], axis=0)
                sim += np.array([o[k * 4:(k + 1) * 4].mean() for k in range(15)])
            sim = sim / sim.max()
            validacion[conj] = {"correlacion": round(float(np.corrcoef(sim, datos["relativo"])[0, 1]), 3),
                                "simulado_relativo": [round(float(x), 3) for x in sim]}
        red = {"fuente": "Videos oficiales Red PC-PUMA, FI-UNAM (mapas Cisco Meraki, un día típico)",
               "estadisticas": ESTADISTICAS_RED,
               "url": "https://www.ingenieria.unam.mx/transformaciondigital/src/pages/red-pc-puma.html",
               "ap_por_edificio": ap_ed, "ap_por_zona": ap_zona, "ap_fuera_de_capas": n_fuera,
               "ap_total": sum(ap_ed.values()) + sum(ap_zona.values()) + n_fuera,
               "uso": uso_red, "validacion": validacion}

    salida = {
        "meta": {
            "proyecto": "GeoSIG FI-UNAM", "generado": datetime.now().isoformat(timespec="seconds"),
            "semilla": sem, "sintetico": True, "horas": [fmt_hora(x) for x in HORAS], "paso_min": PASO_MIN,
            "dias": DIAS, "escenarios": ["ordinario", "examenes"], "estados": ESTADOS, "umbrales": UMBRALES,
            "calendario": CALENDARIO, "wifi": WIFI, "prestamos_por_visita": PRESTAMOS_POR_VISITA,
            "historico": {"semanas": SEMANAS, "nota": "Histórico sintético del semestre: tendencia creciente y repunte en parciales."},
            "indice_prioridad": "50 % densidad de uso + 50 % horas en saturación ≥ 75 % (normalizadas); alta ≥ 0.60, media ≥ 0.35",
        },
        "recintos": recintos,
        "edificios": resumen_ed,
        "edificios_sim": edificios_sim,
        "red_pcpuma": red,
    }
    SALIDA.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Escrito {SALIDA.relative_to(RAIZ)}: {len(recintos)} zonas simuladas, {len(resumen_ed)} edificios con recintos, "
          f"{SALIDA.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
