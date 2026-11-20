<h1 align="center">
  <br>
  <a href="#"><img src="https://raw.githubusercontent.com/luucfr/sns-uptime/main/public/icon.png" alt="SNS Uptime" width="200"></a>
  <br>
  SNS Uptime
  <br>
</h1>

## Prérequis

Avant de commencer, assurez-vous d'avoir les éléments suivants sur votre machine :

- **Ubuntu Server 24.04**
- **Matériel minimum requis** :
  - 2 cœurs CPU
  - 4 Go de RAM
  - 50 Go de stockage
- **Connexion SSH fonctionnelle**
- **Accès root**

## Installation des prérequis

### Installation de Docker
Ajout du dépôt d'installation de Docker :
```bash
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```
Installation des paquets :
```bash
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## Ajout de l'applicaiton sur docker

Création du dossier `sns-uptime` dans `/home` :
```bash
mkdir /home/sns-uptime
```

Téléchargement du fichier docker-compose :
```bash
cd /home/sns-uptime
wget https://raw.githubusercontent.com/sns-solutions/sns-uptime/main/compose.yaml
```

## Démarrage de l'application
```bash
cd /home/sns-uptime
docker compose up -d
```
L'application est désormais accessible à l'adresse ``http://monip:3001``

Il vous sera demandé de choisir comment configurer la base de données. Il est recommandé d'utiliser SQLite, mais si vous souhaitez l'ajouter sur MySQL, c'est possible.

## Acquittement des incidents

Quand une sonde tombe, n'importe qui dans l'équipe peut **acquitter** l'incident depuis sa
page de détail : ça revient à dire « je m'en occupe ».

Concrètement :

- les **rappels s'arrêtent** — plus de renotification toutes les X minutes tant que la panne
  dure, puisque quelqu'un est déjà dessus ;
- la sonde passe en **violet** au lieu de rouge, dans la liste comme sur sa page ;
- une colonne **Acquitté** apparaît dans les statistiques rapides du tableau de bord. Une
  sonde acquittée sort du compteur « Down », qui ne montre donc plus que ce qui attend
  réellement quelqu'un ;
- toute l'équipe voit **qui** a pris l'incident et **quand**, en direct.

L'identité vient du fournisseur d'identité : c'est le nom et l'adresse transmis par Authentik
qui sont enregistrés. Ça fonctionne même en mode `shared`, où tout le monde partage le même
compte local — l'acquittement appartient à la personne, pas au compte.

### Prévenir la personne au rétablissement

Dès que la sonde repasse au vert, l'acquittement se referme tout seul et **la personne qui
l'avait pris reçoit un mail**, à son adresse à elle. Pas besoin de créer une notification par
collaborateur : dans **Réglages → Notifications → Acquittement**, choisissez une notification
SMTP existante. Seul le destinataire est remplacé au moment de l'envoi, le serveur et
l'expéditeur restent les vôtres.

Si aucune notification n'est choisie, tout le reste fonctionne, simplement personne n'est
prévenu individuellement.

### Bon à savoir

- Seule une sonde réellement en panne (DOWN ou PENDING) peut être acquittée.
- Un acquittement ne couvre que la panne en cours. Si la sonde retombe plus tard, il faut
  l'acquitter à nouveau — sinon une nouvelle panne passerait inaperçue.
- « Rendre la main » lève l'acquittement sans attendre le rétablissement, et les rappels
  reprennent.
- Mettre une sonde en pause lève aussi son acquittement.
- La notification de retour à la normale destinée à toute l'équipe continue de partir
  normalement : le mail à la personne qui a acquitté s'ajoute, il ne remplace rien.

## Groupes « Dossier uniquement »

Par défaut dans Uptime Kuma, un groupe est une sonde à part entière : il produit ses propres
battements, alerte quand un de ses enfants tombe, et compte dans les statistiques. Résultat,
une seule panne déclenche deux notifications — celle de la sonde, puis celle de son groupe.

L'option **Dossier uniquement**, disponible à l'édition d'un groupe, le ramène à ce qu'on
attend d'un dossier :

- il **n'envoie jamais de notification**, quelles que soient celles qui lui sont associées ;
- il **ne fait plus apparaître de bulle d'alerte** dans l'interface : seule la sonde réellement
  tombée en déclenche une ;
- il **n'apparaît pas** dans les compteurs Up / Down / Pause du tableau de bord, ni dans sa
  liste des évènements importants ;
- il **n'affiche ni pourcentage de disponibilité, ni barre de battements**.

Sa propre page conserve en revanche son historique : si vous ouvrez le dossier, vous voyez
bien ses changements d'état. Ce qui est masqué, c'est sa présence sur le tableau de bord.

Il continue par ailleurs d'afficher l'état combiné de son contenu : l'icône de dossier prend
la couleur du pire état parmi ses enfants, ce qui permet de repérer un problème d'un coup
d'œil sans déplier l'arborescence. Les groupes imbriqués continuent donc de fonctionner.

### Migration

Les groupes qui existaient déjà sont **basculés automatiquement** en « Dossier uniquement »
à la première mise à jour, sans action de votre part. Les nouveaux groupes le sont aussi par
défaut. Si vous voulez qu'un groupe précis se comporte à nouveau comme une sonde (alertes et
statistiques comprises), décochez la case dans son écran d'édition.

## Authentification via Authentik (forward auth)

SNS Uptime sait déléguer l'authentification à un fournisseur d'identité placé devant lui
(Authentik, Authelia, oauth2-proxy…). Le reverse proxy authentifie la personne, puis
transmet son identité à l'application via des en-têtes HTTP. Le nom et l'adresse e-mail
de l'utilisateur connecté sont affichés dans le menu de profil de l'application.

### Principe

```
Navigateur ──▶ Reverse proxy ──▶ Authentik (outpost)   « qui es-tu ? »
                    │
                    └──▶ SNS Uptime   + X-authentik-username / -email / -name / -groups
