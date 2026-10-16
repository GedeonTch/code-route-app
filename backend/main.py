"""
API principale PERMIS+ — FastAPI
Gère l'authentification, le catalogue de panneaux, les quiz et les statistiques.
"""

import hashlib
import os
import random
import shutil

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import get_db_connection, init_db
from .models import (
    AdminPanneauCreate,
    AdminPanneauUpdate,
    AdminUserCreate,
    AdminUserUpdate,
    CertificationCreate,
    IndemandeIndice,
    QuizSoumission,
    UserLogin,
    UserRegister,
)

# ---------------------------------------------------------------------------
# Initialisation de l'application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="PERMIS+ API",
    description="Backend de l'application d'auto-école PERMIS+",
    version="1.0.0",
)

# Middleware CORS — permissif volontairement : en production le frontend et
# l'API sont servis par le même service (même origine, CORS inactif), mais
# cela permet aussi d'ouvrir frontend/index.html directement en développement.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir les images des panneaux depuis le dossier /panneaux du projet
PANNEAUX_DIR = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "panneaux")
)
MAX_IMAGE_SIZE = 2 * 1024 * 1024  # 2 Mo
ALLOWED_IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}
app.mount("/panneaux", StaticFiles(directory=PANNEAUX_DIR), name="panneaux")


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Retourne le hash SHA-256 du mot de passe."""
    return hashlib.sha256(password.encode()).hexdigest()


def normaliser_role(role: str | None) -> str:
    """Valide et normalise le rôle utilisateur."""
    valeur = (role or "apprenant").strip().lower()
    if valeur not in {"admin", "apprenant"}:
        raise HTTPException(
            status_code=400,
            detail="Le rôle doit être 'admin' ou 'apprenant'.",
        )
    return valeur


def verifier_admin(user_id: int, conn):
    """Vérifie qu'un utilisateur est administrateur, sinon lève une 403."""
    utilisateur = conn.execute(
        "SELECT id, nom, prenom, email, COALESCE(role, 'apprenant') AS role FROM utilisateurs WHERE id = ?",
        (user_id,),
    ).fetchone()

    if not utilisateur:
        raise HTTPException(status_code=404, detail="Administrateur introuvable.")

    if (utilisateur["role"] or "apprenant").lower() != "admin":
        raise HTTPException(
            status_code=403,
            detail="Accès refusé : droits administrateur requis.",
        )

    return utilisateur


def mettre_a_jour_niveau(conn, utilisateur_id: int):
    """
    Recalcule et met à jour le niveau de l'utilisateur après chaque quiz.
    Règles :
      >= 15 quiz et moyenne >= 18 → As du Volant
      >= 10 quiz et moyenne >= 15 → Expert de la Route
      >= 6  quiz et moyenne >= 12 → Conducteur Confirmé
      >= 3  quiz et moyenne >= 8  → Apprenti Conducteur
      sinon                       → Débutant
    """
    sessions = conn.execute(
        "SELECT note_sur_20 FROM sessions_quiz WHERE utilisateur_id = ?",
        (utilisateur_id,),
    ).fetchall()

    nb_quiz = len(sessions)
    if nb_quiz == 0:
        return

    moyenne = sum(s["note_sur_20"] for s in sessions) / nb_quiz

    if nb_quiz >= 15 and moyenne >= 18:
        niveau = "As du Volant"
    elif nb_quiz >= 10 and moyenne >= 15:
        niveau = "Expert de la Route"
    elif nb_quiz >= 6 and moyenne >= 12:
        niveau = "Conducteur Confirmé"
    elif nb_quiz >= 3 and moyenne >= 8:
        niveau = "Apprenti Conducteur"
    else:
        niveau = "Débutant"

    conn.execute(
        "UPDATE utilisateurs SET niveau = ? WHERE id = ?",
        (niveau, utilisateur_id),
    )
    conn.commit()


def generer_question_identification(
    categorie: str, signification: str, distracteurs: list[str]
):
    """Construit une question QCM avec la bonne réponse répartie aléatoirement."""
    lettres = ["A", "B", "C", "D"]
    bonne_reponse = random.choice(lettres)
    distracteurs_melanges = random.sample(distracteurs, 3)

    choix = {}
    index_distracteur = 0
    for lettre in lettres:
        if lettre == bonne_reponse:
            choix[lettre] = signification
        else:
            choix[lettre] = distracteurs_melanges[index_distracteur]
            index_distracteur += 1

    return {
        "type_question": "identification",
        "enonce": "Que signifie ce panneau ?",
        "choix_a": choix["A"],
        "choix_b": choix["B"],
        "choix_c": choix["C"],
        "choix_d": choix["D"],
        "bonne_reponse": bonne_reponse,
    }


def recuperer_distracteurs_panneau(
    conn, panneau_id: int, categorie: str, signification: str
):
    """Récupère 3 mauvaises réponses d'abord dans la même catégorie, sinon ailleurs."""
    memes_categorie = conn.execute(
        """SELECT signification FROM panneaux
           WHERE id != ? AND categorie = ? AND signification != ?
           ORDER BY id""",
        (panneau_id, categorie, signification),
    ).fetchall()

    autres_categories = conn.execute(
        """SELECT signification FROM panneaux
           WHERE id != ? AND categorie != ? AND signification != ?
           ORDER BY id""",
        (panneau_id, categorie, signification),
    ).fetchall()

    distracteurs = []
    for ligne in list(memes_categorie) + list(autres_categories):
        valeur = ligne["signification"]
        if valeur not in distracteurs and valeur != signification:
            distracteurs.append(valeur)
        if len(distracteurs) == 3:
            break

    if len(distracteurs) < 3:
        raise HTTPException(
            status_code=400,
            detail="Impossible de générer automatiquement une question pour ce panneau.",
        )

    return distracteurs


