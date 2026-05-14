---
name: PII Shield HR Integration
overview: "FINALNI PLAN (potvrđen best practices istraživanjem). Document-only pseudonimizacijski sloj — GDPR terminologija: ovo je pseudonimizacija (reverzibilna s ključem), ne anonimizacija. Sidecar jedini dekriptor i vlasnik originala, envelope AES-GCM per DEK (Postgres RLS kao drugi sloj izolacije uz GRANT separation). HR legal identifiers (OIB, IBAN, MBS, sudski broj, ZK). Tri profila: standard, strict_legal, strict. v1 modal read-only + checkbox lista."
todos:
  - id: service-skeleton
    content: "mike-pii-shield/ Python servis: Dockerfile, requirements.txt, FastAPI (/analyze, /sessions/:id/apply-overrides, POST /placeholders/info, /render, /sessions/:id/disclose-placeholder, /healthz, /readyz, /version), envelope DEK-per-session AES-GCM + KMS wrapping od starta (ne v1.1), RLS policy na pii_mappings, pluggable EngineRegistry"
    status: pending
  - id: hr-recognizers
    content: "HR recognizeri: OIB (ručni mod-11,10 + test corpus 30+30), HR IBAN (mod-97), MBS (context-driven), sudski_broj, zk, hr_address fallback. Test corpus: false_positive, false_negative, roundtrip s disclosure override testovima. Presidio NER + regex + checksum + context word analysis — sve 4 razine."
    status: pending
  - id: opf-adapter-stub
    content: "opf_engine.py stub (NotImplementedError) iza PII_ENGINE=presidio|opf|both feature flaga."
    status: pending
  - id: db-migration
    content: "Migracija 110_pii_anonymization.sql: pii_sessions (status, entity_summary, encrypted_dek active od starta), pii_mappings (+ RLS policy: pii_shield_app only), pii_audit_log (ip_hash, ua_hash), ALTER document_versions (pii_session_id, pii_processed_text_cache, pii_status), ALTER user_profiles. Role separation + RLS."
    status: pending
  - id: backend-pii-lib
    content: "backend/src/lib/pii/: client.ts (analyze, applyOverrides, render, placeholderInfo), placeholders.ts (PLACEHOLDER_REGEX, joinChunks — SSE framing buffer ODVOJEN od placeholder split buffer max 128, findResidual), tsRegex.ts (OWASP LLM05 residual gate), gate.ts, redactJsonDeep.ts (OWASP-preporučeni deterministic filter za tool outputs). BEZ store.ts."
    status: pending
  - id: backend-routes
    content: "backend/src/routes/pii.ts: POST /pii/preview-document, /sessions/:id/apply-overrides, /sessions/:id/discard, /messages/:id/render, POST /pii/placeholders/info (batch POST), GET /pii/audit. Logging: skipBodyLog za sve /pii/* rute. Sentry beforeSend filter."
    status: pending
  - id: backend-hooks
    content: "Hook-ovi SAMO na document→model boundary: readDocumentContent, tabular extract*, Word selection.text. runToolCalls: redactJsonDeep na args i results (OWASP deterministic filter preporuka potvrđena). NEMA hooka na user chat content."
    status: pending
  - id: frontend-document-modal
    content: "DocumentAnonymizationPreviewModal.tsx (v1 simple): read-only preview + lista entiteta s checkboxima. original_preview lazy on-hover (Strict: samo tip+duljinu). Footer: Cancel / Apply & send / Send original (AYS). GDPR info banner: 'This is pseudonymization, not anonymization.' BEZ TipTap u v1."
    status: pending
  - id: frontend-account-page
    content: "account/privacy/page.tsx + tab + i18n keys. GDPR disclaimer u UI. Audit log s approve_disclosure. BEZ 'guarantee' ili 'anonymization' u marketinškoj kopiji — koristi 'pseudonymization'."
    status: pending
  - id: frontend-chat-integration
    content: "AddDocButton intercept (pii_default_mode != off), shield badge na chip-u. AssistantMessage poziva POST /pii/messages/:id/render (inline restore, no title attr, memory-only cache, clear na logout/idle)."
    status: pending
  - id: word-addin
    content: "Word add-in: isti simple modal (read-only preview, checkboxes, bez TipTap). Ephemeral sesija za selection."
    status: pending
  - id: deploy
    content: "deploy_pii_shield(): --ingress=internal, Secret Manager (samo sidecar), KMS key setup, IAM invoker, Cloud Monitoring alerting na KMS operacijske greške i unusual access patterns. Migracija 110. cloudbuild.yaml paralelni step."
    status: pending
  - id: docs
    content: "docs/privacy.md: 7 arhitekturnih invarijanti, GDPR pseudonimizacija vs. anonimizacija distinkcija, OWASP LLM05 adresiranje, Standard/Strict-Legal/Strict profili, OPF roadmap, key rotation postupak, audit log politika."
    status: pending
isProject: false
---

## Zaključane arhitekturne invarijante (finalne — 7)

Ovo su nepromjenljive odluke koje se ne smiju narušiti ni u jednom commitu:

1. **Sidecar je jedini dekriptor.** Backend nikad ne čita `pii_mappings.ciphertext`. `mike_app` Postgres rola nema GRANT na `pii_mappings`, a RLS policy blokira `mike_app` čak i ako GRANT pogreškama bude dodan.
2. **Backend nikad ne dobiva raw originale.** Jedina iznimka: `pii_processed_text` koji dolazi iz `/apply-overrides` može sadržavati user-odobridne vrijednosti jer je korisnik eksplicitno odlučio te vrijednosti poslati modelu.
3. **Confirm flow: sidecar gradi finalni tekst.** Backend šalje `{ masked_placeholders, approved_for_disclosure }`, sidecar vraća `{ pii_processed_text, entity_summary }`.
4. **Cache kolona se zove `pii_processed_text_cache`** — precizno opisuje stvarnost.
5. **PII state živi na `document_versions`**, ne na `documents`.
6. **Strict residual gate blokira samo checksum-validirane** OIB (mod-11,10) i HR IBAN (mod-97) u model outputu. Sve ostalo propušta (OWASP LLM05 adresiramo samo za dokazivo osjetljive entitete).
7. **Ovo je pseudonimizacija, ne anonimizacija.** Pod GDPR-om (EDPB, travanj 2025.), LLM-ovi rijetko dostižu standard anonimizacije. Naš sustav smanjuje rizik, ali podaci ostaju osobni podaci s pseudonimom. Korisnici moraju biti obaviješteni — dokumentacija i UI copy koriste "pseudonymization", ne "anonymization".

---

## 1. Arhitektura (konačna)