```

Aucun second écran de connexion n'est présenté : dès que les en-têtes sont présents et
proviennent d'un proxy de confiance, la session est ouverte automatiquement.

### ⚠️ Prérequis de sécurité

Ces deux points sont **obligatoires**, sans eux n'importe qui peut se faire passer pour
n'importe quel utilisateur :

1. **SNS Uptime ne doit pas être joignable directement.** Le port 3001 ne doit être exposé
   qu'au reverse proxy (retirez la publication de port dans `compose.yaml` et placez les deux
   conteneurs sur le même réseau Docker).
2. **Le reverse proxy doit écraser les en-têtes `X-authentik-*` envoyés par le client.**
   C'est le comportement par défaut de `authResponseHeaders` (Traefik) et de
   `auth_request_set` (nginx), mais vérifiez-le.

Par sécurité, l'application n'accepte ces en-têtes que si la connexion provient d'une plage
d'adresses de confiance (par défaut les réseaux privés, voir `UPTIME_KUMA_FORWARD_AUTH_TRUSTED_PROXIES`).

### Configuration

Toutes les options se règlent par variables d'environnement :

| Variable | Défaut | Description |
| --- | --- | --- |
| `UPTIME_KUMA_FORWARD_AUTH_ENABLED` | `false` | Active le forward auth. |
| `UPTIME_KUMA_FORWARD_AUTH_MODE` | `shared` | `shared` : tout le monde partage le compte principal et voit donc les mêmes moniteurs. `per-user` : un compte local par utilisateur, chacun avec ses propres moniteurs. |
| `UPTIME_KUMA_FORWARD_AUTH_TRUSTED_PROXIES` | réseaux privés | Liste d'IP/CIDR autorisés à envoyer les en-têtes, séparés par des virgules. `*` pour tout accepter (à réserver aux cas où l'application est réellement inaccessible sans le proxy). |
| `UPTIME_KUMA_FORWARD_AUTH_ALLOWED_GROUPS` | *(vide)* | Restreint l'accès aux membres de ces groupes. Vide = tout utilisateur authentifié par Authentik. |
| `UPTIME_KUMA_FORWARD_AUTH_AUTO_CREATE` | `true` | En mode `per-user`, crée le compte local à la première connexion. |
| `UPTIME_KUMA_FORWARD_AUTH_LOGOUT_URL` | `/outpost.goauthentik.io/sign_out` | Cible du bouton « Déconnexion ». Laisser vide pour une déconnexion locale uniquement. |
| `UPTIME_KUMA_FORWARD_AUTH_USER_HEADER` | `X-authentik-username` | En-tête portant l'identifiant. |
| `UPTIME_KUMA_FORWARD_AUTH_EMAIL_HEADER` | `X-authentik-email` | En-tête portant l'e-mail. |
| `UPTIME_KUMA_FORWARD_AUTH_NAME_HEADER` | `X-authentik-name` | En-tête portant le nom affiché. |
| `UPTIME_KUMA_FORWARD_AUTH_GROUPS_HEADER` | `X-authentik-groups` | En-tête portant les groupes. |

Le nom et l'e-mail sont resynchronisés depuis Authentik à chaque connexion : c'est le
fournisseur d'identité qui fait autorité.

### Côté Authentik

1. Créer un **Provider** de type *Proxy Provider*, mode **Forward auth (single application)**,
   avec comme *External host* l'URL publique de SNS Uptime.
2. Créer l'**Application** correspondante et la lier à ce provider.
3. Ajouter l'application à un **Outpost** (l'outpost intégré convient).

### Exemple avec Traefik

`compose.yaml` :

```yaml
services:
  uptime-kuma:
    image: ghcr.io/sns-solutions/sns-uptime:main
    platform: linux/x86_64
    volumes:
      - ./data:/app/data
    # Pas de section "ports": l'accès se fait uniquement via le proxy
    environment:
      UPTIME_KUMA_FORWARD_AUTH_ENABLED: "true"
      UPTIME_KUMA_FORWARD_AUTH_ALLOWED_GROUPS: "uptime-admins"
    restart: unless-stopped
    networks:
      - proxy
    labels:
      traefik.enable: "true"
      traefik.http.routers.uptime.rule: "Host(`uptime.example.com`)"
      traefik.http.routers.uptime.middlewares: "authentik@docker"
      traefik.http.services.uptime.loadbalancer.server.port: "3001"