def creer_question_identification_panneau(
    conn, panneau_id: int, categorie: str, signification: str
):
    """Crée la question d'identification automatique d'un panneau."""
    distracteurs = recuperer_distracteurs_panneau(
        conn, panneau_id, categorie, signification
    )
    question = generer_question_identification(categorie, signification, distracteurs)

    cursor = conn.execute(
        """INSERT INTO questions
           (panneau_id, type_question, enonce, choix_a, choix_b, choix_c, choix_d, bonne_reponse)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            panneau_id,
            question["type_question"],
            question["enonce"],
            question["choix_a"],
            question["choix_b"],
            question["choix_c"],
            question["choix_d"],
            question["bonne_reponse"],
        ),
    )

    question["id"] = cursor.lastrowid
    return question


def mettre_a_jour_question_identification_panneau(
    conn, panneau_id: int, categorie: str, signification: str
):
    """Met à jour la première question d'identification du panneau pour rester cohérente."""
    question_existante = conn.execute(
        "SELECT id FROM questions WHERE panneau_id = ? ORDER BY id LIMIT 1",
        (panneau_id,),
    ).fetchone()

    if not question_existante:
        return creer_question_identification_panneau(
            conn, panneau_id, categorie, signification
        )

    distracteurs = recuperer_distracteurs_panneau(
        conn, panneau_id, categorie, signification
    )
    question = generer_question_identification(categorie, signification, distracteurs)

    conn.execute(
        """UPDATE questions
           SET type_question = ?, enonce = ?, choix_a = ?, choix_b = ?, choix_c = ?,
               choix_d = ?, bonne_reponse = ?
           WHERE id = ?""",
        (
            question["type_question"],
            question["enonce"],
            question["choix_a"],
            question["choix_b"],
            question["choix_c"],
            question["choix_d"],
            question["bonne_reponse"],
            question_existante["id"],
        ),
    )

    question["id"] = question_existante["id"]
    return question


def supprimer_sessions_utilisateur(conn, utilisateur_id: int):
    """Supprime d'abord les réponses de sessions puis les sessions d'un utilisateur."""
    sessions = conn.execute(
        "SELECT id FROM sessions_quiz WHERE utilisateur_id = ?",
        (utilisateur_id,),
    ).fetchall()
    session_ids = [session["id"] for session in sessions]

    if session_ids:
        placeholders = ", ".join(["?"] * len(session_ids))
        conn.execute(
            f"DELETE FROM reponses_session WHERE session_id IN ({placeholders})",
            session_ids,
        )

    conn.execute(
        "DELETE FROM sessions_quiz WHERE utilisateur_id = ?", (utilisateur_id,)
    )


def supprimer_questions_panneau(conn, panneau_id: int):
    """Supprime les questions liées à un panneau ainsi que leurs réponses historisées."""
    questions = conn.execute(
        "SELECT id FROM questions WHERE panneau_id = ?",
        (panneau_id,),
    ).fetchall()
    question_ids = [question["id"] for question in questions]

    if question_ids:
        placeholders = ", ".join(["?"] * len(question_ids))
        conn.execute(
            f"DELETE FROM reponses_session WHERE question_id IN ({placeholders})",
            question_ids,
        )

    conn.execute("DELETE FROM questions WHERE panneau_id = ?", (panneau_id,))


def lister_images_custom_panneau(panneau_id: int):
    """Retourne les chemins absolus des images custom locales d'un panneau."""
    prefixe = f"panneau_{panneau_id}."
    images = []

    if not os.path.isdir(PANNEAUX_DIR):
        return images

    for nom_fichier in os.listdir(PANNEAUX_DIR):
        if nom_fichier.startswith(prefixe):
            images.append(os.path.join(PANNEAUX_DIR, nom_fichier))

    return images


def supprimer_images_custom_panneau(panneau_id: int):
    """Supprime toutes les images custom locales d'un panneau."""
    chemins = lister_images_custom_panneau(panneau_id)
    supprimes = []

    for chemin in chemins:
        if os.path.isfile(chemin):
            os.remove(chemin)
            supprimes.append(os.path.basename(chemin))

    return supprimes


# ---------------------------------------------------------------------------
# Authentification
# ---------------------------------------------------------------------------


@app.post("/api/auth/register", summary="Inscription d'un nouvel utilisateur")
def register(user: UserRegister):
    """Crée un compte utilisateur. Retourne les données sans le mot de passe."""
    conn = get_db_connection()
    try:
        # Vérification unicité de l'email
        existant = conn.execute(
            "SELECT id FROM utilisateurs WHERE email = ?", (user.email,)
        ).fetchone()
        if existant:
            raise HTTPException(status_code=400, detail="Cet email est déjà utilisé.")

        hashed = hash_password(user.mot_de_passe)
        cursor = conn.execute(
            """INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role)
               VALUES (?, ?, ?, ?, ?)""",
            (user.nom, user.prenom, user.email, hashed, "apprenant"),
        )
        conn.commit()

        return {
            "id": cursor.lastrowid,
            "nom": user.nom,
            "prenom": user.prenom,
            "email": user.email,
            "niveau": "Débutant",
            "role": "apprenant",
            "message": "Compte créé avec succès.",
        }
    finally:
        conn.close()


@app.post("/api/auth/login", summary="Connexion utilisateur")
def login(credentials: UserLogin):
    """Vérifie les identifiants et retourne les données de l'utilisateur."""
    conn = get_db_connection()
    try:
        utilisateur = conn.execute(
            "SELECT * FROM utilisateurs WHERE email = ?", (credentials.email,)
        ).fetchone()

        if not utilisateur:
            raise HTTPException(
                status_code=401, detail="Email ou mot de passe incorrect."
            )

        if utilisateur["mot_de_passe"] != hash_password(credentials.mot_de_passe):
            raise HTTPException(
                status_code=401, detail="Email ou mot de passe incorrect."
            )

        return {
            "id": utilisateur["id"],
            "nom": utilisateur["nom"],
            "prenom": utilisateur["prenom"],
            "email": utilisateur["email"],
            "niveau": utilisateur["niveau"],
            "role": utilisateur["role"] or "apprenant",
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Administration — utilisateurs
# ---------------------------------------------------------------------------


@app.get(
    "/api/admin/utilisateurs", summary="Liste des utilisateurs pour l'administration"
)
def admin_get_utilisateurs(
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Retourne la liste des utilisateurs avec quelques informations de synthèse."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        utilisateurs = conn.execute(
            """SELECT u.id, u.nom, u.prenom, u.email, u.niveau,
                      COALESCE(u.role, 'apprenant') AS role,
                      u.date_inscription,
                      COUNT(s.id) AS nb_quiz,
                      MAX(s.date_session) AS derniere_activite
               FROM utilisateurs u
               LEFT JOIN sessions_quiz s ON s.utilisateur_id = u.id
               GROUP BY u.id
               ORDER BY u.date_inscription DESC, u.id DESC"""
        ).fetchall()

        return [dict(utilisateur) for utilisateur in utilisateurs]
    finally:
        conn.close()


@app.post(
    "/api/admin/utilisateurs", summary="Créer un utilisateur depuis l'administration"
)
def admin_creer_utilisateur(
    user: AdminUserCreate,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Crée un utilisateur admin ou apprenant depuis le back-office."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        email_existant = conn.execute(
            "SELECT id FROM utilisateurs WHERE email = ?",
            (user.email,),
        ).fetchone()
        if email_existant:
            raise HTTPException(status_code=400, detail="Cet email est déjà utilisé.")

        role = normaliser_role(user.role)
        cursor = conn.execute(
            """INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, niveau, role)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                user.nom,
                user.prenom,
                user.email,
                hash_password(user.mot_de_passe),
                user.niveau or "Débutant",
                role,
            ),
        )
        conn.commit()

        return {
            "id": cursor.lastrowid,
            "nom": user.nom,
            "prenom": user.prenom,
            "email": user.email,
            "niveau": user.niveau or "Débutant",
            "role": role,
            "message": "Utilisateur créé avec succès.",
        }
    finally:
        conn.close()


@app.put("/api/admin/utilisateurs/{user_id}", summary="Modifier un utilisateur")
def admin_modifier_utilisateur(
    user_id: int,
    user: AdminUserUpdate,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Met à jour un utilisateur sans exposer son mot de passe."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        existant = conn.execute(
            "SELECT * FROM utilisateurs WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not existant:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        if user.email and user.email != existant["email"]:
            doublon = conn.execute(
                "SELECT id FROM utilisateurs WHERE email = ? AND id != ?",
                (user.email, user_id),
            ).fetchone()
            if doublon:
                raise HTTPException(
                    status_code=400, detail="Cet email est déjà utilisé."
                )

        role = (
            normaliser_role(user.role)
            if user.role is not None
            else (existant["role"] or "apprenant")
        )
        mot_de_passe = (
            hash_password(user.mot_de_passe)
            if user.mot_de_passe is not None
            else existant["mot_de_passe"]
        )

        donnees = {
            "nom": user.nom if user.nom is not None else existant["nom"],
            "prenom": user.prenom if user.prenom is not None else existant["prenom"],
            "email": user.email if user.email is not None else existant["email"],
            "mot_de_passe": mot_de_passe,
            "niveau": user.niveau if user.niveau is not None else existant["niveau"],
            "role": role,
        }

        conn.execute(
            """UPDATE utilisateurs
               SET nom = ?, prenom = ?, email = ?, mot_de_passe = ?, niveau = ?, role = ?
               WHERE id = ?""",
            (
                donnees["nom"],
                donnees["prenom"],
                donnees["email"],
                donnees["mot_de_passe"],
                donnees["niveau"],
                donnees["role"],
                user_id,
            ),
        )
        conn.commit()

        return {
            "id": user_id,
            "nom": donnees["nom"],
            "prenom": donnees["prenom"],
            "email": donnees["email"],
            "niveau": donnees["niveau"],
            "role": donnees["role"],
            "message": "Utilisateur mis à jour avec succès.",
        }
    finally:
        conn.close()


@app.delete("/api/admin/utilisateurs/{user_id}", summary="Supprimer un utilisateur")
def admin_supprimer_utilisateur(
    user_id: int,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Supprime un utilisateur, ses réponses et ses sessions de quiz."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        if user_id == admin_id:
            raise HTTPException(
                status_code=400,
                detail="Un administrateur ne peut pas se supprimer lui-même.",
            )

        utilisateur = conn.execute(
            "SELECT id, nom, prenom, email FROM utilisateurs WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not utilisateur:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        supprimer_sessions_utilisateur(conn, user_id)
        conn.execute("DELETE FROM utilisateurs WHERE id = ?", (user_id,))
        conn.commit()

        return {
            "message": "Utilisateur supprimé avec succès.",
            "utilisateur": dict(utilisateur),
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Administration — panneaux
# ---------------------------------------------------------------------------


@app.get("/api/admin/panneaux", summary="Liste des panneaux pour l'administration")
def admin_get_panneaux(
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Retourne la liste des panneaux avec des statistiques d'utilisation."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        panneaux = conn.execute(
            """SELECT p.*,
                      (SELECT COUNT(*) FROM questions q WHERE q.panneau_id = p.id)
                          AS nb_questions_associees,
                      (SELECT COUNT(*)
                       FROM reponses_session rs
                       JOIN questions q2 ON rs.question_id = q2.id
                       WHERE q2.panneau_id = p.id)
                          AS nb_apparitions_quiz
               FROM panneaux p
               ORDER BY p.categorie, p.nom"""
        ).fetchall()

        return [dict(panneau) for panneau in panneaux]
    finally:
        conn.close()


@app.post("/api/admin/panneaux", summary="Créer un panneau")
def admin_creer_panneau(
    panneau: AdminPanneauCreate,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Crée un panneau puis sa question QCM automatique d'identification."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        categorie = panneau.categorie.upper()
        cursor = conn.execute(
            """INSERT INTO panneaux (nom, categorie, image_path, signification, description_longue)
               VALUES (?, ?, ?, ?, ?)""",
            (
                panneau.nom,
                categorie,
                panneau.image_path or "",
                panneau.signification,
                panneau.description_longue,
            ),
        )
        if cursor.lastrowid is None:
            raise HTTPException(
                status_code=500,
                detail="Impossible de récupérer l'identifiant du panneau créé.",
            )
        panneau_id = cursor.lastrowid

        question = creer_question_identification_panneau(
            conn,
            panneau_id,
            categorie,
            panneau.signification,
        )
        conn.commit()

        return {
            "id": panneau_id,
            "nom": panneau.nom,
            "categorie": categorie,
            "image_path": panneau.image_path or "",
            "signification": panneau.signification,
            "description_longue": panneau.description_longue,
            "question_associee": question,
            "message": "Panneau créé avec succès.",
        }
    finally:
        conn.close()


@app.put("/api/admin/panneaux/{panneau_id}", summary="Modifier un panneau")
def admin_modifier_panneau(
    panneau_id: int,
    panneau: AdminPanneauUpdate,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Met à jour un panneau et resynchronise sa question d'identification principale."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        existant = conn.execute(
            "SELECT * FROM panneaux WHERE id = ?",
            (panneau_id,),
        ).fetchone()
        if not existant:
            raise HTTPException(status_code=404, detail="Panneau introuvable.")

        donnees = {
            "nom": panneau.nom if panneau.nom is not None else existant["nom"],
            "categorie": (
                panneau.categorie.upper()
                if panneau.categorie is not None
                else existant["categorie"]
            ),
            "image_path": (
                panneau.image_path
                if panneau.image_path is not None
                else existant["image_path"]
            ),
            "signification": (
                panneau.signification
                if panneau.signification is not None
                else existant["signification"]
            ),
            "description_longue": (
                panneau.description_longue
                if panneau.description_longue is not None
                else existant["description_longue"]
            ),
        }

        conn.execute(
            """UPDATE panneaux
               SET nom = ?, categorie = ?, image_path = ?, signification = ?, description_longue = ?
               WHERE id = ?""",
            (
                donnees["nom"],
                donnees["categorie"],
                donnees["image_path"],
                donnees["signification"],
                donnees["description_longue"],
                panneau_id,
            ),
        )

        question = mettre_a_jour_question_identification_panneau(
            conn,
            panneau_id,
            donnees["categorie"],
            donnees["signification"],
        )
        conn.commit()

        return {
            "id": panneau_id,
            "nom": donnees["nom"],
            "categorie": donnees["categorie"],
            "image_path": donnees["image_path"],
            "signification": donnees["signification"],
            "description_longue": donnees["description_longue"],
            "question_associee": question,
            "message": "Panneau mis à jour avec succès.",
        }
    finally:
        conn.close()


@app.delete("/api/admin/panneaux/{panneau_id}", summary="Supprimer un panneau")
def admin_supprimer_panneau(
    panneau_id: int,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Supprime un panneau, ses questions liées et son éventuelle image custom locale."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        panneau = conn.execute(
            "SELECT * FROM panneaux WHERE id = ?",
            (panneau_id,),
        ).fetchone()
        if not panneau:
            raise HTTPException(status_code=404, detail="Panneau introuvable.")

        supprimer_questions_panneau(conn, panneau_id)
        images_supprimees = supprimer_images_custom_panneau(panneau_id)
        conn.execute("DELETE FROM panneaux WHERE id = ?", (panneau_id,))
        conn.commit()

        return {
            "message": "Panneau supprimé avec succès.",
            "panneau": {
                "id": panneau["id"],
                "nom": panneau["nom"],
                "categorie": panneau["categorie"],
            },
            "images_supprimees": images_supprimees,
        }
    finally:
        conn.close()


@app.post(
    "/api/admin/panneaux/{panneau_id}/image", summary="Uploader une image de panneau"
)
async def admin_upload_image_panneau(
    panneau_id: int,
    admin_id: int = Query(..., description="ID de l'administrateur"),
    image: UploadFile = File(...),
):
    """Enregistre une image custom locale pour un panneau avec validation simple."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        panneau = conn.execute(
            "SELECT id FROM panneaux WHERE id = ?",
            (panneau_id,),
        ).fetchone()
        if not panneau:
            raise HTTPException(status_code=404, detail="Panneau introuvable.")

        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=400,
                detail="Format d'image non supporté. Utilisez PNG, JPEG ou WEBP.",
            )

        contenu = await image.read(MAX_IMAGE_SIZE + 1)
        if len(contenu) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail="Image trop volumineuse. Taille maximale : 2 Mo.",
            )

        await image.seek(0)
        supprimer_images_custom_panneau(panneau_id)

        extension = ALLOWED_IMAGE_TYPES[image.content_type]
        nom_fichier = f"panneau_{panneau_id}{extension}"
        chemin_fichier = os.path.join(PANNEAUX_DIR, nom_fichier)

        with open(chemin_fichier, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)

        image_path = f"/panneaux/{nom_fichier}"
        conn.execute(
            "UPDATE panneaux SET image_path = ? WHERE id = ?",
            (image_path, panneau_id),
        )
        conn.commit()

        return {
            "id": panneau_id,
            "image_path": image_path,
            "message": "Image du panneau mise à jour avec succès.",
        }
    finally:
        conn.close()
        await image.close()


