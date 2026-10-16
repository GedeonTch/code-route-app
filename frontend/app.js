/* ============================================================
   PERMIS+ — app.js
   Application SPA Vanilla JS pour l'entraînement au code de la route
   ============================================================ */

// ─── CONSTANTES ET CONFIGURATION ─────────────────────────────────────────────

// Chemins relatifs : en production (Render) l'API et le frontend sont servis
// par le même service (même origine) ; en local uvicorn sert aussi les deux.
const API = "/api";
const PANNEAUX_URL = "/panneaux";

// Libellés lisibles côté interface pour les catégories backend.
const CATEGORY_LABELS = {
  danger: "Danger",
  interdiction: "Interdiction",
  obligation: "Obligation",
  information: "Information",
};

// ─── ÉTAT GLOBAL DE L'APPLICATION ────────────────────────────────────────────

const state = {
  user: null, // utilisateur connecté
  theme: "cockpit", // thème actuel (cockpit | aurora | ember | daylight)
  muted: false, // son coupé
  audioCtx: null, // contexte Web Audio API
  audioInitialized: false,
  currentView: "landing",

  // Quiz
  quizQuestions: [],
  currentQuestionIndex: 0,
  quizNbQuestions: 10,
  quizCategorie: "all",
  quizReponses: [], // [{question_id, reponse_donnee, temps_reponse_secondes, est_correcte}]
  quizStartTime: null,
  questionStartTime: null,
  timerInterval: null,
  timerSecondes: 30,
  indiceCount: 0, // 0, 1 ou 2 indices utilisés pour la question courante
  quizAbort: null, // timeout ID du délai entre questions (annulable)

  // Flash
  flashPanneaux: [],
  flashIndex: 0,
  flashTimer: null,
  flashPaused: false,

  // Résultats
  lastSessionId: null,
  lastQuizData: null, // questions avec bonnes/mauvaises réponses

  // Catalogue (pour le filtrage local)
  allPanneaux: [],

  // Three.js
  landingScene: null,
  landingCamera: null,
  landingRenderer: null,
  landingAnimId: null,

  // Administration
  adminSection: "dashboard",
  adminDashboard: null,
  adminUsers: [],
  adminPanneaux: [],
  adminUserSearch: "",
  adminPanneauSearch: "",
  adminPanneauFilter: "all",
};

// ─── GESTION DES VUES ────────────────────────────────────────────────────────

/**
 * Affiche une vue et cache toutes les autres, avec une transition fade de 0.25s.
 * @param {string} viewId - Identifiant de la vue (ex: 'dashboard', 'quiz')
 */
function showView(viewId) {
  // Protéger la vue admin contre les accès non autorisés.
  if (viewId === "admin" && !isAdminUser()) {
    showToast("Accès administration refusé.", "error");
    viewId = "dashboard";
  }

  // 1. Cacher toutes les views
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.add("hidden");
    v.classList.remove("active");
  });

  // 2. Attendre un tick pour que le DOM applique le masquage
  requestAnimationFrame(() => {
    const target = document.getElementById(`view-${viewId}`);
    if (!target) return;

    target.classList.remove("hidden");
    // 3. Léger délai pour déclencher la transition CSS
    setTimeout(() => target.classList.add("active"), 25);

    // 4. Mettre à jour les liens nav actifs
    document.querySelectorAll("[data-view]").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === viewId);
    });

    // 5. Mettre à jour l'état courant
    state.currentView = viewId;

    // 6. Gérer la visibilité de la navbar
    if (viewId === "landing") {
      hideNavbar();
    } else {
      showNavbar();
    }
  });
}

// ─── WEB AUDIO API ───────────────────────────────────────────────────────────

/** Initialise le contexte audio (à appeler sur le premier geste utilisateur). */
function initAudio() {
  if (state.audioCtx) return;
  state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.audioInitialized = true;
}

/**
 * Crée et joue une note synthétique.
 * @param {number} freq       - Fréquence principale (Hz)
 * @param {number} duration   - Durée en millisecondes
 * @param {string} type       - Type d'oscillateur ('sine' | 'triangle' | 'sawtooth' | 'square')
 * @param {number} volume     - Volume de départ (0–1)
 * @param {number|null} startFreq - Fréquence initiale pour le glissando
 * @param {number|null} endFreq   - Fréquence finale pour le glissando
 */
function playNote(
  freq,
  duration,
  type = "sine",
  volume = 0.3,
  startFreq = null,
  endFreq = null,
) {
  if (state.muted || !state.audioCtx) return;
  const osc = state.audioCtx.createOscillator();
  const gain = state.audioCtx.createGain();
  osc.connect(gain);
  gain.connect(state.audioCtx.destination);
  osc.type = type;
  osc.frequency.value = freq;

  // Glissando optionnel (transition de fréquence)
  if (startFreq !== null && endFreq !== null) {
    osc.frequency.setValueAtTime(startFreq, state.audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(
      endFreq,
      state.audioCtx.currentTime + duration / 1000,
    );
  }

  gain.gain.setValueAtTime(volume, state.audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    state.audioCtx.currentTime + duration / 1000,
  );
  osc.start();
  osc.stop(state.audioCtx.currentTime + duration / 1000);
}

/** Clic bouton — note courte et légère. */
function playClick() {
  if (state.muted || !state.audioCtx) return;
  playNote(800, 100, "sine", 0.1);
}

/** Bonne réponse — deux notes ascendantes en triangle avec fondu. */
function playCorrect() {
  if (state.muted || !state.audioCtx) return;
  // Première note : Do5 (523 Hz), 300 ms
  playNote(523, 300, "triangle", 0.25);
  // Deuxième note : Mi5 (659 Hz), 300 ms, décalée de 250 ms
  setTimeout(() => playNote(659, 300, "triangle", 0.2), 250);
}

/** Mauvaise réponse — note qui descend en dent de scie. */
function playWrong() {
  if (state.muted || !state.audioCtx) return;
  playNote(300, 400, "sawtooth", 0.18, 300, 150);
}

/** Fin de quiz réussi (≥ 14/20) — fanfare de 4 notes ascendantes. */
function playSuccess() {
  if (state.muted || !state.audioCtx) return;
  const notes = [523, 587, 659, 784];
  notes.forEach((freq, i) => {
    setTimeout(() => playNote(freq, 250, "triangle", 0.2), i * 180);
  });
}

/** Fin de quiz échoué (< 10/20) — note basse qui tombe. */
function playFailure() {
  if (state.muted || !state.audioCtx) return;
  playNote(220, 800, "sine", 0.2, 220, 110);
}

/** Son de succès d'une action admin. */
function playAdminSuccess() {
  if (state.muted || !state.audioCtx) return;
  playNote(440, 200, "triangle", 0.18, 440, 880);
}

/** Son de confirmation d'une suppression admin. */
function playAdminDelete() {
  if (state.muted || !state.audioCtx) return;
  playNote(300, 350, "sawtooth", 0.14, 300, 100);
}

/**
 * Tick du timer (5 dernières secondes) — fréquence montante à chaque tick.
 * @param {number} secondeRestante - Secondes restantes (5 à 1)
 */
function playTick(secondeRestante) {
  if (state.muted || !state.audioCtx) return;
  const freq = 400 + (5 - secondeRestante) * 80;
  playNote(freq, 80, "square", 0.08);
}

// ─── THREE.JS — SCÈNE 1 : LANDING (PANNEAU STOP) ─────────────────────────────

/** Initialise la scène Three.js du panneau STOP en rotation sur la landing page. */
function initLandingScene() {
  const canvas = document.getElementById("canvas-landing");
  if (!canvas || !window.THREE) return;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 8, 20);

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  // Groupe principal pour mieux cadrer le panneau et son support.
  const stopGroup = new THREE.Group();
  scene.add(stopGroup);

  // Forme octogonale du panneau STOP.
  const shape = new THREE.Shape();
  const n = 8;
  const r = 1.55;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 8;
    if (i === 0) shape.moveTo(r * Math.cos(angle), r * Math.sin(angle));
    else shape.lineTo(r * Math.cos(angle), r * Math.sin(angle));
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSize: 0.03,
    bevelThickness: 0.03,
    bevelSegments: 2,
  });

  // Matériaux du panneau : rouge premium + léger vernis métallique.
  const faceMaterial = new THREE.MeshPhongMaterial({
    color: 0xd3161d,
    emissive: 0x420204,
    shininess: 130,
    specular: 0x777777,
  });
  const edgeMaterial = new THREE.MeshPhongMaterial({
    color: 0x9e0f14,
    shininess: 90,
    specular: 0x666666,
  });
  // ExtrudeGeometry attend le matériau des faces en premier, puis celui des côtés.
  const stopSign = new THREE.Mesh(geometry, [faceMaterial, edgeMaterial]);
  stopSign.castShadow = false;
  stopGroup.add(stopSign);

  // Sprite texte STOP, bien centré et toujours lisible sur la face avant.
  const stopTextCanvas = document.createElement("canvas");
  stopTextCanvas.width = 1200;
  stopTextCanvas.height = 420;
  const textCtx = stopTextCanvas.getContext("2d");
  if (textCtx) {
    textCtx.clearRect(0, 0, stopTextCanvas.width, stopTextCanvas.height);
    textCtx.fillStyle = "#ffffff";
    textCtx.font = "900 230px Arial Black, Arial, sans-serif";
    textCtx.textAlign = "center";
    textCtx.textBaseline = "middle";
    textCtx.lineWidth = 10;
    textCtx.strokeStyle = "rgba(255,255,255,0.18)";
    textCtx.shadowColor = "rgba(255,255,255,0.14)";
    textCtx.shadowBlur = 18;
    textCtx.strokeText("STOP", 600, 215);
    textCtx.fillText("STOP", 600, 215);
  }

  const stopTextTexture = new THREE.CanvasTexture(stopTextCanvas);
  stopTextTexture.needsUpdate = true;
  const stopTextMaterial = new THREE.SpriteMaterial({
    map: stopTextTexture,
    transparent: true,
    depthWrite: false,
  });
  const stopFrontLabel = new THREE.Sprite(stopTextMaterial);
  stopFrontLabel.position.set(0, 0.08, 0.24);
  stopFrontLabel.scale.set(2.05, 0.72, 1);
  stopGroup.add(stopFrontLabel);

  // Support métallique du panneau.
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 3.5, 24),
    new THREE.MeshPhongMaterial({
      color: 0x9aa6b2,
      shininess: 80,
      specular: 0xdddddd,
    }),
  );
  pole.position.set(0, -2.4, -0.05);
  stopGroup.add(pole);

  // Socle discret pour ancrer visuellement l'objet 3D.
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.55, 0.18, 32),
    new THREE.MeshPhongMaterial({ color: 0x243447, shininess: 18 }),
  );
  base.position.set(0, -4.1, -0.15);
  stopGroup.add(base);

  // Halo lumineux derrière le panneau pour mieux le détacher de l'arrière-plan.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 2.45, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffd27d,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  halo.position.set(0, 0, -0.08);
  stopGroup.add(halo);

  const glow = new THREE.PointLight(0xffb347, 2.6, 18, 2);
  glow.position.set(-0.3, 0.6, 2.4);
  scene.add(glow);

  const ambient = new THREE.AmbientLight(0x7a8ba3, 0.75);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(3, 4, 6);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x7fb4ff, 1.15);
  rimLight.position.set(-4, 1, 2);
  scene.add(rimLight);

  // Légère route de fond pour renforcer l'évocation du code de la route.
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 18),
    new THREE.MeshBasicMaterial({
      color: 0x111821,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  road.rotation.x = -Math.PI / 2.35;
  road.position.set(0.2, -4.25, -1.5);
  scene.add(road);

  camera.position.set(0.1, 0.2, 8.4);
  stopGroup.position.set(window.innerWidth > 960 ? 4.6 : 0, 0.3, 0);
  stopGroup.rotation.x = -0.02;
  // Oriente la face STOP vers la caméra dès le départ.
  stopGroup.rotation.y = -0.16;

  state.landingScene = scene;
  state.landingCamera = camera;
  state.landingRenderer = renderer;

  function animate() {
    const t = performance.now() * 0.001;
    state.landingAnimId = requestAnimationFrame(animate);
    // Oscillation courte gauche/droite : la face STOP reste toujours visible.
    stopGroup.rotation.y = -0.16 + Math.sin(t * 0.9) * 0.18;
    stopGroup.rotation.z = Math.sin(t * 0.52) * 0.018;
    stopGroup.position.y = 0.25 + Math.sin(t * 1.2) * 0.08;
    halo.material.opacity = 0.2 + Math.sin(t * 1.4) * 0.04;
    glow.intensity = 2.55 + Math.sin(t * 1.8) * 0.28;
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    stopGroup.position.x = window.innerWidth > 960 ? 4.6 : 0;
  });
}