```mermaid
flowchart LR
    subgraph client [Frontend / Word add-in]
        adddoc[AddDocButton]
        modal[DocumentAnonymizationPreviewModal<br/>v1 simple]
        composer[ChatInput - nema PII toggle]
        render[AssistantMessage<br/>inline restore]
    end
    subgraph backend [mike-backend - Node TS]
        upload[/POST single-documents/]
        piiroutes["/pii/preview-document<br/>/pii/sessions/:id/apply-overrides<br/>/pii/sessions/:id/discard<br/>/pii/messages/:id/render<br/>/pii/placeholders/info<br/>/pii/audit"]
        chat["/chat / projects/:id/chat<br/>/tabular-review/:id/chat"]
        readdoc[chatTools::readDocumentContent]
        tabext[tabular extract*Markdown]
    end
    subgraph shield [mike-pii-shield - Python sidecar]
        api[FastAPI<br/>IAM identity check first]
        engine{EngineRegistry<br/>PII_ENGINE env}
        presidio[Presidio + spaCy hr<br/>+ legal whitelist]
        opf[OPF stub v1.1]
        recog[HR recognizers<br/>OIB IBAN MBS ZK]
        crypto[AES-256-GCM<br/>pii_shield_app role only]
    end
    subgraph data [Cloud SQL]
        sessions[(pii_sessions<br/>status + entity_summary)]
        mappings[(pii_mappings<br/>pii_shield_app role only)]
        docversions[(document_versions<br/>pii_session_id<br/>pii_processed_text_cache<br/>pii_status)]
        audit[(pii_audit_log)]
    end

    adddoc -->|"upload"| upload
    upload -->|"extracted text"| piiroutes
    piiroutes -->|"HTTP /analyze"| api
    api --> engine
    engine --> presidio
    engine -.v1.1.-> opf
    presidio --> recog
    api --> crypto
    crypto --> mappings
    api -->|"anonymized_text + entity_summary"| piiroutes
    piiroutes --> sessions
    piiroutes -->|"anonymized_text + session_id"| modal

    modal -->|"apply-overrides: masked + approved_for_disclosure"| piiroutes
    piiroutes -->|"HTTP /apply-overrides"| api
    api -->|"pii_processed_text only"| piiroutes
    piiroutes --> docversions
    piiroutes --> audit

    composer -->|"raw user text - unchanged"| chat
    chat --> readdoc
    readdoc -->|"pii_processed_text_cache if exists"| chat
    readdoc -.no cache.->|"HTTP /analyze"| api
    chat --> tabext
    tabext -.->|"same flow"| api

    render -->|"POST /pii/messages/:id/render"| piiroutes
    piiroutes -->|"HTTP /render (session_ids + text)"| api
    api -->|"rendered_text only"| piiroutes
    piiroutes -->|"rendered_text"| render
    piiroutes --> audit
```

---

## Best practices nalazi (istraživanje You.com + Tavily, svibanj 2026.)

Pretraživanje je potvrdilo arhitekturne odluke i dodalo konkretne dopune koje su integrirane u ostatak plana:

**Presidio i custom recognizeri (oneuptime.com, anonym.community)**
- Presidio koristi sve 4 razine detekcije: NER + regex + checksum validacija + context word analysis. Naši HR recognizeri implementiraju sve 4.
- Context word analysis za MBS (bez kontekst-riječi skor = 0.0) potvrđen kao dobra praksa za smanjenje false positivea.
- Presidio pokriva ~20 entity tipova; region-specific (OIB, IBAN_HR, MBS, sudski broj, ZK) zahtijevaju custom `PatternRecognizer` — mi to implementiramo.

**Envelope encryption per DEK (n.demir.io, docs.cloud.google.com, oneuptime.com)**
- Best practice: generiraj DEK (AES-256) per sesija, kriptira DEK Cloud KMS CMK-om, pohrani `encrypted_dek` uz šifrirane podatke. CMK nikad ne dodiruje sirov plaintext.
- Pattern potvrđen: `nonce = os.urandom(12)` + `AESGCM.encrypt(nonce, plaintext, aad)` + KMS wrap DEK.
- **Izmjena v1 plana**: Envelope encryption ide u v1, ne v1.1. Schema već ima `pii_sessions.encrypted_dek bytea`, ali sidecar aktivira KMS wrap od starta. `PII_ENCRYPTION_KEY_SECRET` postaje `PII_KMS_KEY_NAME=projects/mikeoss-495610/locations/europe-west1/keyRings/pii-ring/cryptoKeys/pii-dek-wrapping-key`.
- Key rotation postupak: 90-dana rotacija DEK wrapping ključa. Stare sesije se re-wrapaju asinkrono (Cloud Scheduler job, ne blokira serving). Cloud Monitoring alert na `google.cloud.kms.v1.KeyManagementService.Decrypt` unusual patterns.

**Postgres Row Level Security (satoricyber.com, enterprisedb.com, vibhorkumar.wordpress.com)**
- GRANT separation je potreban ali nije dovoljan — GRANT može biti pogreškama proširen. RLS na `pii_mappings` je drugi sloj izolacije.
- `column_encrypt v4.0` pattern (vibhorkumar): automatsko log masking, key rotation kroz `encrypt.rotate()`. Naš sidecar implementira ekvivalent ručno.
- Implementacija: `ALTER TABLE pii_mappings ENABLE ROW LEVEL SECURITY; CREATE POLICY pii_shield_only ON pii_mappings USING (current_user = 'pii_shield_app');`

**GDPR 2026 i EDPB (secureprivacy.ai, regolo.ai, lowerplane.com)**
- **Kritično**: EDPB travanj 2025. — LLM-ovi rijetko dostižu standard anonimizacije. Naš sustav je pseudonimizacija (reverzibilna s ključem). Podaci ostaju osobni podaci pod GDPR-om.
- EU AI Act puna primjena od 2. kolovoza 2026. — za high-risk AI sustave potreban DPIA + FRIA.
- `true anonymization is difficult to achieve` — implementiramo to iskreno u kopiji i docs.
- Preporuka iz regolo.ai: dokumentiraj što provider vidi i pohranjuje. Naša dokumentacija mora jasno reći: "LLM provider nikad ne vidi originale. Backend nikad ne čita originale. Sidecar drži pseudonime s ključem."
- GDPR data minimization: ne logiraj što ne trebaš (već implementirano kroz `skipBodyLog`).

**OWASP LLM05:2025 — Improper Output Handling (genai.owasp.org)**
- LLM output koji sadrži XSS payload ili haluciniranu lozinku mora biti sanitiziran. Naš `gate.ts` (`maskResidual`) direktno adresira ovaj OWASP rizik za checksum-validirane identifikatore.
- Preporuka: "Apply deterministic filters to all tool outputs." Naš `redactJsonDeep` u `runToolCalls` je ta implementacija.
- XSS u rendered PII: originali se ugrađuju inline u DOM (jedini neizbježni exposure). Sidecar mora HTML-escapati originale prije vraćanja kroz `/render` endpoint.

**SSE streaming buffer (dev.to, tpiros.dev)**
- SSE framing buffer (`buffer.split('\n\n')`) je ortogonalan na placeholder split buffer.
- Implementacijski detalj za `joinChunks`: SSE client decode → `\n\n` split za SSE eventi → unutar svakog `data:` polja, stateful placeholder buffer (max 128 chars) za split `{{PII:...:` across chunk boundaries.
- Ne treba `TextDecoder({ stream: true })` na backendu jer backend ne parsira SSE — to radi frontend. Backend samo piše `data: ...\n\n` chunkove.

**MCP security (arxiv.org USENIX 2025)**
- MCP tool output je novi attack surface (PoisonedRAG pattern). Tool result koji dolazi od vanjskog MCP servera može sadržavati i injektirani prompt i PII.
- `redactJsonDeep` na tool results u Strict modu je obrana od oba rizika istovremeno.

---

## 2. Sidecar `mike-pii-shield/` (Python, Cloud Run)

### Struktura direktorija

```
mike-pii-shield/
├── Dockerfile
├── requirements.txt
├── pyproject.toml
├── app/
│   ├── main.py
│   ├── log.py          # structured JSON logger, strips text fields
│   ├── middleware.py   # IAM identity check, Cache-Control, request-id
│   ├── crypto.py       # AES-256-GCM, envelope prep for v1.1
│   ├── profiles.py     # STANDARD_ENTITIES, STRICT_LEGAL_ENTITIES, STRICT_ENTITIES
│   ├── store/
│   │   └── pg.py       # pii_mappings CRUD (pii_shield_app role)
│   └── engines/
│       ├── registry.py
│       ├── presidio_engine.py
│       ├── opf_engine.py   # stub: raise NotImplementedError
│       └── both_engine.py  # stub za v1.1
├── recognizers/
│   ├── oib.py
│   ├── hr_iban.py
│   ├── mbs.py
│   ├── sudski_broj.py
│   ├── zk.py
│   └── hr_address.py
└── tests/
    ├── fixtures/hr_legal_samples.jsonl  # ~50 sintetičkih uzoraka
    ├── test_oib.py           # 30 valid + 30 invalid
    ├── test_hr_iban.py
    ├── test_roundtrip.py     # analyze → apply-overrides → render
    ├── test_false_positives.py
    └── test_false_negatives.py
```

