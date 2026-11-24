"""Extrae datos de la Red PC-PUMA de los videos oficiales (mapas de calor Cisco Meraki).

Fuente: https://www.ingenieria.unam.mx/transformaciondigital/src/pages/red-pc-puma.html
        (videos "Norte" y "Sur", sección "Un día en la Facultad de Ingeniería").

Uso:  python scripts/extraer_red_pcpuma.py CARPETA_FRAMES_NORTE CARPETA_FRAMES_SUR
      (cuadros extraídos con: ffmpeg -i Norte.mp4 -vf fps=4 q_%03d.png)

Produce:
  data/red_pcpuma_ap.geojson   grupos de puntos de acceso (número de AP, edificio o zona donde caen)
  data/red_pcpuma_uso.json     intensidad relativa de uso de la red por hora, por conjunto y por edificio/zona

Método y limitaciones:
- Los números de las burbujas son grupos de AP que el mapa junta a ese zoom (no AP individuales);
  los íconos sueltos son 1 AP. Se transcribieron de un cuadro nocturno (sin saturación de puntos).
- La georreferencia es aproximada (escala y desplazamiento ajustados a las huellas de los edificios
  digitalizados en QGIS); error estimado de 5 a 10 m.
- La "intensidad de uso" es un índice relativo (0–100 %) calculado del color del mapa de calor y los
  puntos de clientes dentro de cada polígono; no es un conteo exacto de dispositivos.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import geo_utils as gu

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"

# Transformación píxel(1920×1080) ↔ metros locales: px = tx + x/s ; py = ty - y/s
TRANSF = {"norte": (0.225, 1707, 1850), "sur": (0.52, 862, 109)}

# Grupos de AP (x, y en píxeles del cuadro 1920×1080, número de AP). Íconos sueltos = 1.
AP = {
    "norte": [(1068, 364, 2), (1219, 359, 12), (1178, 416, 2), (1230, 414, 3), (1241, 479, 15), (709, 500, 2),
              (1033, 521, 3), (1084, 520, 4), (1160, 518, 2), (966, 543, 5), (699, 568, 3), (785, 567, 5),
              (876, 564, 2), (1250, 555, 11), (1033, 596, 4), (909, 641, 3), (1123, 636, 3), (1252, 629, 12),
              (863, 680, 8), (940, 686, 5), (693, 697, 9), (1036, 727, 3), (1241, 721, 9), (709, 789, 9),
              (784, 812, 5), (851, 805, 10), (951, 789, 12), (1237, 791, 3), (1249, 885, 10),
              (1107, 435, 1), (1191, 576, 1), (1215, 639, 1), (1146, 728, 1)],
    "sur": [(1093, 235, 10), (1128, 233, 3), (1067, 299, 18), (1149, 289, 18), (1060, 370, 14), (1311, 475, 9),
            (1301, 527, 15), (1105, 595, 6), (1177, 589, 13), (832, 603, 5), (936, 602, 6), (1023, 633, 11),
            (927, 663, 13), (989, 663, 11), (835, 679, 14), (1133, 685, 14), (1213, 681, 22), (1274, 664, 4),
            (852, 811, 25), (940, 815, 10), (1044, 777, 10), (1015, 886, 14), (958, 918, 4), (1002, 941, 12),
            (935, 512, 1), (1015, 504, 1)],
}


def a_px(conj, x, y):
    s, tx, ty = TRANSF[conj]
    return tx + x / s, ty - y / s


def a_lonlat(conj, px, py):
    s, tx, ty = TRANSF[conj]
    x, y = (px - tx) * s, (ty - py) * s
    return x / gu.KX + gu.LON0, y / gu.KY + gu.LAT0


def hora_de_cuadro(i):
    """Cuadro i (4 fps, desde 1) → hora del día. 1 s de video = 1 h; inicia 7:00 pm."""
    return (19 + (i - 4.8) / 4) % 24


def puntaje(a):
    """Índice de actividad por píxel: mapa de calor (rojo > naranja > amarillo) + puntos de clientes."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    rojo = (r > 150) & (g < 90)
    naranja = (r > 200) & (g >= 90) & (g < 170) & (b < 120)
    amarillo = (r > 200) & (g >= 170) & (b < 140) & (r - b > 80)
    punto = (b > 120) & (r < 140) & (g < 140) & (b - g > 30)
    return 1.0 * rojo + 0.6 * naranja + 0.3 * amarillo + 0.8 * punto


