# ducaios-tools

Outils propres de [DucAiOs](https://github.com/testeuribrahim-cloud) : chacun tourne dans
un conteneur isolé, reçoit une demande JSON sur l'entrée standard et rend un résultat
JSON sur la sortie standard. L'image de chaque outil est construite depuis un commit
de `main` et utilisée **épinglée par empreinte** (`nom@sha256:…`).

## Règles

- Tout changement passe par une pull request relue et fusionnée par la créatrice.
- Chaque changement est accompagné de tests ; `npm test` doit passer.
- Dépendances en versions exactes, verrouillées par `package-lock.json`. L'agent Coding
  installe les dépendances (`npm install`) **avant** de travailler, puis travaille réseau
  coupé : toute nouvelle dépendance passe d'abord par une pull request à part.
- Aucun secret dans ce dépôt.
- `third_party/` contient du code d'autres projets, copié **sans modification**, avec
  sa licence et ses empreintes (`PROVENANCE.json`). Les adaptations se font ailleurs.

## Contenu

| Chemin | Rôle |
|---|---|
| `third_party/openclaw/` | Extraction du texte d'une page HTML, reprise d'OpenClaw v2026.9.6 (licence MIT) |
| `tools/web-fetch/` | Outil `web.fetch` 1.0.0 : lit une page https publique et rend son texte comme `web_fetch` d'OpenClaw en mode text ; code, tests, `Dockerfile` et [documentation](tools/web-fetch/README.md) (contrat, limites, sécurité réseau). Paquet `@ducaios-tools/web-fetch`, version lue par le workflow d'image ; dépendances exactes, celles d'OpenClaw |
| `.github/workflows/image-web-fetch.yml` | Construction de l'image `web.fetch` depuis `main`, publiée sur GHCR avec une attestation de provenance |

## Licences

Le code de `third_party/openclaw/` est sous licence MIT, © 2026 OpenClaw Foundation :
voir `third_party/openclaw/LICENSE`.