### Endpoints

**Sigurnosni middleware (sve rute)**:
1. Validira Cloud Run identity token (`X-Goog-IAP-JWT` ili `Authorization: Bearer <OIDC>`) — jedino tada vjeruje `X-Mike-User` headeru.
2. Attachira `X-Mike-Request-Id`, `X-Mike-Actor-User`, `X-Mike-Source` na audit log.
3. Postavlja `Cache-Control: no-store, no-cache` na sve responseove.
4. `Content-Type: application/json` na errorima, bez Python tracebackova koji mogu sadržavati dio inputa.

**`POST /analyze`**

```
Request headers:
  X-Mike-User: <user_uuid>
  X-Mike-Document: <doc_uuid | "ephemeral">
  X-Mike-DocVersion: <version_uuid | "ephemeral">
  X-Mike-Chat: <chat_uuid | null>
  X-Mike-Source: chat|project_chat|tabular|word
  X-Anon-Mode: standard|strict_legal|strict
  X-Mike-Request-Id: <uuid>

Body (max 5 MB):
{
  "text": "...",
  "existing_session_id": null | "<uuid>"  // deterministički counter
}

Response:
{
  "session_id": "<uuid>",   // NOVI redak u pii_sessions (status=pending)
  "anonymized_text": "...", // {{PII:OIB:000001}} placeholderi
  "entities": [
    { "placeholder": "{{PII:OIB:000001}}", "type": "OIB",
      "score": 0.99, "span_start": 42, "span_end": 53 }
  ],
  "entity_summary": { "OIB": 1, "PERSON": 2, "IBAN_HR": 1 }
}
```

Sidecar kreira `pii_session` redak u Postgresu (`status='pending'`). Mappinge kriptira i sprema u `pii_mappings`. Backend dobiva samo `anonymized_text`.

**`POST /sessions/:id/apply-overrides`** (zamjena za prethodni `/restore-original`)

```
Request:
{
  "masked_placeholders": ["{{PII:OIB:000001}}", "{{PII:IBAN_HR:000002}}"],
  "approved_for_disclosure": ["{{PII:PERSON:000003}}"]
}

Response:
{
  "session_id": "...",
  "status": "confirmed",
  "pii_processed_text": "...",  // finalni tekst: {{PII:OIB:000001}} ostaje,
                                 // {{PII:PERSON:000003}} zamijenjen originalom
  "entity_summary": {
    "masked": { "OIB": 1, "IBAN_HR": 1 },
    "approved_for_disclosure": { "PERSON": 1 }
  }
}
```

Sidecar:
1. Dekriptira mappinge za sesiju.
2. Gradi finalni tekst — masked placeholderi ostaju, `approved_for_disclosure` se zamijenjuju originalima unutar sidecara.
3. Ažurira `pii_sessions.status = 'confirmed'`, `entity_summary`, `confirmed_at`.
4. Briše `pii_mappings` redove za `approved_for_disclosure` entitete (više nisu tajni; korisnik ih je eksplicitno odobrio).
5. Vraća `pii_processed_text` i `entity_summary` — **bez sirovih originala u odgovoru**.
6. Puni `pii_audit_log` s `action='approve_disclosure'` za svaki odobreni placeholder.

Finalni `pii_processed_text` može sadržavati neke originale, ali samo one koje je korisnik svjesno pustio. Backend taj tekst sprema u `document_versions.pii_processed_text_cache`.

**`POST /render`**

```
Request:
{
  "session_ids": ["<uuid>", "<uuid>"],
  "text": "Dokument navodi {{PII:OIB:000001}} kao stranku.",
  "output_format": "text" | "html"   // default: "text"
}

Response:
{
  "rendered_text": "Dokument navodi 12345678901 kao stranku."  // text output
  // ili za html: "Dokument navodi <span class=\"pii-restored\" data-type=\"OIB\">12345678901</span> kao stranku."
}
```

Sidecar:
1. Dekriptira mappinge za sve session_ids.
2. Regex-replace placeholdera u tekstu.
3. **OWASP LLM05 obrana**: HTML-escapa originale (`html.escape(original)`) kada je `output_format="html"` — sprječava XSS ako model halucinira `<script>` ili slično kao dio "imenske" vrijednosti.
4. Nikad ne vraća `{ placeholder: original }` mapping tablicu.

**`POST /placeholders/info`** (POST umjesto GET s pathom — izbjegava URL encoding problema)

```
Request:
{
  "session_id": "...",
  "placeholders": ["{{PII:OIB:000001}}", "{{PII:PERSON:000002}}"]
}

Response:
{
  "results": [
    {
      "placeholder": "{{PII:OIB:000001}}",
      "entity_type": "OIB",
      "original_preview": "123...901",  // standard/strict_legal: 3 + ... + 3 znakova
      "char_count": 11                   // strict: samo tip i duljinu, bez preview
    }
  ]
}
```

`original_preview` ovisi o modu sesije:
- `standard` / `strict_legal`: `Iva...ić` style (3 chars + `...` + 3 chars minimum; za kratke (<7 chars): samo `***`).
- `strict`: samo `{ entity_type, char_count }`, bez preview. Audit svaki poziv.

**`POST /sessions/:id/disclose-placeholder`** (eksplicitna akcija: puni original za prikaz korisniku u modal kontekstu)

Namjena: modal treba prikazati puni original da korisnik može donijeti informiranu odluku o `approve_for_disclosure`. Ovo je jedini endpoint koji vraća puni original — **samo u kontekstu modalnog review-a, ne za render asistentovog teksta**.

```
Request:
{
  "placeholder": "{{PII:PERSON:000003}}",
  "reason": "user_review_for_disclosure_decision"
}

Response:
{
  "placeholder": "{{PII:PERSON:000003}}",
  "original": "Ivan Horvat"   // puni original
}
```

Rate limit: **5/min/user/session** (namjerno strogo). Audit `disclose_for_review`. Session mora biti u statusu `pending` (ne može se dohvatiti original za već confirmed/discarded sesiju).

**`GET /healthz`** — HTTP 200 ako je proces živ.

**`GET /readyz`** — HTTP 200 kad je NLP model loaded i DB connection OK.

**`GET /version`** — `{ engine, presidio_version, spacy_model, recognizers: [...], build_sha }`.

### Placeholder format (zaključano)

```
{{PII:TYPE:NNNNNN}}
```

- `TYPE` = `[A-Z_]+` (primjeri: `OIB`, `IBAN_HR`, `PERSON`, `MBS`, `SUDSKI_BROJ`, `ZK_PODACI`, `EMAIL`, `PHONE`, `ADDRESS`, `ORG`, `LOC`, `DATE`, `MONEY`, `URL`, `IP`, `CREDENTIAL`)
- `NNNNNN` = šesteroznamenkasti niz (`000001` do `999999`), deterministički raspoređen po sesiji (isti original = isti broj u sesiji)
- Ukupna max duljina: 26 znakova — buffer je siguran

Regex za matchanje: `\{\{PII:[A-Z_]+:\d{6}\}\}`