@app.delete(
    "/api/admin/panneaux/{panneau_id}/image",
    summary="Supprimer l'image custom d'un panneau",
)
def admin_supprimer_image_panneau(
    panneau_id: int,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Supprime l'image custom locale d'un panneau si elle existe."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        panneau = conn.execute(
            "SELECT id, image_path FROM panneaux WHERE id = ?",
            (panneau_id,),
        ).fetchone()
        if not panneau:
            raise HTTPException(status_code=404, detail="Panneau introuvable.")

        images_supprimees = supprimer_images_custom_panneau(panneau_id)
        image_path_custom = f"/panneaux/panneau_{panneau_id}."

        if (panneau["image_path"] or "").startswith(image_path_custom):
            conn.execute(
                "UPDATE panneaux SET image_path = ? WHERE id = ?",
                ("", panneau_id),
            )
            conn.commit()
        elif images_supprimees:
            conn.commit()

        return {
            "message": "Image custom supprimée avec succès."
            if images_supprimees
            else "Aucune image custom à supprimer.",
            "images_supprimees": images_supprimees,
            "image_path": "" if images_supprimees else panneau["image_path"],
        }
    finally:
        conn.close()


@app.get("/api/admin/stats", summary="Statistiques globales d'administration")
def admin_get_stats(admin_id: int = Query(..., description="ID de l'administrateur")):
    """Retourne quelques statistiques globales utiles au tableau de bord admin."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        total_utilisateurs = conn.execute(
            "SELECT COUNT(*) AS total FROM utilisateurs"
        ).fetchone()["total"]
        total_quiz = conn.execute(
            "SELECT COUNT(*) AS total FROM sessions_quiz"
        ).fetchone()["total"]

        panneau_plus_rate = conn.execute(
            """SELECT p.id, p.nom, p.categorie, p.signification,
                      COUNT(rs.id) AS nb_erreurs,
                      COUNT(DISTINCT rs.session_id) AS nb_sessions_concernees
               FROM reponses_session rs
               JOIN questions q ON rs.question_id = q.id
               JOIN panneaux p ON q.panneau_id = p.id
               WHERE rs.est_correcte = 0
               GROUP BY p.id
               ORDER BY nb_erreurs DESC, p.id ASC
               LIMIT 1"""
        ).fetchone()

        meilleure_note = conn.execute(
            """SELECT s.note_sur_20, s.date_session,
                      u.id AS utilisateur_id, u.nom, u.prenom
               FROM sessions_quiz s
               JOIN utilisateurs u ON s.utilisateur_id = u.id
               ORDER BY s.note_sur_20 DESC, s.date_session DESC
               LIMIT 1"""
        ).fetchone()

        dernieres_inscriptions = conn.execute(
            """SELECT id, nom, prenom, email, niveau,
                      COALESCE(role, 'apprenant') AS role,
                      date_inscription
               FROM utilisateurs
               ORDER BY date_inscription DESC, id DESC
               LIMIT 5"""
        ).fetchall()

        return {
            "total_utilisateurs": total_utilisateurs,
            "total_quiz": total_quiz,
            "panneau_plus_rate": dict(panneau_plus_rate) if panneau_plus_rate else None,
            "meilleure_note_globale": dict(meilleure_note) if meilleure_note else None,
            "dernieres_inscriptions": [
                dict(utilisateur) for utilisateur in dernieres_inscriptions
            ],
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Panneaux — ATTENTION : les routes spécifiques AVANT /{id}
# ---------------------------------------------------------------------------


@app.get("/api/panneaux/search", summary="Recherche de panneaux")
def search_panneaux(q: str = Query(..., description="Terme de recherche")):
    """Recherche dans le nom et la signification des panneaux (insensible à la casse)."""
    conn = get_db_connection()
    try:
        panneaux = conn.execute(
            """SELECT * FROM panneaux
               WHERE nom LIKE ? OR signification LIKE ?""",
            (f"%{q}%", f"%{q}%"),
        ).fetchall()
        return [dict(p) for p in panneaux]
    finally:
        conn.close()


@app.get("/api/panneaux/categorie/{cat}", summary="Panneaux par catégorie")
def panneaux_par_categorie(cat: str):
    """Retourne tous les panneaux d'une catégorie (DANGER, INTERDICTION, OBLIGATION, INFORMATION)."""
    conn = get_db_connection()
    try:
        panneaux = conn.execute(
            "SELECT * FROM panneaux WHERE categorie = ?", (cat.upper(),)
        ).fetchall()
        if not panneaux:
            raise HTTPException(
                status_code=404,
                detail=f"Aucun panneau trouvé pour la catégorie '{cat}'.",
            )
        return [dict(p) for p in panneaux]
    finally:
        conn.close()