// ─── THREE.JS — SCÈNE 2 : PARTICULES (BONNE RÉPONSE) ─────────────────────────

/** Affiche une pluie de particules vertes lors d'une bonne réponse. */
function showCorrectParticles() {
  const canvas = document.getElementById("canvas-particles");
  if (!canvas || !window.THREE) return;
  canvas.style.display = "block";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100,
  );
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setClearColor(0x000000, 0);
  camera.position.z = 5;

  // Création de 40 sphères vertes avec vélocité aléatoire
  const particles = [];
  for (let i = 0; i < 40; i++) {
    const geom = new THREE.SphereGeometry(0.05, 4, 4);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00dfa2,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set((Math.random() - 0.5) * 6, -3, 0);
    const vx = (Math.random() - 0.5) * 0.05;
    const vy = 0.04 + Math.random() * 0.06;
    particles.push({ mesh, vx, vy, life: 1.0 });
    scene.add(mesh);
  }

  const startTime = Date.now();
  function animateParticles() {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 1.5) {
      renderer.dispose();
      canvas.style.display = "none";
      return;
    }
    requestAnimationFrame(animateParticles);
    particles.forEach((p) => {
      p.mesh.position.x += p.vx;
      p.mesh.position.y += p.vy;
      p.mesh.position.y -= 0.005; // légère gravité
      p.life -= 0.01;
      p.mesh.material.opacity = Math.max(0, p.life);
    });
    renderer.render(scene, camera);
  }
  animateParticles();
}

// ─── THREE.JS — SCÈNE 3 : CONFETTI (RÉSULTATS ≥ 14/20) ──────────────────────

/** Affiche des confettis 3D colorés en cas de réussite au quiz. */
function showConfetti() {
  const canvas = document.getElementById("canvas-confetti");
  if (!canvas || !window.THREE) return;
  canvas.style.display = "block";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  camera.position.z = 5;

  // Palette de couleurs des confettis
  const colors = [0xe8a020, 0x1a6ebb, 0x00dfa2, 0xff4d6d, 0xf77f00];
  const confettis = [];

  for (let i = 0; i < 60; i++) {
    const geom = new THREE.PlaneGeometry(0.15, 0.15);
    const mat = new THREE.MeshBasicMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(
      (Math.random() - 0.5) * 10,
      5 + Math.random() * 3,
      (Math.random() - 0.5) * 3,
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );
    confettis.push({
      mesh,
      vy: -(0.03 + Math.random() * 0.04),
      vrot: (Math.random() - 0.5) * 0.1,
    });
    scene.add(mesh);
  }

  const startTime = Date.now();
  function animateConfetti() {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed > 4) {
      renderer.dispose();
      canvas.style.display = "none";
      return;
    }
    requestAnimationFrame(animateConfetti);
    confettis.forEach((c) => {
      c.mesh.position.y += c.vy;
      c.mesh.rotation.z += c.vrot;
      // Fade out progressif sur la dernière seconde
      if (elapsed > 3) c.mesh.material.opacity = Math.max(0, 1 - (elapsed - 3));
    });
    renderer.render(scene, camera);
  }
  animateConfetti();
}

// ─── AUTHENTIFICATION ─────────────────────────────────────────────────────────

/**
 * Connecte un utilisateur via l'API.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function login(email, password) {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, mot_de_passe: password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Erreur de connexion");

    state.user = normalizeUserSession(data);
    localStorage.setItem("permis_user", JSON.stringify(state.user));
    showNavbar();
    updateUserChrome();
    if (isAdminUser()) {
      showView("admin");
      loadAdminView("dashboard");
    } else {
      showView("dashboard");
      loadDashboard();
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Inscrit un nouvel utilisateur puis le connecte automatiquement.
 * @param {string} nom
 * @param {string} prenom
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function register(nom, prenom, email, password) {
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom, prenom, email, mot_de_passe: password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Erreur d'inscription");
    // Auto-login après une inscription réussie
    return await login(email, password);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Déconnecte l'utilisateur et revient à la landing page. */
