"""
Gestion de la base de données SQLite pour PERMIS+.
Crée et initialise les 5 tables nécessaires à l'application.
"""

import os
import sqlite3

# Chemin absolu vers la base de données, dans le même dossier que ce fichier
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "permis_plus.db")


def get_db_connection() -> sqlite3.Connection:
    """Retourne une connexion SQLite avec row_factory pour accès par nom de colonne."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Active les contraintes de clés étrangères sur chaque connexion.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Crée toutes les tables si elles n'existent pas encore."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Table des utilisateurs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS utilisateurs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            prenom TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            mot_de_passe TEXT NOT NULL,
            niveau TEXT DEFAULT 'Débutant',
            role TEXT DEFAULT 'apprenant',
            date_inscription TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migration douce : ajoute la colonne role si la table utilisateurs existe déjà.
    colonnes_utilisateurs = cursor.execute("PRAGMA table_info(utilisateurs)").fetchall()
    noms_colonnes = {colonne[1] for colonne in colonnes_utilisateurs}
    if "role" not in noms_colonnes:
        cursor.execute(
            "ALTER TABLE utilisateurs ADD COLUMN role TEXT DEFAULT 'apprenant'"
        )

    # Table des panneaux de signalisation
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS panneaux (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            categorie TEXT NOT NULL,
            image_path TEXT NOT NULL,
            signification TEXT NOT NULL,
            description_longue TEXT
        )
    """)

    # Table des questions QCM liées aux panneaux
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panneau_id INTEGER REFERENCES panneaux(id),
            type_question TEXT NOT NULL,
            enonce TEXT NOT NULL,
            choix_a TEXT NOT NULL,
            choix_b TEXT NOT NULL,
            choix_c TEXT NOT NULL,
            choix_d TEXT NOT NULL,
            bonne_reponse TEXT NOT NULL
        )
    """)

    # Table des sessions de quiz
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions_quiz (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            utilisateur_id INTEGER REFERENCES utilisateurs(id),
            date_session TEXT DEFAULT CURRENT_TIMESTAMP,
            score INTEGER NOT NULL,
            total_questions INTEGER NOT NULL,
            note_sur_20 REAL NOT NULL,
            duree_secondes INTEGER
        )
    """)

    # Table des réponses par session
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reponses_session (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER REFERENCES sessions_quiz(id),
            question_id INTEGER REFERENCES questions(id),
            reponse_donnee TEXT,
            est_correcte INTEGER,
            temps_reponse_secondes INTEGER
        )
    """)

    # Table des certifications As du Volant
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS certifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            utilisateur_id INTEGER REFERENCES utilisateurs(id),
            admin_id INTEGER REFERENCES utilisateurs(id),
            message TEXT,
            date_emission TEXT DEFAULT CURRENT_TIMESTAMP,
            statut TEXT DEFAULT 'certifie',
            numero_unique TEXT,
            nom_utilisateur TEXT,
            prenom_utilisateur TEXT
        )
    """)

    conn.commit()
    conn.close()
    print(f"Base de données initialisée : {DB_PATH}")


if __name__ == "__main__":
    init_db()
