"""Descarga Leaflet y Chart.js a vendor/ para la copia local de respaldo (sin internet).

Uso (con internet, una sola vez):  python scripts/descargar_librerias.py
Después, el sitio funciona sin CDN. Si vendor/ está vacío, index.html usa el CDN.
"""
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
VENDOR = RAIZ / "vendor"

ARCHIVOS = {
    "leaflet/leaflet.js": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    "leaflet/leaflet.css": "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    "leaflet/images/marker-icon.png": "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    "leaflet/images/marker-icon-2x.png": "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    "leaflet/images/marker-shadow.png": "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    "leaflet/images/layers.png": "https://unpkg.com/leaflet@1.9.4/dist/images/layers.png",
    "chartjs/chart.umd.js": "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js",
}

for destino, url in ARCHIVOS.items():
    ruta = VENDOR / destino
    ruta.parent.mkdir(parents=True, exist_ok=True)
    print(f"↓ {url}")
    with urllib.request.urlopen(url, timeout=30) as r:
        ruta.write_bytes(r.read())
print(f"Listo: {len(ARCHIVOS)} archivos en {VENDOR.relative_to(RAIZ)}/")
