# Changelog

## 1.0.2

- Un agent relancé par un message reprend son poste : plus de faux « nouveau départ » ni de fausse délégation de Claude (bug trouvé lors d'un essai réel).
- Un message vers `main` est affiché comme un message vers Claude.
- La page explique quand le serveur a disparu (rechargement du mod, fin de session) au lieu d'afficher « Reconnexion… » sans fin.

## 1.0.1

- La délégation (Claude vers le rôle) apparaît dans le fil des communications.
- Le mécanisme de retour d'un sous-agent n'est plus affiché comme un outil de travail.
- Documentation : limites sur les échanges visibles et description de l'essai en conditions réelles.

## 1.0.0

- Page web locale en direct avec personnages animés, enveloppes entre les postes et fil des communications.
- Sept rôles définis (PO, Business Analyst, IT Owner, Tech Lead, Développeur, Reviewer, QA) et agents `agent-troupe:<rôle>` prêts à l'emploi.
- Modèles d'équipe : `equipe-complete`, `livraison`, `qualite`, `cadrage`, `custom`.
- Mode démonstration, bascule français / anglais, thème clair et sombre, animations réduites respectées.
- Serveur local sans dépendance : loopback, jeton, contrôle de Host et d'Origin, CSP stricte.