### Crypto layer (`app/crypto.py`) — envelope encryption aktivan od v1

Potvrđen pattern iz GCP docs i best practices istraživanja (n.demir.io, docs.cloud.google.com):

```python
class EnvelopeEncryption:
    """
    Per-session DEK: AES-256-GCM lokalno, DEK kriptiran Cloud KMS CMK-om.
    CMK nikad ne dodiruje plaintext. DEK nikad ne napušta sidecar u plaintextu.
    """
    def __init__(self):
        self.kms = kms.KeyManagementServiceClient()
        self.key_path = os.environ["PII_KMS_KEY_NAME"]
        # npr: projects/mikeoss-495610/locations/europe-west1/keyRings/pii-ring/cryptoKeys/pii-dek-wrapping-key

    def new_session_dek(self) -> tuple[bytes, bytes]:
        """Vrati (plaintext_dek, encrypted_dek_for_storage)."""
        dek = os.urandom(32)
        resp = self.kms.encrypt(request={"name": self.key_path, "plaintext": dek})
        return dek, resp.ciphertext  # encrypted_dek ide u pii_sessions

    def load_session_dek(self, encrypted_dek: bytes) -> bytes:
        """Dohvati DEK iz KMS za dekriptiranje mappinga."""
        resp = self.kms.decrypt(request={"name": self.key_path, "ciphertext": encrypted_dek})
        return resp.plaintext

    def encrypt_mapping(self, dek: bytes, session_id: str, placeholder: str, original: str) -> tuple[bytes, bytes]:
        nonce = os.urandom(12)
        aad = (session_id + placeholder).encode()
        aesgcm = AESGCM(dek)
        ciphertext = aesgcm.encrypt(nonce, original.encode(), aad)
        return ciphertext, nonce

    def decrypt_mapping(self, dek: bytes, session_id: str, placeholder: str,
                        ciphertext: bytes, nonce: bytes) -> str:
        aad = (session_id + placeholder).encode()
        aesgcm = AESGCM(dek)
        return aesgcm.decrypt(nonce, ciphertext, aad).decode()
```

Deploy env var: `PII_KMS_KEY_NAME=projects/mikeoss-495610/locations/europe-west1/keyRings/pii-ring/cryptoKeys/pii-dek-wrapping-key`

Key rotation postupak (dokumentirati u `docs/privacy.md`):
1. Kreiraj novu KMS key version.
2. Cloud Scheduler job (jednom tjedno): SELECT sesije s `encrypted_dek` starijim od 90 dana → `load_session_dek(old)` → `kms.encrypt(new_key_version, dek)` → UPDATE `pii_sessions.encrypted_dek`.
3. Cloud Monitoring alert na `google.cloud.kms.v1.KeyManagementService.Decrypt` unusual access rates i KMS operation failures.

Backend **nema** `PII_KMS_KEY_NAME` ni `PII_ENCRYPTION_KEY_SECRET` — samo sidecar.

### HR recognizeri

**`oib.py`** — regex `\b\d{11}\b` + ručni mod-11,10 validator (ne `python-stdnum`):

```python
def _validate_oib(oib: str) -> bool:
    if not oib.isdigit() or len(oib) != 11:
        return False
    a = 10
    for d in oib[:10]:
        a = (a + int(d)) % 10
        if a == 0: a = 10
        a = (a * 2) % 11
    check = 11 - a
    return check == int(oib[10]) if check < 10 else (check == 10 and int(oib[10]) == 0)
```

Test corpus (`tests/test_oib.py`): 30 stvarnih-format OIB-ova s checksum probom, 30 nasumičnih 11-cifrenih stringova (expected: rejected), 5 edge caseova (vodeće nule, granica checksuma).

**`hr_iban.py`** — regex `\bHR\d{2}\s?(\d{4}\s?){4}\d{3}\b` + ručni mod-97 validator. Test corpus analogno.

**`mbs.py`** — **context-driven**: regex `\b\d{6,9}\b` aktivira se **samo** uz context word/phrase u ±50 znakova: `MBS`, `matični broj subjekta`, `Tt-`, `sudski registar`. Bez konteksta, skor = 0.0 → Presidio odbacuje.

**`sudski_broj.py`** — patterni: `[A-ZČĆŽŠĐ][a-zčćžšđ]{0,3}-\d+/\d{2,4}` (primjeri: `P-123/2024`, `Pn-1/24`, `Gž-99/2023`, `I R1-44/25`). Context boost: `predmet`, `Op. broj`, `Sud:`, `Pravomoćnost`.

**`zk.py`** — patterni:
- `k\.\s?č\.?\s?br?\.?\s?\d+(?:/\d+)?` — k.č.br.
- `z\.k\.?\s?ul(?:ožak)?\.?\s?\d+` — z.k.uložak
- `k\.o\.?\s?[A-ZČĆŽŠĐ][\wčćžšđ\s-]{2,}` — katastarska općina

Context boost: `Općinski sud`, `gruntovnica`, `posjedovni list`, `katastarska općina`.

**`hr_address.py`** — fallback za ulice ako spaCy LOC promakne: `\b(Ul\.|Ulica|Trg|Avenija|Cesta)\s+[A-ZČĆŽŠĐ][\wčćžšđ\s.]{2,}\s\d+[A-Za-z]?\b`.

### Profili (`app/profiles.py`)

**`standard`**:
- Entiteti: PERSON, EMAIL, PHONE, IBAN_HR, OIB, MBS, SUDSKI_BROJ, ZK_PODACI, ADDRESS
- Score threshold: 0.5

**`strict_legal`** (default za pravne korisnike):
- Entiteti: sve iz standard + ORG (samo privatne tvrtke, ne javne institucije), DATE (samo uz osobu — datum rođenja, death — ne datumi presuda/zakona/rokova), MONEY (samo uz osobni račun/naknadu, ne javne iznose), URL, IP
- Post-processor "legal whitelist": odbacuje spanove koji padaju unutar `Vrhovni sud`, `Ustavni sud`, `čl. \d+`, `Zakon o`, `Narodne novine`, `NN \d+`, `pravomoćna presuda`, `rješenjem`, `Ministarstvo` i srodnih contextualnih termina
- Score threshold: 0.4

**`strict`**:
- Entiteti: sve iz strict_legal + ORG (svi), LOC (sve lokacije), DATE (svi osim `danas`, `jučer`, `ovaj tjedan`), MONEY (svi ≥ 100 EUR), CREDENTIAL (v1.1 s OPF), NRP
- Score threshold: 0.3
- Drugi prolaz: TS-style regex checksum validacija za OIB + IBAN unutar sidecara
- Fail-closed: ako /analyze timeout → HTTP 503, backend ne šalje dokument

### Logging (`app/log.py`)

Svaki log record je JSON:
```json
{
  "timestamp": "...", "request_id": "...", "session_id": "...",
  "action": "analyze", "mode": "strict_legal", "source": "document",
  "entity_count": 4, "text_len": 12043, "latency_ms": 342
}
```

Polja koja **nikad** ne ulaze u log: `text`, `anonymized_text`, `pii_processed_text`, `rendered_text`, `original`, `original_preview`, `ciphertext`, `entities[].span_start/end`.

FastAPI exception handler: vraća `{ "error": "internal_error", "request_id": "..." }` bez Python tracebackova.

### Test corpus (`tests/fixtures/hr_legal_samples.jsonl`)

~50 sintetičkih uzoraka, 3 kategorije testova:

- **False positive** (`test_false_positives.py`): sudovi, zakoni, datumi presuda, javni iznosi, institucije — ovi ne smiju biti maskirani u `strict_legal`.
- **False negative** (`test_false_negatives.py`): OIB, IBAN, MBS, osobna imena u kontekstu — ovi moraju biti maskirani.
- **Roundtrip** (`test_roundtrip.py`):
  1. `/analyze` → provjeri `anonymized_text` ne sadrži originale
  2. `/apply-overrides` s `masked=[OIB]`, `approved_for_disclosure=[PERSON]`
  3. Provjeri `pii_processed_text` sadrži PERSON original ali ne OIB
  4. `/render` s masked sesijom → provjeri OIB vraćen
  5. Provjeri PERSON render vraća isti original (nije maskiran jer disclosure)

---

## 3. Backend (`backend/`) — integracija

### `backend/src/lib/pii/client.ts`

Sve sidecar operacije teku kroz ovaj modul. Backend nikad ne importira crypto lib za PII.

```typescript
interface PiiClient {
  analyze(text: string, mode: PiiMode, ctx: PiiContext): Promise<AnalyzeResult>
  applyOverrides(sessionId: string, payload: OverridePayload): Promise<ApplyResult>
  render(sessionIds: string[], text: string, ctx: PiiContext): Promise<{ rendered_text: string }>
  placeholderInfo(placeholders: string[], sessionId: string): Promise<PlaceholderInfoResult>
  discloseForReview(sessionId: string, placeholder: string): Promise<{ original: string }>
}
// ApplyResult.pii_processed_text je jedini tekst koji backend sprema
// ApplyResult ne sadrži { placeholder: original } mapping
```

Retry: exponential backoff, max 2 pokušaja, timeout 8s. `PiiShieldError` class **nikad ne sadrži `text` ili `original` polje**.

Headers koje backend šalje sidecaru za svaki request:
- `X-Mike-User: <userId>`
- `X-Mike-Request-Id: <ulazni request UUID>` (korelacija log redova)
- `X-Mike-Actor-User: <userId>` (redundantno, za audit jasnoću)
- `X-Mike-Source: chat | project_chat | tabular | word`
- Cloud Run OIDC token u `Authorization` (fetcha automatski s metadata server)

### `backend/src/lib/pii/placeholders.ts`

```typescript
const PLACEHOLDER_REGEX = /\{\{PII:[A-Z_]+:\d{6}\}\}/g
const MAX_PLACEHOLDER_BUFFER = 128  // znakova — za split placeholder across SSE chunks

function findResidual(text: string): string[]   // vraca placeholdere koji nisu u sesiji

// VAŽNO: postoje DVA odvojena buffera u SSE pipeline-u:
// 1. SSE framing buffer (na frontend strani): `buffer.split('\n\n')`, ostatak ide u sljedeći chunk
//    — ovo parsira SSE protokol, ortogonalno na PII
// 2. Placeholder split buffer (ovdje, backend): drži kraj chunka ako sadrži '{{' bez '}}'
//    — ovo je jedino što joinChunks radi; ne dira SSE framing

function joinChunks(stream: AsyncIterable<string>): AsyncGenerator<string> {
  // Stateful: buffer drži suffix chunka koji počinje s '{{' ali nema zatvaranje '}}'
  // Ako buffer naraste iznad MAX_PLACEHOLDER_BUFFER (128 chars), ispusti ga bez čekanja
  // da ne blokiramo UI stream. Maksimalni placeholder je ~32 chars, pa je 128 siguran margin.
  // Nikad ne blokira stream dulje nego što treba.
}
```

### `backend/src/lib/pii/tsRegex.ts`

Samo za Strict residual gate u model outputu. Ne koristi se za anonimizaciju (to radi sidecar).

```typescript
// Vraća pozicije checksum-validiranih OIB-ova ili HR IBAN-ova nađenih u tekstu
function findValidatedResidual(text: string): ResidualSpan[]
```

### `backend/src/lib/pii/gate.ts`

```typescript
// Koristi tsRegex za final check na model outputu
// Blokira SAMO checksum-validirane OIB/IBAN koji nisu bili u sesijskim placeholderima
// Za sve ostalo: propusti i audita ništa (false positive threshold prevysok)
function maskResidual(text: string, sessionIds: string[]): { text: string; blocked: ResidualSpan[] }
```

`blocked` spanovi se zamjenjuju s `[[REDACTED OIB]]` / `[[REDACTED IBAN]]` — ne blokira cijeli stream.

### `backend/src/lib/pii/redactJsonDeep.ts`

```typescript
// Defenzivno prolazi JSON objekt i anonimizira string vrijednosti
// NE dira ključeve (osim ako je explicit opt-in)
// Koristi se u runToolCalls za args/results u Strict modu
function redactJsonDeep(value: unknown, sessionId: string, mode: PiiMode): Promise<unknown>
```

### Hook-ovi u postojeći kod

**`backend/src/lib/chatTools.ts` → `readDocumentContent`** (~1282):

```
1. Ekstrahiraj tekst (PDF / DOCX / mammoth / word-extractor) — bez izmjena
2. Pronađi aktivnu sesiju za (document_version_id, mode) iz document_versions:
   a. Ako postoji pii_session_id i pii_processed_text_cache → vrati cache
   b. Ako ne postoji i pii_default_mode != 'off':
      - pozovi client.analyze(text, mode, ctx)
      - pozovi client.applyOverrides(sessionId, { masked_placeholders: sve, approved_for_disclosure: [] })
        (silent full masking — bez user review)
      - spremi pii_session_id i pii_processed_text_cache u document_versions
      - audit auto_anonymize
      - vrati pii_processed_text
   c. Ako pii_default_mode == 'off' → vrati originalni tekst (status quo)
```

**`backend/src/routes/tabular.ts`** → `extractPdfMarkdown` / `extractDocxMarkdown` rezultat prolazi kroz isti flow.

**`backend/src/routes/chat.ts`** → Word add-in `selection.text`: ako `client === "word"` i `selection.has_selection`, poziva `/analyze` s `X-Mike-Document: ephemeral` → dobija `anonymized_text` → šalje modelu, session istječe za 1 dan.

**`runLLMStream`** i **`streamChatWithTools`**: bez izmjena u main toku. Model dobiva `pii_processed_text` iz `readDocumentContent`. SSE stream prema klijentu prolazi nepromijenjen.

**`runToolCalls`**:
- `args` (od modela prema alatu): `redactJsonDeep` u Strict modu. Standard: no-op.
- `result` iz MCP / lokalnih alata / web search: poziva `/analyze` na tool result tekstu u istoj sesiji (novi toolovi su potencijalni izvor PII iz vanjskih sustava).

### Logging policy u backendu

`backend/src/index.ts` middleware:
```typescript
app.use('/pii', (req, res, next) => { req.skipBodyLog = true; next() })
```

Globalni error handler — za svaku `error.message`:
```typescript
const safeMessage = placeholders.findResidual(error.message).length > 0
  ? '[error message contained PII placeholders, redacted]'
  : error.message
```

### `backend/src/routes/pii.ts`

**`POST /pii/preview-document`**:
```
Body: { document_id, document_version_id?, mode }
→ ekstrahira tekst dokumenta
→ poziva client.analyze(text, mode, ctx)
→ vraća { session_id, anonymized_text, entities, entity_summary, expires_at }
```
Backend nikad ne sprema mapping. Mapping je samo u sidecaru.

**`POST /pii/sessions/:id/apply-overrides`**:
```
Body: { masked_placeholders: string[], approved_for_disclosure: string[] }
→ poziva client.applyOverrides(sessionId, payload)
→ dobija { pii_processed_text, entity_summary, status }
→ UPDATE document_versions SET
    pii_session_id = sessionId,
    pii_processed_text_cache = pii_processed_text,
    pii_status = 'confirmed'
→ audit: za svaki 'approved_for_disclosure' entitet, action='approve_disclosure'
→ vraća { session_id, status: "confirmed", entity_summary }
```

