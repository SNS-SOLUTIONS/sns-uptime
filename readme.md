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
wget https://raw.githubusercontent.com/luucfr/sns-uptime/main/compose.yaml
```

## Démarrage de l'application
```bash
cd /home/sns-uptime
docker compose up -d
```
L'application est désormais accessible à l'adresse ``http://monip:3001``

Il vous sera demandé de choisir comment configurer la base de données. Il est recommandé d'utiliser SQLite, mais si vous souhaitez l'ajouter sur MySQL, c'est possible.

## Mise a jour de l'application
Pour mettre à jour l'application, exécutez les commandes suivantes.
```bash
cd /home/sns-uptime/
sudo docker compose pull
sudo docker compose up -d
sudo docker image prune -f
```