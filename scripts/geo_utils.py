"""Utilidades geométricas sin dependencias externas (solo Python estándar).

Trabaja en una proyección local en metros (equirectangular centrada en la FI),
suficiente para áreas y traslapes a escala de campus (error < 0.1 %).
"""
import math

LAT0, LON0 = 19.329, -99.183
KY = 110_574.0
KX = 111_320.0 * math.cos(math.radians(LAT0))


def a_metros(lon, lat):
    return ((lon - LON0) * KX, (lat - LAT0) * KY)


def poligonos(geom):
    """Lista de polígonos; cada uno es una lista de anillos [exterior, huecos...] en metros."""
    if geom["type"] == "Polygon":
        bruto = [geom["coordinates"]]
    elif geom["type"] == "MultiPolygon":
        bruto = geom["coordinates"]
    else:
        return []
    return [[[a_metros(p[0], p[1]) for p in anillo] for anillo in poli] for poli in bruto]


def area_anillo(a):
    return abs(sum(a[i][0] * a[i + 1][1] - a[i + 1][0] * a[i][1] for i in range(len(a) - 1))) / 2


def area_m2(geom):
    return sum(area_anillo(p[0]) - sum(area_anillo(h) for h in p[1:]) for p in poligonos(geom))


def _pip_anillo(x, y, a):
    c = False
    for i in range(len(a) - 1):
        (x1, y1), (x2, y2) = a[i], a[i + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def contiene(polis, x, y):
    for p in polis:
        if _pip_anillo(x, y, p[0]) and not any(_pip_anillo(x, y, h) for h in p[1:]):
            return True
    return False


def bbox(polis):
    xs = [pt[0] for p in polis for pt in p[0]]
    ys = [pt[1] for p in polis for pt in p[0]]
    return min(xs), min(ys), max(xs), max(ys)


def muestras(polis, paso=1.0):
    """Puntos de una malla regular que caen dentro de la geometría."""
    x0, y0, x1, y1 = bbox(polis)
    pts = []
    y = y0 + paso / 2
    while y < y1:
        x = x0 + paso / 2
        while x < x1:
            if contiene(polis, x, y):
                pts.append((x, y))
            x += paso
        y += paso
    return pts


def traslape_m2(pts_a, polis_b, paso=1.0):
    """Área aproximada de A que cae dentro de B (por muestreo)."""
    bx0, by0, bx1, by1 = bbox(polis_b)
    n = sum(1 for x, y in pts_a if bx0 <= x <= bx1 and by0 <= y <= by1 and contiene(polis_b, x, y))
    return n * paso * paso


def centroide(polis):
    """Punto representativo (centroide de las muestras, o el más cercano a él dentro)."""
    pts = muestras(polis, 1.0) or [polis[0][0][0]]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    if not contiene(polis, cx, cy):
        cx, cy = min(pts, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    return cx / KX + LON0, cy / KY + LAT0


def _cruzan(p1, p2, p3, p4):
    def o(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2, d3, d4 = o(p3, p4, p1), o(p3, p4, p2), o(p1, p2, p3), o(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def auto_interseccion(anillo):
    n = len(anillo) - 1
    for i in range(n):
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if _cruzan(anillo[i], anillo[i + 1], anillo[j], anillo[j + 1]):
                return True
    return False