@app.get("/api/panneaux", summary="Liste complète des panneaux")
def get_panneaux():
    """Retourne la liste de tous les panneaux de signalisation."""
    conn = get_db_connection()
    try:
        panneaux = conn.execute("SELECT * FROM panneaux").fetchall()
        return [dict(p) for p in panneaux]
    finally:
        conn.close()


@app.get("/api/panneaux/{panneau_id}", summary="Détail d'un panneau")
def get_panneau(panneau_id: int):
    """Retourne un panneau avec toutes ses questions associées."""
    conn = get_db_connection()
    try:
        panneau = conn.execute(
            "SELECT * FROM panneaux WHERE id = ?", (panneau_id,)
        ).fetchone()
        if not panneau:
            raise HTTPException(status_code=404, detail="Panneau introuvable.")

        questions = conn.execute(
            "SELECT * FROM questions WHERE panneau_id = ?", (panneau_id,)
        ).fetchall()

        resultat = dict(panneau)
        resultat["questions"] = [dict(q) for q in questions]
        return resultat
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Catalogue (alias de /api/panneaux)
# ---------------------------------------------------------------------------


@app.get("/api/catalogue", summary="Catalogue complet (alias)")
def get_catalogue():
    """Alias de /api/panneaux — retourne l'ensemble des panneaux."""
    return get_panneaux()


