# Sécurité et confidentialité

## Ce que fait le mod

- Il lance un petit serveur Node (`plugins/agent-troupe/server/server.mjs`, sans dépendance) pour la durée de la session.
- Ce serveur **n'écoute que sur `127.0.0.1`**, sur un port libre choisi au démarrage. Il n'émet **aucune requête sortante** et n'envoie **aucune télémétrie**.
- Il exige un **jeton aléatoire** (donné dans l'adresse affichée par `/troupe`) pour servir la page, le flux d'événements et recevoir des événements. Il refuse un `Host` ou un `Origin` étranger, ce qui bloque le rebinding DNS et les pages web tierces.
- La page est servie avec une politique de sécurité de contenu stricte : aucun script, style ni image externe, aucune interface de formulaire.

## Ce que le mod envoie à la page

Le rôle, l'état, le **nom** de l'outil en cours, une description courte de la tâche d'un agent et le texte tronqué (140 caractères par défaut) des messages entre agents.

Il n'envoie **jamais** : le contenu des fichiers, les arguments des outils (commandes, chemins, requêtes), le prompt complet d'un sous-agent. L'option `messageText: none` retire aussi le texte des messages.

Ces garanties sont couvertes par des tests (`troupe.test.ts`) qui échouent si le code envoie un prompt ou des arguments.

## Journal de debug

Si la variable d'environnement `TROUPE_DUMP` désigne un fichier, le serveur y ajoute les événements reçus (lignes JSON). C'est désactivé par défaut. Ce fichier contient le texte tronqué des messages : ne le partagez pas sans l'avoir relu.

## Signaler une vulnérabilité

Utilisez le signalement privé de GitHub : onglet **Security**, puis **Report a vulnerability**. N'ouvrez pas de ticket public pour une faille.
