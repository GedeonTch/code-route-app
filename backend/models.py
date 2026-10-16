"""
Schémas Pydantic v2 pour la validation des données de l'API PERMIS+.
"""

from pydantic import BaseModel


class UserRegister(BaseModel):
    nom: str
    prenom: str
    email: str
    mot_de_passe: str


class UserLogin(BaseModel):
    email: str
    mot_de_passe: str


class QuizSoumission(BaseModel):
    utilisateur_id: int
    questions: list[
        dict[str, object]
    ]  # [{question_id, reponse_donnee, temps_reponse_secondes}]
    duree_totale: int


class IndemandeIndice(BaseModel):
    panneau_id: int
    numero_indice: int  # 1 ou 2


class AdminUserCreate(BaseModel):
    nom: str
    prenom: str
    email: str
    mot_de_passe: str
    role: str = "apprenant"
    niveau: str = "Débutant"


class AdminUserUpdate(BaseModel):
    nom: str | None = None
    prenom: str | None = None
    email: str | None = None
    mot_de_passe: str | None = None
    role: str | None = None
    niveau: str | None = None


class AdminPanneauCreate(BaseModel):
    nom: str
    categorie: str
    signification: str
    image_path: str = ""
    description_longue: str | None = None


class AdminPanneauUpdate(BaseModel):
    nom: str | None = None
    categorie: str | None = None
    signification: str | None = None
    image_path: str | None = None
    description_longue: str | None = None


class CertificationCreate(BaseModel):
    utilisateur_id: int
    message: str | None = None