# ---------------------------------------------------------------------------
# Quiz
# ---------------------------------------------------------------------------


@app.get("/api/quiz/generer", summary="Générer un quiz")
def generer_quiz(
    nb: int = Query(10, description="Nombre de questions"),
    categorie: str = Query("all", description="Catégorie ou 'all'"),
):
    """
    Retourne N questions aléatoires avec le panneau associé.
    Si categorie != 'all', filtre par catégorie.
    """
    conn = get_db_connection()
    try:
        if categorie.lower() == "all":
            questions = conn.execute(
                """SELECT q.*, p.nom AS panneau_nom, p.categorie, p.image_path, p.signification
                   FROM questions q
                   JOIN panneaux p ON q.panneau_id = p.id"""
            ).fetchall()
        else:
            questions = conn.execute(
                """SELECT q.*, p.nom AS panneau_nom, p.categorie, p.image_path, p.signification
                   FROM questions q
                   JOIN panneaux p ON q.panneau_id = p.id
                   WHERE p.categorie = ?""",
                (categorie.upper(),),
            ).fetchall()

        if not questions:
            raise HTTPException(
                status_code=404, detail="Aucune question disponible pour ces critères."
            )

        # Sélection aléatoire (sans dépassement du total disponible)
        nb_effectif = min(nb, len(questions))
        selection = random.sample(list(questions), nb_effectif)
        return [dict(q) for q in selection]
    finally:
        conn.close()


