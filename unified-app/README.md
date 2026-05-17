# LM Studio Hub

Aplicación unificada que integra cuatro herramientas de productividad con IA en un único servidor Express. Todas comparten el mismo puerto, el mismo proxy LLM y tienen bases de datos independientes.

---

## Aplicaciones incluidas

| App | Ruta | Descripción |
|---|---|---|
| **Dashboard** | `/` | Panel de control con estadísticas de uso del LLM y logs en tiempo real |
| **Bookmark Manager** | `/app/bookmark` | Gestión de favoritos importados desde Chrome/Firefox con descripciones generadas por IA |
| **English Chatbot** | `/app/chatbot` | Asistente de conversación en inglés con mejora dual (formal/casual), audio UK/US y verificación de pronunciación |
| **PromptAI** | `/app/promptai` | Generador de prompts de alta calidad con patrón ReAct |
| **English Teacher App** | `/app/teacher` | Profesor personal de inglés B2→C1 con sesiones estructuradas: speaking, gramática, vocabulario, escritura, pronunciación, listening y verbos irregulares |

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior
- [LM Studio](https://lmstudio.ai/) corriendo en `http://127.0.0.1:1234` con el servidor local activo
- Un modelo cargado en LM Studio (por defecto se usa `google/gemma-3-4b`)

---

## Instalación y arranque

```bash
# 1. Entrar en la carpeta del proyecto
cd unified-app

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor
npm start
# o directamente:
node server.js
```

El servidor intenta arrancar en `http://localhost:3000`.
Si ese puerto está ocupado, hace fallback automático a `3001`, `3002`, etc. (hasta 10 intentos).

---

## Estructura del proyecto

```
unified-app/
├── server.js                  # Servidor Express unificado (puerto 3000)
├── package.json
│
├── db/                        # Módulos de base de datos (Node.js / SQLite)
│   ├── bookmark-db.js         # SQLite para favoritos, carpetas e historial de importaciones
│   ├── chatbot-db.js          # SQLite para conversaciones y mensajes del chatbot
│   ├── logs-db.js             # SQLite para logs de uso del LLM
│   └── teacher-db.js          # SQLite para el Teacher App (sesiones, vocabulario, verbos)
│
├── teacher-router.js          # Router Express independiente del Teacher App
│
├── data/                      # Creado automáticamente al iniciar
│   ├── bookmarks.db           # Base de datos de favoritos
│   ├── chatbot.db             # Base de datos del chatbot
│   ├── llm-logs.db            # Logs de peticiones al LLM
│   ├── teacher.db             # Sesiones, vocabulario y verbos irregulares
│   └── promptai-conversations/ # Conversaciones de PromptAI (JSON)
│
└── public/                    # Frontends estáticos
    ├── index.html             # Dashboard principal
    ├── bookmark/
    │   ├── index.html         # UI del Bookmark Manager
    │   ├── app.js             # Lógica de la aplicación
    │   ├── db.js              # Cliente API (reemplaza IndexedDB original)
    │   ├── lm-client.js       # Cliente LLM (rutas vía proxy Hub)
    │   ├── bookmark-parser.js # Parser de archivos HTML de favoritos
    │   └── styles.css
    ├── chatbot/
    │   ├── index.html         # UI principal del English Chatbot
    │   ├── phrase-bank.html   # Catálogo de frases con búsqueda, audio y verificación de pronunciación
    │   └── phrase-bank-summary.html # Reporte de generación de frases
    ├── teacher/
    │   └── index.html         # UI del English Teacher App (sesión completa + verbos irregulares)
    └── promptai/
        └── index.html         # UI del PromptAI
```

---

## Bases de datos

Cada aplicación tiene su propia base de datos independiente. Todas usan **SQLite** con modo WAL para mejor rendimiento concurrente, excepto PromptAI que usa ficheros JSON.

### `data/bookmarks.db`
Gestionada por `db/bookmark-db.js`.

| Tabla | Campos principales |
|---|---|
| `bookmarks` | `id`, `title`, `url`, `url_norm` (dedup), `base_domain`, `folder`, `favicon`, `add_date`, `description`, `source_file`, `saved_at` |
| `folders` | `id`, `path`, `title` |
| `imports` | `id`, `filename`, `imported_at`, `added`, `skipped`, `total_in_file` |

### `data/chatbot.db`
Gestionada por `db/chatbot-db.js`.

| Tabla | Campos principales |
|---|---|
| `conversations` | `id`, `title`, `created_at`, `updated_at` |
| `messages` | `id`, `conversation_id`, `role`, `content_raw`, `created_at` |

### `data/llm-logs.db`
Gestionada por `db/logs-db.js`. Se purgan automáticamente los registros con más de **7 días** de antigüedad al arrancar el servidor.

| Tabla | Campos principales |
|---|---|
| `llm_logs` | `id`, `app`, `model`, `endpoint`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `duration_ms`, `status` (`pending`/`success`/`error`), `error_message`, `request_preview`, `created_at` |

### `data/teacher.db`
Gestionada por `db/teacher-db.js`.

| Tabla | Campos principales |
|---|---|
| `content_packs` | `id`, `profile_id`, `pack_name`, `level`, `session_number`, `content_json`, `created_at`, `updated_at` |
| `session_states` | `id`, `profile_id`, `session_number`, `cefr_level_estimate`, `scores_json`, `recurring_errors_json`, `new_vocabulary_json`, `pronunciation_targets_json`, `next_homework_json`, `raw_json` |
| `vocabulary_cards` | `id`, `profile_id`, `session_number`, `term`, `meaning_es`, `example_en`, `created_at`, `updated_at` |
| `irregular_verbs` | `id`, `profile_id`, `level`, `batch_name`, `verbs_json`, `created_at` |

### `data/promptai-conversations/`
Ficheros JSON individuales por conversación. Formato: `conv_<timestamp>_<random>.json`.

---

## API REST completa

### Proxy LLM
Todas las peticiones al LLM pasan por el servidor Hub. Esto permite registrar logs de uso independientemente de la app que los origina. Identificar el origen se hace mediante la cabecera `X-App`.

| Método | Ruta | Descripción |
|---|---|---|
| `*` | `/lm/v1/*` | Proxy a `http://127.0.0.1:1234/v1/*` |
| `*` | `/lm/api/v1/*` | Proxy a `http://127.0.0.1:1234/api/v1/*` |

### Bookmark
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/bookmark/bookmarks` | Lista todos los favoritos |
| `POST` | `/api/bookmark/bookmarks/batch` | Guarda un lote (con deduplicación por URL normalizada) |
| `PUT` | `/api/bookmark/bookmarks/:id` | Actualiza un favorito (ej. guardar descripción IA) |
| `DELETE` | `/api/bookmark/bookmarks?sourceFile=` | Elimina favoritos de un archivo importado concreto |
| `GET` | `/api/bookmark/folders` | Lista todas las carpetas |
| `POST` | `/api/bookmark/folders` | Guarda un lote de carpetas |
| `GET` | `/api/bookmark/imports` | Historial de importaciones |
| `POST` | `/api/bookmark/imports` | Registra una nueva importación |
| `DELETE` | `/api/bookmark/imports/:id` | Elimina un registro del historial |
| `DELETE` | `/api/bookmark/all` | Vacía toda la base de datos |
| `GET` | `/api/bookmark/export` | Descarga snapshot completo en JSON |
| `POST` | `/api/bookmark/import` | Restaura base de datos desde snapshot JSON |

### Chatbot
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/chatbot/conversations` | Lista conversaciones |
| `POST` | `/api/chatbot/conversations` | Crea una conversación vacía |
| `DELETE` | `/api/chatbot/conversations/:id` | Elimina una conversación |
| `GET` | `/api/chatbot/conversations/:id/messages` | Mensajes de una conversación |
| `POST` | `/api/chatbot/conversations/:id/messages` | Añade mensaje y obtiene respuesta del LLM |
| `GET` | `/api/chatbot/phrase-bank` | Lista frases guardadas (opcional `?category=`) |
| `POST` | `/api/chatbot/phrase-bank/generate` | Genera frases con LLM y las guarda en base de datos |
| `POST` | `/api/chatbot/phrase-bank/import` | Importa frases desde JSON |
| `POST` | `/api/chatbot/pronunciation/check` | Evalúa pronunciación del usuario usando transcript + LLM |

### PromptAI
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/promptai/conversations` | Lista conversaciones guardadas |
| `POST` | `/api/promptai/conversations` | Crea o actualiza una conversación |
| `GET` | `/api/promptai/conversations/:id` | Obtiene una conversación completa |
| `DELETE` | `/api/promptai/conversations/:id` | Elimina una conversación |

### Teacher App
| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/teacher/generate-session` | Genera contenido completo para una sesión (2 llamadas paralelas al LLM) |
| `POST` | `/api/teacher/generate-section` | Regenera una sección individual (`warmup`, `grammar`, `writing`, `vocab`, `pronunciation`, `listening`) |
| `POST` | `/api/teacher/content-packs` | Guarda un content pack en SQLite |
| `GET` | `/api/teacher/content-packs` | Lista todos los content packs del perfil |
| `GET` | `/api/teacher/content-packs/:id` | Obtiene un content pack completo por ID |
| `POST` | `/api/teacher/session-state` | Guarda o actualiza el estado de una sesión (upsert por `profile_id + session_number`) |
| `GET` | `/api/teacher/session-state` | Obtiene un estado de sesión (por `sessionNumber`) o el más reciente |
| `POST` | `/api/teacher/vocabulary-cards` | Guarda tarjetas de vocabulario de la sesión (upsert por término) |
| `GET` | `/api/teacher/vocabulary-cards` | Lista tarjetas de vocabulario (por `sessionNumber`) o las de la sesión más reciente |
| `POST` | `/api/teacher/irregular-verbs/generate` | Genera 10 verbos irregulares con IA para el nivel indicado y los guarda en SQLite |
| `GET` | `/api/teacher/irregular-verbs` | Lista todos los batches de verbos; con `?id=` devuelve un batch concreto; incluye `allVerbs` con dedup global |
| `POST` | `/api/teacher/maintenance/clear-saved-sessions` | Elimina todos los datos del perfil (packs, sesiones, vocab, verbos) |

### Logs y estado
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/logs?limit=N` | Últimos N logs de uso del LLM (máx. 200 por defecto) |
| `GET` | `/api/stats` | Estadísticas agregadas globales y por aplicación |
| `GET` | `/api/status` | Estado de conexión con LM Studio y modelos disponibles |
| `GET` | `/api/logs/stream` | Stream SSE de eventos en tiempo real |

---

## Logs en tiempo real (SSE)

El dashboard se conecta a `/api/logs/stream` mediante Server-Sent Events. Los eventos emitidos son:

| Evento | Cuándo se emite | Payload |
|---|---|---|
| `snapshot` | Al conectarse | Últimos 50 logs existentes |
| `log:pending` | Inicio de una petición LLM | `{ id, app, model, endpoint, request_preview, created_at }` |
| `log:update` | Cuando la petición termina | `{ id, status, duration_ms, prompt_tokens, completion_tokens, total_tokens, error_message }` |

Cada app identifica sus peticiones añadiendo la cabecera `X-App: bookmark|chatbot|promptai`.

---

## Configuración

Los valores de configuración están en la parte superior de `server.js`:

```js
const PORT      = Number(process.env.PORT) || 3000;
const LM_STUDIO = 'http://127.0.0.1:1234';
const MODEL     = 'google/gemma-3-4b';
const TOKEN     = 'sk-lm-...';           // API key de LM Studio
const CONV_DIR  = 'data/promptai-conversations/';
```

Para cambiar el modelo o el endpoint de LM Studio basta con editar estas constantes y reiniciar el servidor. Desde la UI del Bookmark Manager y PromptAI también se puede configurar el modelo sin reiniciar.

---

## Características del backend LLM

### Segunda pasada de reparación (Dictionary + Verb Engine)
Cuando el LLM devuelve una respuesta escasa, el servidor detecta el problema y realiza automáticamente una segunda llamada con un prompt de reparación focalizado:

- **`isSparseDictionaryResult`** — detecta: significado vacío, traducción vacía (modos `en-es`/`es-en`), ejemplos vacíos o cobertura léxica < 3 campos
- **`isSparseVerbResult`** — detecta: translation/pos vacíos, usage vacío o < 2 pares de tiempos conjugados (para verbos)
- **`finalizeDictionary`** — aplica `ensureList` en todos los campos de salida: `antonyms`, `phrasal_verbs`, `common_expressions`, `slang`, `related`, `notes`; garantiza que ninguno salga vacío
- **`enforceVerbConsistency`** — para palabras que no son verbos fuerza `verb.type = 'N/A'` y deja todas las conjugaciones vacías, evitando datos espúreos
- Mapeo de alias de claves del LLM: `phrasal_verbs` / `phrasalVerbs`, `common_expressions` / `commonExpressions` / `expressions`, `slang` / `slang_colloquial` / `colloquial`, `related` / `related_terms` / `relatedTerms`, `notes` / `usage_notes` / `usageNotes`

---

## Dependencias

```json
{
  "express": "^4.18.2"
}
```

SQLite se ejecuta con `node:sqlite` (módulo nativo de Node.js), por lo que no se necesita ningún driver externo ni servidor de base de datos adicional.

---

## Flujo de datos

```
Browser
  │
  ├─ GET /app/bookmark  ──►  public/bookmark/index.html
  │       │
  │       ├─ BookmarkDB.*  ──►  /api/bookmark/*  ──►  db/bookmark-db.js  ──►  data/bookmarks.db
  │       └─ LMClient.*   ──►  /lm/v1/*         ──►  LM Studio :1234
  │
  ├─ GET /app/chatbot   ──►  public/chatbot/index.html
  │       │
  │       ├─ /api/chatbot/conversations  ──►  db/chatbot-db.js  ──►  data/chatbot.db
  │       └─ callLM()   (interno)        ──►  LM Studio :1234
  │
  ├─ GET /app/promptai  ──►  public/promptai/index.html
  │       │
  │       ├─ /api/promptai/conversations  ──►  data/promptai-conversations/*.json
  │       └─ fetch /lm/v1/chat/completions ──►  LM Studio :1234
  │
  ├─ GET /app/teacher  ──►  public/teacher/index.html
  │       │
  │       ├─ /api/teacher/*  ──►  teacher-router.js  ──►  db/teacher-db.js  ──►  data/teacher.db
  │       └─ callLMLarge()   (interno)               ──►  LM Studio :1234
  │
  └─ GET /             ──►  public/index.html (Dashboard)
          │
          ├─ /api/stats  /api/status  /api/logs
          └─ /api/logs/stream  (SSE)  ◄──  broadcastSSE() en cada petición LLM

Todas las rutas /lm/*  →  proxyToLM()  →  crea log (pending)  →  LM Studio
                                        →  actualiza log (success/error)
                                        →  broadcastSSE(log:update)
```

---

## Uso de las aplicaciones

### Bookmark Manager
1. Abre `http://localhost:3000/app/bookmark`
2. Importa ficheros HTML exportados desde Chrome o Firefox (arrastrar o botón Importar)
3. Navega por la jerarquía de carpetas, dominios o temas
4. Usa **"Describir con IA"** para generar descripciones automáticas
5. Exporta la base de datos completa como JSON desde el modal **Base de datos**

### English Chatbot
1. Abre `http://localhost:3000/app/chatbot`
2. Crea una nueva conversación desde la barra lateral
3. Escribe en inglés o español — el asistente responde con mejoras nativas en formato **Formal Native** y **Casual Native**
4. Usa los botones de audio `UK` y `US` para escuchar pronunciación británica y americana
5. Abre `http://localhost:3000/app/chatbot/phrase-bank.html` para explorar todas las frases guardadas
6. En Phrase Bank usa `Check Pronunciation` para grabarte, evaluar tu pronunciación con LLM y ver feedback en un pop-up
7. Las conversaciones y frases persisten en SQLite y se pueden reutilizar entre sesiones
8. Usa el **Diccionario** para buscar cualquier palabra en modo `en-es`, `es-en` o `en-en` — todos los campos léxicos (antónimos, phrasal verbs, expresiones, slang, relacionadas) siempre están poblados gracias a la segunda pasada automática de reparación
9. Usa el **Motor de Verbos** para obtener conjugaciones completas, tipo de verbo y ejemplos de uso en contexto; para no-verbos devuelve solo definición y ejemplos sin conjugaciones espurias

### PromptAI
1. Abre `http://localhost:3000/app/promptai`
2. Describe tu objetivo de desarrollo en el área de texto
3. El modelo aplica el patrón **ReAct** (Pensamiento → Acción) para generar un prompt de alta calidad
4. Copia el prompt generado con un click y pégalo en Claude, Copilot o cualquier asistente
5. Usa las plantillas rápidas de la barra lateral izquierda para casos de uso comunes
6. Las **métricas de sesión** y las **conversaciones guardadas** se muestran en el panel derecho
7. Arrastra los dos splitters para ajustar el ancho de cada panel (izquierdo y derecho)
8. En pantallas `≤1100px` el panel derecho se oculta automáticamente; en `≤800px` solo se muestra el chat

### English Teacher App
1. Abre `http://localhost:3000/app/teacher`
2. El perfil está fijo a `daniel`; establece el número de sesión y el objetivo principal
3. Pulsa **Start Session** para generar contenido nuevo con IA (6 secciones: Speaking → Grammar → Vocabulary → Writing → Pronunciation → Listening)
4. Completa cada sección en orden — el flujo avanza automáticamente y registra puntuaciones (0-10) en cada habilidad
5. Al terminar, la pantalla de **Resultados** muestra puntuaciones, errores recurrentes, deberes y tarjetas de vocabulario; el estado se guarda automáticamente en SQLite
6. Usa **Settings** para cambiar el nivel CEFR objetivo, el modo de generación y previsualizar content packs guardados
7. Los **Content Packs** guardados en SQLite permiten reutilizar el mismo contenido en varias sesiones sin llamar al LLM de nuevo
8. Pulsa **Irregular Verbs** en la barra lateral para generar y estudiar 10 verbos por tanda: todas las formas, traducción al español, IPA, ejemplos y audio UK/US
9. El nivel de dificultad se adapta automáticamente al rendimiento acumulado del estudiante a lo largo de las sesiones
10. Usa **Load latest** para recuperar el estado guardado de la última sesión y continuar desde donde se dejó

### Dashboard
1. Abre `http://localhost:3000`
2. Ve el estado de conexión con LM Studio en tiempo real
3. Consulta estadísticas de tokens, latencia y peticiones por aplicación
4. Filtra logs por aplicación y estado (pending / success / error)
5. Los logs aparecen automáticamente en tiempo real vía SSE sin necesidad de recargar
6. Navega a cada app desde la barra lateral izquierda o las tarjetas del dashboard; todos los links abren en la misma pestaña
7. El splitter entre sidebar y contenido principal es arrastrable para ajustar el ancho