function logout() {
  state.user = null;
  state.adminDashboard = null;
  state.adminUsers = [];
  state.adminPanneaux = [];
  localStorage.removeItem("permis_user");
  updateUserChrome();
  hideNavbar();
  showView("landing");
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

/** Charge et affiche le tableau de bord de l'utilisateur connecté. */
async function loadDashboard() {
  // Salutation selon l'heure du jour
  const h = new Date().getHours();
  const greeting = h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  document.getElementById("greetingText").innerHTML =
    `${greeting}, <span id="greetingName">${state.user.prenom}</span>`;

  // Date du jour en français
  const now = new Date();
  document.getElementById("dateDisplay").textContent = now.toLocaleDateString(
    "fr-FR",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  );

  // Récupérer les statistiques depuis l'API
  try {
    const stats = await apiGet(`/stats/${state.user.id}`);

    // Animer les chiffres des stats
    animateNumber("statQuizFaits", 0, stats.nb_quiz, 800);
    animateNumber(
      "statMeilleurScore",
      0,
      Math.round((stats.meilleur_score / 20) * 100),
      800,
      "%",
    );
    animateNumber(
      "statMoyenne",
      0,
      Math.round((stats.moyenne / 20) * 100),
      800,
      "%",
    );

    // Barres de progression (avec léger délai pour l'effet visuel)
    setTimeout(() => {
      document.getElementById("barQuiz").style.width =
        Math.min(100, stats.nb_quiz * 10) + "%";
      document.getElementById("barMeilleur").style.width =
        (stats.meilleur_score / 20) * 100 + "%";
      document.getElementById("barMoyenne").style.width =
        (stats.moyenne / 20) * 100 + "%";
    }, 100);

    // Graphique de progression
    if (stats.historique_scores && stats.historique_scores.length > 0) {
      document.getElementById("chartEmpty").style.display = "none";
      drawProgressChart(stats.historique_scores);
    }

    // Badge de niveau
    document.getElementById("dashNiveauNom").textContent = stats.niveau;
    document.getElementById("dashNiveauIcon").textContent = getNiveauEmoji(
      stats.niveau,
    );

    // Mettre à jour le niveau dans l'état et localStorage
    state.user.niveau = stats.niveau;
    localStorage.setItem("permis_user", JSON.stringify(state.user));
  } catch (e) {
    console.warn("Stats non disponibles :", e.message);
  }
}

/**
 * Dessine le graphique de progression des scores sur un canvas 2D.
 * @param {number[]} scores - Tableau de scores sur 20
 */
function drawProgressChart(scores) {
  const canvas = document.getElementById("progressChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.offsetWidth;
  const h = 120;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);

  const max = 20;
  const padding = 20;
  const stepX = (w - padding * 2) / Math.max(scores.length - 1, 1);

  // Grille horizontale légère
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (h - padding * 2) * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();
  }

  // Couleur depuis la variable CSS du thème courant
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue("--accent-primary").trim() || "#E8A020";

  // Ligne de courbe principale
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  scores.forEach((score, i) => {
    const x = padding + i * stepX;
    const y = padding + (h - padding * 2) * (1 - score / max);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Aire sous la courbe avec transparence
  ctx.beginPath();
  scores.forEach((score, i) => {
    const x = padding + i * stepX;
    const y = padding + (h - padding * 2) * (1 - score / max);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(padding + (scores.length - 1) * stepX, h - padding);
  ctx.lineTo(padding, h - padding);
  ctx.closePath();
  // Convertir la couleur en rgba pour la transparence
  ctx.fillStyle =
    color.replace(")", ", 0.1)").replace("rgb", "rgba") ||
    "rgba(232, 160, 32, 0.1)";
  ctx.fill();

  // Points de données
  scores.forEach((score, i) => {
    const x = padding + i * stepX;
    const y = padding + (h - padding * 2) * (1 - score / max);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
}

// ─── QUIZ ─────────────────────────────────────────────────────────────────────

/** Génère et lance un quiz avec la configuration actuelle. */
async function startQuiz() {
  const nb = state.quizNbQuestions;
  const cat = state.quizCategorie;

  try {
    const questions = await apiGet(`/quiz/generer?nb=${nb}&categorie=${cat}`);
    if (!questions || questions.length === 0) {
      showToast("Aucune question disponible pour cette catégorie", "error");
      return;
    }

    // Réinitialiser l'état du quiz
    state.quizQuestions = questions;
    state.currentQuestionIndex = 0;
    state.quizReponses = [];
    state.quizStartTime = Date.now();

    showView("quiz");
    renderQuestion();
  } catch (e) {
    showToast("Erreur lors de la génération du quiz", "error");
  }
}

/** Affiche la question courante dans l'interface. */
function renderQuestion() {
  const q = state.quizQuestions[state.currentQuestionIndex];
  if (!q) {
    submitQuiz();
    return;
  }

  state.indiceCount = 0;
  state.questionStartTime = Date.now();

  // ── Normalisation : l'API peut renvoyer la catégorie en MAJUSCULES ──
  const catLower = normalizeCategory(q.categorie);
  const imagePath = q.image_path || "";

  // ── Image du panneau ──
  const img = document.getElementById("quizPanneauImg");
  const svgPlaceholder = document.getElementById("quizPanneauSvg");
  img.style.display = "block";
  svgPlaceholder.style.display = "none";
  img.src = `${PANNEAUX_URL}/${imagePath.split("/").pop()}`;
  img.onerror = () => {
    img.style.display = "none";
    svgPlaceholder.style.display = "flex";
    svgPlaceholder.className = `panneau-placeholder ${catLower}`;
  };

  // ── Badge catégorie ──
  const badge = document.getElementById("quizCategorieBadge");
  badge.textContent = getCategoryLabel(catLower);
  badge.className = `cat-badge cat-${catLower}`;

  // ── Cadre coloré selon catégorie ──
  document.getElementById("quizPanneauFrame").className =
    `panneau-frame cat-${catLower}-frame`;

  // ── Texte de la question et des choix ──
  document.getElementById("questionText").textContent = q.enonce;
  document.getElementById("answerA").textContent = q.choix_a;
  document.getElementById("answerB").textContent = q.choix_b;
  document.getElementById("answerC").textContent = q.choix_c;
  document.getElementById("answerD").textContent = q.choix_d;

  // ── Réinitialiser les boutons réponses ──
  document.querySelectorAll(".answer-btn").forEach((btn) => {
    btn.className = "answer-btn";
    btn.disabled = false;
  });

  // ── Réinitialiser la bulle ROADY ──
  document.getElementById("roadyBubble").classList.add("hidden");
  const indiceBtn = document.getElementById("indiceBtn");
  indiceBtn.disabled = false;
  indiceBtn.textContent = "";
  // Reconstruire le contenu du bouton indice
  indiceBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
    </svg>
    Indice ROADY
  `;

  // ── Compteur de question ──
  document.getElementById("questionCounter").textContent =
    `Question ${state.currentQuestionIndex + 1} / ${state.quizQuestions.length}`;

  // ── Points de progression ──
  renderQuestionDots();

  // ── Timer ──
  startTimer(q);
}

/** Affiche les points de progression du quiz (correct/incorrect/futur). */
function renderQuestionDots() {
  const dots = document.getElementById("questionDots");
  dots.innerHTML = "";
  state.quizQuestions.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = "question-dot";
    if (i < state.currentQuestionIndex) {
      // Question déjà répondue — couleur selon résultat.
      const rep = state.quizReponses[i];
      dot.classList.add(rep && rep.est_correcte ? "correct" : "incorrect");
    } else if (i === state.currentQuestionIndex) {
      dot.classList.add("current");
    } else {
      dot.classList.add("future");
    }
    dots.appendChild(dot);
  });
}

/**
 * Démarre le timer de 30 secondes pour la question courante.
 * @param {Object} question - L'objet question courant
 */
function startTimer(question) {
  clearInterval(state.timerInterval);
  const timerSec = 30;
  let remaining = timerSec;

  const timerBar = document.getElementById("timerBar");
  timerBar.style.width = "100%";
  timerBar.style.background = "var(--accent-primary)";
  timerBar.classList.remove("timer-shake");

  state.timerInterval = setInterval(() => {
    remaining--;
    const pct = (remaining / timerSec) * 100;
    timerBar.style.width = pct + "%";

    // Changement de couleur progressif selon l'urgence
    if (remaining <= 5) {
      timerBar.style.background = "#E53E3E";
      timerBar.classList.add("timer-shake");
      playTick(remaining);
    } else if (remaining <= 10) {
      timerBar.style.background = "#F77F00";
    } else {
      timerBar.style.background = "var(--accent-primary)";
    }

    // Temps écoulé — soumettre une réponse nulle
    if (remaining <= 0) {
      clearInterval(state.timerInterval);
      handleAnswer(null, question);
    }
  }, 1000);
}

/**
 * Gère la sélection d'une réponse (ou l'absence de réponse si temps écoulé).
 * @param {string|null} choix    - Lettre du choix ('A','B','C','D') ou null
 * @param {Object}      question - L'objet question courant
 */
function handleAnswer(choix, question) {
  clearInterval(state.timerInterval);

  const tempsReponse = Math.round(
    (Date.now() - state.questionStartTime) / 1000,
  );
  const q = question || state.quizQuestions[state.currentQuestionIndex];
  const estCorrecte = choix !== null && choix === q.bonne_reponse;

  // Enregistrer la réponse (null si timer expiré → chaîne vide pour éviter crash backend)
  state.quizReponses.push({
    question_id: q.id,
    reponse_donnee: choix ?? "",
    temps_reponse_secondes: tempsReponse,
    est_correcte: estCorrecte ? 1 : 0,
  });

  // ── Feedback visuel sur les boutons ──
  document.querySelectorAll(".answer-btn").forEach((btn) => {
    btn.disabled = true;
    const btnChoice = btn.dataset.choice;
    if (btnChoice === q.bonne_reponse) {
      btn.classList.add("answer-correct", "correct");
    } else if (btnChoice === choix && !estCorrecte) {
      btn.classList.add("answer-wrong", "incorrect");
    }
  });

  // ── Feedback sonore et visuel ──
  if (estCorrecte) {
    playCorrect();
    showCorrectParticles();
  } else {
    playWrong();
  }

  // Passer à la question suivante après 1.2 secondes
  state.quizAbort = setTimeout(() => {
    state.quizAbort = null;
    state.currentQuestionIndex++;
    if (state.currentQuestionIndex < state.quizQuestions.length) {
      renderQuestion();
    } else {
      submitQuiz();
    }
  }, 1200);
}

/** Envoie les réponses du quiz à l'API et affiche les résultats. */
async function submitQuiz() {
  const duree = Math.round((Date.now() - state.quizStartTime) / 1000);

  try {
    const result = await apiFetch("/quiz/soumettre", {
      method: "POST",
      body: JSON.stringify({
        utilisateur_id: state.user.id,
        questions: state.quizReponses,
        duree_totale: duree,
      }),
    });

    state.lastSessionId = result.session_id;
    state.lastQuizData = {
      questions: state.quizQuestions,
      reponses: state.quizReponses,
      ...result,
    };

    showView("resultats");
    displayResults(result, duree);
  } catch (e) {
    console.error("Erreur soumission quiz:", e);
    showToast(`Erreur : ${e.message}`, "error");
  }
}

/**
 * Affiche la page de résultats avec animation de la note.
 * @param {Object} result - Réponse de l'API
 * @param {number} duree  - Durée totale en secondes
 */
function displayResults(result, duree) {
  const note = result.note_sur_20;
  const el = document.getElementById("resultScore");
  el.textContent = "0";

  // Animation progressive de la note
  let current = 0;
  const target = note;
  const step = target / 60;
  const interval = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = current.toFixed(1);
    if (current >= target) {
      clearInterval(interval);
      el.textContent = target.toFixed(1);
      // Sons et effets spéciaux après l'animation
      if (note >= 14) {
        playSuccess();
        showConfetti();
      } else if (note < 10) {
        playFailure();
      }
    }
  }, 25);

  // Classe CSS de couleur de la note
  el.className =
    "results-score-big " +
    (note >= 14 ? "score-green" : note >= 10 ? "score-orange" : "score-red");

  // Mention selon la note
  let mention;
  if (note >= 18) mention = "🏆 Excellent";
  else if (note >= 14) mention = "✅ Bien";
  else if (note >= 10) mention = "⚠️ Passable";
  else mention = "❌ Insuffisant";
  document.getElementById("resultMention").textContent = mention;

  // Détails
  document.getElementById("resultBonnes").textContent =
    `${result.score} / ${result.total_questions}`;
  document.getElementById("resultDuree").textContent = formatDuree(duree);

  // Construire la liste des corrections
  buildCorrections();
}

/** Construit la liste de corrections question par question. */
function buildCorrections() {
  const list = document.getElementById("correctionsList");
  list.innerHTML = "";

  const { questions, reponses } = state.lastQuizData;
  questions.forEach((q, i) => {
    const rep = reponses[i];
    const correct = rep && rep.est_correcte;
    const div = document.createElement("div");
    div.className = `correction-item ${correct ? "correction-ok" : "correction-ko"}`;
    div.innerHTML = `
      <div class="correction-header">
        <span class="correction-icon">${correct ? "✓" : "✗"}</span>
        <span class="correction-question">${q.enonce}</span>
      </div>
      <div class="correction-body">
        <div class="correction-line">
          <span class="correction-label">Votre réponse :</span>
          <span>${rep ? getChoixText(q, rep.reponse_donnee) : "Pas de réponse"}</span>
        </div>
        <div class="correction-line">
          <span class="correction-label">Bonne réponse :</span>
          <span class="correction-good">${getChoixText(q, q.bonne_reponse)}</span>
        </div>
      </div>
    `;
    list.appendChild(div);
  });
}

/**
 * Retourne le texte d'un choix de réponse pour une question donnée.
 * @param {Object} question - Objet question
 * @param {string} choix    - Lettre du choix ('A','B','C','D')
 * @returns {string}
 */
function getChoixText(question, choix) {
  const map = {
    A: question.choix_a,
    B: question.choix_b,
    C: question.choix_c,
    D: question.choix_d,
  };
  return map[choix] || "—";
}

// ─── CATALOGUE ────────────────────────────────────────────────────────────────

/** Charge et affiche le catalogue complet des panneaux. */
async function loadCatalogue() {
  try {
    const panneaux = await apiGet("/catalogue");
    state.allPanneaux = (panneaux || []).map(normalizePanneauData);
    renderCatalogue(state.allPanneaux);
  } catch (e) {
    showToast("Impossible de charger le catalogue", "error");
  }
}

/**
 * Injecte les cartes panneaux dans la grille du catalogue.
 * @param {Object[]} panneaux - Liste des panneaux à afficher
 */
function renderCatalogue(panneaux) {
  const grid = document.getElementById("panneauxGrid");
  grid.innerHTML = "";

  panneaux.forEach((rawPanneau) => {
    const p = normalizePanneauData(rawPanneau);
    const card = document.createElement("div");
    card.className = "panneau-card";
    card.innerHTML = `
      <div class="panneau-card-img">
        <img src="${PANNEAUX_URL}/${(p.image_path || "").split("/").pop()}" alt="${escapeHtml(p.nom)}"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="panneau-placeholder ${p.categorie}" style="display:none; width:100%; height:100%"></div>
      </div>
      <div class="panneau-card-info">
        <span class="cat-badge cat-${p.categorie}">${p.categorieLabel}</span>
        <h4 class="panneau-card-name">${escapeHtml(p.nom)}</h4>
        <p class="panneau-card-sig">${escapeHtml(p.signification || "")}</p>
      </div>
      <div class="panneau-overlay">
        <p>${escapeHtml(p.description_longue || p.signification || "")}</p>
      </div>
    `;
    card.addEventListener("click", () => openPanneauModal(p));
    grid.appendChild(card);
  });

  if (panneaux.length === 0) {
    grid.innerHTML =
      '<div class="admin-empty">Aucun panneau ne correspond à vos filtres.</div>';
  }
}

/**
 * Filtre les panneaux du catalogue selon la recherche textuelle et la catégorie.
 * @param {string} query     - Texte de recherche (minuscules)
 * @param {string} categorie - Catégorie sélectionnée ('all' ou nom de catégorie)
 */
function filterCatalogue(query, categorie) {
  if (!state.allPanneaux) return;

  const normalizedQuery = (query || "").trim().toLowerCase();
  const normalizedCategorie =
    categorie === "all" ? "all" : normalizeCategory(categorie);

  let filtered = [...state.allPanneaux];
  if (normalizedCategorie !== "all") {
    filtered = filtered.filter(
      (p) => normalizeCategory(p.categorie) === normalizedCategorie,
    );
  }

  if (normalizedQuery) {
    filtered = filtered.filter((p) => {
      const haystack = [
        p.nom,
        p.signification,
        p.description_longue,
        p.categorieLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  renderCatalogue(filtered);
}

/**
 * Ouvre la modale de détail d'un panneau.
 * @param {Object} p - Objet panneau
 */
function openPanneauModal(rawPanneau) {
  const p = normalizePanneauData(rawPanneau);
  const overlay = document.getElementById("modalOverlay");
  const img = document.getElementById("modalImg");

  img.style.display = "block";
  document.getElementById("modalSvgPlaceholder").style.display = "none";
  img.src = `${PANNEAUX_URL}/${(p.image_path || "").split("/").pop()}`;
  img.onerror = () => {
    img.style.display = "none";
    const svgP = document.getElementById("modalSvgPlaceholder");
    svgP.style.display = "flex";
    svgP.className = `panneau-placeholder ${p.categorie}`;
  };

  document.getElementById("modalCategorie").textContent = p.categorieLabel;
  document.getElementById("modalCategorie").className =
    `cat-badge cat-${p.categorie}`;
  document.getElementById("modalNom").textContent = p.nom;
  document.getElementById("modalSignification").textContent = p.signification;
  document.getElementById("modalDescription").textContent =
    p.description_longue || "";

  // Bouton "Tester ce panneau" — lance un quiz filtré sur cette catégorie.
  document.getElementById("modalTestBtn").onclick = () => {
    closeModal();
    setQuizCategory(p.categorie);
    setQuizQuestionCount(5);
    showView("quiz-config");
    showToast(
      `Catégorie "${p.categorieLabel}" sélectionnée pour le quiz`,
      "info",
    );
  };

  overlay.classList.remove("hidden");
}

/** Ferme la modale catalogue. */
function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
}

// ─── HISTORIQUE ───────────────────────────────────────────────────────────────

/** Charge et affiche l'historique des sessions de l'utilisateur. */
async function loadHistorique() {
  try {
    const sessions = await apiGet(`/quiz/historique/${state.user.id}`);
    renderHistorique(sessions);

    // Résumé statistique si des sessions existent
    if (sessions.length > 0) {
      const meilleure = Math.max(...sessions.map((s) => s.note_sur_20));
      const total = sessions.length;
      const moyenne = sessions.reduce((a, s) => a + s.note_sur_20, 0) / total;
      document.getElementById("historiqueSummary").innerHTML = `
        <div class="histo-stat"><span class="histo-number">${total}</span><span>Sessions</span></div>
        <div class="histo-stat"><span class="histo-number">${meilleure.toFixed(1)}</span><span>Meilleure note</span></div>
        <div class="histo-stat"><span class="histo-number">${moyenne.toFixed(1)}</span><span>Moyenne</span></div>
      `;
    }
  } catch (e) {
    showToast("Impossible de charger l'historique", "error");
  }
}

/**
 * Injecte les lignes de l'historique dans le tableau.
 * @param {Object[]} sessions - Liste des sessions
 */
function renderHistorique(sessions) {
  const body = document.getElementById("tableBody");
  body.innerHTML = "";

  if (sessions.length === 0) {
    body.innerHTML =
      '<div class="table-empty">Aucune session pour le moment. Lancez votre premier quiz !</div>';
    return;
  }

  sessions.forEach((s) => {
    const row = document.createElement("div");
    row.className = "table-row";
    const noteCls =
      s.note_sur_20 >= 14
        ? "score-green"
        : s.note_sur_20 >= 10
          ? "score-orange"
          : "score-red";
    row.innerHTML = `
      <span>${new Date(s.date_session).toLocaleDateString("fr-FR")}</span>
      <span>${s.total_questions}</span>
      <span>${Math.round((s.score / s.total_questions) * 100)}%</span>
      <span class="${noteCls}">${s.note_sur_20.toFixed(1)}/20</span>
      <span>${formatDuree(s.duree_secondes)}</span>
    `;
    row.addEventListener("click", () => loadSessionDetail(s.id));
    body.appendChild(row);
  });
}

/**
 * Charge et affiche le détail d'une session d'historique.
 * @param {number} sessionId - Identifiant de la session
 */
async function loadSessionDetail(sessionId) {
  try {
    const detail = await apiGet(`/quiz/session/${sessionId}`);
    const container = document.getElementById("sessionDetail");
    container.classList.remove("hidden");
    container.innerHTML = `
      <div class="session-detail-card">
        <h3>Détail de la session</h3>
        <div class="session-corrections">
          ${detail.reponses
            .map(
              (r) => `
            <div class="correction-item ${r.est_correcte ? "correction-ok" : "correction-ko"}">
              <span class="correction-icon">${r.est_correcte ? "✓" : "✗"}</span>
              <span>${r.question_enonce || "Question"}</span>
              <span class="correction-good">${r.bonne_reponse_texte || ""}</span>
            </div>
          `,
            )
            .join("")}
        </div>
        <button class="btn-secondary" onclick="document.getElementById('sessionDetail').classList.add('hidden')">Fermer</button>
      </div>
    `;
    container.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    showToast("Impossible de charger le détail", "error");
  }
}

// ─── MODE FLASH (RÉVISION) ────────────────────────────────────────────────────

/** Charge les panneaux pour le mode révision flash et démarre l'animation. */
async function startFlash() {
  const cat = state.quizCategorie;
  try {
    const panneaux = await apiGet(`/revision?categorie=${cat}`);
    state.flashPanneaux = panneaux;
    state.flashIndex = 0;
    state.flashPaused = false;

    showView("flash");
    renderFlashCard();
    startFlashTimer();
  } catch (e) {
    showToast("Impossible de charger les panneaux", "error");
  }
}

/** Affiche la carte flash correspondant au panneau courant. */
function renderFlashCard() {
  const p = state.flashPanneaux[state.flashIndex];
  if (!p) {
    showFlashEnd();
    return;
  }

  const img = document.getElementById("flashImg");
  const svgPh = document.getElementById("flashSvgPlaceholder");
  img.style.display = "block";
  svgPh.style.display = "none";
  img.src = `${PANNEAUX_URL}/${p.image_path.split("/").pop()}`;
  img.onerror = () => {
    img.style.display = "none";
    svgPh.style.display = "flex";
    svgPh.className = `panneau-placeholder ${normalizeCategory(p.categorie)}`;
  };

  // Cacher la signification au départ (elle s'affiche après 3s)
  const sig = document.getElementById("flashSignification");
  sig.classList.add("hidden");
  sig.textContent = p.signification;

  // Barre de progression
  const pct = ((state.flashIndex + 1) / state.flashPanneaux.length) * 100;
  document.getElementById("flashBarFill").style.width = pct + "%";
  document.getElementById("flashCounter").textContent =
    `${state.flashIndex + 1} / ${state.flashPanneaux.length}`;

  // Afficher le bouton "Passer au Quiz" à partir du 3e panneau
  if (state.flashIndex >= 2) {
    document.getElementById("btnPasserQuiz").classList.remove("hidden");
  }
}

/**
 * Démarre le minuteur du mode flash :
 * - 3s  : affiche la signification
 * - +2s : passe au panneau suivant
 */
function startFlashTimer() {
  clearTimeout(state.flashTimer);

  state.flashTimer = setTimeout(() => {
    if (!state.flashPaused) {
      document.getElementById("flashSignification").classList.remove("hidden");

      state.flashTimer = setTimeout(() => {
        if (!state.flashPaused) nextFlashCard();
      }, 2000);
    }
  }, 3000);
}

/** Passe au panneau flash suivant avec une animation de glissement. */
function nextFlashCard() {
  state.flashIndex++;
  if (state.flashIndex >= state.flashPanneaux.length) {
    showFlashEnd();
    return;
  }

  // Animation de slide
  const card = document.getElementById("flashCard");
  card.style.animation = "slideInRightFull 0.4s ease";
  setTimeout(() => {
    card.style.animation = "";
  }, 400);

  renderFlashCard();
  startFlashTimer();
}

/** Affiche l'écran de fin du mode flash. */
function showFlashEnd() {
  clearTimeout(state.flashTimer);
  document.getElementById("flashEnd").classList.remove("hidden");
}

// ─── CLASSEMENT ───────────────────────────────────────────────────────────────

/** Charge et affiche le classement des utilisateurs. */
async function loadClassement() {
  try {
    const classement = await apiGet("/classement");
    renderPodium(classement.slice(0, 3));
    renderClassementTable(classement);

    // Avertir si l'utilisateur n'est pas dans le top
    const userInTop = classement.some((c) => c.prenom === state.user.prenom);
    if (!userInTop) {
      document.getElementById("classementHint").classList.remove("hidden");
    }
  } catch (e) {
    showToast("Impossible de charger le classement", "error");
  }
}

/**
 * Construit le podium visuel (top 3).
 * @param {Object[]} top3 - Les 3 premiers du classement
 */
function renderPodium(top3) {
  const podium = document.getElementById("podium");
  podium.innerHTML = "";

  // Ordre d'affichage : 2e | 1er | 3e (disposition podium classique)
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const positions = ["second", "first", "third"];
  const ranks = [2, 1, 3];

  order.forEach((p, i) => {
    if (!p) return;
    const place = document.createElement("div");
    place.className = `podium-place ${positions[i]}`;
    place.innerHTML = `
      <div class="podium-avatar">${p.prenom.charAt(0).toUpperCase()}</div>
      <div class="podium-name">${p.prenom}</div>
      <div class="podium-score">${p.meilleure_note.toFixed(1)}/20</div>
      <div class="podium-rank">#${ranks[i]}</div>
      <div class="podium-column"></div>
    `;
    podium.appendChild(place);
  });
}

/**
 * Remplit le tableau du classement complet.
 * @param {Object[]} classement - Tableau trié des participants
 */
function renderClassementTable(classement) {
  const body = document.getElementById("classementBody");
  body.innerHTML = "";

  classement.forEach((c, i) => {
    const row = document.createElement("div");
    const isUser = state.user && c.prenom === state.user.prenom;
    row.className = `table-row ${isUser ? "user-row" : ""}`;
    row.innerHTML = `
      <span class="rank-badge">#${c.rang}</span>
      <span>${c.prenom}</span>
      <span class="${c.meilleure_note >= 14 ? "score-green" : c.meilleure_note >= 10 ? "score-orange" : "score-red"}">${c.meilleure_note.toFixed(1)}/20</span>
      <span>${c.date ? new Date(c.date).toLocaleDateString("fr-FR") : "—"}</span>
    `;
    body.appendChild(row);
  });
}

// ─── PROFIL ET NIVEAUX ────────────────────────────────────────────────────────

/** Charge et affiche la page de profil de l'utilisateur. */
async function loadProfil() {
  document.getElementById("profilNomComplet").textContent =
    `${state.user.prenom} ${state.user.nom}`;
  document.getElementById("profilEmail").textContent = state.user.email;
  document.getElementById("profilAvatarBig").textContent = (
    state.user.prenom.charAt(0) + state.user.nom.charAt(0)
  ).toUpperCase();

  try {
    const stats = await apiGet(`/stats/${state.user.id}`);
    const niveau = stats.niveau;

    document.getElementById("niveauCurrentName").textContent = niveau;
    document.getElementById("niveauCurrentIcon").textContent =
      getNiveauEmoji(niveau);
    document.getElementById("niveauNextInfo").textContent = buildNiveauNextInfo(
      stats.progression_niveaux,
    );

    // Barre de progression vers le prochain niveau
    const progressFill = document.getElementById("niveauProgressFill");
    progressFill.style.width = calculateNiveauProgress(stats) + "%";

    // Surligner le niveau actuel dans la liste
    document.querySelectorAll(".niveau-item").forEach((item) => {
      item.classList.remove("niveau-active");
      if (item.dataset.niveau === niveau) item.classList.add("niveau-active");
    });
  } catch (e) {
    console.warn("Stats profil non disponibles");
  }

  // Certifications reçues
  try {
    const certifs = await apiGet(`/certifications/${state.user.id}`);
    const certifSection = document.getElementById("certifSection");
    const certifList = document.getElementById("certifList");
    if (certifs && certifs.length > 0) {
      certifSection.classList.remove("hidden");
      certifList.innerHTML = certifs.map((c) => `
        <div class="certif-card">
          <div class="certif-badge">🏆</div>
          <div class="certif-body">
            <div class="certif-top">
              <div>
                <p class="certif-id-label">Certification officielle PERMIS+</p>
                <p class="certif-id-code">${escapeHtml(c.numero_unique || "—")}</p>
              </div>
              <button class="btn-primary certif-dl-btn" data-cert-view='${escapeHtml(JSON.stringify(c))}'>
                ⬇ Télécharger
              </button>
            </div>
            <p class="certif-meta">Émise par ${escapeHtml(c.admin_prenom)} ${escapeHtml(c.admin_nom)} · ${new Date(c.date_emission).toLocaleDateString("fr-FR")}</p>
          </div>
        </div>
      `).join("");

      certifList.querySelectorAll("[data-cert-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
          try {
            const certData = JSON.parse(btn.dataset.certView.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
            openCertificatModal(certData);
          } catch (_) {}
        });
      });
    } else {
      certifSection.classList.add("hidden");
    }
  } catch (e) {
    console.warn("Certifications non disponibles");
  }
}

/**
 * Retourne l'emoji correspondant au niveau.
 * @param {string} niveau - Nom du niveau
 * @returns {string}
 */
function getNiveauEmoji(niveau) {
  const map = {
    Débutant: "🟤",
    "Apprenti Conducteur": "🔵",
    "Conducteur Confirmé": "🟢",
    "Expert de la Route": "🟡",
    "As du Volant": "🔴",
  };
  return map[niveau] || "🟤";
}

/**
 * Construit le texte d'information pour progresser vers le prochain niveau.
 * @param {Object} progression - Données de progression retournées par l'API
 * @returns {string}
 */
function buildNiveauNextInfo(progression) {
  if (!progression) return "";
  const {
    quiz_faits,
    quiz_requis_prochain,
    moyenne_actuelle,
    moyenne_requise_prochain,
    prochain_niveau,
  } = progression;
  if (!prochain_niveau) return "Vous avez atteint le niveau maximum !";
  const quizRestants = Math.max(0, quiz_requis_prochain - quiz_faits);
  const moyenneRestante = Math.max(
    0,
    moyenne_requise_prochain - moyenne_actuelle,
  ).toFixed(1);
  return `Pour atteindre ${prochain_niveau} : encore ${quizRestants} quiz et une moyenne de ${moyenne_requise_prochain}/20 (actuellement ${moyenne_actuelle.toFixed(1)}/20)`;
}

/**
 * Calcule le pourcentage de progression vers le prochain niveau.
 * @param {Object} stats - Statistiques de l'utilisateur
 * @returns {number} - Pourcentage entre 0 et 100
 */
function calculateNiveauProgress(stats) {
  const { nb_quiz, moyenne } = stats;
  const niveaux = [
    { quiz: 0, avg: 0 },
    { quiz: 3, avg: 8 },
    { quiz: 6, avg: 12 },
    { quiz: 10, avg: 15 },
    { quiz: 15, avg: 18 },
  ];

  // Trouver le niveau actuel
  let currentIdx = 0;
  for (let i = 0; i < niveaux.length; i++) {
    if (nb_quiz >= niveaux[i].quiz && moyenne >= niveaux[i].avg) currentIdx = i;
  }

  if (currentIdx >= niveaux.length - 1) return 100;

  const next = niveaux[currentIdx + 1];
  const quizPct =
    next.quiz > 0 ? Math.min(100, (nb_quiz / next.quiz) * 100) : 100;
  const avgPct = next.avg > 0 ? Math.min(100, (moyenne / next.avg) * 100) : 100;
  return Math.min(100, (quizPct + avgPct) / 2);
}

// ─── BOT ROADY (INDICES) ──────────────────────────────────────────────────────

/**
 * Demande un indice à l'API pour la question courante et l'affiche dans la bulle ROADY.
 * Maximum 2 indices par question.
 */
async function requestIndice() {
  if (state.indiceCount >= 2) {
    showRoadyBubble("ROADY a dit tout ce qu'il pouvait. 🤫");
    return;
  }

  state.indiceCount++;
  const q = state.quizQuestions[state.currentQuestionIndex];
  if (!q) return;

  try {
    const res = await apiFetch("/indice", {
      method: "POST",
      body: JSON.stringify({
        panneau_id: q.panneau_id,
        numero_indice: state.indiceCount,
      }),
    });
    showRoadyBubble(res.indice);

    // Indiquer visuellement que les indices sont épuisés
    if (state.indiceCount >= 2) {
      document.getElementById("indiceBtn").innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
        </svg>
        🚗 ROADY (épuisé)
      `;
    }
  } catch (e) {
    showRoadyBubble("ROADY n'est pas disponible pour le moment.");
  }
}

/**
 * Affiche un message dans la bulle ROADY.
 * @param {string} text - Texte de l'indice
 */
function showRoadyBubble(text) {
  const bubble = document.getElementById("roadyBubble");
  document.getElementById("roadyText").textContent = text;
  bubble.classList.remove("hidden");
}

// ─── UTILITAIRES API ──────────────────────────────────────────────────────────

/**
 * Effectue un GET vers l'API et retourne le JSON.
 * @param {string} endpoint - Chemin relatif à API (ex: '/stats/1')
 * @returns {Promise<any>}
 */
async function apiGet(endpoint) {
  const res = await fetch(`${API}${endpoint}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Erreur ${res.status}`);
  }
  return res.json();
}

/**
 * Effectue une requête vers l'API avec options (POST, PUT…) et retourne le JSON.
 * @param {string} endpoint - Chemin relatif à API
 * @param {RequestInit} options - Options fetch
 * @returns {Promise<any>}
 */
async function apiFetch(endpoint, options = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Erreur ${res.status}`);
  }
  return res.json();
}

// ─── UTILITAIRES INTERFACE ────────────────────────────────────────────────────

/**
 * Formate une durée en secondes sous la forme "Xm Ys".
 * @param {number} secondes
 * @returns {string}
 */
function formatDuree(secondes) {
  if (!secondes && secondes !== 0) return "—";
  const m = Math.floor(secondes / 60);
  const s = secondes % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Anime un chiffre de `from` à `to` avec un easing cubic-out.
 * @param {string} elementId - ID de l'élément cible
 * @param {number} from      - Valeur de départ
 * @param {number} to        - Valeur d'arrivée
 * @param {number} duration  - Durée en ms
 * @param {string} suffix    - Suffixe à ajouter (ex: '%')
 */
function animateNumber(elementId, from, to, duration, suffix = "") {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = Date.now();
  const step = () => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // cubic-out
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Affiche la barre de navigation. */
function showNavbar() {
  document.getElementById("navbar").classList.remove("hidden");
}

/** Cache la barre de navigation. */
function hideNavbar() {
  document.getElementById("navbar").classList.add("hidden");
}

/** Met à jour les initiales affichées dans le bouton avatar de la navbar. */
function updateAvatar() {
  if (!state.user) return;
  const initials = (
    (state.user.prenom || "?").charAt(0) + (state.user.nom || "?").charAt(0)
  ).toUpperCase();
  document.getElementById("avatarInitials").textContent = initials;
}

/**
 * Affiche une notification toast.
 * @param {string} message - Texte du message
 * @param {'info'|'error'|'success'} type - Variante visuelle
 */
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/**
 * Applique un thème visuel à l'application.
 * @param {string} theme - Nom du thème ('cockpit' | 'aurora' | 'ember' | 'daylight')
 */
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("permis_theme", theme);
}

/** Normalise les données de session utilisateur. */
function normalizeUserSession(user) {
  if (!user) return null;
  const role = String(user.role || "apprenant").toLowerCase();
  return {
    ...user,
    role: role === "user" ? "apprenant" : role,
  };
}

/** Retourne vrai si l'utilisateur courant est administrateur. */
function isAdminUser() {
  return (
    !!state.user && String(state.user.role || "").toLowerCase() === "admin"
  );
}

/** Normalise le nom de catégorie pour l'affichage et le filtrage. */
function normalizeCategory(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return CATEGORY_LABELS[normalized] ? normalized : "information";
}

/** Retourne le libellé lisible d'une catégorie. */
function getCategoryLabel(value) {
  const normalized = normalizeCategory(value);
  return CATEGORY_LABELS[normalized] || "Information";
}

/** Retourne un objet panneau normalisé pour toute l'interface. */
function normalizePanneauData(panneau = {}) {
  const categorie = normalizeCategory(panneau.categorie);
  return {
    ...panneau,
    categorie,
    categorieLabel: getCategoryLabel(categorie),
  };
}

/** Échappement HTML minimal pour l'injection de contenu backend dans le DOM. */
function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Synchronise les contrôles du quiz avec une catégorie. */
function setQuizCategory(category) {
  const normalized = category === "all" ? "all" : normalizeCategory(category);
  state.quizCategorie = normalized;
  document.querySelectorAll("#categorieGroup .toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === normalized);
  });
}

/** Synchronise les contrôles du quiz avec un nombre de questions. */
function setQuizQuestionCount(nb) {
  state.quizNbQuestions = nb;
  document.querySelectorAll("#nbQuestionsGroup .toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.value) === nb);
  });
}

/** Met à jour les éléments de chrome utilisateur dans la navbar. */
function updateUserChrome() {
  const adminRibbon = document.getElementById("adminRibbon");
  const adminBadge = document.getElementById("navAdminBadge");
  const adminNavLink = document.getElementById("adminNavLink");
  const navUserMeta = document.getElementById("navUserMeta");
  const navUserName = document.getElementById("navUserName");

  if (!state.user) {
    document.body.classList.remove("admin-mode");
    adminRibbon?.classList.add("hidden");
    adminBadge?.classList.add("hidden");
    adminNavLink?.classList.add("hidden");
    navUserMeta?.classList.add("hidden");
    return;
  }

  updateAvatar();
  navUserMeta?.classList.remove("hidden");
  navUserName.textContent =
    `${state.user.prenom || "Conducteur"} ${state.user.nom || ""}`.trim();

  if (isAdminUser()) {
    document.body.classList.add("admin-mode");
    adminRibbon?.classList.remove("hidden");
    adminBadge?.classList.remove("hidden");
    adminNavLink?.classList.remove("hidden");
  } else {
    document.body.classList.remove("admin-mode");
    adminRibbon?.classList.add("hidden");
    adminBadge?.classList.add("hidden");
    adminNavLink?.classList.add("hidden");
  }
}

/** Construit une URL d'endpoint admin avec l'identifiant de l'admin courant. */
function buildAdminEndpoint(path) {
  const normalizedPath = path === "dashboard" ? "stats" : path;
  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `/admin/${normalizedPath}${separator}admin_id=${encodeURIComponent(state.user.id)}`;
}

/** Récupère une collection depuis une réponse hétérogène. */
function extractCollection(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

/** Vérifie l'accès admin et redirige sinon. */
function ensureAdminAccess(silent = false) {
  if (isAdminUser()) return true;
  if (!silent) showToast("Vous n'avez pas accès à l'administration.", "error");
  showView("dashboard");
  if (state.user) loadDashboard();
  return false;
}

/** GET vers l'API admin. */
async function apiGetAdmin(path) {
  if (!ensureAdminAccess(true)) throw new Error("Accès admin refusé");
  return apiGet(buildAdminEndpoint(path));
}

/** Requête vers l'API admin, compatible JSON et FormData. */
async function apiFetchAdmin(path, options = {}) {
  if (!ensureAdminAccess(true)) throw new Error("Accès admin refusé");

  const body = options.body;
  const isFormData = body instanceof FormData;
  const headers = isFormData
    ? { ...(options.headers || {}) }
    : { "Content-Type": "application/json", ...(options.headers || {}) };

  const res = await fetch(`${API}${buildAdminEndpoint(path)}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Erreur ${res.status}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** Affiche une section de l'administration. */
function showAdminSection(section) {
  state.adminSection = section;
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.adminSection === section);
  });
  document.querySelectorAll(".admin-section").forEach((panel) => {
    const isActive =
      panel.id ===
      `adminSection${section.charAt(0).toUpperCase()}${section.slice(1)}`;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("active", isActive);
  });
}

/** Charge la vue admin courante. */
async function loadAdminView(section = state.adminSection || "dashboard") {
  if (!ensureAdminAccess()) return;
  showAdminSection(section);

  if (section === "dashboard") await loadAdminDashboard();
  else if (section === "users") await loadAdminUsers();
  else if (section === "panneaux") await loadAdminPanneaux();
  else if (section === "certifications") await loadAdminCertifications();
}

/** Charge le tableau de bord admin. */
async function loadAdminDashboard() {
  try {
    const data = await apiGetAdmin("dashboard");
    state.adminDashboard = data || {};
    renderAdminDashboard();
  } catch (e) {
    document.getElementById("adminStatsGrid").innerHTML =
      `<div class="admin-empty">${escapeHtml(e.message)}</div>`;
    document.getElementById("adminLatestTableBody").innerHTML =
      '<div class="admin-empty">Impossible de charger les dernières inscriptions.</div>';
  }
}

/** Charge la liste des utilisateurs admin. */
async function loadAdminUsers() {
  try {
    const data = await apiGetAdmin("utilisateurs");
    state.adminUsers = extractCollection(data, [
      "utilisateurs",
      "users",
      "items",
    ]).map(normalizeUserSession);
    renderAdminUsers();
  } catch (e) {
    document.getElementById("adminUsersTableBody").innerHTML =
      `<div class="admin-empty">${escapeHtml(e.message)}</div>`;
  }
}

/** Charge la liste des panneaux admin. */
async function loadAdminPanneaux() {
  try {
    const data = await apiGetAdmin("panneaux");
    state.adminPanneaux = extractCollection(data, ["panneaux", "items"]).map(
      normalizePanneauData,
    );
    renderAdminPanneaux();
  } catch (e) {
    document.getElementById("adminPanneauxGrid").innerHTML =
      `<div class="admin-empty">${escapeHtml(e.message)}</div>`;
  }
}

/** Retourne la liste filtrée des utilisateurs admin. */
function getFilteredAdminUsers() {
  const query = state.adminUserSearch.trim().toLowerCase();
  if (!query) return state.adminUsers;
  return state.adminUsers.filter((user) =>
    [user.nom, user.prenom, user.email, user.role, user.niveau]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

/** Retourne la liste filtrée des panneaux admin. */
function getFilteredAdminPanneaux() {
  return state.adminPanneaux.filter((panneau) => {
    const okCategory =
      state.adminPanneauFilter === "all" ||
      normalizeCategory(panneau.categorie) === state.adminPanneauFilter;
    const haystack = [
      panneau.nom,
      panneau.signification,
      panneau.description_longue,
      panneau.categorieLabel,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const okSearch = haystack.includes(
      state.adminPanneauSearch.trim().toLowerCase(),
    );
    return okCategory && okSearch;
  });
}

/** Affiche les métriques et les dernières inscriptions admin. */
function renderAdminDashboard() {
  const dashboard = state.adminDashboard || {};
  const latest = extractCollection(dashboard, [
    "dernieres_inscriptions",
    "latest_registrations",
    "inscriptions",
    "recent_users",
  ]).slice(0, 5);

  const totalUsers =
    dashboard.total_utilisateurs || dashboard.nb_utilisateurs || 0;
  const totalQuiz =
    dashboard.total_quiz ||
    dashboard.total_sessions ||
    dashboard.nb_sessions ||
    0;
  const panneauRate = dashboard.panneau_plus_rate;
  const meilleureNote = dashboard.meilleure_note_globale;

  document.getElementById("adminStatsGrid").innerHTML = `
    <div class="admin-stat-card">
      <div class="admin-stat-label">Utilisateurs inscrits</div>
      <div class="admin-stat-value">${totalUsers}</div>
      <div class="admin-stat-sub">Total des comptes créés</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-label">Quiz complétés</div>
      <div class="admin-stat-value">${totalQuiz}</div>
      <div class="admin-stat-sub">Toutes sessions confondues</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-label">Panneau le plus raté</div>
      <div class="admin-stat-value admin-stat-value-sm">${escapeHtml(panneauRate?.nom || "—")}</div>
      <div class="admin-stat-sub">${panneauRate ? `${panneauRate.nb_erreurs} erreur${panneauRate.nb_erreurs > 1 ? "s" : ""}` : "Aucune donnée pour le moment"}</div>
    </div>
    <div class="admin-stat-card">
      <div class="admin-stat-label">Meilleure note globale</div>
      <div class="admin-stat-value">${meilleureNote ? `${Number(meilleureNote.note_sur_20).toFixed(1)}` : "—"}</div>
      <div class="admin-stat-sub">${meilleureNote ? `${escapeHtml(meilleureNote.prenom || "")} ${escapeHtml(meilleureNote.nom || "")}`.trim() : "Aucune session enregistrée"}</div>
    </div>
  `;

  document.getElementById("adminLatestCount").textContent =
    `${latest.length} élément${latest.length > 1 ? "s" : ""}`;
  const latestBody = document.getElementById("adminLatestTableBody");
  if (!latest.length) {
    latestBody.innerHTML =
      '<div class="admin-empty">Aucune inscription récente disponible.</div>';
    return;
  }

  latestBody.innerHTML = latest
    .map(
      (user) => `
        <div class="table-row admin-users-row">
          <span>${escapeHtml(`${user.prenom || ""} ${user.nom || ""}`.trim() || "—")}</span>
          <span>${escapeHtml(user.email || "—")}</span>
          <span>${escapeHtml(user.niveau || "Débutant")}</span>
          <span>${user.date_inscription ? new Date(user.date_inscription).toLocaleDateString("fr-FR") : "—"}</span>
        </div>
      `,
    )
    .join("");
}

/** Affiche le tableau des utilisateurs admin. */
function renderAdminUsers() {
  const body = document.getElementById("adminUsersTableBody");
  const users = getFilteredAdminUsers();

  if (!users.length) {
    body.innerHTML = '<div class="admin-empty">Aucun utilisateur trouvé.</div>';
    return;
  }

  body.innerHTML = users
    .map((user) => {
      const role = String(user.role || "apprenant").toLowerCase();
      return `
        <div class="table-row admin-users-row admin-users-grid-7">
          <span>${escapeHtml(`${user.prenom || ""} ${user.nom || ""}`.trim())}</span>
          <span>${escapeHtml(user.email || "—")}</span>
          <span><span class="cat-badge ${role === "admin" ? "cat-interdiction" : "cat-obligation"}">${role === "admin" ? "Admin" : "Apprenant"}</span></span>
          <span>${escapeHtml(user.niveau || "—")}</span>
          <span>${user.date_inscription ? new Date(user.date_inscription).toLocaleDateString("fr-FR") : "—"}</span>
          <span>${Number(user.nb_quiz || 0)}</span>
          <span class="admin-row-actions">
            <button class="admin-action-btn" data-admin-edit-user="${user.id}">Modifier</button>
            <button class="admin-action-btn danger" data-admin-delete-user="${user.id}">Supprimer</button>
          </span>
        </div>
      `;
    })
    .join("");
}

/** Affiche la grille des panneaux admin. */
function renderAdminPanneaux() {
  const grid = document.getElementById("adminPanneauxGrid");
  const panneaux = getFilteredAdminPanneaux();

  if (!panneaux.length) {
    grid.innerHTML = '<div class="admin-empty">Aucun panneau trouvé.</div>';
    return;
  }

  grid.innerHTML = panneaux
    .map(
      (p) => `
      <article class="admin-panneau-card">
        <div class="admin-panneau-media">
          <img src="${PANNEAUX_URL}/${(p.image_path || "").split("/").pop()}" alt="${escapeHtml(p.nom)}"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="panneau-placeholder ${p.categorie}" style="display:none; width:100%; height:100%"></div>
        </div>
        <div class="admin-panneau-body">
          <span class="cat-badge cat-${p.categorie}">${p.categorieLabel}</span>
          <h4>${escapeHtml(p.nom)}</h4>
          <p>${escapeHtml(p.signification || "")}</p>
          <div class="admin-row-actions">
            <button class="admin-action-btn" data-admin-edit-panneau="${p.id}">Modifier</button>
            <button class="admin-action-btn" data-admin-image-panneau="${p.id}">Image</button>
            <button class="admin-action-btn danger" data-admin-delete-panneau="${p.id}">Supprimer</button>
          </div>
        </div>
      </article>
    `,
    )
    .join("");
}

/** Ouvre la modale admin générique. */
function openAdminModal(content) {
  document.getElementById("adminModalContent").innerHTML = content;
  document.getElementById("adminModalOverlay").classList.remove("hidden");
}

/** Ferme la modale admin. */
function closeAdminModal() {
  document.getElementById("adminModalOverlay").classList.add("hidden");
}

/** Ouvre une modale de confirmation admin. */
function openAdminConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  confirmClass = "btn-primary",
}) {
  openAdminModal(`
    <div class="admin-modal-body">
      <div class="admin-modal-head">
        <h3>${escapeHtml(title)}</h3>
        <p class="admin-confirm-copy">${escapeHtml(message)}</p>
      </div>
      <div class="admin-modal-actions">
        <button class="btn-secondary" id="adminConfirmCancel">Annuler</button>
        <button class="${confirmClass}" id="adminConfirmValidate">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `);

  document
    .getElementById("adminConfirmCancel")
    .addEventListener("click", closeAdminModal);
  document
    .getElementById("adminConfirmValidate")
    .addEventListener("click", async () => {
      await onConfirm();
      closeAdminModal();
    });
}

/** Retourne une image en data URL pour prévisualisation. */
function readImagePreview(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

/** Ouvre la modale d'édition / création d'utilisateur. */
function openAdminUserModal(user = null) {
  const isEdit = !!user;
  openAdminModal(`
    <div class="admin-modal-body">
      <div class="admin-modal-head">
        <h3>${isEdit ? "Modifier l'utilisateur" : "Ajouter un utilisateur"}</h3>
        <p>${isEdit ? "Mettez à jour les informations du compte sans recharger la page." : "Créez un nouveau compte utilisateur ou administrateur."}</p>
      </div>
      <form id="adminUserForm">
        <div class="admin-form-grid">
          <div class="field-group">
            <label>Prénom</label>
            <input type="text" name="prenom" value="${escapeHtml(user?.prenom || "")}" required>
          </div>
          <div class="field-group">
            <label>Nom</label>
            <input type="text" name="nom" value="${escapeHtml(user?.nom || "")}" required>
          </div>
          <div class="field-group full">
            <label>Email</label>
            <input type="email" name="email" value="${escapeHtml(user?.email || "")}" required>
          </div>
          <div class="field-group">
            <label>Rôle</label>
            <select name="role">
              <option value="apprenant" ${user?.role !== "admin" ? "selected" : ""}>Apprenant</option>
              <option value="admin" ${user?.role === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </div>
          <div class="field-group">
            <label>Niveau</label>
            <input type="text" name="niveau" value="${escapeHtml(user?.niveau || "Débutant")}">
          </div>
          <div class="field-group full">
            <label>${isEdit ? "Nouveau mot de passe (optionnel)" : "Mot de passe"}</label>
            <input type="password" name="mot_de_passe" ${isEdit ? "" : "required"}>
          </div>
        </div>
        <div class="admin-modal-actions">
          <button type="button" class="btn-secondary" id="adminUserCancel">Annuler</button>
          <button type="submit" class="btn-primary">${isEdit ? "Enregistrer" : "Créer"}</button>
        </div>
      </form>
    </div>
  `);

  document
    .getElementById("adminUserCancel")
    .addEventListener("click", closeAdminModal);
  document
    .getElementById("adminUserForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const payload = {
        nom: form.get("nom"),
        prenom: form.get("prenom"),
        email: form.get("email"),
        role: form.get("role"),
        niveau: form.get("niveau"),
      };
      if (form.get("mot_de_passe"))
        payload.mot_de_passe = form.get("mot_de_passe");

      try {
        await apiFetchAdmin(
          isEdit ? `utilisateurs/${user.id}` : "utilisateurs",
          {
            method: isEdit ? "PUT" : "POST",
            body: JSON.stringify(payload),
          },
        );
        playAdminSuccess();
        showToast(
          isEdit ? "Utilisateur mis à jour." : "Utilisateur ajouté.",
          "success",
        );
        closeAdminModal();
        await loadAdminUsers();
        await loadAdminDashboard();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
}

/** Ouvre la modale d'édition / création de panneau. */
function openAdminPanneauModal(panneau = null, imageOnly = false) {
  const isEdit = !!panneau;
  const normalized = panneau ? normalizePanneauData(panneau) : null;
  const imageSrc = normalized?.image_path
    ? `${PANNEAUX_URL}/${normalized.image_path.split("/").pop()}`
    : "";

  openAdminModal(`
    <div class="admin-modal-body">
      <div class="admin-modal-head">
        <h3>${imageOnly ? "Changer l'image du panneau" : isEdit ? "Modifier le panneau" : "Ajouter un panneau"}</h3>
        <p>${imageOnly ? "Chargez une nouvelle image et vérifiez la prévisualisation avant validation." : "Mettez à jour le panneau, sa catégorie et son visuel dans le catalogue."}</p>
      </div>
      <form id="adminPanneauForm">
        <div class="admin-form-grid">
          <div class="field-group ${imageOnly ? "hidden" : ""}">
            <label>Nom</label>
            <input type="text" name="nom" value="${escapeHtml(normalized?.nom || "")}" ${imageOnly ? "" : "required"}>
          </div>
          <div class="field-group ${imageOnly ? "hidden" : ""}">
            <label>Catégorie</label>
            <select name="categorie">
              <option value="danger" ${normalized?.categorie === "danger" ? "selected" : ""}>Danger</option>
              <option value="interdiction" ${normalized?.categorie === "interdiction" ? "selected" : ""}>Interdiction</option>
              <option value="obligation" ${normalized?.categorie === "obligation" ? "selected" : ""}>Obligation</option>
              <option value="information" ${!normalized || normalized?.categorie === "information" ? "selected" : ""}>Information</option>
            </select>
          </div>
          <div class="field-group full ${imageOnly ? "hidden" : ""}">
            <label>Signification</label>
            <input type="text" name="signification" value="${escapeHtml(normalized?.signification || "")}" ${imageOnly ? "" : "required"}>
          </div>
          <div class="field-group full ${imageOnly ? "hidden" : ""}">
            <label>Description longue</label>
            <textarea name="description_longue">${escapeHtml(normalized?.description_longue || "")}</textarea>
          </div>
          <div class="field-group full">
            <label>Image</label>
            <input type="file" name="image" id="adminPanneauImageInput" accept="image/*" ${isEdit ? "" : "required"}>
          </div>
          <div class="field-group full">
            <label>Prévisualisation</label>
            <div class="admin-upload-preview" id="adminUploadPreview">
              ${imageSrc ? `<img src="${imageSrc}" alt="Prévisualisation du panneau">` : "<span>Aucune image sélectionnée</span>"}
            </div>
          </div>
        </div>
        <div class="admin-modal-actions">
          <button type="button" class="btn-secondary" id="adminPanneauCancel">Annuler</button>
          ${imageOnly && isEdit ? '<button type="button" class="btn-secondary danger-outline" id="adminPanneauDeleteImage">Supprimer l\'image</button>' : ""}
          <button type="submit" class="btn-primary">${imageOnly ? "Mettre à jour l'image" : isEdit ? "Enregistrer" : "Ajouter"}</button>
        </div>
      </form>
    </div>
  `);

  const input = document.getElementById("adminPanneauImageInput");
  const preview = document.getElementById("adminUploadPreview");

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await readImagePreview(file);
    preview.innerHTML = dataUrl
      ? `<img src="${dataUrl}" alt="Nouvelle prévisualisation du panneau">`
      : "<span>Aucune image sélectionnée</span>";
  });

  document
    .getElementById("adminPanneauCancel")
    .addEventListener("click", closeAdminModal);

  const deleteImageBtn = document.getElementById("adminPanneauDeleteImage");
  if (deleteImageBtn && normalized) {
    deleteImageBtn.addEventListener("click", async () => {
      try {
        await apiFetchAdmin(`panneaux/${normalized.id}/image`, {
          method: "DELETE",
        });
        playAdminDelete();
        showToast("Image supprimée. Le placeholder sera utilisé.", "success");
        closeAdminModal();
        await loadAdminPanneaux();
        await loadCatalogue();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  }

  document
    .getElementById("adminPanneauForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const target = e.currentTarget;
      const file = input.files?.[0];

      try {
        if (imageOnly && isEdit) {
          if (!file) {
            showToast("Sélectionnez une image avant de continuer.", "error");
            return;
          }
          const imageForm = new FormData();
          imageForm.append("image", file);
          await apiFetchAdmin(`panneaux/${normalized.id}/image`, {
            method: "POST",
            body: imageForm,
          });
        } else {
          const payload = {
            nom: target.nom.value,
            categorie: target.categorie.value,
            signification: target.signification.value,
            description_longue: target.description_longue.value,
          };

          const savedPanneau = await apiFetchAdmin(
            isEdit ? `panneaux/${normalized.id}` : "panneaux",
            {
              method: isEdit ? "PUT" : "POST",
              body: JSON.stringify(payload),
            },
          );

          const panneauId = isEdit ? normalized.id : savedPanneau?.id;
          if (file && panneauId) {
            const imageForm = new FormData();
            imageForm.append("image", file);
            await apiFetchAdmin(`panneaux/${panneauId}/image`, {
              method: "POST",
              body: imageForm,
            });
          }
        }

        playAdminSuccess();
        showToast(
          imageOnly
            ? "Image mise à jour."
            : isEdit
              ? "Panneau mis à jour."
              : "Panneau ajouté.",
          "success",
        );
        closeAdminModal();
        await loadAdminPanneaux();
        await loadCatalogue();
        await loadAdminDashboard();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
}

/** Déclenche la suppression d'un utilisateur avec confirmation. */
function confirmDeleteAdminUser(userId) {
  const user = state.adminUsers.find(
    (item) => Number(item.id) === Number(userId),
  );
  if (!user) return;

  openAdminConfirmModal({
    title: "Supprimer cet utilisateur ?",
    message: `Cette action retirera ${user.prenom} ${user.nom} de la plateforme.`,
    confirmLabel: "Supprimer",
    onConfirm: async () => {
      try {
        await apiFetchAdmin(`utilisateurs/${user.id}`, { method: "DELETE" });
        playAdminDelete();
        showToast("Utilisateur supprimé.", "success");
        await loadAdminUsers();
        await loadAdminDashboard();
      } catch (error) {
        showToast(error.message, "error");
      }
    },
  });
}

/** Déclenche la suppression d'un panneau avec confirmation. */
function confirmDeleteAdminPanneau(panneauId) {
  const panneau = state.adminPanneaux.find(
    (item) => Number(item.id) === Number(panneauId),
  );
  if (!panneau) return;

  openAdminConfirmModal({
    title: "Supprimer ce panneau ?",
    message: `Le panneau \"${panneau.nom}\" sera retiré du catalogue et des écrans admin.`,
    confirmLabel: "Supprimer",
    onConfirm: async () => {
      try {
        await apiFetchAdmin(`panneaux/${panneau.id}`, { method: "DELETE" });
        playAdminDelete();
        showToast("Panneau supprimé.", "success");
        await loadAdminPanneaux();
        await loadCatalogue();
        await loadAdminDashboard();
      } catch (error) {
        showToast(error.message, "error");
      }
    },
  });
}

// ─── CERTIFICATIONS ADMIN ────────────────────────────────────────────────────

/** Charge et affiche la liste des certifications émises. */
async function loadAdminCertifications() {
  try {
    const [eligibles, emises] = await Promise.all([
      apiGetAdmin("certifications/eligibles"),
      apiGetAdmin("certifications"),
    ]);
    state.adminEligibles = Array.isArray(eligibles) ? eligibles : [];
    state.adminCertifications = Array.isArray(emises) ? emises : [];
    renderAdminEligibles();
    renderAdminCertifications();

    // Compteurs d'onglets
    document.getElementById("certEligiblesCount").textContent = state.adminEligibles.filter(e => !e.deja_certifie).length;
    document.getElementById("certEmisesCount").textContent = state.adminCertifications.length;
  } catch (e) {
    document.getElementById("adminEligiblesBody").innerHTML =
      `<div class="admin-empty">${escapeHtml(e.message)}</div>`;
  }
}

/** Affiche la liste des utilisateurs éligibles. */
function renderAdminEligibles() {
  const body = document.getElementById("adminEligiblesBody");
  const list = state.adminEligibles || [];

  if (!list.length) {
    body.innerHTML = '<div class="admin-empty">Aucun utilisateur As du Volant pour le moment.</div>';
    return;
  }

  body.innerHTML = list.map((u) => {
    const certified = u.deja_certifie > 0;
    return `
      <div class="table-row admin-cert-elig-row">
        <span>${escapeHtml(`${u.prenom} ${u.nom}`)}</span>
        <span>${u.nb_quiz || 0}</span>
        <span class="score-green">${u.meilleure_note ? Number(u.meilleure_note).toFixed(1) : "—"}/20</span>
        <span>${u.moyenne ? Number(u.moyenne).toFixed(1) : "—"}/20</span>
        <span>
          ${certified
            ? '<span class="cert-status certified">✅ Certifié</span>'
            : '<span class="cert-status eligible">⭐ Éligible</span>'}
        </span>
        <span>
          <button class="admin-action-btn" data-admin-certifier="${u.id}"
            ${certified ? 'disabled title="Déjà certifié"' : ''}>
            ${certified ? "Déjà certifié" : "🏆 Certifier"}
          </button>
        </span>
      </div>
    `;
  }).join("");
}

/** Affiche le tableau des certifications émises. */
function renderAdminCertifications() {
  const body = document.getElementById("adminCertTableBody");
  const certifs = state.adminCertifications || [];

  if (!certifs.length) {
    body.innerHTML = '<div class="admin-empty">Aucune certification émise pour le moment.</div>';
    return;
  }

  body.innerHTML = certifs.map((c) => `
    <div class="table-row admin-cert-row">
      <span>${escapeHtml(`${c.prenom} ${c.nom}`)}</span>
      <span class="cert-id-badge">${escapeHtml(c.numero_unique || "—")}</span>
      <span>${c.date_emission ? new Date(c.date_emission).toLocaleDateString("fr-FR") : "—"}</span>
      <span class="admin-row-actions">
        <button class="admin-action-btn" data-admin-preview-cert='${JSON.stringify({
          prenom: c.prenom, nom: c.nom, date_emission: c.date_emission,
          numero_unique: c.numero_unique, admin_prenom: c.admin_prenom, admin_nom: c.admin_nom
        })}'>Voir</button>
        <button class="admin-action-btn danger" data-admin-revoke-cert="${c.id}">Révoquer</button>
      </span>
    </div>
  `).join("");
}

/** Ouvre la modale d'émission rapide depuis la liste éligibles. */
async function certifierUtilisateur(userId) {
  const user = (state.adminEligibles || []).find(u => Number(u.id) === Number(userId));
  if (!user) return;

  openAdminConfirmModal({
    title: `Certifier ${user.prenom} ${user.nom} ?`,
    message: `Une certification officielle As du Volant sera générée et disponible dans son profil.`,
    confirmLabel: "🏆 Émettre la certification",
    confirmClass: "btn-primary",
    onConfirm: async () => {
      try {
        const res = await apiFetchAdmin("certifications", {
          method: "POST",
          body: JSON.stringify({ utilisateur_id: user.id }),
        });
        playAdminSuccess();
        showToast(res.message_ok || "Certification émise.", "success");
        await loadAdminCertifications();
      } catch (err) {
        showToast(err.message, "error");
      }
    },
  });
}

/** Bascule entre les onglets de la section certifications. */
function switchCertTab(tab) {
  document.querySelectorAll(".cert-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.certTab === tab);
  });
  document.getElementById("certPanelEligibles").classList.toggle("hidden", tab !== "eligibles");
  document.getElementById("certPanelEmises").classList.toggle("hidden", tab !== "emises");
}

/** Révoque une certification avec confirmation. */
function confirmRevokeCert(certId) {
  openAdminConfirmModal({
    title: "Révoquer cette certification ?",
    message: "Cette action supprimera définitivement la certification de l'utilisateur.",
    confirmLabel: "Révoquer",
    confirmClass: "btn-secondary danger-outline",
    onConfirm: async () => {
      try {
        await apiFetchAdmin(`certifications/${certId}`, { method: "DELETE" });
        playAdminDelete();
        showToast("Certification révoquée.", "success");
        await loadAdminCertifications();
      } catch (err) {
        showToast(err.message, "error");
      }
    },
  });
}

// ─── CERTIFICAT PREMIUM — RENDU & TÉLÉCHARGEMENT ─────────────────────────────

/**
 * Remplit et affiche la modale du certificat visuel premium.
 * @param {Object} data - { prenom_utilisateur, nom_utilisateur, date_emission, numero_unique, admin_prenom, admin_nom }
 */
function openCertificatModal(data) {
  const prenom = data.prenom_utilisateur || data.prenom || "";
  const nom = data.nom_utilisateur || data.nom || "";
  const dateStr = data.date_emission
    ? new Date(data.date_emission).toLocaleDateString("fr-FR")
    : new Date().toLocaleDateString("fr-FR");
  const numero = data.numero_unique || "PERMIS-XXXXXX";
  const adminNom = `${data.admin_prenom || "Gedeon"} ${data.admin_nom || "Cibanvunya"}`.trim();
  const year = data.date_emission ? new Date(data.date_emission).getFullYear() : new Date().getFullYear();

  document.getElementById("certRecipientName").textContent = `${prenom} ${nom}`.trim();
  document.getElementById("certDate").textContent = dateStr;
  document.getElementById("certNumero").textContent = numero;
  document.getElementById("certSignature").textContent = adminNom;
  document.getElementById("certSealYear").textContent = year;

  document.getElementById("certModalOverlay").classList.remove("hidden");
}

/** Ferme la modale certificat. */
function closeCertificatModal() {
  document.getElementById("certModalOverlay").classList.add("hidden");
}

/** Télécharge le certificat en PNG via html2canvas. */
async function downloadCertificat() {
  const el = document.getElementById("certificatPremium");
  if (!window.html2canvas) {
    showToast("Librairie d'export non disponible.", "error");
    return;
  }
  try {
    showToast("Génération en cours…", "info");
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
    });
    const link = document.createElement("a");
    const nomFichier = document.getElementById("certRecipientName").textContent
      .replace(/\s+/g, "_").toLowerCase();
    link.download = `certificat_permis_plus_${nomFichier}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Certificat téléchargé.", "success");
  } catch (e) {
    showToast("Erreur lors de l'export.", "error");
  }
}

// ─── RÉSEAU DE ROUTES SVG (LANDING) ──────────────────────────────────────────

/**
 * Génère un réseau de routes SVG animé en arrière-plan de la landing page.
 */
function initRoadNetwork() {
  const container = document.getElementById("roadNetwork");
  if (!container) return;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("viewBox", "0 0 1000 800");

  // Lignes représentant des routes (horizontales, verticales, diagonales)
  const lines = [
    [0, 200, 1000, 200],
    [0, 400, 1000, 400],
    [0, 600, 1000, 600],
    [200, 0, 200, 800],
    [500, 0, 500, 800],
    [800, 0, 800, 800],
    [0, 0, 500, 400],
    [500, 400, 1000, 0],
    [0, 800, 1000, 0],
  ];

  lines.forEach(([x1, y1, x2, y2], i) => {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "white");
    line.setAttribute("stroke-width", "1");
    line.style.animation = `roadPulse ${8 + i * 1.5}s ease-in-out infinite`;
    line.style.animationDelay = `${i * 0.5}s`;
    svg.appendChild(line);
  });

  container.appendChild(svg);
}

// ─── INITIALISATION ET EVENT LISTENERS ───────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // ── 1. Restaurer le thème sauvegardé ──
  const savedTheme = localStorage.getItem("permis_theme") || "cockpit";
  setTheme(savedTheme);

  // ── 2. Restaurer la session utilisateur ──
  const savedUser = localStorage.getItem("permis_user");
  if (savedUser) {
    try {
      state.user = normalizeUserSession(JSON.parse(savedUser));
      showNavbar();
      updateUserChrome();
      if (isAdminUser()) {
        showView("admin");
        loadAdminView("dashboard");
      } else {
        showView("dashboard");
        loadDashboard();
      }
    } catch (e) {
      // Données corrompues — réinitialiser.
      localStorage.removeItem("permis_user");
      showView("landing");
      initRoadNetwork();
    }
  } else {
    showView("landing");
    initRoadNetwork();
  }

  // ── 3. Initialiser la scène Three.js ──
  initLandingScene();
  setQuizCategory(state.quizCategorie);
  setQuizQuestionCount(state.quizNbQuestions);

  // ── EVENT LISTENERS ──────────────────────────────────────────────────────

  // Initialiser l'audio au premier geste utilisateur.
  document.addEventListener(
    "click",
    () => {
      initAudio();
    },
    { once: true },
  );

  // Fermeture globale des modales via Échap.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeModal();
    closeAdminModal();
  });

  // ── Bascule Connexion / Inscription ──
  document.getElementById("toggleLogin").addEventListener("click", () => {
    document.getElementById("formLogin").classList.remove("hidden");
    document.getElementById("formRegister").classList.add("hidden");
    document.getElementById("toggleLogin").classList.add("toggle-active");
    document.getElementById("toggleRegister").classList.remove("toggle-active");
  });

  document.getElementById("toggleRegister").addEventListener("click", () => {
    document.getElementById("formRegister").classList.remove("hidden");
    document.getElementById("formLogin").classList.add("hidden");
    document.getElementById("toggleRegister").classList.add("toggle-active");
    document.getElementById("toggleLogin").classList.remove("toggle-active");
  });

  // ── Formulaire de connexion ──
  document.getElementById("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    playClick();
    const errEl = document.getElementById("loginError");
    errEl.classList.add("hidden");
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPassword").value;
    const result = await login(email, password);
    if (!result.success) {
      errEl.textContent = result.error;
      errEl.classList.remove("hidden");
    }
  });

  // ── Formulaire d'inscription ──
  document
    .getElementById("formRegister")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      playClick();
      const errEl = document.getElementById("registerError");
      errEl.classList.add("hidden");
      const result = await register(
        document.getElementById("regNom").value,
        document.getElementById("regPrenom").value,
        document.getElementById("regEmail").value,
        document.getElementById("regPassword").value,
      );
      if (!result.success) {
        errEl.textContent = result.error;
        errEl.classList.remove("hidden");
      }
    });

  // ── Liens de navigation ──
  document.querySelectorAll("[data-view]").forEach((el) => {
    // Exclure le bouton avatar qui a son propre handler.
    if (el.id === "avatarBtn") return;
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      playClick();
      const view = el.dataset.view;
      showView(view);

      // Charger les données selon la vue activée.
      if (view === "dashboard") loadDashboard();
      else if (view === "catalogue") loadCatalogue();
      else if (view === "historique") loadHistorique();
      else if (view === "classement") loadClassement();
      else if (view === "profil") loadProfil();
      else if (view === "admin")
        await loadAdminView(state.adminSection || "dashboard");
    });
  });

  // ── Cartes d'action du dashboard ──
  document.querySelectorAll(".action-card").forEach((card) => {
    card.addEventListener("click", () => {
      playClick();
      const view = card.dataset.view;
      if (view) {
        showView(view);
        if (view === "catalogue") loadCatalogue();
      }
    });
  });

  // ── Déconnexion ──
  document.getElementById("logoutBtn").addEventListener("click", () => {
    playClick();
    logout();
  });

  // ── Sélecteur de thème ──
  document.getElementById("themeBtnToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("themeDropdown").classList.toggle("hidden");
  });

  document.querySelectorAll(".theme-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme(btn.dataset.theme);
      document.getElementById("themeDropdown").classList.add("hidden");
      if (state.currentView === "dashboard") loadDashboard();
      if (state.currentView === "admin") renderAdminDashboard();
    });
  });

  // Fermer le dropdown thème si clic en dehors.
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#themeSelector")) {
      document.getElementById("themeDropdown")?.classList.add("hidden");
    }
  });

  // ── Bouton muet ──
  document.getElementById("muteBtn").addEventListener("click", () => {
    state.muted = !state.muted;
    const icon = document.getElementById("soundIcon");
    if (state.muted) {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15"/>
        <line x1="17" y1="9" x2="23" y2="15"/>
      `;
    } else {
      icon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
      `;
    }
  });

  // ── Config quiz — nombre de questions ──
  document.getElementById("nbQuestionsGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    playClick();
    setQuizQuestionCount(parseInt(btn.dataset.value, 10));
  });

  // ── Config quiz — catégorie ──
  document.getElementById("categorieGroup").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    playClick();
    setQuizCategory(btn.dataset.value);
  });

  // ── Lancer le quiz ──
  document.getElementById("btnLancerQuiz").addEventListener("click", () => {
    playClick();
    startQuiz();
  });

  // ── Lancer le mode révision flash ──
  document.getElementById("btnReviser").addEventListener("click", () => {
    playClick();
    startFlash();
  });

  // ── Sélection d'une réponse dans le quiz ──
  document.getElementById("answersGrid").addEventListener("click", (e) => {
    const btn = e.target.closest(".answer-btn");
    if (!btn || btn.disabled) return;
    playClick();
    initAudio();
    const choix = btn.dataset.choice;
    const q = state.quizQuestions[state.currentQuestionIndex];
    handleAnswer(choix, q);
  });

  // ── Bouton Quitter le quiz ──
  document.getElementById("btnQuitQuiz").addEventListener("click", () => {
    playClick();
    document.getElementById("confirmQuitOverlay").classList.remove("hidden");
  });

  // ── Dialog confirmation quitter — Annuler ──
  document.getElementById("confirmQuitCancel").addEventListener("click", () => {
    playClick();
    document.getElementById("confirmQuitOverlay").classList.add("hidden");
  });

  // ── Dialog confirmation quitter — Confirmer ──
  document.getElementById("confirmQuitOk").addEventListener("click", () => {
    document.getElementById("confirmQuitOverlay").classList.add("hidden");
    // Annuler le timer courant
    clearInterval(state.timerInterval);
    // Annuler le timeout de passage à la question suivante
    if (state.quizAbort) {
      clearTimeout(state.quizAbort);
      state.quizAbort = null;
    }
    // Réinitialiser l'état du quiz
    state.quizQuestions = [];
    state.quizReponses = [];
    state.currentQuestionIndex = 0;
    showView("quiz-config");
    showToast("Quiz annulé.", "info");
  });

  // Fermer le dialog quitter avec Échap
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.getElementById("confirmQuitOverlay")?.classList.add("hidden");
    }
  });

  // ── Indice ROADY ──
  document.getElementById("indiceBtn").addEventListener("click", () => {
    playClick();
    requestIndice();
  });

  document.getElementById("roadyClose").addEventListener("click", () => {
    document.getElementById("roadyBubble").classList.add("hidden");
  });

  // ── Page résultats — accordion corrections ──
  document.getElementById("correctionsToggle").addEventListener("click", () => {
    playClick();
    const list = document.getElementById("correctionsList");
    list.classList.toggle("hidden");
    const svg = document.querySelector("#correctionsToggle svg");
    svg.style.transform = list.classList.contains("hidden")
      ? ""
      : "rotate(180deg)";
  });

  // ── Page résultats — actions ──
  document.getElementById("btnRecommencer").addEventListener("click", () => {
    playClick();
    showView("quiz-config");
  });

  document.getElementById("btnDashboard").addEventListener("click", () => {
    playClick();
    showView("dashboard");
    loadDashboard();
  });

  // ── Catalogue — barre de recherche ──
  document.getElementById("searchInput").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const activeCat =
      document.querySelector("#catFilters .cat-filter.active")?.dataset.cat ||
      "all";
    filterCatalogue(q, activeCat);
  });

  // ── Catalogue — filtres par catégorie ──
  document.getElementById("catFilters").addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-filter");
    if (!btn) return;
    playClick();
    document
      .querySelectorAll("#catFilters .cat-filter")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const cat = btn.dataset.cat;
    const q = document.getElementById("searchInput").value.toLowerCase();
    filterCatalogue(q, cat);
  });

  // ── Modale catalogue — fermeture ──
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("modalOverlay")) closeModal();
  });

  // ── Modale admin — fermeture ──
  document
    .getElementById("adminModalClose")
    .addEventListener("click", closeAdminModal);
  document
    .getElementById("adminModalOverlay")
    .addEventListener("click", (e) => {
      if (e.target === document.getElementById("adminModalOverlay"))
        closeAdminModal();
    });

  // ── Mode flash — pause / reprise ──
  document.getElementById("flashPause").addEventListener("click", () => {
    state.flashPaused = !state.flashPaused;
    document.getElementById("flashPause").textContent = state.flashPaused
      ? "▶ Reprendre"
      : "⏸ Pause";
    if (!state.flashPaused) startFlashTimer();
    else clearTimeout(state.flashTimer);
  });

  // ── Mode flash — passer au quiz ──
  document.getElementById("btnPasserQuiz").addEventListener("click", () => {
    playClick();
    clearTimeout(state.flashTimer);
    startQuiz();
  });

  // ── Mode flash — fin de révision ──
  document.getElementById("btnRevisionRevoir").addEventListener("click", () => {
    playClick();
    document.getElementById("flashEnd").classList.add("hidden");
    state.flashIndex = 0;
    renderFlashCard();
    startFlashTimer();
  });

  document.getElementById("btnRevisionLancer").addEventListener("click", () => {
    playClick();
    clearTimeout(state.flashTimer);
    startQuiz();
  });

  // ── Avatar — accès au profil ──
  document.getElementById("avatarBtn").addEventListener("click", () => {
    playClick();
    showView("profil");
    loadProfil();
  });

  // ── Navigation admin ──
  document
    .getElementById("adminSidebarNav")
    .addEventListener("click", async (e) => {
      const btn = e.target.closest(".admin-nav-btn");
      if (!btn) return;
      playClick();
      await loadAdminView(btn.dataset.adminSection);
    });

  document.getElementById("adminBackBtn").addEventListener("click", () => {
    playClick();
    showView("dashboard");
    loadDashboard();
  });

  document
    .getElementById("adminRefreshDashboard")
    .addEventListener("click", async () => {
      playClick();
      await loadAdminDashboard();
    });
  document
    .getElementById("adminRefreshUsers")
    .addEventListener("click", async () => {
      playClick();
      await loadAdminUsers();
    });
  document
    .getElementById("adminRefreshPanneaux")
    .addEventListener("click", async () => {
      playClick();
      await loadAdminPanneaux();
    });

  document.getElementById("adminAddUserBtn").addEventListener("click", () => {
    playClick();
    openAdminUserModal();
  });

  document
    .getElementById("adminAddPanneauBtn")
    .addEventListener("click", () => {
      playClick();
      openAdminPanneauModal();
    });

  document.getElementById("adminUserSearch").addEventListener("input", (e) => {
    state.adminUserSearch = e.target.value;
    renderAdminUsers();
  });

  document
    .getElementById("adminPanneauSearch")
    .addEventListener("input", (e) => {
      state.adminPanneauSearch = e.target.value;
      renderAdminPanneaux();
    });

  document
    .getElementById("adminPanneauFilters")
    .addEventListener("click", (e) => {
      const btn = e.target.closest(".cat-filter");
      if (!btn) return;
      playClick();
      document
        .querySelectorAll("#adminPanneauFilters .cat-filter")
        .forEach((item) => item.classList.remove("active"));
      btn.classList.add("active");
      state.adminPanneauFilter = btn.dataset.cat;
      renderAdminPanneaux();
    });

  document
    .getElementById("adminUsersTableBody")
    .addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-admin-edit-user]");
      const deleteBtn = e.target.closest("[data-admin-delete-user]");

      if (editBtn) {
        playClick();
        const user = state.adminUsers.find(
          (item) => Number(item.id) === Number(editBtn.dataset.adminEditUser),
        );
        if (user) openAdminUserModal(user);
      }

      if (deleteBtn) {
        playClick();
        confirmDeleteAdminUser(deleteBtn.dataset.adminDeleteUser);
      }
    });

  document
    .getElementById("adminPanneauxGrid")
    .addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-admin-edit-panneau]");
      const imageBtn = e.target.closest("[data-admin-image-panneau]");
      const deleteBtn = e.target.closest("[data-admin-delete-panneau]");

      if (editBtn) {
        playClick();
        const panneau = state.adminPanneaux.find(
          (item) =>
            Number(item.id) === Number(editBtn.dataset.adminEditPanneau),
        );
        if (panneau) openAdminPanneauModal(panneau);
      }

      if (imageBtn) {
        playClick();
        const panneau = state.adminPanneaux.find(
          (item) =>
            Number(item.id) === Number(imageBtn.dataset.adminImagePanneau),
        );
        if (panneau) openAdminPanneauModal(panneau, true);
      }

      if (deleteBtn) {
        playClick();
        confirmDeleteAdminPanneau(deleteBtn.dataset.adminDeletePanneau);
      }
    });

  // ── Certifications — bouton émettre ──
  document.getElementById("adminEmettreBtn").addEventListener("click", async () => {
    playClick();
    if (!state.adminEligibles || state.adminEligibles.length === 0) await loadAdminCertifications();
    // Switcher vers l'onglet éligibles
    switchCertTab("eligibles");
    showToast("Sélectionnez un utilisateur éligible et cliquez sur Certifier.", "info");
  });

  // ── Certifications — onglets ──
  document.querySelectorAll(".cert-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      playClick();
      switchCertTab(tab.dataset.certTab);
    });
  });

  // ── Certifications — certifier depuis la liste éligibles ──
  document.getElementById("adminEligiblesBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-admin-certifier]");
    if (!btn) return;
    playClick();
    certifierUtilisateur(Number(btn.dataset.adminCertifier));
  });

  // ── Certifications — actions tableau émises ──
  document.getElementById("adminCertTableBody").addEventListener("click", (e) => {
    const revokeBtn = e.target.closest("[data-admin-revoke-cert]");
    const previewBtn = e.target.closest("[data-admin-preview-cert]");

    if (revokeBtn) {
      playClick();
      confirmRevokeCert(Number(revokeBtn.dataset.adminRevokeCert));
    }
    if (previewBtn) {
      playClick();
      try {
        const data = JSON.parse(previewBtn.dataset.adminPreviewCert);
        openCertificatModal(data);
      } catch (_) {}
    }
  });

  // ── Modale certificat ──
  document.getElementById("certCloseBtn").addEventListener("click", closeCertificatModal);
  document.getElementById("certDownloadBtn").addEventListener("click", downloadCertificat);
  document.getElementById("certModalOverlay").addEventListener("click", (e) => {
    if (e.target === document.getElementById("certModalOverlay")) closeCertificatModal();
  });
});