networks:
  proxy:
    external: true
```

Le middleware `authentik` (à déclarer une seule fois sur votre outpost) :

```yaml
labels:
  traefik.http.middlewares.authentik.forwardauth.address: "http://authentik-outpost:9000/outpost.goauthentik.io/auth/traefik"
  traefik.http.middlewares.authentik.forwardauth.trustForwardHeader: "true"
  traefik.http.middlewares.authentik.forwardauth.authResponseHeaders: "X-authentik-username,X-authentik-groups,X-authentik-email,X-authentik-name,X-authentik-uid"
```

### Exemple avec nginx

```nginx
location / {
    auth_request /outpost.goauthentik.io/auth/nginx;
    error_page 401 = @goauthentik_proxy_signin;

    auth_request_set $authentik_username $upstream_http_x_authentik_username;
    auth_request_set $authentik_email    $upstream_http_x_authentik_email;
    auth_request_set $authentik_name     $upstream_http_x_authentik_name;
    auth_request_set $authentik_groups   $upstream_http_x_authentik_groups;

    proxy_set_header X-authentik-username $authentik_username;
    proxy_set_header X-authentik-email    $authentik_email;
    proxy_set_header X-authentik-name     $authentik_name;
    proxy_set_header X-authentik-groups   $authentik_groups;

    # Nécessaire pour le temps réel (WebSocket)
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_pass http://uptime-kuma:3001;
}
```

### Bon à savoir

- Le formulaire de connexion classique reste disponible si la requête n'a pas transité par
  Authentik, ce qui permet de garder un accès de secours en local.
- Quand le forward auth est actif, le changement de mot de passe et la double authentification
  sont masqués dans les réglages : ils se gèrent dans Authentik.
- Le bouton « Déconnexion » redirige vers la déconnexion d'Authentik, sinon la session serait
  immédiatement rouverte.
- Prometheus ne peut plus lire `/metrics` s'il passe par le proxy : excluez cette route du
  forward auth, ou continuez à utiliser une clé d'API.

## Mise a jour de l'application
Pour mettre à jour l'application, exécutez les commandes suivantes.
```bash
cd /home/sns-uptime/
sudo docker compose pull
sudo docker compose up -d
sudo docker image prune -f
```
