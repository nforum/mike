# `mike/` — built-in MCP konfiguracija

Ovaj folder sadrži **server-side** konfiguraciju MCP (Model Context Protocol)
poslužitelja koje Max učitava automatski na svakom chat requestu.

Za razliku od konektora koje korisnik dodaje preko UI-ja
(`Postavke → Konektori`, tablica `user_mcp_servers`), serveri definirani ovdje:

- **Ne pojavljuju** se u UI-ju i ne mogu se ugasiti per-korisnik.
- **Ne traže OAuth flow** — autoriziraju se isključivo preko statičkih `headers`.
- **Vrijede globalno** (svi korisnici dobivaju njihove alate u chatu).
- **Ne završavaju u bazi** — žive samo u JSON-u na disku.

Koristi ih za uvijek-uključene organizacijske integracije (npr. interni search,
docs proxy) koje ne želiš izlagati kao izborne konektore.

## Lokacija datoteke

Backend traži konfiguraciju ovim redoslijedom:

1. Putanja iz env varijable `MIKE_MCP_CONFIG` (apsolutna).
2. `./mike/mcp.json` relativno na `process.cwd()` (lokalni razvoj iz repo roota).
3. `../mike/mcp.json` (kad backend kreće iz `backend/`).
4. `/app/mike/mcp.json` (Docker / Cloud Run — kopirano iz `mike/` u image).

Ako nijedna ne postoji, loader tiho preskače ovaj korak (nije error).

## Format

```jsonc
{
  "mcpServers": {
    "<slug>": {
      "name": "Display name",          // optional, fallback = slug
      "url": "https://mcp.example.com/mcp",
      "headers": {                       // optional
        "Authorization": "Bearer ${MY_TOKEN}",
        "X-Tenant": "mike"
      },
      "enabled": true                    // optional, default true
    }
  }
}
```

### Pravila

- `<slug>` mora odgovarati regexu `^[a-z0-9_-]{1,20}$`. Loader interno doda
  prefiks `sys-` (tako da konačni slug u tool-name-u izgleda
  `mcp__sys-<slug>__<toolName>`) da se izbjegnu sudari s korisničkim
  konektorima.
- `url` mora biti `https://…` ili `http://localhost…`. Podržan je samo
  **Streamable HTTP** transport (isti SDK kao za korisničke MCP-ove).
- U svim string vrijednostima podržana je supstitucija `${VAR_NAME}`. Ako
  varijabla nije postavljena, biva zamijenjena praznim stringom i loader
  zalogira upozorenje.
- `enabled: false` u potpunosti preskače server (ne pokušava ni connect).

## Promjene bez restarta

Loader provjerava `mtime` datoteke prije svakog chat requesta i parsira
ponovno samo kad se promijeni. Edit + spremi je dovoljno; nema potrebe za
restartom backend procesa.

## Sigurnost

Iako u datoteci mogu stajati sirovi tokeni, **preferiraj** referenciranje
preko `${ENV_VAR}` i držanje tajni izvan repozitorija. Dodaj `mike/*.local.json`
u `.gitignore` ako želiš per-environment override.

## Primjer (lokalni razvoj)

```bash
export CONTEXT7_API_KEY=ctx7-...
cd backend && npm run dev
```

Ako `mike/mcp.json` u radnom direktoriju ima `context7` s `enabled: true`,
backend će se na startu chat requesta spojiti na `mcp.context7.com`,
povući alate, i ponuditi ih modelu — bez ikakvog UI traga.
