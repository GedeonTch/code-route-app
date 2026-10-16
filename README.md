# PERMIS+ — Application d'apprentissage du code de la route

![Python](https://img.shields.io/badge/Python-3.10%2B-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688)
![Licence](https://img.shields.io/badge/Licence-GPL%20v3-blue)

Application web pédagogique de type auto-école : catalogue interactif de panneaux de signalisation, quiz à choix multiples notés, suivi de progression par niveaux et espace d'administration complet.

Le projet est composé d'une API REST **FastAPI** (backend) et d'une interface **HTML/CSS/JavaScript** (frontend, sans framework).

## Fonctionnalités

### Côté apprenant

- **Inscription / connexion** avec rôles (`apprenant`, `admin`)
- **Catalogue de panneaux** : recherche, filtrage par catégorie (danger, interdiction, obligation, information), fiche détaillée avec signification et description
- **Quiz QCM** : nombre de questions paramétrable (10 par défaut), filtre par catégorie ; les mauvaises réponses sont puisées en priorité dans la même catégorie que la bonne (cohérence pédagogique)
- **Bot d'indices ROADY** : deux indices progressifs par panneau (forme/catégorie, puis extrait de la description)
- **Notation sur 20** avec enregistrement du temps de réponse par question et de la durée totale de session
- **Historique détaillé** des sessions de quiz
- **Progression par niveaux** recalculée après chaque quiz (voir tableau ci-dessous)
- **Statistiques personnelles** : nombre de quiz, meilleure note, moyenne, progression vers le niveau suivant
- **Classement top 10** anonymisé (nom de famille réduit à l'initiale)
- **Mode révision flash** par catégorie
- **Certification « As du Volant »** avec numéro unique (`PERMIS-AAAA-XXXXXX`), émise et révocable par un administrateur
- **4 thèmes visuels** : Cockpit, Aurora, Ember, Daylight

### Côté administration

- Gestion des utilisateurs (création, modification, suppression, rôles et niveaux)
- Gestion des panneaux (création, modification, suppression) avec **upload d'images** (PNG, JPEG, WebP — 2 Mo maximum)
- Régénération automatique de la question d'identification associée à chaque panneau modifié
- Statistiques globales de la plateforme
- Gestion du cycle de vie des certifications (élégibilité, émission, révocation)

## Stack technique

| Composant | Technologies |
|---|---|
| Backend | Python 3.10+, FastAPI 0.111, Pydantic v2, Uvicorn |
| Base de données | SQLite (6 tables : utilisateurs, panneaux, questions, sessions_quiz, reponses_session, certifications) |
| Frontend | HTML5, CSS3, JavaScript (vanilla, aucune dépendance de build) |
| Contenu | 20 panneaux de signalisation et leurs questions, images incluses dans `panneaux/` |

```
├── backend/
│   ├── main.py          # API REST (~30 endpoints) : auth, catalogue, quiz, stats, admin
│   ├── database.py      # Connexion SQLite et création des 6 tables
│   ├── models.py        # Schémas Pydantic de validation
│   └── seed.py          # Peuplement initial : 20 panneaux, questions et comptes de démo
├── frontend/
│   ├── index.html       # Interface monopage (vues : dashboard, quiz, catalogue, historique, admin…)
│   ├── app.js           # Logique applicative côté client
│   └── style.css        # 4 thèmes visuels
├── panneaux/            # Images des panneaux (PNG)
└── requirements.txt
```

## Installation et lancement

**Prérequis :** Python 3.10 ou supérieur.

> ℹ️ Les versions des dépendances sont épinglées (`fastapi==0.111.0`, `pydantic==2.7.1`…). Sur un Python très récent (3.13+), `pip` peut ne pas trouver les paquets compilés correspondants ; dans ce cas, installer les mêmes paquets sans imposer la version (`pip install fastapi uvicorn pydantic python-multipart`).

```bash
# 1. Cloner le dépôt
git clone https://github.com/GedeonTch/code-route-app.git
cd code-route-app

# 2. Créer un environnement virtuel et installer les dépendances
python -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r requirements.txt

# 3. Initialiser la base de données (panneaux, questions, comptes de démo)
python -m backend.seed

# 4. Lancer l'API (le frontend l'attend sur le port 8080)
uvicorn backend.main:app --reload --port 8080
```

Puis ouvrir le frontend :

```bash
# Option A — servir le dossier frontend
cd frontend
python -m http.server 8081
# → http://localhost:8081

# Option B — ouvrir directement frontend/index.html dans un navigateur
```

La documentation interactive de l'API (Swagger UI) est disponible sur **http://localhost:8080/docs** une fois le serveur lancé.

## Comptes de démonstration

Créés par le script de seed :

| Rôle | Email | Mot de passe |
|---|---|---|
| Apprenant | `demo@permis.com` | `demo123` |
| Administrateur | `admin@permis.local` | `admin1234` |

> ⚠️ Ces identifiants sont destinés au développement local uniquement. Pour tout déploiement réel, les supprimer ou les remplacer.

## Système de niveaux

Le niveau est recalculé automatiquement après chaque quiz, à partir du nombre de sessions et de la moyenne générale :

| Niveau | Condition |
|---|---|
| Débutant | niveau initial |
| Apprenti Conducteur | ≥ 3 quiz et moyenne ≥ 8/20 |
| Conducteur Confirmé | ≥ 6 quiz et moyenne ≥ 12/20 |
| Expert de la Route | ≥ 10 quiz et moyenne ≥ 15/20 |
| As du Volant | ≥ 15 quiz et moyenne ≥ 18/20 — éligible à la certification |

## Sécurité & améliorations prévues

Le projet est livré en configuration de **développement**. Les points suivants sont identifiés comme pistes d'amélioration :

- **Hachage des mots de passe** : actuellement SHA-256 sans sel → migration vers bcrypt/argon2
- **CORS** : toutes origines autorisées (`*`, configuration de développement) → restreindre aux origines du frontend
- **Contrôle d'accès admin** : vérifié via le paramètre `admin_id` de la requête, sans session ni jeton → authentification par jeton (JWT)
- **Identifiants de démo** : présents dans `seed.py` → externaliser en variables d'environnement
- **Tests automatisés** : à ajouter (le dépôt n'en contient pas actuellement)

## Licence

Ce projet est distribué sous licence **GNU GPL v3** — voir le fichier [LICENSE](LICENSE).

## Auteur

**Gédéon Cibanvunya** — [GitHub](https://github.com/GedeonTch) · tchibanvunyagedeon@gmail.com
