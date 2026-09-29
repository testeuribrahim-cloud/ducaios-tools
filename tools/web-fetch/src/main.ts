// Point d'entrée de web.fetch : les vrais dns.lookup et https.request, aucune option ni variable d'environnement.
import { run } from "./cli.js";
import { realDeps } from "./fetch-page.js";

process.exitCode = await run(process.stdin, process.stdout, process.stderr, realDeps);
