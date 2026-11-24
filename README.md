# GeoSIG FI-UNAM

Plataforma SIG web responsiva (mobile-first, para tableta) que muestra en un mapa la ocupación y saturación de los espacios de la Facultad de Ingeniería, UNAM.
Proyecto final de Administración de Proyectos, semestre 2027-1. Cliente: Ing. Aurea Acosta.

> Los datos de ocupación son **sintéticos**. Los atributos que el equipo no capturó en QGIS se estimaron y aparecen marcados como **est.** en el visor (lista completa en `docs/revision_atributos.csv`).

## Estructura

```
geosig-fi-unam/
├── index.html                  Página única (visor + tablero)
├── css/styles.css              Identidad azul y oro, mobile-first
├── js/
│   ├── simulacion.js           Simulación en vivo + predicción por reglas (sin DOM)
│   └── app.js                  Mapa Leaflet, tablero Chart.js, pisos, geolocalización
├── data/
│   ├── qgis/                   ← AQUÍ van las exportaciones de QGIS (EPSG:4326)
│   ├── edificios.geojson       Capas normalizadas que lee el visor
│   ├── recintos.geojson
│   ├── areas_comunes.geojson
│   └── kpi_data.json           Dataset sintético indexado por id_recinto
├── scripts/
│   ├── preparar_capas.py       Normaliza y rellena atributos faltantes
│   ├── generar_kpi.py          Genera kpi_data.json
│   ├── validar_geojson.py      Esquema, traslapes, recintos dentro de su edificio, enlace con el JSON
│   ├── geo_utils.py            Geometría (áreas, traslapes) sin dependencias
│   └── descargar_librerias.py  Copia Leaflet y Chart.js a vendor/ (respaldo sin internet)
├── docs/revision_atributos.csv Qué se capturó, calculó o estimó, objeto por objeto
├── vendor/                     Bibliotecas locales (si falta, se usa el CDN)
└── tests/                      Pruebas del motor (node) y de la interfaz (playwright)
```

## Actualizar las capas después de editar en QGIS

```bash
# 1. Exportar las tres capas como GeoJSON, EPSG:4326, precisión 7, RFC7946=YES, a data/qgis/
python scripts/preparar_capas.py      # normaliza y rellena lo que falte
python scripts/generar_kpi.py         # simula la ocupación
python scripts/validar_geojson.py     # debe terminar con 0 errores
python -m http.server 8000            # revisar en http://localhost:8000
```

Las capacidades confirmadas en la hoja "Espacios y capacidades" se copian a `data/capacidades_confirmadas.csv` (id_recinto, capacidad_max, fuente) y tienen prioridad sobre todo lo demás. Después, lo capturado en QGIS tiene prioridad: si llenas `capacidad_max`, `nivel`, `estado_fisico`, etc., el script deja de estimarlos.

## Modelo de datos

- **Edificios** (contexto, no se simulan): `id_edificio`, `nombre`, `niveles`, `conjunto`, `uso_principal`, `estado_fisico`…
- **Recintos** (interiores): `id_recinto`, `nombre`, `tipo`, `subtipo`, `id_edificio`, `nivel`, `capacidad_max`, `superficie_m2`, `equipos`, horario…
- **Áreas comunes** (exteriores): `id_recinto`, `nombre`, `tipo` (`area_comun`, `estacionamiento`, `area_verde`, `otro`), `subtipo`, `simular`, `unidad` (personas o vehículos)…

## Anclas de realismo (datos oficiales usados para calibrar la simulación)

| Dato | Uso en el modelo | Fuente |
|---|---|---|
| Matrícula de licenciatura 2024-1: 13,695 | Capacidad total de los edificios | Memoria UNAM 2024, FI |
| Uso de cada edificio (salones, laboratorios, bibliotecas, administrativo) | Capacidad por m² y forma del día de cada edificio | Croquis oficial de la FI |
| 463 antenas, curva de uso por hora por edificio | Forma del día de los edificios, capacidad Wi-Fi | Videos Red PC-PUMA |
| 107,380 clientes únicos, 14,823 por día, 3.71 GB por cliente | Referencia de conectividad | Infografía Red PC-PUMA (feb–abr) |
| Densidades de nivel de servicio peatonal (personas/m²) | Estado de áreas abiertas sin cupo fijo | Criterio de diseño peatonal (niveles de servicio) |

## Modelo de simulación