@app.post("/api/quiz/soumettre", summary="Soumettre les réponses d'un quiz")
def soumettre_quiz(soumission: QuizSoumission):
    """
    Enregistre les réponses, calcule le score, met à jour le niveau utilisateur.
    Retourne : session_id, score, total, note_sur_20, duree.
    """
    conn = get_db_connection()
    try:
        # Vérification de l'existence de l'utilisateur
        utilisateur = conn.execute(
            "SELECT id FROM utilisateurs WHERE id = ?", (soumission.utilisateur_id,)
        ).fetchone()
        if not utilisateur:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        total = len(soumission.questions)
        if total == 0:
            raise HTTPException(
                status_code=400, detail="Aucune question dans la soumission."
            )

        # Calcul du score
        score = 0
        resultats_reponses = []

        for item in soumission.questions:
            question_id_brut = item.get("question_id")
            if not isinstance(question_id_brut, int):
                continue

            question_id = question_id_brut
            # reponse_donnee peut être None si le timer a expiré — on normalise en chaîne vide
            reponse_donnee = str(item.get("reponse_donnee") or "")
            temps_brut = item.get("temps_reponse_secondes", 0)
            temps = temps_brut if isinstance(temps_brut, int) else 0

            question = conn.execute(
                "SELECT bonne_reponse FROM questions WHERE id = ?", (question_id,)
            ).fetchone()

            if not question:
                continue  # Question inconnue, ignorée

            # Comparaison sécurisée — réponse vide = toujours incorrect
            est_correcte = (
                1
                if reponse_donnee
                and reponse_donnee.upper() == question["bonne_reponse"].upper()
                else 0
            )
            if est_correcte:
                score += 1

            resultats_reponses.append(
                {
                    "question_id": question_id,
                    "reponse_donnee": reponse_donnee,
                    "est_correcte": est_correcte,
                    "temps_reponse_secondes": temps,
                }
            )

        note_sur_20 = round((score / total) * 20, 2)

        # Insertion de la session
        cursor = conn.execute(
            """INSERT INTO sessions_quiz (utilisateur_id, score, total_questions, note_sur_20, duree_secondes)
               VALUES (?, ?, ?, ?, ?)""",
            (
                soumission.utilisateur_id,
                score,
                total,
                note_sur_20,
                soumission.duree_totale,
            ),
        )
        session_id = cursor.lastrowid

        # Insertion des réponses individuelles
        for r in resultats_reponses:
            conn.execute(
                """INSERT INTO reponses_session (session_id, question_id, reponse_donnee, est_correcte, temps_reponse_secondes)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    session_id,
                    r["question_id"],
                    r["reponse_donnee"],
                    r["est_correcte"],
                    r["temps_reponse_secondes"],
                ),
            )

        conn.commit()

        # Mise à jour du niveau utilisateur
        mettre_a_jour_niveau(conn, soumission.utilisateur_id)

        return {
            "session_id": session_id,
            "score": score,
            "total": total,
            "note_sur_20": note_sur_20,
            "duree": soumission.duree_totale,
        }
    finally:
        conn.close()


@app.get(
    "/api/quiz/historique/{user_id}", summary="Historique des quiz d'un utilisateur"
)
def historique_quiz(user_id: int):
    """Retourne toutes les sessions de quiz de l'utilisateur, de la plus récente à la plus ancienne."""
    conn = get_db_connection()
    try:
        utilisateur = conn.execute(
            "SELECT id FROM utilisateurs WHERE id = ?", (user_id,)
        ).fetchone()
        if not utilisateur:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        sessions = conn.execute(
            """SELECT * FROM sessions_quiz
               WHERE utilisateur_id = ?
               ORDER BY date_session DESC""",
            (user_id,),
        ).fetchall()
        return [dict(s) for s in sessions]
    finally:
        conn.close()


@app.get("/api/quiz/session/{session_id}", summary="Détail d'une session de quiz")
def detail_session(session_id: int):
    """Retourne le détail complet d'une session avec les réponses et les questions associées."""
    conn = get_db_connection()
    try:
        session = conn.execute(
            "SELECT * FROM sessions_quiz WHERE id = ?", (session_id,)
        ).fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session introuvable.")

        reponses = conn.execute(
            """SELECT rs.*, q.enonce, q.choix_a, q.choix_b, q.choix_c, q.choix_d,
                      q.bonne_reponse, p.nom AS panneau_nom, p.image_path
               FROM reponses_session rs
               JOIN questions q ON rs.question_id = q.id
               JOIN panneaux p ON q.panneau_id = p.id
               WHERE rs.session_id = ?""",
            (session_id,),
        ).fetchall()

        resultat = dict(session)
        resultat["reponses"] = [dict(r) for r in reponses]
        return resultat
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Indice — Bot ROADY
# ---------------------------------------------------------------------------


@app.post("/api/indice", summary="Demander un indice (bot ROADY)")
def demander_indice(demande: IndemandeIndice):
    """
    Fournit un indice progressif sur un panneau.
    Indice 1 : forme et catégorie du panneau.
    Indice 2 : début de la description longue.
    Au-delà : ROADY est épuisé.
    """
    conn = get_db_connection()
    try:
        panneau = conn.execute(
            "SELECT * FROM panneaux WHERE id = ?", (demande.panneau_id,)
        ).fetchone()
        if not panneau:
            raise HTTPException(status_code=404, detail="Panneau introuvable.")

        categorie = panneau["categorie"]

        if demande.numero_indice == 1:
            # Indice visuel : forme associée à la catégorie
            formes = {
                "DANGER": "triangulaire à fond blanc",
                "INTERDICTION": "circulaire à fond rouge",
                "OBLIGATION": "circulaire à fond bleu",
                "INFORMATION": "rectangulaire à fond bleu",
            }
            forme = formes.get(categorie, "de forme inconnue")
            return {"indice": f"C'est un panneau de {categorie.lower()} — {forme}."}

        elif demande.numero_indice == 2:
            # Indice textuel : début de la description longue
            description = panneau["description_longue"] or ""
            extrait = description[:50] + "..." if len(description) > 50 else description
            return {"indice": extrait}

        else:
            # ROADY est à court d'indices
            return {
                "indice": "ROADY  a dit tout ce qu'il pouvait. 🤫",
                "epuise": True,
            }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Statistiques utilisateur
# ---------------------------------------------------------------------------


@app.get("/api/stats/{user_id}", summary="Statistiques d'un utilisateur")
def get_stats(user_id: int):
    """Retourne les statistiques complètes et la progression de l'utilisateur."""
    conn = get_db_connection()
    try:
        utilisateur = conn.execute(
            "SELECT * FROM utilisateurs WHERE id = ?", (user_id,)
        ).fetchone()
        if not utilisateur:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        sessions = conn.execute(
            """SELECT note_sur_20 FROM sessions_quiz
               WHERE utilisateur_id = ?
               ORDER BY date_session DESC""",
            (user_id,),
        ).fetchall()

        nb_quiz = len(sessions)
        notes = [s["note_sur_20"] for s in sessions]

        if nb_quiz > 0:
            meilleur_score = round(max(notes), 2)
            moyenne = round(sum(notes) / nb_quiz, 1)
        else:
            meilleur_score = 0.0
            moyenne = 0.0

        # Les 10 dernières notes (déjà triées DESC)
        historique_scores = notes[:10]

        # Progression vers le niveau suivant
        niveaux_suivants = {
            "Débutant": ("Apprenti Conducteur", 3, 8.0),
            "Apprenti Conducteur": ("Conducteur Confirmé", 6, 12.0),
            "Conducteur Confirmé": ("Expert de la Route", 10, 15.0),
            "Expert de la Route": ("As du Volant", 15, 18.0),
            "As du Volant": (None, None, None),
        }

        niveau_actuel = utilisateur["niveau"]
        prochain_niveau, quiz_requis, moy_requise = niveaux_suivants.get(
            niveau_actuel, (None, None, None)
        )

        return {
            "nb_quiz": nb_quiz,
            "meilleur_score": meilleur_score,
            "moyenne": moyenne,
            "niveau": niveau_actuel,
            "historique_scores": historique_scores,
            "progression_niveaux": {
                "quiz_faits": nb_quiz,
                "quiz_requis_prochain": quiz_requis,
                "moyenne_actuelle": moyenne,
                "moyenne_requise_prochain": moy_requise,
                "prochain_niveau": prochain_niveau,
            },
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Classement
# ---------------------------------------------------------------------------


@app.get("/api/classement", summary="Top 10 des meilleurs conducteurs")
def get_classement():
    """
    Retourne le top 10 des utilisateurs basé sur leur meilleure note_sur_20.
    Une ligne par utilisateur, nom de famille tronqué à l'initiale.
    """
    conn = get_db_connection()
    try:
        resultats = conn.execute(
            """SELECT u.prenom, u.nom, u.niveau,
                      MAX(s.note_sur_20) AS meilleure_note,
                      MAX(s.date_session) AS date
               FROM sessions_quiz s
               JOIN utilisateurs u ON s.utilisateur_id = u.id
               GROUP BY s.utilisateur_id
               ORDER BY meilleure_note DESC
               LIMIT 10"""
        ).fetchall()

        classement = []
        for rang, row in enumerate(resultats, start=1):
            # Anonymisation partielle : "Dupont" → "D."
            nom_initial = (row["nom"][0] + ".") if row["nom"] else "?"
            classement.append(
                {
                    "rang": rang,
                    "prenom": row["prenom"],
                    "nom": nom_initial,
                    "meilleure_note": row["meilleure_note"],
                    "date": row["date"][:10]
                    if row["date"]
                    else None,  # format YYYY-MM-DD
                    "niveau": row["niveau"],
                }
            )
        return classement
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Révision (mode flash)
# ---------------------------------------------------------------------------


@app.get("/api/revision", summary="Mode révision flash")
def get_revision(categorie: str = Query("all", description="Catégorie ou 'all'")):
    """
    Retourne les panneaux pour le mode flash (nom, image, signification, catégorie).
    Filtre par catégorie si précisé.
    """
    conn = get_db_connection()
    try:
        if categorie.lower() == "all":
            panneaux = conn.execute(
                "SELECT nom, image_path, signification, categorie FROM panneaux"
            ).fetchall()
        else:
            panneaux = conn.execute(
                """SELECT nom, image_path, signification, categorie
                   FROM panneaux WHERE categorie = ?""",
                (categorie.upper(),),
            ).fetchall()

        return [dict(p) for p in panneaux]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Certifications — As du Volant
# ---------------------------------------------------------------------------

import uuid as _uuid


def _generer_numero_cert() -> str:
    """Génère un identifiant unique de certification (ex: PERMIS-2026-A3F7B2)."""
    suffix = _uuid.uuid4().hex[:6].upper()
    from datetime import datetime
    year = datetime.now().year
    return f"PERMIS-{year}-{suffix}"


@app.get("/api/admin/certifications/eligibles", summary="Utilisateurs éligibles à la certification")
def admin_get_eligibles(
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Retourne les utilisateurs 'As du Volant' non encore certifiés."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        rows = conn.execute(
            """SELECT u.id, u.nom, u.prenom, u.email, u.niveau,
                      u.date_inscription,
                      COUNT(s.id) AS nb_quiz,
                      MAX(s.note_sur_20) AS meilleure_note,
                      ROUND(AVG(s.note_sur_20), 1) AS moyenne,
                      (SELECT COUNT(*) FROM certifications c WHERE c.utilisateur_id = u.id) AS deja_certifie
               FROM utilisateurs u
               LEFT JOIN sessions_quiz s ON s.utilisateur_id = u.id
               WHERE u.niveau = 'As du Volant'
               GROUP BY u.id
               ORDER BY u.date_inscription DESC"""
        ).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.post("/api/admin/certifications", summary="Émettre une certification As du Volant")
def admin_emettre_certification(
    cert: CertificationCreate,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Génère et enregistre une certification pour un utilisateur As du Volant."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        utilisateur = conn.execute(
            "SELECT id, nom, prenom, niveau FROM utilisateurs WHERE id = ?",
            (cert.utilisateur_id,),
        ).fetchone()
        if not utilisateur:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        if utilisateur["niveau"] != "As du Volant":
            raise HTTPException(
                status_code=400,
                detail="Cet utilisateur n'a pas encore atteint le niveau As du Volant.",
            )

        numero = _generer_numero_cert()
        message_final = cert.message or (
            f"Félicitations {utilisateur['prenom']} {utilisateur['nom']} ! "
            "Vous avez démontré une maîtrise exceptionnelle du code de la route "
            "et êtes désormais certifié As du Volant par PERMIS+."
        )

        cursor = conn.execute(
            """INSERT INTO certifications
               (utilisateur_id, admin_id, message, statut, numero_unique, nom_utilisateur, prenom_utilisateur)
               VALUES (?, ?, ?, 'certifie', ?, ?, ?)""",
            (
                cert.utilisateur_id,
                admin_id,
                message_final,
                numero,
                utilisateur["nom"],
                utilisateur["prenom"],
            ),
        )
        conn.commit()

        return {
            "id": cursor.lastrowid,
            "utilisateur_id": cert.utilisateur_id,
            "prenom": utilisateur["prenom"],
            "nom": utilisateur["nom"],
            "numero_unique": numero,
            "message": message_final,
            "statut": "certifie",
            "message_ok": f"Certification {numero} émise pour {utilisateur['prenom']} {utilisateur['nom']}.",
        }
    finally:
        conn.close()


@app.get("/api/admin/certifications", summary="Liste des certifications émises")
def admin_get_certifications(
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Retourne toutes les certifications émises."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        rows = conn.execute(
            """SELECT c.id, c.message, c.date_emission, c.statut, c.numero_unique,
                      u.id AS utilisateur_id, u.prenom, u.nom, u.niveau,
                      a.prenom AS admin_prenom, a.nom AS admin_nom
               FROM certifications c
               JOIN utilisateurs u ON c.utilisateur_id = u.id
               JOIN utilisateurs a ON c.admin_id = a.id
               ORDER BY c.date_emission DESC"""
        ).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.delete("/api/admin/certifications/{cert_id}", summary="Révoquer une certification")
def admin_revoquer_certification(
    cert_id: int,
    admin_id: int = Query(..., description="ID de l'administrateur"),
):
    """Supprime une certification émise."""
    conn = get_db_connection()
    try:
        verifier_admin(admin_id, conn)

        cert = conn.execute(
            "SELECT id FROM certifications WHERE id = ?", (cert_id,)
        ).fetchone()
        if not cert:
            raise HTTPException(status_code=404, detail="Certification introuvable.")

        conn.execute("DELETE FROM certifications WHERE id = ?", (cert_id,))
        conn.commit()
        return {"message": "Certification révoquée avec succès."}
    finally:
        conn.close()


@app.get("/api/certifications/{user_id}", summary="Certifications d'un utilisateur")
def get_certifications_utilisateur(user_id: int):
    """Retourne les certifications reçues par un utilisateur avec toutes les infos pour le certificat."""
    conn = get_db_connection()
    try:
        utilisateur = conn.execute(
            "SELECT id, nom, prenom, niveau FROM utilisateurs WHERE id = ?", (user_id,)
        ).fetchone()
        if not utilisateur:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

        rows = conn.execute(
            """SELECT c.id, c.message, c.date_emission, c.statut, c.numero_unique,
                      c.nom_utilisateur, c.prenom_utilisateur,
                      a.prenom AS admin_prenom, a.nom AS admin_nom
               FROM certifications c
               JOIN utilisateurs a ON c.admin_id = a.id
               WHERE c.utilisateur_id = ?
               ORDER BY c.date_emission DESC""",
            (user_id,),
        ).fetchall()

        result = []
        for r in rows:
            d = dict(r)
            # Fallback si colonnes vides (anciennes entrées)
            d["nom_utilisateur"] = d["nom_utilisateur"] or utilisateur["nom"]
            d["prenom_utilisateur"] = d["prenom_utilisateur"] or utilisateur["prenom"]
            d["niveau"] = utilisateur["niveau"]
            result.append(d)

        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Initialisation au démarrage du serveur
# ---------------------------------------------------------------------------


@app.on_event("startup")
def initialiser_base() -> None:
    """Crée les tables et peuple la base à chaque démarrage.

    Indispensable en déploiement (Render) : le système de fichiers du service
    est éphémère, la base SQLite est donc recréée et re-seedée à chaque
    (re)démarrage. Le seed est idempotent : il vérifie l'existence des
    données avant d'insérer, aucun doublon en local.
    """
    from .seed import seed

    init_db()
    seed()


# ---------------------------------------------------------------------------
# Service du frontend (monté APRÈS toutes les routes /api/...)
# ---------------------------------------------------------------------------

# Chemin absolu vers le dossier frontend, quelle que soit la racine d'exécution
FRONTEND_DIR = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
)

# Monté en dernier : les routes /api/... et /panneaux déclarées ci-dessus
# gardent la priorité ; tout le reste sert l'interface statique.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


# ---------------------------------------------------------------------------
# Point d'entrée (exécution directe)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    # Render (et la plupart des PaaS) exposent le port via la variable PORT
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port)