def main(carpeta_norte, carpeta_sur):
    capas = {n: json.loads((DATA / f"{n}.geojson").read_text(encoding="utf-8"))["features"]
             for n in ("edificios", "recintos", "areas_comunes")}

    def conj_de(f):
        return f["properties"].get("conjunto") or "sur"

    # ---------- 1. Puntos de acceso georreferenciados y asignados ----------
    feats_ap = []
    for conj, lista in AP.items():
        for k, (px, py, n) in enumerate(lista):
            lon, lat = a_lonlat(conj, px, py)
            x, y = gu.a_metros(lon, lat)
            # Los AP casi siempre están en edificios: primero el edificio que lo contiene o el más cercano (≤ 25 m);
            # si no hay, la zona exterior que lo contiene.
            def dist_borde(f):
                ps = gu.poligonos(f["geometry"])
                if gu.contiene(ps, x, y):
                    return 0.0
                return min(((q[0] - x) ** 2 + (q[1] - y) ** 2) ** 0.5 for p in ps for q in p[0])
            cand = sorted(((dist_borde(f), f["properties"]["id_edificio"]) for f in capas["edificios"]), key=lambda t: t[0])
            ed = cand[0][1] if cand and cand[0][0] <= 25 else None
            zona = None if ed else next((f["properties"]["id_recinto"] for f in capas["areas_comunes"]
                                         if gu.contiene(gu.poligonos(f["geometry"]), x, y)), None)
            feats_ap.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                             "properties": {"id": f"{conj[0].upper()}{k + 1:02d}", "conjunto": conj, "num_ap": n,
                                            "id_edificio": ed, "id_zona": zona,
                                            "ubicacion": "edificio" if ed else ("exterior" if zona else "fuera del área digitalizada")}})
    (DATA / "red_pcpuma_ap.geojson").write_text(json.dumps({"type": "FeatureCollection", "name": "red_pcpuma_ap",
        "fuente": "Video oficial Red PC-PUMA, FI-UNAM (mapa Cisco Meraki); georreferencia aproximada", "features": feats_ap},
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---------- 2. Intensidad de uso por hora ----------
    uso = {"fuente": "Videos oficiales Red PC-PUMA (Norte y Sur), un día típico; índice relativo 0–1 por zona",
           "horas": list(range(7, 22)), "conjuntos": {}, "zonas": {}}
    for conj, carpeta in (("norte", carpeta_norte), ("sur", carpeta_sur)):
        cuadros = sorted(Path(carpeta).glob("q_*.png"))
        mascaras = {}
        for f in capas["edificios"] + capas["areas_comunes"]:
            if conj_de(f) != conj:
                continue
            m = Image.new("L", (1920, 1080), 0)
            d = ImageDraw.Draw(m)
            for p in gu.poligonos(f["geometry"]):
                d.polygon([a_px(conj, *q) for q in p[0]], fill=1)
                for h in p[1:]:
                    d.polygon([a_px(conj, *q) for q in h], fill=0)
            arr = np.asarray(m, dtype=bool)
            if arr.sum() > 200:
                clave = f["properties"].get("id_edificio") or f["properties"]["id_recinto"]
                mascaras[clave] = arr
        total = np.zeros((1080, 1920), bool)
        for arr in mascaras.values():
            total |= arr
        serie = {k: {} for k in list(mascaras) + ["_total"]}
        for c in cuadros:
            i = int(c.stem.split("_")[1])
            h = hora_de_cuadro(i)
            a = np.asarray(Image.open(c).convert("RGB")).astype(int)
            pts = puntaje(a)
            hb = int(h)
            for k, arr in list(mascaras.items()) + [("_total", total)]:
                serie[k].setdefault(hb, []).append(float(pts[arr].mean()))
        for k, por_hora in serie.items():
            vals = [float(np.mean(por_hora.get(h, [0]))) for h in range(24)]
            mx = max(vals)
            if mx < 0.002:      # zona fuera del cuadro del video o sin actividad visible
                if k != "_total":
                    continue
            mx = mx or 1
            rel = [round(vals[h] / mx, 3) for h in range(7, 22)]
            if k == "_total":
                uso["conjuntos"][conj] = {"relativo": rel, "noche_relativo": round(float(np.mean([vals[h] for h in (1, 2, 3, 4)])) / mx, 3)}
            else:
                uso["zonas"][k] = {"conjunto": conj, "relativo": rel, "intensidad_pico": round(mx, 4)}
    (DATA / "red_pcpuma_uso.json").write_text(json.dumps(uso, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    tot = {c: sum(p[2] for p in l) for c, l in AP.items()}
    print(f"AP leídos: norte {tot['norte']}, sur {tot['sur']} (total {sum(tot.values())})")
    for conj in ("norte", "sur"):
        print(conj, "perfil 07–21 h:", uso["conjuntos"][conj]["relativo"])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