**`POST /pii/sessions/:id/discard`**:
```
→ sidecar /sessions/:id/discard (čisti mappinge za non-masked entitete, status='discarded')
→ document_versions.pii_status = 'discarded'
→ audit action='discard'
```

**`POST /pii/messages/:messageId/render`**:
```
Body: { text: string }
→ owner check: userId vlasnik svih sesija koje su vezane za dokumente used u tom chatu
→ dohvati session_ids iz document_versions za dokumente koji su u chatu
→ client.render(session_ids, text)
→ vraća { rendered_text }
→ audit: action='render', entity_count = broj zamijenjenih placeholdera
→ Header: Cache-Control: no-store
Rate limit: 60/min/user
```

**`POST /pii/placeholders/info`**:
```
Body: { session_id, placeholders: string[] }
→ owner check
→ client.placeholderInfo(placeholders, session_id)
→ vraća { results: [{ placeholder, entity_type, original_preview, char_count }] }
→ audit: action='placeholder_lookup', count = placeholders.length
Rate limit: 120/min/user
Header: Cache-Control: no-store
```

**`GET /pii/audit`**:
```
Query: ?from=&to=&document_id=&mode=&action=&page=&per_page=
→ SELECT iz pii_audit_log WHERE user_id = req.userId
→ bez originala, samo entity_summary i metadata
```

**Bez promjena** na `/chat`, `/projects/:id/chat`, `/tabular-review/:id/chat` request bodyju.

---

## 4. Database (Cloud SQL) — konačna shema

Migracija `backend/migrations/110_pii_anonymization.sql`:

```sql
-- ─── pii_sessions ────────────────────────────────────────────────────────
CREATE TABLE pii_sessions (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL,
    document_id       uuid        NOT NULL,     -- referentni, ne FK (dokument može biti obrisan)
    document_version_id uuid      NOT NULL,
    mode              text        NOT NULL CHECK (mode IN ('standard','strict_legal','strict')),
    engine            text        NOT NULL DEFAULT 'presidio',
    source            text        NOT NULL CHECK (source IN ('chat','project_chat','tabular','word','ephemeral')),
    status            text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','confirmed','discarded','expired')),
    entity_summary    jsonb       NOT NULL DEFAULT '{}',  -- { masked: {...}, approved_for_disclosure: {...} }
    encrypted_dek     bytea       NULL,         -- v1.1 envelope encryption, NULL u v1
    created_at        timestamptz NOT NULL DEFAULT now(),
    confirmed_at      timestamptz NULL,
    discarded_at      timestamptz NULL,
    expires_at        timestamptz NOT NULL
    -- bez UNIQUE constraint; aplikacijski pronalazi zadnju status='pending'|'confirmed' sesiju
);

-- ─── pii_mappings ────────────────────────────────────────────────────────
-- Tablicu kreira ista migracija, ali pii_shield_app je jedina rola sa SELECT
CREATE TABLE pii_mappings (
    session_id    uuid        NOT NULL REFERENCES pii_sessions(id) ON DELETE CASCADE,
    placeholder   text        NOT NULL,  -- {{PII:OIB:000001}}
    entity_type   text        NOT NULL,
    ciphertext    bytea       NOT NULL,
    nonce         bytea       NOT NULL,  -- 12 bytes AES-GCM nonce
    score         real        NULL,
    span_start    int         NULL,
    span_end      int         NULL,
    source        text        NOT NULL CHECK (source IN ('document','tool_result','manual')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, placeholder)
);

-- ─── pii_audit_log ───────────────────────────────────────────────────────
CREATE TABLE pii_audit_log (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid        NOT NULL,
    document_id         uuid        NULL,
    document_version_id uuid        NULL,
    chat_id             uuid        NULL,
    message_id          uuid        NULL,
    session_id          uuid        NULL,
    mode                text        NULL,
    action              text        NOT NULL CHECK (action IN (
        'preview',
        'apply_overrides',
        'approve_disclosure',
        'discard',
        'auto_anonymize',
        'render',
        'placeholder_lookup',
        'disclose_for_review',
        'expire'
    )),
    entity_summary      jsonb       NOT NULL DEFAULT '{}',
    residual_blocked    jsonb       NULL,
    source              text        NOT NULL,
    created_by_ip_hash  text        NULL,   -- SHA-256(ip + global_salt), nije reverzibilan
    user_agent_hash     text        NULL,   -- SHA-256(ua + global_salt)
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pii_audit_user_created ON pii_audit_log(user_id, created_at DESC);
CREATE INDEX idx_pii_sessions_expires   ON pii_sessions(expires_at) WHERE status = 'pending';
CREATE INDEX idx_pii_sessions_docver    ON pii_sessions(document_version_id, mode, status);

-- ─── document_versions proširenje ─────────────────────────────────────────
-- PII state živi na document_versions, ne na documents globalno
ALTER TABLE document_versions
    ADD COLUMN IF NOT EXISTS pii_session_id           uuid    NULL,
    ADD COLUMN IF NOT EXISTS pii_processed_text_cache text    NULL,  -- može sadržavati user-approved originale
    ADD COLUMN IF NOT EXISTS pii_status               text    NULL
                             CHECK (pii_status IN ('pending','confirmed','discarded'));

-- ─── user_profiles proširenje ─────────────────────────────────────────────
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS pii_default_mode    text    NOT NULL DEFAULT 'off'
                             CHECK (pii_default_mode IN ('off','standard','strict_legal','strict')),
    ADD COLUMN IF NOT EXISTS pii_review_required boolean NOT NULL DEFAULT true;

-- ─── Role separation + Row Level Security (dvije razine izolacije) ────────
-- Potvrđeno best practices: GRANT je potreban ali nije dovoljan; RLS ostaje
-- čak i ako GRANT pogreškama bude proširen.

-- Pokrenuti samo ako rola ne postoji (idempotentno):
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pii_shield_app') THEN
    CREATE ROLE pii_shield_app LOGIN;
  END IF;
END $$;

GRANT SELECT, INSERT, DELETE ON pii_mappings TO pii_shield_app;
GRANT SELECT, INSERT, UPDATE ON pii_sessions TO pii_shield_app;
GRANT INSERT                  ON pii_audit_log TO pii_shield_app;

-- mike_app intentionally has NO GRANT on pii_mappings
GRANT SELECT, INSERT, UPDATE ON pii_sessions  TO mike_app;
GRANT SELECT, INSERT         ON pii_audit_log TO mike_app;

-- RLS na pii_mappings — drugi sloj obrane
ALTER TABLE pii_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_mappings FORCE ROW LEVEL SECURITY;   -- blokira i table owner osim BYPASSRLS
CREATE POLICY pii_mappings_shield_only ON pii_mappings
    USING (pg_has_role(current_user, 'pii_shield_app', 'member'));
-- mike_app ne može pročitati retke čak ni ako budu greškom grantani SELECT

-- ─── TTL trigger (pii_audit_log zapis prije CASCADE brisanja) ────────────
CREATE OR REPLACE FUNCTION pii_sessions_expire_audit() RETURNS trigger AS $$
BEGIN
    INSERT INTO pii_audit_log(user_id, session_id, document_version_id, action, entity_summary, source)
    VALUES (OLD.user_id, OLD.id, OLD.document_version_id, 'expire', OLD.entity_summary, 'ttl_job');
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pii_sessions_before_delete
BEFORE DELETE ON pii_sessions
FOR EACH ROW EXECUTE FUNCTION pii_sessions_expire_audit();
```