- **Comportamiento por subtipo:** pasillos y accesos con picos en cambios de clase, plazas a mediodía, laboratorios por bloques de clase, auditorios por eventos, estacionamientos que se llenan en la mañana, etc. Se escala a la capacidad y se respeta el horario de cada zona (07:00–21:00 como máximo).
- **En vivo:** el perfil de 15 min se interpola al minuto, con una variación determinística (todas las tabletas ven lo mismo). Nunca supera `capacidad_max`.
- **Ritmo de clases:** bloques de 2 h que inician en hora impar (7:00 a 19:00), con el peso de cada bloque tomado de los horarios oficiales por grupo de la DCB; los salones bajan ~10 min en cada cambio de clase y los pasillos y accesos tienen su pico justo en esos minutos.
- **Observaciones del equipo (24-nov):** salones con pico de 70–80 %; bibliotecas (Antonio Dovalí, Enrique Rivero Borrell, Enzo Levi) sí se saturan; salas PC-PUMA hasta ~80 %; laboratorios de Geomática con grupos de 4 a 12 y clase solo en algunos bloques; auditorios solo con eventos; exteriores y estacionamientos sin máximo; pasillos muy concurridos en los cambios de salón y calma durante la clase.
- **Áreas abiertas:** no tienen cupo; se evalúan por densidad: libre < 0.10, cómodo, concurrido ≥ 0.30 y congestionado ≥ 0.60 personas/m² (circulaciones: 0.15 / 0.40 / 0.70).
- **Sugerencia por ubicación:** si la zona donde está el usuario (GPS o “Estoy aquí”) está saturada o lo estará en la próxima hora, se proponen alternativas del mismo tipo (o áreas de descanso) ordenadas por espacio y distancia, con ruta en el mapa.
- **Reglas:** R1 demanda ordinaria · R2 periodo de exámenes · R3 saturación crítica actual o prevista en la próxima hora, con alternativas del mismo grupo de uso.
- **Edificios completos:** capacidad = m² construidos (huella × niveles) / m² por persona según `uso_principal`, calibrada para que la FI sume ~14,000 lugares (referencia: 14,823 clientes de red por día). La forma del perfil horario es la curva oficial de la Red PC-PUMA de cada edificio (60 %) combinada con un perfil típico de aulas (40 %); sin curva oficial, un perfil por uso. Se puede capturar `uso_principal` en QGIS (`aulas`, `laboratorios`, `biblioteca`, `administrativo`, `mixto`).
- **Tráfico:** personas que pasan por hora = ocupación × 60 / permanencia media del subtipo.
- **Wi-Fi (aproximado):** puntos de acceso estimados (`wifi_ap`, se puede capturar en QGIS), 40 dispositivos por punto; dispositivos = personas × factor (1.2 interiores, 0.6 cómputo, 0.5 exteriores).
- **Biblioteca:** visitas = flujo acumulado; préstamos = 0.18 por visita.
- **Áreas de descanso:** todas las áreas comunes y verdes excepto estacionamientos, zona restringida, entrada del Anexo, Instituto de Ingeniería y Área de Posgrado; principales: Zona del tren, Jardineras FI y Plaza del Bicentenario.
- **Histórico:** 12 semanas sintéticas del semestre 2027-1 (tendencia creciente y repunte en parciales).
- **Índice de atención (P3):** a partes iguales, personas al día (volumen), uso por m² (intensidad) y horas en ≥ 75 % (saturación), normalizados dentro de su grupo; alta ≥ 0.44, media ≥ 0.28. Se calcula por zona y por edificio; personas y vehículos por separado.

## Datos oficiales de la Red PC-PUMA

`scripts/extraer_red_pcpuma.py` lee los videos “Norte” y “Sur” de
https://www.ingenieria.unam.mx/transformaciondigital/src/pages/red-pc-puma.html (mapas de calor Cisco Meraki):

```bash
ffmpeg -i Norte.mp4 -vf fps=4 frames_norte/q_%03d.png
ffmpeg -i Sur.mp4   -vf fps=4 frames_sur/q_%03d.png
python scripts/extraer_red_pcpuma.py frames_norte frames_sur   # luego: python scripts/generar_kpi.py
```

Produce `data/red_pcpuma_ap.geojson` (463 puntos de acceso en grupos, georreferenciados de forma aproximada y asignados a edificios)
y `data/red_pcpuma_uso.json` (índice relativo de uso de la red por hora, por conjunto y por edificio). El generador usa los AP oficiales
como capacidad Wi-Fi de los interiores y compara la curva del modelo con la oficial (correlación en `kpi_data.json → red_pcpuma.validacion`).

## Demostración

“Simular hora” fija el día y la hora; ▶ Reproducir recorre el día. Caso del plan: martes 10:00, Laboratorio de Fotogrametría saturado.
El selector **Planta** (Todas / PB / 1…) filtra los recintos por nivel. Tocar un edificio abre su ficha con sus recintos por piso.

## Publicación (GitHub Pages)

Settings → Pages → Deploy from branch → `main` / raíz. El GPS solo funciona en HTTPS (GitHub Pages) o `localhost`.
