Installer : `bash mac/installer.sh` (le relais de Mafe et Kuroro ; `bash mac/installer.sh kuroro` pour Kuroro seul). Le laissez-passer doit être dans le Trousseau : `security add-generic-password -s qg-bypass -a qg -w <passe>`.
Kuroro (`mac/kuroro.mjs`, toujours lancé) : prend les demandes de la page du QG et les fait répondre par Ollama (`qwen3:8b`, à garder installé) ; c'est ce qui fait parler Kuroro dans Safari et sur le téléphone tant que le Mac est allumé.
Désinstaller : `bash mac/desinstaller.sh` (ou `bash mac/desinstaller.sh kuroro`).
Journaux : `~/Library/Logs/qg-relais.log`, `~/Library/Logs/qg-kuroro.log` (statuts seulement, jamais le passe ni le texte des messages).

Feu (le copilote de trading) lit le compte Binance **en lecture seule** à chaque passage du relais (`mac/feu.mjs`). La clé
API (créée sur Binance avec « Lecture » seulement) et son secret vont dans le Trousseau, jamais ailleurs :
`security add-generic-password -s qg-binance-lecture -a qg -w` puis `security add-generic-password -s qg-binance-secret -a qg -w`
(sans valeur après `-w` : le Trousseau la demande, elle ne reste pas dans l'historique du terminal). Sans clé, rien n'est
lu et le bureau de Feu dit « clé pas encore créée ». Une clé qui peut trader, retirer ou transférer est refusée.
