# web.fetch 1.0.0

Outil de [DucAiOs](https://github.com/testeuribrahim-cloud) (décisions 0026 et 0036) : il lit
**une page https publique** et rend son texte **comme l'outil `web_fetch` d'OpenClaw en mode
`text`**. Il remplacera `openclaw.web_fetch` une fois leurs résultats comparés en mode ombre.

Il tourne dans un conteneur isolé : une demande JSON sur l'entrée standard, un résultat JSON
sur la sortie standard. Le texte rendu vient d'Internet : il n'est **jamais fiable**
(`"untrusted": true`) et ne doit jamais être suivi comme une consigne.

## Contrat

### Entrée (entrée standard)

```json
{ "url": "https://exemple.fr/page", "maxChars": 20000 }
```

| Champ | Type | Règle |
|---|---|---|
| `url` | texte | obligatoire ; https seulement (voir « Sécurité réseau ») |
| `maxChars` | entier | facultatif, de 100 à 20 000 ; 20 000 par défaut |

Tout autre champ, tout autre type, un JSON illisible ou une demande de plus de 64 Ko sont refusés.

### Sortie (sortie standard, code 0)

Un seul objet JSON :

```json
{
  "url": "https://exemple.fr/page",
  "finalUrl": "https://exemple.fr/article",
  "status": 200,
  "contentType": "text/html",
  "title": "Titre de la page",
  "text": "Texte de la page…",
  "truncated": false,
  "bytes": 48213,
  "redirects": 1,
  "untrusted": true
}
```

| Champ | Sens |
|---|---|
| `url` | l'adresse demandée, telle quelle |
| `finalUrl` | l'adresse de la page lue, après les redirections |
| `status` | code HTTP de la page lue (toujours 2xx) |
| `contentType` | type de contenu, sans paramètres, en minuscules |
| `title` | titre de la page, s'il y en a un (HTML seulement) |
| `text` | le texte extrait, au plus `maxChars` caractères |
| `truncated` | `true` si le texte a été coupé à `maxChars` |
| `bytes` | octets du corps lus, **après** décompression |
| `redirects` | nombre de redirections suivies |
| `untrusted` | toujours `true` |

### Erreurs (code 1)

Sur la sortie standard, un seul objet JSON :

```json
{ "error": { "code": "non_public_address", "message": "adresse 10.0.0.1 non publique" }, "untrusted": true }
```

et un message court sur la sortie d'erreur (`web.fetch : …`). Un refus de sécurité contient
toujours « non publique » ou « interdit » dans son message.

| Code | Cause |
|---|---|
| `invalid_input` | entrée hors contrat, ou adresse illisible |
| `forbidden_url` | schéma autre que https, identifiants dans l'adresse, port autre que 443, redirection de https vers http (« interdit ») |
| `non_public_address` | adresse, ou une des adresses du nom, dans une plage refusée (« non publique ») |
| `too_many_redirects` | plus de 3 redirections (« interdit ») |
| `dns_error` | nom introuvable ou sans adresse |
| `http_status` | réponse autre que 2xx |
| `unsupported_content_type` | type de contenu non accepté, ou absent |
| `unsupported_encoding` | encodage de contenu autre que gzip, deflate ou br |
| `body_too_large` | plus de 2 000 000 octets après décompression |
| `timeout` | plus de 9 s pour tout l'appel |
| `network_error` | connexion impossible (certificat invalide compris), corps interrompu ou illisible |
| `extraction_failed` | aucun texte lisible dans la page |

## Limites

- **2 000 000 octets** de corps au plus, comptés en continu **après** décompression (gzip,
  deflate ou br) : une archive piégée s'arrête à la limite.
- **9 s** au plus pour tout l'appel : résolutions, redirections et lecture du corps comprises.
- Types de contenu acceptés : `text/html`, `application/xhtml+xml`, `text/plain`,
  `text/markdown`, `application/json`. Les autres sont refusés.

## Sécurité réseau

L'outil applique lui-même ces règles, en plus de la passerelle du conteneur qui refuse les
mêmes plages : deux protections indépendantes. **Aucune variable d'environnement, option ou
argument ne peut les assouplir.**

- **https seulement, port 443 seulement**, aucun identifiant dans l'adresse ; `http:`,
  `file:` et tout autre schéma refusés.
- **Plages refusées** :
  - IPv4 : `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`,
    `100.64.0.0/10`, `0.0.0.0/8`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4` ;
  - IPv6 : `::1/128`, `::/128`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96`, `64:ff9b::/96`,
    `100::/64`, `2001:db8::/32`, `ff00::/8`.

  Les écritures détournées (`0x7f.1`, `2130706433`, `017700000001`, `[::ffff:127.0.0.1]`…)
  sont refusées aussi : l'adresse est lue par `new URL()` puis vérifiée par `node:net`,
  jamais par une expression sur le texte.
- **Résolution vérifiée** : `dns.lookup` avec `all: true` ; si **une seule** des adresses est
  refusée, le nom entier l'est. La connexion part ensuite vers l'adresse vérifiée elle-même
  (le `lookup` de la connexion ne rend qu'elle), avec la vérification TLS normale du nom
  (`servername`). **Jamais de seconde résolution** entre la vérification et la connexion
  (protection contre le DNS rebinding).
- **3 redirections au plus**, suivies à la main ; chaque saut repasse toutes les vérifications ;
  la 4e redirection et toute redirection de https vers http sont refusées.

## Origine du code d'extraction

Le texte est extrait par le code d'OpenClaw v2026.9.6, copié **sans modification** dans
[`third_party/openclaw/`](../../third_party/openclaw/) (licence MIT, empreintes dans
`PROVENANCE.json`) :

- `text/html` et `application/xhtml+xml` : retrait du contenu caché, puis Readability
  (`extensions/web-readability/web-content-extractor.ts`) en mode `text` ; s'il ne rend rien,
  `extractBasicHtmlContent` (`src/agents/tools/web-fetch-utils.ts`) ; sinon, erreur ;
- `text/markdown` : `markdownToText` ;
- `application/json` : JSON indenté sur 2 espaces, ou le corps tel quel s'il est invalide ;
- `text/plain` : tel quel ;
- puis troncature à `maxChars` par `truncateWebFetchText`.

Les imports propres à OpenClaw (`openclaw/plugin-sdk/*`, `@openclaw/normalization-core/*`) vont
vers de petits fichiers de [`src/openclaw-shims/`](src/openclaw-shims/) : alias d'esbuild à la
construction, `paths` de `tsconfig.json` pour les tests. Les bibliothèques ont les versions
exactes d'OpenClaw : `@mozilla/readability` 0.6.0, `linkedom` 0.18.13, `htmlparser2` 10.1.0,
`entities` 8.1.0.

## Construire et tester

Depuis la racine du dépôt, après `npm ci` :

```bash
npm run build --workspace @ducaios-tools/web-fetch   # → tools/web-fetch/dist/web-fetch.mjs
npm test                                             # tests du dépôt, puis ceux de chaque outil
```

- `npm run build` (`build.mjs`) produit **un seul fichier**, `dist/web-fetch.mjs`, qui contient
  aussi les bibliothèques d'extraction. L'extracteur Readability d'OpenClaw les charge par
  `import(CONSTANTE)`, qu'esbuild ne suit pas : ces deux imports sont réécrits en imports
  littéraux **au moment de la construction seulement** (le fichier de `third_party/` reste
  intact), et la construction échoue si ces lignes changent.
- `npm test` dans `tools/web-fetch/` lance `test/*.test.ts` : adresses, redirections, DNS,
  limites, extraction et contrat, **sans réseau réel ni secret** (serveur https local avec un
  certificat généré pendant le test, faux résolveur et connexion injectés dans
  `fetchPage(input, { lookup, connect })`).

## Image

[`Dockerfile`](Dockerfile), construit depuis la racine du dépôt (contexte `.`) par
[`.github/workflows/image-web-fetch.yml`](../../.github/workflows/image-web-fetch.yml), depuis
`main` seulement ; DucAiOs ne l'utilise qu'épinglée par empreinte (`nom@sha256:…`), après
vérification.

- Trois étapes, toutes sur `node:22.23.3-alpine` épinglé par empreinte : construction
  (`npm ci`, `npm run build`, contrôle du fichier construit), dépendances de production
  (`npm ci --omit=dev`), image finale.
- Image finale : `/app/web-fetch.mjs`, `/app/node_modules` (dépendances de production et leurs
  licences), `/app/licenses/openclaw/` ; ni npm, ni npx, ni corepack, ni yarn.
- Utilisateur `65534:65534`, point d'entrée `node /app/web-fetch.mjs` ; aucune écriture sur
  disque, aucun shell requis.

Lancement type, tel que DucAiOs l'isole :

```bash
echo '{"url":"https://example.com/"}' | docker run --rm -i --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges ghcr.io/testeuribrahim-cloud/ducaios-tools-web-fetch@sha256:…
```