TTL job (Cloud Scheduler, jednom dnevno):
```sql
DELETE FROM pii_sessions
WHERE expires_at < now()
  AND status IN ('confirmed', 'discarded', 'expired');
```

Aktivna sesija lookup (bez UNIQUE constrainta):
```sql
SELECT id FROM pii_sessions
WHERE document_version_id = $1 AND mode = $2 AND status IN ('pending','confirmed')
ORDER BY created_at DESC LIMIT 1;
```

---

## 5. Frontend (`frontend/`) — konačni UI

### Account stranica `account/privacy/page.tsx`

Mirrorira [frontend/src/app/(pages)/account/mcp/page.tsx](frontend/src/app/(pages)/account/mcp/page.tsx):
- Toggle `Anonymize documents before AI` — `off | standard | strict_legal | strict`.
- Toggle `Require manual review before sending` (default: true).
- Audit log tablica (last 100): timestamp, document filename, mode, masked entity counts, `approve_disclosure` count, action badge, "Open chat" link.

Tab u [frontend/src/app/(pages)/account/layout.tsx](frontend/src/app/(pages)/account/layout.tsx): `{ key: "privacy", href: "/account/privacy", labelKey: "privacy" }`.

i18n keys (novo u `frontend/messages/{en,hr}.json`):
```json
"account": {
  "tabs": { "privacy": "Privacy" }
},
"privacy": {
  "title": "Document Privacy",
  "mode_off": "Off",
  "mode_standard": "Standard",
  "mode_strict_legal": "Strict (Legal)",
  "mode_strict": "Strict",
  "review_required": "Require manual review before sending",
  "banner": "Mapping table is encrypted in your environment and is never sent to the AI.",
  "disclaimer": "This is a privacy aid, not a guarantee. Apply Strict or Strict-Legal mode for high-sensitivity matters.",
  "audit_title": "Audit Log",
  "audit_action_preview": "Preview",
  "audit_action_apply_overrides": "Confirmed",
  "audit_action_approve_disclosure": "Disclosed",
  "audit_action_discard": "Sent original",
  "audit_action_auto_anonymize": "Auto-anonymized",
  "audit_action_render": "Viewed",
  "audit_action_expire": "Expired"
}
```

### `DocumentAnonymizationPreviewModal.tsx` (v1 simple)

Stilski uzor [frontend/src/app/components/shared/ShareChatModal.tsx](frontend/src/app/components/shared/ShareChatModal.tsx).

Struktura (`createPortal`, `fixed inset-0 z-[101]`, `rounded-2xl bg-white shadow-2xl`, `max-w-4xl max-h-[85vh]`):

**Header**: document filename + version badge + Mode dropdown (Standard / Strict-Legal / Strict).

**Banner**: ikonica shield + "Mapping table is encrypted at rest in your environment and is never sent to the AI."

**Body (dvostupčano)**:
- *Lijevo (60%)*: read-only preview anonimiziranog teksta. Plain `<div>` s CSS chip stilom za `{{PII:TYPE:000001}}` placeholdere (bijeli chip, boja border-a po tipu: OIB = crvena, PERSON = žuta, IBAN_HR = ljubičasta, ZK = plava, ostalo = siva). NIJE TipTap editor — `contentEditable: false`.
- *Desno (40%)*: scrollable lista entiteta grupirana po tipu. Svaki entitet: checkbox (default: checked = "mask this"), tip badge, `original_preview` (dohvaća se **lazy — samo na hover** nad checkboxom, call `POST /pii/placeholders/info`, cache u React state za trajanje modala samo). Tooltip: custom React Popover, **NE** HTML `title` atribut. Strict mode: prikazuje samo `[TYPE, N chars]` umjesto previewa. Filter dropdown po tipu. "Select all / Deselect all" buttons.

**Footer**:
- `Cancel` (zatvori, dokument se ne priloži)
- `Apply & send anonymized` (primary button; disable ako Strict i live `tsRegex` detektira goli checksum-validirani OIB/IBAN u preview tekstu)
- `Send original — no anonymization` (link-stil, disabled ako `pii_default_mode === 'strict'`; klik otvara AYS dialog: "This will send the document with personal identifiers intact to the AI provider. This action is audit-logged.")

**Confirm flow** (klik na "Apply & send anonymized"):
1. Skupi `masked = []` i `approved_for_disclosure = []` iz checkbox stanja.
2. `POST /pii/sessions/:id/apply-overrides` → dobija `{ pii_processed_text, entity_summary }`.
3. Backend zatvori sesiju, spremi cache u `document_versions`.
4. Pozovi `onConfirm(doc.withPiiSessionId(sessionId))`.
5. Zatvori modal.

**v1.1 planirano** (ne u v1):
- TipTap editor umjesto read-only previewa.
- "Mark selected as PII" iz selekcije.
- Disclose action unutar modala (klik + AYS → `POST /sessions/:id/disclose-placeholder` za puni original u UI).

### Chat integracija

**`AddDocButton`** ([frontend/src/app/components/assistant/AddDocButton.tsx](frontend/src/app/components/assistant/AddDocButton.tsx)):

Intercept `onSelectDoc`:
```typescript
if (userProfile.pii_default_mode !== 'off') {
  const preview = await previewDocumentAnonymization({ document_id, mode })
  if (userProfile.pii_review_required) {
    openModal(preview, (confirmedDoc) => onSelectDoc(confirmedDoc))
  } else {
    // tiha full masking
    const result = await confirmDocumentAnonymization(preview.session_id, {
      masked_placeholders: preview.entities.map(e => e.placeholder),
      approved_for_disclosure: []
    })
    onSelectDoc({ ...doc, pii_session_id: result.session_id })
  }
} else {
  onSelectDoc(doc)
}
```

Document chip u ChatInputu dobiva shield badge (`ShieldCheckIcon`, neutral siva kad masked, crvena kad nema sesiju ali mode je Strict). Custom React tooltip: "X entities masked — click to review".

**`AssistantMessage`** ([frontend/src/app/components/assistant/AssistantMessage.tsx](frontend/src/app/components/assistant/AssistantMessage.tsx)):

- Detektira `{{PII:` u `content` stringu.
- Lazy-poziva `POST /pii/messages/:messageId/render` s `{ text: content }`.
- Rezultat cache-ira u `Map<messageId, rendered_text>` u `ChatContextStore` (**memory-only, NE `localStorage`**).
- Cache se briše na logout, `useAssistantChat` unmount, ili idle > 10 min.
- Renderira `rendered_text` umjesto `content`; originali su inline u DOM-u (jedini neizbježni exposure — dokumentirano).
- Per-chip popover (klik na shield icon): dohvaća `POST /pii/placeholders/info` → prikazuje `entity_type` i `original_preview`. **NE** `title` atribut.

`UserMessage`: bez izmjena.

Tipovi — `MikeDocument` u [frontend/src/app/components/shared/types.ts](frontend/src/app/components/shared/types.ts):
```typescript
pii_session_id?:    string
pii_entity_summary?: Record<string, number>
pii_mode?:          "standard" | "strict_legal" | "strict"
pii_status?:        "pending" | "confirmed" | "discarded"
```

**mikeApi.ts** novi helperi:
```typescript
previewDocumentAnonymization(params)        // → POST /pii/preview-document
confirmDocumentAnonymization(id, payload)  // → POST /pii/sessions/:id/apply-overrides
discardDocumentAnonymization(id)           // → POST /pii/sessions/:id/discard
renderMessage(messageId, text)             // → POST /pii/messages/:messageId/render
placeholderInfo(payload)                   // → POST /pii/placeholders/info
getPrivacyAuditLog(filters)               // → GET /pii/audit
```

