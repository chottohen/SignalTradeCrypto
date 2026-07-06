// Sauvegarde/restauration optionnelle des favoris + du portefeuille sur
// Google Drive, dans le dossier prive "appDataFolder" (invisible dans le
// Drive normal de l'utilisateur, dedie a cette appli uniquement).
//
// Flow OAuth implicite (Google Identity Services): le jeton d'acces vit en
// memoire seulement, pas de refresh token cote client possible sans
// backend. L'utilisateur devra donc parfois se reconnecter (jeton valable
// ~1h ou perdu au rechargement de la page). C'est un compromis assume pour
// rester 100% cote client, sans serveur a soi.

const DRIVE_FILE_NAME = "signaltrade-data.json";
let driveAccessToken = null;
let driveTokenClient = null;
let driveFileId = null;

function setDriveStatus(text) {
  document.getElementById("drive-status").textContent = text;
}

function setDriveConnectedUi(connected) {
  document.getElementById("drive-connect-btn").style.display = connected ? "none" : "inline-block";
  document.getElementById("drive-save-btn").style.display = connected ? "inline-block" : "none";
  document.getElementById("drive-restore-btn").style.display = connected ? "inline-block" : "none";
}

function initDriveTokenClient() {
  if (driveTokenClient || typeof google === "undefined") return driveTokenClient;
  driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_DRIVE_SCOPE,
    callback: (response) => {
      if (response.error) {
        setDriveStatus(`Erreur de connexion Google: ${response.error}`);
        return;
      }
      driveAccessToken = response.access_token;
      setDriveConnectedUi(true);
      setDriveStatus("Connecté à Google Drive.");
    },
  });
  return driveTokenClient;
}

function connectDrive() {
  const client = initDriveTokenClient();
  if (!client) {
    setDriveStatus("Service Google indisponible (hors ligne ?).");
    return;
  }
  client.requestAccessToken({ prompt: "consent" });
}

async function driveFetch(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${driveAccessToken}` },
  });
  if (resp.status === 401) {
    driveAccessToken = null;
    setDriveConnectedUi(false);
    throw new Error("Session Google expirée, reconnectez-vous.");
  }
  return resp;
}

async function findDriveFileId() {
  if (driveFileId) return driveFileId;
  const resp = await driveFetch(
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)&q=" +
      encodeURIComponent(`name='${DRIVE_FILE_NAME}'`)
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  driveFileId = data.files && data.files.length ? data.files[0].id : null;
  return driveFileId;
}

async function saveToDrive() {
  if (!driveAccessToken) {
    setDriveStatus("Connectez-vous d'abord à Google Drive.");
    return;
  }
  setDriveStatus("Sauvegarde en cours…");
  try {
    const payload = JSON.stringify({ favorites: Array.from(favorites), portfolio, savedAt: Date.now() });
    const fileId = await findDriveFileId();

    const metadata = { name: DRIVE_FILE_NAME, mimeType: "application/json" };
    if (!fileId) metadata.parents = ["appDataFolder"];

    const boundary = "signaltrade-boundary";
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;

    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const resp = await driveFetch(url, {
      method: fileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    driveFileId = data.id;
    setDriveStatus(`Sauvegardé sur Drive à ${new Date().toLocaleTimeString("fr-FR")}.`);
  } catch (e) {
    setDriveStatus(`Erreur: ${e.message}`);
  }
}

async function restoreFromDrive() {
  if (!driveAccessToken) {
    setDriveStatus("Connectez-vous d'abord à Google Drive.");
    return;
  }
  setDriveStatus("Restauration en cours…");
  try {
    const fileId = await findDriveFileId();
    if (!fileId) {
      setDriveStatus("Aucune sauvegarde trouvée sur Drive.");
      return;
    }
    const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    favorites.clear();
    (data.favorites || []).forEach((s) => favorites.add(s));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));

    portfolio = data.portfolio || portfolio;
    savePortfolio();
    favoriteEntriesLoaded = false;
    rankedEntriesLoaded = false;

    renderPortfolioPage();
    setDriveStatus(`Restauré (sauvegarde du ${new Date(data.savedAt).toLocaleString("fr-FR")}).`);
  } catch (e) {
    setDriveStatus(`Erreur: ${e.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("drive-connect-btn").addEventListener("click", connectDrive);
  document.getElementById("drive-save-btn").addEventListener("click", saveToDrive);
  document.getElementById("drive-restore-btn").addEventListener("click", restoreFromDrive);
});
