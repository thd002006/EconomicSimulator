# Map data

Versioned **finished map packs** for the game. Put completed maps here regardless of how they were authored.

```text
data-src/maps/
├── index.json
└── world-modern/
    ├── map.json
    ├── provinces.runtime.json
    ├── boundaries.runtime.json
    ├── coastlines.runtime.json
    ├── cities.runtime.json
    └── spatial-index.json
```

The client loads them at `/maps/<id>` directly from this directory (dev middleware + build copy).

Validate packs before committing:

```bash
pnpm map:validate
```
