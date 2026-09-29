# Code repris d'OpenClaw

Copie **exacte, sans aucune modification**, de fichiers du dépôt
[openclaw/openclaw](https://github.com/openclaw/openclaw), étiquette `v2026.9.6`
(commit `ce5bbdc244ee937246cc1700d1b224d020c3b599`), la version installée dans
l'instance OpenClaw de DucAiOs (`openclaw@2026.9.6`).

Licence : MIT, « Copyright (c) 2026 OpenClaw Foundation » — texte complet dans
[`LICENSE`](LICENSE), à garder avec ce code.

## Pourquoi

L'outil `web.fetch` doit convertir le HTML en texte **comme** l'outil `web_fetch`
d'OpenClaw en mode `text`, qu'il remplace (décisions 0026 et 0036 de DucAiOs) :
leurs résultats sont comparés en mode ombre avant toute activation. Le chemin
d'OpenClaw est :

1. `sanitizeHtml` (`src/agents/tools/web-fetch-visibility.ts`) : retire le contenu caché ;
2. Readability (`extensions/web-readability/web-content-extractor.ts`) avec
   `@mozilla/readability` 0.6.0 et `linkedom` 0.18.13, en mode texte ;
3. à défaut, `extractBasicHtmlContent` (`src/agents/tools/web-fetch-utils.ts`).

Les autres fichiers sont les dépendances internes de ceux-ci.

## Règles

- **Ne jamais modifier ces fichiers.** Les imports propres à OpenClaw
  (`openclaw/plugin-sdk/*`, `@openclaw/normalization-core/*`) se résolvent au moment
  de la construction de l'outil, par des alias hors de ce dossier.
- Les bibliothèques utilisées ont les mêmes versions, exactes, que dans OpenClaw :
  `@mozilla/readability` 0.6.0, `linkedom` 0.18.13, `htmlparser2` 10.1.0 (sous
  `linkedom`), `entities` 8.1.0 (voir `PROVENANCE.json`).
- `PROVENANCE.json` donne, pour chaque fichier, sa taille, son empreinte Git (identique
  à celle du dépôt d'origine) et son SHA-256 ; `npm test` les revérifie.
- Une mise à jour se fait par une nouvelle copie depuis une autre étiquette, dans une
  pull request à part, avec `PROVENANCE.json` régénéré.

## Vérification faite avant la copie

Sur 7 pages (dont 6 réelles, et une page d'essai avec du contenu caché), les
fonctions `sanitizeHtml`, l'extraction Readability et `extractBasicHtmlContent` de
cette copie, construites avec les bibliothèques ci-dessus, rendent un résultat
identique octet pour octet à celui du code compilé installé dans OpenClaw 2026.9.6.
