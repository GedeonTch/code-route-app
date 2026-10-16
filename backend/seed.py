"""
Peuplement initial de la base de données PERMIS+.
Insère les 20 panneaux, leurs questions QCM et un utilisateur de démonstration.
Vérifie l'existence des données avant d'insérer pour éviter les doublons.
"""

import hashlib
import os

try:
    from .database import get_db_connection, init_db
except ImportError:
    from database import get_db_connection, init_db

# ---------------------------------------------------------------------------
# Données des 20 panneaux avec leurs questions QCM
# Chaque question a 4 choix ; la bonne réponse varie entre A, B, C et D.
# Les mauvaises réponses proviennent de la même catégorie (pédagogique).
# ---------------------------------------------------------------------------

PANNEAUX_ET_QUESTIONS = [
    # ── DANGER (6 panneaux) ─────────────────────────────────────────────────
    {
        "panneau": {
            "nom": "Virage à droite",
            "categorie": "DANGER",
            "image_path": "/panneaux/virage_droite.png",
            "signification": "Virage dangereux à droite",
            "description_longue": (
                "Un virage serré à droite approche. Réduisez la vitesse "
                "avant d'aborder le virage, pas pendant."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Virage dangereux à droite",
            "choix_b": "Double virage dont le premier est à gauche",
            "choix_c": "Chaussée particulièrement glissante",
            "choix_d": "Passage de piétons",
            "bonne_reponse": "A",
        },
    },
    {
        "panneau": {
            "nom": "Double virage",
            "categorie": "DANGER",
            "image_path": "/panneaux/double_virage.png",
            "signification": "Double virage dont le premier est à gauche",
            "description_longue": (
                "Succession de deux virages dangereux. Restez sur votre voie "
                "et adaptez votre vitesse dès l'entrée."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Virage dangereux à droite",
            "choix_b": "Double virage dont le premier est à gauche",
            "choix_c": "Passage d'animaux sauvages",
            "choix_d": "Travaux sur la chaussée",
            "bonne_reponse": "B",
        },
    },
    {
        "panneau": {
            "nom": "Chaussée glissante",
            "categorie": "DANGER",
            "image_path": "/panneaux/chaussee_glissante.png",
            "signification": "Chaussée particulièrement glissante",
            "description_longue": (
                "Risque de dérapage. Évitez les accélérations et freinages "
                "brusques. Gardez vos distances."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Virage dangereux à droite",
            "choix_b": "Passage de piétons",
            "choix_c": "Chaussée particulièrement glissante",
            "choix_d": "Travaux sur la chaussée",
            "bonne_reponse": "C",
        },
    },
    {
        "panneau": {
            "nom": "Passage piétons",
            "categorie": "DANGER",
            "image_path": "/panneaux/passage_pietons.png",
            "signification": "Passage de piétons",
            "description_longue": (
                "Des piétons traversent régulièrement ici. Ralentissez "
                "et soyez prêt à vous arrêter."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Virage dangereux à droite",
            "choix_b": "Double virage dont le premier est à gauche",
            "choix_c": "Chaussée particulièrement glissante",
            "choix_d": "Passage de piétons",
            "bonne_reponse": "D",
        },
    },
    {
        "panneau": {
            "nom": "Animaux sauvages",
            "categorie": "DANGER",
            "image_path": "/panneaux/animaux.png",
            "signification": "Passage d'animaux sauvages",
            "description_longue": (
                "Des animaux peuvent surgir sur la route, surtout à l'aube "
                "et au crépuscule. Restez vigilant."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Passage d'animaux sauvages",
            "choix_b": "Virage dangereux à droite",
            "choix_c": "Chaussée particulièrement glissante",
            "choix_d": "Travaux sur la chaussée",
            "bonne_reponse": "A",
        },
    },
    {
        "panneau": {
            "nom": "Travaux",
            "categorie": "DANGER",
            "image_path": "/panneaux/travaux.png",
            "signification": "Travaux sur la chaussée",
            "description_longue": (
                "Zone de chantier. Respectez les déviations et les limitations "
                "temporaires. Des ouvriers peuvent être présents."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Passage de piétons",
            "choix_b": "Travaux sur la chaussée",
            "choix_c": "Double virage dont le premier est à gauche",
            "choix_d": "Passage d'animaux sauvages",
            "bonne_reponse": "B",
        },
    },
    # ── INTERDICTION (6 panneaux) ────────────────────────────────────────────
    {
        "panneau": {
            "nom": "Sens interdit",
            "categorie": "INTERDICTION",
            "image_path": "/panneaux/sens_interdit.png",
            "signification": "Accès interdit à tout véhicule",
            "description_longue": (
                "Vous ne pouvez pas vous engager dans cette direction. "
                "Cette interdiction s'applique à tous les véhicules sans exception."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Vitesse maximale autorisée : 50 km/h",
            "choix_b": "Stationnement interdit",
            "choix_c": "Accès interdit à tout véhicule",
            "choix_d": "Demi-tour interdit",
            "bonne_reponse": "C",
        },
    },
    {
        "panneau": {
            "nom": "Vitesse limitée à 50",
            "categorie": "INTERDICTION",
            "image_path": "/panneaux/vitesse_50.png",
            "signification": "Vitesse maximale autorisée : 50 km/h",
            "description_longue": (
                "Ne pas dépasser 50 km/h. C'est la vitesse maximale "
                "en agglomération en France."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Accès interdit à tout véhicule",
            "choix_b": "Stationnement interdit",
            "choix_c": "Dépassement interdit pour les véhicules à moteur",
            "choix_d": "Vitesse maximale autorisée : 50 km/h",
            "bonne_reponse": "D",
        },
    },
    {
        "panneau": {
            "nom": "Vitesse limitée à 30",
            "categorie": "INTERDICTION",
            "image_path": "/panneaux/vitesse_30.png",
            "signification": "Vitesse maximale autorisée : 30 km/h",
            "description_longue": (
                "Zone 30. Les piétons et cyclistes sont prioritaires. "
                "Ces zones se trouvent souvent près des écoles."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Vitesse maximale autorisée : 30 km/h",
            "choix_b": "Vitesse maximale autorisée : 50 km/h",
            "choix_c": "Stationnement interdit",
            "choix_d": "Demi-tour interdit",
            "bonne_reponse": "A",
        },
    },
    {
        "panneau": {
            "nom": "Stationnement interdit",
            "categorie": "INTERDICTION",
            "image_path": "/panneaux/stationnement_interdit.png",
            "signification": "Stationnement interdit",
            "description_longue": (
                "Il est interdit de laisser son véhicule à l'arrêt ici, "
                "même brièvement."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Accès interdit à tout véhicule",
            "choix_b": "Stationnement interdit",
            "choix_c": "Demi-tour interdit",
            "choix_d": "Dépassement interdit pour les véhicules à moteur",
            "bonne_reponse": "B",
        },
    },
    {
        "panneau": {
            "nom": "Demi-tour interdit",
            "categorie": "INTERDICTION",
            "image_path": "/panneaux/demi_tour_interdit.png",
            "signification": "Demi-tour interdit",
            "description_longue": (
                "Vous ne pouvez pas faire demi-tour sur cette section. "
                "Cherchez un autre point de retournement."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Accès interdit à tout véhicule",
            "choix_b": "Vitesse maximale autorisée : 50 km/h",
            "choix_c": "Demi-tour interdit",
            "choix_d": "Stationnement interdit",
            "bonne_reponse": "C",
        },
    },
    {
        "panneau": {
            "nom": "Dépassement interdit",
            "categorie": "INTERDICTION",
            "image_path": "/panneaux/depassement_interdit.png",
            "signification": "Dépassement interdit pour les véhicules à moteur",
            "description_longue": (
                "Interdit de doubler un autre véhicule motorisé. L'interdiction "
                "s'arrête au prochain panneau ou au panneau de fin d'interdiction."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Accès interdit à tout véhicule",
            "choix_b": "Stationnement interdit",
            "choix_c": "Demi-tour interdit",
            "choix_d": "Dépassement interdit pour les véhicules à moteur",
            "bonne_reponse": "D",
        },
    },
    # ── OBLIGATION (4 panneaux) ──────────────────────────────────────────────
    {
        "panneau": {
            "nom": "Obligation tourner à droite",
            "categorie": "OBLIGATION",
            "image_path": "/panneaux/tourner_droite.png",
            "signification": "Obligation de tourner à droite",
            "description_longue": (
                "Vous devez impérativement tourner à droite. "
                "Tout droit ou à gauche est interdit."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Obligation de tourner à droite",
            "choix_b": "Obligation de tourner à gauche",
            "choix_c": "Voie réservée aux piétons",
            "choix_d": "Vitesse minimale obligatoire : 50 km/h",
            "bonne_reponse": "A",
        },
    },
    {
        "panneau": {
            "nom": "Obligation tourner à gauche",
            "categorie": "OBLIGATION",
            "image_path": "/panneaux/tourner_gauche.png",
            "signification": "Obligation de tourner à gauche",
            "description_longue": (
                "Vous devez impérativement tourner à gauche. "
                "Tout droit ou à droite est interdit."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Obligation de tourner à droite",
            "choix_b": "Obligation de tourner à gauche",
            "choix_c": "Voie réservée aux piétons",
            "choix_d": "Vitesse minimale obligatoire : 50 km/h",
            "bonne_reponse": "B",
        },
    },
    {
        "panneau": {
            "nom": "Voie réservée aux piétons",
            "categorie": "OBLIGATION",
            "image_path": "/panneaux/voie_pietons.png",
            "signification": "Voie réservée aux piétons",
            "description_longue": (
                "Cette voie est exclusivement réservée aux piétons. "
                "Les véhicules, y compris les vélos, ne peuvent pas y circuler."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Obligation de tourner à droite",
            "choix_b": "Vitesse minimale obligatoire : 50 km/h",
            "choix_c": "Voie réservée aux piétons",
            "choix_d": "Obligation de tourner à gauche",
            "bonne_reponse": "C",
        },
    },
    {
        "panneau": {
            "nom": "Vitesse minimale",
            "categorie": "OBLIGATION",
            "image_path": "/panneaux/vitesse_minimale.png",
            "signification": "Vitesse minimale obligatoire : 50 km/h",
            "description_longue": (
                "Sur autoroute par temps sec, vous devez maintenir une vitesse "
                "d'au moins 50 km/h sur la voie de gauche."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Obligation de tourner à droite",
            "choix_b": "Voie réservée aux piétons",
            "choix_c": "Obligation de tourner à gauche",
            "choix_d": "Vitesse minimale obligatoire : 50 km/h",
            "bonne_reponse": "D",
        },
    },
    # ── INFORMATION (4 panneaux) ─────────────────────────────────────────────
    {
        "panneau": {
            "nom": "Parking",
            "categorie": "INFORMATION",
            "image_path": "/panneaux/parking.png",
            "signification": "Stationnement autorisé",
            "description_longue": (
                "Un espace de stationnement est disponible dans cette direction "
                "ou à cet endroit."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Stationnement autorisé",
            "choix_b": "Hôpital ou centre médical à proximité",
            "choix_c": "Station-service",
            "choix_d": "Début d'autoroute",
            "bonne_reponse": "A",
        },
    },
    {
        "panneau": {
            "nom": "Hôpital",
            "categorie": "INFORMATION",
            "image_path": "/panneaux/hopital.png",
            "signification": "Hôpital ou centre médical à proximité",
            "description_longue": (
                "Un établissement de santé se trouve à proximité. "
                "Silence conseillé — klaxon et vitesse excessive déconseillés."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Stationnement autorisé",
            "choix_b": "Hôpital ou centre médical à proximité",
            "choix_c": "Station-service",
            "choix_d": "Début d'autoroute",
            "bonne_reponse": "B",
        },
    },
    {
        "panneau": {
            "nom": "Station-service",
            "categorie": "INFORMATION",
            "image_path": "/panneaux/station_service.png",
            "signification": "Station-service",
            "description_longue": (
                "Une station d'essence se trouve dans cette direction. "
                "Préparez-vous à quitter la voie principale si nécessaire."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Stationnement autorisé",
            "choix_b": "Début d'autoroute",
            "choix_c": "Station-service",
            "choix_d": "Hôpital ou centre médical à proximité",
            "bonne_reponse": "C",
        },
    },
    {
        "panneau": {
            "nom": "Autoroute",
            "categorie": "INFORMATION",
            "image_path": "/panneaux/autoroute.png",
            "signification": "Début d'autoroute",
            "description_longue": (
                "Vous entrez sur une autoroute. Les règles spécifiques s'appliquent : "
                "vitesse max 130 km/h, arrêt interdit sauf urgence."
            ),
        },
        "question": {
            "type_question": "identification",
            "enonce": "Que signifie ce panneau ?",
            "choix_a": "Stationnement autorisé",
            "choix_b": "Hôpital ou centre médical à proximité",
            "choix_c": "Station-service",
            "choix_d": "Début d'autoroute",
            "bonne_reponse": "D",
        },
    },
]


def hash_password(password: str) -> str:
    """Retourne le hash SHA-256 du mot de passe."""
    return hashlib.sha256(password.encode()).hexdigest()


def seed_panneaux_et_questions(conn):
    """Insère les 20 panneaux et leurs questions si la table est vide."""
    nb_existants = conn.execute("SELECT COUNT(*) FROM panneaux").fetchone()[0]
    if nb_existants > 0:
        print(f"  → {nb_existants} panneau(x) déjà présent(s), insertion ignorée.")
        return

    for entree in PANNEAUX_ET_QUESTIONS:
        p = entree["panneau"]
        q = entree["question"]

        # Insertion du panneau
        cursor = conn.execute(
            """INSERT INTO panneaux (nom, categorie, image_path, signification, description_longue)
               VALUES (?, ?, ?, ?, ?)""",
            (
                p["nom"],
                p["categorie"],
                p["image_path"],
                p["signification"],
                p["description_longue"],
            ),
        )
        panneau_id = cursor.lastrowid

        # Insertion de la question associée
        conn.execute(
            """INSERT INTO questions
               (panneau_id, type_question, enonce, choix_a, choix_b, choix_c, choix_d, bonne_reponse)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                panneau_id,
                q["type_question"],
                q["enonce"],
                q["choix_a"],
                q["choix_b"],
                q["choix_c"],
                q["choix_d"],
                q["bonne_reponse"],
            ),
        )
        print(f"  ✓ Panneau inséré : [{p['categorie']}] {p['nom']}")

    conn.commit()
    print(f"  → {len(PANNEAUX_ET_QUESTIONS)} panneaux et questions insérés.")


def seed_utilisateur_demo(conn):
    """Insère l'utilisateur de démonstration si absent et garantit son rôle apprenant."""
    existant = conn.execute(
        "SELECT id FROM utilisateurs WHERE email = ?", ("demo@permis.com",)
    ).fetchone()

    if existant:
        conn.execute(
            "UPDATE utilisateurs SET role = 'apprenant' WHERE email = ?",
            ("demo@permis.com",),
        )
        conn.commit()
        print("  → Utilisateur demo déjà présent, rôle apprenant garanti.")
        return

    conn.execute(
        """INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
           VALUES (?, ?, ?, ?, ?)""",
        (
            "Demo",
            "Utilisateur",
            "demo@permis.com",
            hash_password("demo123"),
            "apprenant",
        ),
    )
    conn.commit()
    print("  ✓ Utilisateur demo inséré (email: demo@permis.com, mdp: demo123).")


def seed_admin_defaut(conn):
    """Ajoute un compte admin par défaut s'il n'existe encore aucun administrateur.

    Le mot de passe provient de la variable d'environnement PERMIS_ADMIN_PASSWORD.
    Sans variable définie, un mot de passe de développement est utilisé : il
    convient exclusivement à un usage local (jamais à un déploiement public).
    """
    admin_existant = conn.execute(
        "SELECT id FROM utilisateurs WHERE role = 'admin' LIMIT 1"
    ).fetchone()

    if admin_existant:
        print("  → Un administrateur existe déjà, insertion ignorée.")
        return

    mot_de_passe = os.environ.get("PERMIS_ADMIN_PASSWORD")
    if mot_de_passe:
        source = "défini via PERMIS_ADMIN_PASSWORD"
    else:
        mot_de_passe = "admin1234"
        source = "MOT DE PASSE DE DÉVELOPPEMENT PAR DÉFAUT (définir PERMIS_ADMIN_PASSWORD en production)"

    conn.execute(
        """INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
           VALUES (?, ?, ?, ?, ?)""",
        (
            "Admin",
            "PERMIS+",
            "admin@permis.local",
            hash_password(mot_de_passe),
            "admin",
        ),
    )
    conn.commit()
    print(f"  ✓ Compte admin inséré (email: admin@permis.local, mot de passe : {source}).")


def seed():
    """Point d'entrée principal : initialise la DB puis insère les données."""
    print("=== Initialisation de la base de données ===")
    init_db()

    print("\n=== Insertion des panneaux et questions ===")
    conn = get_db_connection()
    try:
        seed_panneaux_et_questions(conn)

        print("\n=== Insertion de l'utilisateur de démonstration ===")
        seed_utilisateur_demo(conn)

        print("\n=== Vérification du compte administrateur par défaut ===")
        seed_admin_defaut(conn)
    finally:
        conn.close()

    print("\n=== Seed terminé avec succès ===")


if __name__ == "__main__":
    seed()