**Frontend logging hygiene**:
- `mikeApi.ts` ne loga `text`, `rendered_text`, `original_preview` polja u request/response interceptorima.
- Sentry beforeSend hook redaktira ta polja iz breadcrumbs.
- Service worker (ako postoji) ne cache-ira `/pii/*` responseove.

---

## 6. Word add-in

[word-addin/src/taskpane/components/ChatInput.tsx](word-addin/src/taskpane/components/ChatInput.tsx):
- `selection.text` tretira se kao ephemeral dokument.
- Isti preview flow s manjim modalom (`max-w-md`).
- v1 modal u add-inu je read-only + checkboxes (bez TipTap — ne treba jer nema editor u add-inu).
- Add-in ne dodaje TipTap dependencies u v1 (bundle ostaje manji).

[word-addin/src/taskpane/hooks/useChat.ts](word-addin/src/taskpane/hooks/useChat.ts):
- Ako `pii_default_mode !== 'off'` i `selection.has_selection`: pokreni preview → modal → send s `anonymized_selection_text` umjesto raw `selection.text`.

[word-addin/src/taskpane/lib/api.ts](word-addin/src/taskpane/lib/api.ts): isti `previewDocumentAnonymization`, `confirmDocumentAnonymization` helperi.

---

## 7. Tri profila (zaključano)

| | standard | strict_legal | strict |
|---|---|---|---|
| PERSON | ✓ | ✓ | ✓ |
| EMAIL, PHONE | ✓ | ✓ | ✓ |
| OIB, IBAN_HR, MBS, SUDSKI_BROJ, ZK | ✓ | ✓ | ✓ |
| ADDRESS (ulica + broj) | ✓ | ✓ | ✓ |
| ORG (privatne) | — | ✓ | ✓ |
| ORG (javne: sudovi, ministarstva) | — | — | ✓ |
| DATE (uz osobu) | — | ✓ | ✓ |
| DATE (presuda, zakona, roka) | — | — | ✓ |
| MONEY (uz osobni račun) | — | ✓ | ✓ |
| MONEY (javni iznosi) | — | — | ✓ |
| URL, IP | — | ✓ | ✓ |
| LOC (sve) | — | — | ✓ |
| CREDENTIAL (v1.1) | — | — | ✓ |
| Score threshold | 0.5 | 0.4 | 0.3 |
| Fail-closed na sidecar timeout | — | — | ✓ |
| Drugi prolaz tsRegex | — | — | ✓ |

Strict-Legal legal whitelist: `Vrhovni sud`, `Ustavni sud`, `Općinski sud`, `čl. \d+`, `Zakon o`, `Narodne novine`, `NN \d+`, `pravomoćna presuda`, `rješenjem`, `Ministarstvo`, `Republika Hrvatska`, `županija` i srodni — spanovi koji padaju unutar ovih konteksta se odbacuju u post-processoru čak i ako Presidio NER vratio visok skor.

---

## 8. Audit log

- Backend NIKAD ne loga originale.
- Actions: `preview`, `apply_overrides`, `approve_disclosure`, `discard`, `auto_anonymize`, `render`, `placeholder_lookup`, `disclose_for_review`, `expire`.
- IP/UA hashevi: `SHA-256(value + AUDIT_SALT)` — korelacija bez de-anonimizacije.
- UI: `account/privacy/page.tsx` tablica, filterovi: datum, dokument, mode, action.

---

## 9. Deploy

Prerekviziti prije prvog deploya:

```bash
# 1. Kreiraj KMS key ring i key (jednom)
gcloud kms keyrings create pii-ring \
    --location europe-west1 --project "$PROJECT_ID"
gcloud kms keys create pii-dek-wrapping-key \
    --keyring pii-ring --location europe-west1 \
    --purpose encryption --rotation-period 7776000s \  # 90 dana
    --next-rotation-time $(date -d '+90 days' -Iseconds) \
    --project "$PROJECT_ID"

# 2. Dodijeli pii-shield SA pravo koristiti ključ
gcloud kms keys add-iam-policy-binding pii-dek-wrapping-key \
    --keyring pii-ring --location europe-west1 \
    --member "serviceAccount:mike-pii-shield@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/cloudkms.cryptoKeyEncrypterDecrypter

# 3. Cloud Monitoring alert na KMS unusual access
gcloud alpha monitoring policies create \
    --policy-from-file=infra/monitoring/pii-kms-alert.yaml
# pii-kms-alert.yaml: alert kada Decrypt rate > 10x normalni hourly prosjek
# ili kada KMS operation failures > 0 u 5-minutnom prozoru
```

```bash
# Novi target u scripts/deploy.sh
deploy_pii_shield() {
  local KMS_KEY="projects/${PROJECT_ID}/locations/europe-west1/keyRings/pii-ring/cryptoKeys/pii-dek-wrapping-key"

  gcloud run deploy mike-pii-shield \
    --source mike-pii-shield \
    --region "$REGION" --project "$PROJECT_ID" \
    --service-account "mike-pii-shield@${PROJECT_ID}.iam.gserviceaccount.com" \
    --ingress=internal --no-allow-unauthenticated \
    --min-instances=1 --memory=2Gi --cpu=2 \
    --set-env-vars "PII_ENGINE=presidio,PII_KMS_KEY_NAME=${KMS_KEY}" \
    --set-secrets "DATABASE_URL=pii-shield-db-url:latest"

  gcloud run services add-iam-policy-binding mike-pii-shield \
    --member "serviceAccount:mike-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/run.invoker --region "$REGION"

  # Verifikacija: healthz + readyz
  local URL=$(gcloud run services describe mike-pii-shield --region "$REGION" --format='value(status.url)')
  curl -sf -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${URL}/readyz" \
    || { echo "mike-pii-shield readyz failed"; exit 1; }
}
```

Backend env vars:
- `PII_SHIELD_URL` — internal Cloud Run URL
- `PII_DEFAULT_MODE=off`
- `PII_SESSION_TTL_DAYS=7`
- `PII_FAIL_OPEN_STANDARD=true`

Backend **nema** `PII_KMS_KEY_NAME` niti `PII_ENCRYPTION_KEY_SECRET` — kriptografski materijal ide isključivo sidecaru.

Migracija: ručno `psql ... -f backend/migrations/110_pii_anonymization.sql` prije deploya backenda (isti workflow kao za 109).

---

## 10. Izvan v1

- Chat tekst korisnika — ne dira se.
- OPF engine — samo stub.
- TipTap editor u modalu — v1.1.
- Mark-as-PII iz selekcije — v1.1.
- Cloud KMS envelope encryption — v1.1 (schema pripremljena).
- Cross-document placeholder canonicalizacija — v2.
- Naslov-generacija, MCP args/results u Standard modu, web search — v1 bez izmjena.

---

## 11. Pozicioniranje (konačno, bez "guarantee")

> Max processes legal documents through a pre-LLM anonymization layer. When a user attaches a document, sensitive entities are detected and replaced with consistent placeholders. Only the anonymized version is sent to the model. The user's chat messages flow unchanged. Original values are encrypted in a dedicated sidecar service — the main application backend cannot decrypt them and they are never sent to the LLM. Croatian legal identifiers (OIB validated with ISO 7064 mod-11,10, IBAN with mod-97, MBS, sudski broj, k.č./z.k.ul./k.o.) are recognized natively, significantly reducing the risk that Croatian legal context is missed by generic NER models. Three anonymization profiles are available: Standard, Strict-Legal (default for legal workflows — preserves case-relevant facts such as court names, judgment dates, and statutory references while masking personal identifiers), and Strict. This is a privacy aid, not a guarantee — please review the audit log and apply the appropriate profile for your matter.
