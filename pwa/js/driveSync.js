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
let pendingRestoreAfterConnect = false;
let restorePromptDismissed = false;

// Un appareil "vide" n'a jamais enregistre de transaction: c'est le cas d'un
// nouveau telephone/ordinateur, ou le portefeuille est encore a son etat
// initial et ou une restauration depuis Drive est probablement souhaitee.
function isDeviceEmpty() {
  return portfolio.transactions.length === 0;
}

function maybeShowRestorePrompt() {
  document.getElementById("restore-prompt").hidden = !(isDeviceEmpty() && !restorePromptDismissed);
}

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
        pendingRestoreAfterConnect = false;
        setDriveStatus(`Erreur de connexion Google: ${response.error}`);
        return;
      }
      driveAccessToken = response.access_token;
      setDriveConnectedUi(true);
      setDriveStatus("Connecté à Google Drive.");
      if (pendingRestoreAfterConnect) {
        pendingRestoreAfterConnect = false;
        restoreFromDrive();
      }
    },
  });
  return driveTokenClient;
}

function connectDrive() {
  const client = initDriveTokenClient();
  if (!client) {
    pendingRestoreAfterConnect = false;
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

async function readDriveBackup(fileId) {
  const resp = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Date de la derniere sauvegarde Drive vue par cet appareil (ecrite ou
// restauree). Si la sauvegarde distante est plus recente, un autre appareil
// l'a modifiee depuis: l'ecraser sans prevenir ferait perdre ces donnees.
const LAST_SYNC_KEY = "signaltrade_drive_last_sync";

function getLastSync() {
  return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0;
}

function setLastSync(timestamp) {
  localStorage.setItem(LAST_SYNC_KEY, String(timestamp));
}

function countTransactions(backup) {
  return ((backup && backup.portfolio && backup.portfolio.transactions) || []).length;
}

async function saveToDrive() {
  if (!driveAccessToken) {
    setDriveStatus("Connectez-vous d'abord à Google Drive.");
    return;
  }
  setDriveStatus("Sauvegarde en cours…");
  try {
    const savedAt = Date.now();
    const payload = JSON.stringify({ favorites: Array.from(favorites), portfolio, savedAt });
    const fileId = await findDriveFileId();

    if (fileId) {
      const remote = await readDriveBackup(fileId);
      if (remote.savedAt > getLastSync()) {
        const remoteDate = new Date(remote.savedAt).toLocaleString("fr-FR");
        const message =
          `La sauvegarde Drive (${remoteDate}, ${countTransactions(remote)} transaction(s)) contient des données que cet appareil n'a pas récupérées ` +
          `(enregistrées depuis un autre appareil ?).\n\n` +
          `Cet appareil : ${portfolio.transactions.length} transaction(s).\n\n` +
          `Écraser la sauvegarde Drive avec les données de cet appareil ?`;
        if (!confirm(message)) {
          setDriveStatus("Sauvegarde annulée : la sauvegarde Drive est conservée. Utilisez « Restaurer » pour la récupérer.");
          return;
        }
      }
    }

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
    setLastSync(savedAt);
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
    const data = await readDriveBackup(fileId);

    favorites.clear();
    (data.favorites || []).forEach((s) => favorites.add(s));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favorites)));

    portfolio = data.portfolio || portfolio;
    savePortfolio();
    setLastSync(data.savedAt || Date.now());
    favoriteEntriesLoaded = false;
    rankedEntriesLoaded = false;

    renderPortfolioPage();
    maybeShowRestorePrompt();
    setDriveStatus(`Restauré (sauvegarde du ${new Date(data.savedAt).toLocaleString("fr-FR")}).`);
  } catch (e) {
    setDriveStatus(`Erreur: ${e.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("drive-connect-btn").addEventListener("click", connectDrive);
  document.getElementById("drive-save-btn").addEventListener("click", saveToDrive);
  document.getElementById("drive-restore-btn").addEventListener("click", restoreFromDrive);

  document.getElementById("restore-prompt-yes").addEventListener("click", () => {
    restorePromptDismissed = true;
    maybeShowRestorePrompt();
    if (driveAccessToken) {
      restoreFromDrive();
    } else {
      pendingRestoreAfterConnect = true;
      connectDrive();
    }
  });
  document.getElementById("restore-prompt-later").addEventListener("click", () => {
    restorePromptDismissed = true;
    maybeShowRestorePrompt();
  });
});
