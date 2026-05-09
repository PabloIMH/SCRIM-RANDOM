import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs, limit, increment } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCjtOa52fMSsApcZLMk1n8iWqZzTwCT3hQ",
    authDomain: "scrims-random.firebaseapp.com",
    projectId: "scrims-random",
    storageBucket: "scrims-random.firebasestorage.app",
    messagingSenderId: "285560827053",
    appId: "1:285560827053:web:a6b653816fce33d17faa24",
    measurementId: "G-G10TYRKDE7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Variables de Estado Global
let allPlayers = {};
let tournamentPlayers = {};
let selectedPlayers = [];
let mode = 3;
let gameMode = 'aram';
let blueTeam = [];
let redTeam = [];
let tournamentHistory = [];
let totalMatchesPlayed = 0;
let captainsMode = false;
let currentRole = null;
const ROLES = ['TOP', 'JUNGLA', 'MID', 'ADC', 'SUPP'];
let aramRoleSelector = false;
let grietaDraft = false;
let draftActive = false;

let currentLvpTeam = null;
let currentLvpSessionId = null;
let currentLvpVotes = {};

// Room State
let currentRoomId = null;
let isAdmin = false;
let authMode = 'login';
let unsubscribeRoom = null;

// --- AUTH & ROOM LOGIC ---

onAuthStateChanged(auth, async (user) => {
    if (user) {
        await checkUserRoom(user);
    } else {
        if (!currentRoomId) showLanding();
    }
});

async function checkUserRoom(user) {
    const q = query(collection(db, "rooms"), where("ownerId", "==", user.uid), limit(1));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const roomDoc = querySnapshot.docs[0];
        enterRoom(roomDoc.id, true);
    } else if (!currentRoomId) {
        showLanding();
    }
}

window.showAuth = (type) => {
    authMode = type;
    document.getElementById('authTitle').textContent = type === 'login' ? 'INICIAR SESIÓN' : 'CREAR CUENTA';
    document.getElementById('authSubmitBtn').textContent = type === 'login' ? 'ENTRAR' : 'REGISTRARME Y CREAR SALA';
    document.getElementById('authSwitchText').innerHTML = type === 'login'
        ? '¿No tienes cuenta? <span onclick="window.showAuth(\'register\')">Regístrate</span>'
        : '¿Ya tienes cuenta? <span onclick="window.showAuth(\'login\')">Inicia Sesión</span>';
    document.getElementById('authSection').classList.remove('hidden');
};

window.hideAuth = () => {
    document.getElementById('authSection').classList.add('hidden');
};

window.togglePasswordVisibility = () => {
    const pwdInput = document.getElementById('authPassword');
    const icon = document.getElementById('passwordIcon');
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        icon.textContent = '🙈';
    } else {
        pwdInput.type = 'password';
        icon.textContent = '👁️';
    }
};

function getFriendlyErrorMessage(code) {
    switch (code) {
        case 'auth/invalid-email':
            return "El correo electrónico no es válido.";
        case 'auth/user-disabled':
            return "Esta cuenta ha sido desactivada.";
        case 'auth/user-not-found':
            return "No existe ninguna cuenta con este correo.";
        case 'auth/wrong-password':
            return "La contraseña es incorrecta.";
        case 'auth/invalid-credential':
            return "Credenciales incorrectas. Revisa tu email y contraseña.";
        case 'auth/email-already-in-use':
            return "Este correo ya está registrado.";
        case 'auth/weak-password':
            return "La contraseña es muy débil (mínimo 6 caracteres).";
        case 'auth/too-many-requests':
            return "Demasiados intentos fallidos. Intenta más tarde.";
        default:
            return "Ocurrió un error inesperado. Intenta de nuevo.";
    }
}

window.handleAuthSubmit = async () => {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;

    if (!email || !password) {
        showAlert("⚠️ ERROR", "Completa todos los campos.");
        return;
    }

    showLoading(true);
    try {
        if (authMode === 'login') {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await createNewRoom(userCredential.user.uid);
        }
        hideAuth();
    } catch (error) {
        console.error("Error Auth:", error);
        const friendlyMsg = getFriendlyErrorMessage(error.code);
        showAlert("❌ ERROR", friendlyMsg);
    } finally {
        showLoading(false);
    }
};

async function createNewRoom(userId) {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const adminCode = "ADM-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    const roomRef = doc(db, "rooms", roomId);
    const initialData = {
        ownerId: userId,
        adminCode: adminCode,
        allPlayers: {},
        selectedPlayers: [],
        mode: 3,
        gameMode: 'aram',
        tournamentPlayers: {},
        tournamentHistory: [],
        totalMatchesPlayed: 0,
        createdAt: new Date().toISOString()
    };
    await setDoc(roomRef, initialData);
    enterRoom(roomId, true);
}

window.joinRoom = async () => {
    const code = document.getElementById('joinRoomInput').value.trim().toUpperCase();
    if (!code) return;

    showLoading(true);
    try {
        // 1. Intentar entrar como Dueño/Lector (por ID de sala)
        const roomRef = doc(db, "rooms", code);
        const roomSnap = await getDoc(roomRef);

        if (roomSnap.exists()) {
            enterRoom(code, false); // Entra como lector por defecto
            return;
        }

        // 2. Intentar entrar como Administrador (por Código Admin)
        const q = query(collection(db, "rooms"), where("adminCode", "==", code), limit(1));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const roomDoc = querySnapshot.docs[0];
            enterRoom(roomDoc.id, true); // Entra como admin
        } else {
            showAlert("⚠️ NO ENCONTRADA", "El código no corresponde a ninguna sala activa.");
        }
    } catch (error) {
        console.error(error);
        showAlert("❌ ERROR", "Error al intentar unirse.");
    } finally {
        showLoading(false);
    }
};

function enterRoom(roomId, asAdmin) {
    currentRoomId = roomId;
    isAdmin = asAdmin;

    document.getElementById('landingPage').classList.add('hidden');
    document.getElementById('roomContent').classList.remove('hidden');
    document.getElementById('displayRoomId').textContent = roomId;

    startRoomListener(roomId);

    const url = new URL(window.location);
    url.searchParams.set('room', roomId);
    window.history.pushState({}, '', url);
}

let lastMatchTimestamp = null;

function startRoomListener(roomId) {
    if (unsubscribeRoom) unsubscribeRoom();

    unsubscribeRoom = onSnapshot(doc(db, "rooms", roomId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            allPlayers = data.allPlayers || {};
            tournamentPlayers = data.tournamentPlayers || {};
            tournamentHistory = data.tournamentHistory || [];
            totalMatchesPlayed = data.totalMatchesPlayed || 0;
            selectedPlayers = data.selectedPlayers || [];
            mode = data.mode || 3;
            gameMode = data.gameMode || 'aram';
            captainsMode = data.captainsMode || false;
            aramRoleSelector = data.aramRoleSelector || false;
            grietaDraft = data.grietaDraft || false;
            draftActive = data.draftActive || false;

            // Mostrar modal de LVP en vivo para todos
            if (data.lvpVotingActive) {
                currentLvpTeam = data.lvpTeam;
                currentLvpSessionId = data.lvpSessionId;
                currentLvpVotes = data.lvpVotes || {};
                renderLvpLiveModal();
            } else {
                const existingModal = document.getElementById('lvpLiveModal');
                if (existingModal) existingModal.remove();
                currentLvpTeam = null;
                currentLvpSessionId = null;
                currentLvpVotes = {};
            }

            // Sincronizar checkboxes (evitar bucles infinitos con checks silenciosos)
            const chkCaptains = document.getElementById('captainsModeToggle');
            const chkAramRole = document.getElementById('aramRoleSelectorToggle');
            const chkGrietaDraft = document.getElementById('grietaDraftToggle');
            if (chkCaptains) chkCaptains.checked = captainsMode;
            if (chkAramRole) chkAramRole.checked = aramRoleSelector;
            if (chkGrietaDraft) chkGrietaDraft.checked = grietaDraft;

            // Sincronizar Modo Capitanes "En Vivo"
            if (draftActive && data.currentDraft) {
                captains = data.currentDraft.captains;
                currentTurn = data.currentDraft.currentTurn;
                availableForCaptains = data.currentDraft.availablePlayers;
                blueTeam = data.currentDraft.blueTeam;
                redTeam = data.currentDraft.redTeam;

                document.getElementById('captainOverlay').classList.add('show');
                document.getElementById('captainInterface').classList.remove('hidden');
                renderCaptainInterface();
            } else {
                document.getElementById('captainOverlay').classList.remove('show');
                document.getElementById('captainInterface').classList.add('hidden');
            }

            // Mostrar código admin si es admin o dueño
            const user = auth.currentUser;
            const isOwner = user && data.ownerId === user.uid;

            if (isOwner) isAdmin = true;

            const adminDisplay = document.getElementById('adminCodeDisplay');
            if (isAdmin || isOwner) {
                const code = data.adminCode || 'NO DISPONIBLE';
                adminDisplay.innerHTML = ` | <span style="color:#ff00ff">ADMIN:</span> ${code} <button class="copy-btn" onclick="window.copyAdminCode('${code}')">📋</button>`;
                adminDisplay.style.display = '';
            } else {
                adminDisplay.innerHTML = '';
                adminDisplay.style.display = 'none';
            }

            // Aplicar visibilidad de admin
            document.querySelectorAll('.admin-only').forEach(el => {
                el.classList.toggle('hidden', !isAdmin);
            });
            document.querySelectorAll('.not-admin-only').forEach(el => {
                el.classList.toggle('hidden', isAdmin);
            });

            // Si hay un equipo generado actualmente
            if (data.currentMatch) {
                const matchChanged = data.currentMatch.timestamp !== lastMatchTimestamp;

                blueTeam = data.currentMatch.blueTeam;
                redTeam = data.currentMatch.redTeam;
                updateTeamsUI();

                const roleAnnouncement = document.getElementById('roleAnnouncement');
                if (data.currentMatch.currentRole) {
                    document.getElementById('announcedRole').textContent = data.currentMatch.currentRole;
                    if (roleAnnouncement) roleAnnouncement.classList.remove('hidden');
                } else {
                    if (roleAnnouncement) roleAnnouncement.classList.add('hidden');
                }

                if (matchChanged) {
                    lastMatchTimestamp = data.currentMatch.timestamp;
                    triggerRevealFanfare();
                } else {
                    document.getElementById('teamsSection').classList.remove('hidden');
                }
            } else if (!draftActive) { // No ocultar si el draft está activo
                document.getElementById('teamsSection').classList.add('hidden');
                lastMatchTimestamp = null;
            }

            renderAllPlayers();
            renderPlayerPool();
            updateLeaderboard();
            updateHistory();
            updateTournamentProgress();
            updateModeUI(); // Sincronizar botones de modo

            if (document.getElementById('mainContent').classList.contains('hidden')) {
                document.getElementById('mainContent').classList.remove('hidden');
            }
        }
    });
}

function updateModeUI() {
    // Sincronizar botones de modo (3v3, 4v4, 5v5)
    document.querySelectorAll('.mode-btn').forEach(btn => {
        const val = parseInt(btn.textContent);
        btn.classList.toggle('active', val === mode);
    });

    // Sincronizar botones de modo de juego (ARAM/GRIETA)
    const btnAram = document.getElementById('btnAram');
    const btnGrieta = document.getElementById('btnGrieta');
    if (btnAram) btnAram.classList.toggle('active', gameMode === 'aram');
    if (btnGrieta) btnGrieta.classList.toggle('active', gameMode === 'grieta');

    // Visibilidad de switches según el rol (Admin vs Lector)
    const aramSwitch = document.getElementById('aramRoleSwitch');
    const grietaSwitch = document.getElementById('grietaDraftSwitch');
    const captainsSection = document.getElementById('grietaCaptainsSection');

    if (isAdmin) {
        // Admin: ve los switches según el modo de juego
        if (aramSwitch) aramSwitch.classList.toggle('hidden', gameMode !== 'aram');
        if (grietaSwitch) grietaSwitch.classList.toggle('hidden', gameMode !== 'grieta');
        if (captainsSection) captainsSection.classList.toggle('hidden', gameMode !== 'grieta');
    } else {
        // Lector: SOLO ve los switches si están activos Y corresponden al modo de juego
        if (aramSwitch) aramSwitch.classList.toggle('hidden', gameMode !== 'aram' || !aramRoleSelector);
        if (grietaSwitch) grietaSwitch.classList.toggle('hidden', gameMode !== 'grieta' || !grietaDraft);
        if (captainsSection) captainsSection.classList.toggle('hidden', gameMode !== 'grieta' || !captainsMode);
    }

    // Interfaz de selección de capitanes (selectores de capitanes)
    const captainsSelectUI = document.getElementById('captainsSelection');
    if (captainsSelectUI) {
        captainsSelectUI.classList.toggle('hidden', !captainsMode || draftActive);
    }

    // Deshabilitar controles si no es admin
    const gameModeSelector = document.getElementById('gameModeSelector');
    const modeSelector = document.getElementById('modeSelector');
    const toggles = ['captainsModeToggle', 'aramRoleSelectorToggle', 'grietaDraftToggle'];

    if (gameModeSelector) gameModeSelector.classList.toggle('readonly-control', !isAdmin);
    if (modeSelector) modeSelector.classList.toggle('readonly-control', !isAdmin);
    toggles.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = !isAdmin;
    });

}

function triggerRevealFanfare() {
    const overlay = document.getElementById('revealOverlay');
    const text = document.getElementById('revealText');
    const teamsSection = document.getElementById('teamsSection');

    // Ocultar equipos inicialmente
    teamsSection.classList.add('hidden');
    teamsSection.classList.remove('reveal-teams-anim');

    overlay.classList.remove('hidden');

    const messages = ["¡PREPAREN EL ANASTASIO!", "¡SIN LLOROS POR LOS EQUIPOS!", "¡ATRAPAR LA MOSCA!"];
    let i = 0;

    const interval = setInterval(() => {
        i++;
        if (i < messages.length) {
            text.textContent = messages[i];
        } else {
            clearInterval(interval);
        }
    }, 800);

    setTimeout(() => {
        overlay.classList.add('hidden');
        teamsSection.classList.remove('hidden');
        teamsSection.classList.add('reveal-teams-anim');

        // Scroll automático hacia los equipos
        setTimeout(() => {
            teamsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }, 2800);
}

function showLanding() {
    document.getElementById('landingPage').classList.remove('hidden');
    document.getElementById('roomContent').classList.add('hidden');
    document.getElementById('mainContent').classList.add('hidden');
    if (unsubscribeRoom) unsubscribeRoom();
}

window.logout = async () => {
    await signOut(auth);
    isAdmin = false;
    currentRoomId = null;
    showLanding();
    const url = new URL(window.location);
    url.searchParams.delete('room');
    window.history.pushState({}, '', url);
};

window.copyRoomCode = () => {
    navigator.clipboard.writeText(currentRoomId);
    showAlert("📋 COPIADO", "Código de sala copiado al portapapeles.");
};

// --- LOGICA DE JUEGO ---

async function saveToFirebase(showLoader = true) {
    if (!isAdmin) return;
    if (showLoader) showLoading(true);
    try {
        const roomRef = doc(db, "rooms", currentRoomId);
        await updateDoc(roomRef, {
            allPlayers,
            selectedPlayers,
            mode,
            gameMode,
            captainsMode,
            aramRoleSelector,
            grietaDraft,
            draftActive,
            currentDraft: draftActive ? {
                captains,
                currentTurn,
                availablePlayers: availableForCaptains,
                blueTeam,
                redTeam
            } : null,
            tournamentPlayers,
            tournamentHistory,
            totalMatchesPlayed,
            lastUpdate: new Date().toISOString()
        });
    } catch (error) {
        console.error("Error guardando:", error);
        showAlert("❌ ERROR", "No tienes permisos de administrador.");
    } finally {
        if (showLoader) showLoading(false);
    }
}

function addNewPlayer() {
    if (!isAdmin) return;
    const input = document.getElementById('playerInput');
    const nick = input.value.trim().toUpperCase();
    if (!nick) return;
    if (allPlayers[nick]) {
        showAlert('⚠️ JUGADOR EXISTENTE', 'Ese nick ya está en la lista.');
        return;
    }
    allPlayers[nick] = true;
    input.value = '';
    saveToFirebase(false);
}

window.confirmRemovePlayer = (nick) => {
    if (!isAdmin) return;
    showAlert('🗑️ ELIMINAR JUGADOR', `¿Estás seguro de que quieres eliminar a ${nick} de la lista permanente?`, [
        { text: 'CANCELAR', action: null },
        { text: 'ELIMINAR', danger: true, action: () => removePlayer(nick) }
    ]);
};

function removePlayer(nick) {
    delete allPlayers[nick];
    selectedPlayers = selectedPlayers.filter(p => p !== nick);
    saveToFirebase(false);
    renderAllPlayers();
    renderPlayerPool();
}

window.editPlayerName = (oldNick) => {
    if (!isAdmin) return;
    showAlert('✎ EDITAR NICK', 'Ingresa el nuevo nombre:', [
        { text: 'CANCELAR', action: null },
        {
            text: 'GUARDAR', action: () => {
                const newNick = document.getElementById('alertInput').value.trim().toUpperCase();
                if (!newNick || newNick === oldNick) return;
                if (allPlayers[newNick]) {
                    showAlert('⚠️ ERROR', 'Ese nick ya existe.');
                    return;
                }

                // 1. Mover en allPlayers
                allPlayers[newNick] = true;
                delete allPlayers[oldNick];

                // 2. Actualizar en lobby (selectedPlayers)
                selectedPlayers = selectedPlayers.map(p => p === oldNick ? newNick : p);

                // 3. Actualizar en liga (tournamentPlayers)
                if (tournamentPlayers[oldNick]) {
                    tournamentPlayers[newNick] = { ...tournamentPlayers[oldNick] };
                    delete tournamentPlayers[oldNick];
                }

                saveToFirebase(false);
                renderAllPlayers();
                renderPlayerPool();
            }
        }
    ], true, oldNick);
};

window.togglePlayerSelection = (nick) => {
    if (!isAdmin) return; // Solo el admin selecciona
    const idx = selectedPlayers.indexOf(nick);
    if (idx === -1) {
        if (selectedPlayers.length >= mode * 2) {
            showAlert('⚠️ LOBBY LLENO', `El modo actual es ${mode}v${mode}. Máximo ${mode * 2} jugadores.`);
            return;
        }
        selectedPlayers.push(nick);
    } else {
        selectedPlayers.splice(idx, 1);
    }
    saveToFirebase(false);
};

function renderAllPlayers() {
    const container = document.getElementById('allPlayers');
    if (!container) return;

    // Obtener el término de búsqueda
    const searchInput = document.getElementById('searchSaved');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    // Filtrar y ordenar nicks
    const sortedNicks = Object.keys(allPlayers)
        .filter(nick => nick.toLowerCase().includes(searchTerm))
        .sort();

    if (sortedNicks.length === 0) {
        container.innerHTML = `<div style="color: rgba(255,255,255,0.2); width: 100%; text-align: center; padding: 15px;">
            ${searchTerm ? 'No se encontraron coincidencias' : 'No hay jugadores guardados'}
        </div>`;
        return;
    }

    container.innerHTML = sortedNicks.map(nick => {
        const isSelected = selectedPlayers.includes(nick);
        // ID seguro para el menu (sin espacios ni caracteres raros)
        const menuId = `menu-${nick.replace(/\s+/g, '-')}`;
        return `<div class="player-card ${isSelected ? 'selected' : ''}" onclick="window.togglePlayerSelection('${nick}')">
            ${nick}
            ${isAdmin ? `
                <div class="card-menu" onclick="event.stopPropagation()">
                    <button class="menu-dots" onclick="window.toggleCardMenu(event, '${menuId}')">⋮</button>
                    <div class="menu-dropdown" id="${menuId}">
                        <div class="menu-item" onclick="window.editPlayerName('${nick}')">✎ Editar</div>
                        <div class="menu-item danger" onclick="window.confirmRemovePlayer('${nick}')">× Eliminar</div>
                    </div>
                </div>
            ` : ''}
        </div>`;
    }).join('');
}

window.toggleCardMenu = (event, menuId) => {
    // Cerrar otros menús primero
    document.querySelectorAll('.menu-dropdown').forEach(m => {
        if (m.id !== menuId) {
            m.classList.remove('show');
            m.closest('.player-card')?.classList.remove('menu-open');
        }
    });

    const menu = document.getElementById(menuId);
    const card = event.target.closest('.player-card');

    if (menu && card) {
        const isOpening = !menu.classList.contains('show');
        menu.classList.toggle('show');
        card.classList.toggle('menu-open', isOpening);
    }
};

// Cerrar menús al hacer clic fuera
document.addEventListener('click', (e) => {
    if (!e.target.closest('.card-menu')) {
        document.querySelectorAll('.menu-dropdown').forEach(m => m.classList.remove('show'));
        document.querySelectorAll('.player-card').forEach(c => c.classList.remove('menu-open'));
    }
});

function renderPlayerPool() {
    const container = document.getElementById('playerPool');
    const counter = document.getElementById('lobbyCounter');
    if (!container || !counter) return;

    const searchInput = document.getElementById('searchLobby');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    counter.textContent = `(${selectedPlayers.length}/${mode * 2})`;

    // Alerta visual si sobran jugadores
    if (selectedPlayers.length > mode * 2) {
        counter.style.color = '#ff4d4d';
        counter.style.textShadow = '0 0 10px rgba(255, 77, 77, 0.5)';
    } else {
        counter.style.color = '#00ffff';
        counter.style.textShadow = 'none';
    }

    // Filtrar jugadores seleccionados
    const filteredPool = selectedPlayers.filter(nick => nick.toLowerCase().includes(searchTerm));

    if (captainsMode) updateCaptainSelects();

    if (filteredPool.length === 0) {
        container.innerHTML = `<div style="color: rgba(255,255,255,0.2); width: 100%; text-align: center; padding: 15px;">
            ${searchTerm ? 'No está en el lobby' : 'Selecciona jugadores arriba...'}
        </div>`;
        return;
    }

    container.innerHTML = filteredPool.map(nick => `<div class="player-tag">
        <span>${nick}</span>
        <span class="remove" onclick="window.togglePlayerSelection('${nick}')">×</span>
    </div>`).join('');
}

function generateTeams() {
    if (!isAdmin) return;
    if (selectedPlayers.length < mode * 2) {
        showAlert('⚠️ JUGADORES INSUFICIENTES', `Se necesitan ${mode * 2} jugadores.`);
        return;
    }

    if (gameMode === 'grieta' && captainsMode) {
        window.startCaptainSelection();
        return;
    }

    const shuffled = [...selectedPlayers].sort(() => Math.random() - 0.5);
    
    if (gameMode === 'grieta' && grietaDraft) {
        const blueRoles = [...ROLES].sort(() => Math.random() - 0.5);
        const redRoles = [...ROLES].sort(() => Math.random() - 0.5);
        blueTeam = shuffled.slice(0, mode).map((nick, i) => ({ nick, role: blueRoles[i] || 'COMODÍN' }));
        redTeam = shuffled.slice(mode, mode * 2).map((nick, i) => ({ nick, role: redRoles[i] || 'COMODÍN' }));
        
        blueTeam.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
        redTeam.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    } else {
        blueTeam = shuffled.slice(0, mode);
        redTeam = shuffled.slice(mode, mode * 2);
    }

    if (gameMode === 'aram' && aramRoleSelector) {
        currentRole = ROLES[Math.floor(Math.random() * ROLES.length)];
    } else {
        currentRole = null;
    }

    updateTeamsUI();
    document.getElementById('teamsSection').classList.remove('hidden');
    saveTeamsToFirebase();
}

async function saveTeamsToFirebase() {
    if (!isAdmin) return;
    const matchData = {
        blueTeam,
        redTeam,
        gameMode,
        timestamp: new Date().toISOString()
    };
    if (currentRole) {
        matchData.currentRole = currentRole;
    }
    await updateDoc(doc(db, "rooms", currentRoomId), {
        currentMatch: matchData,
        draftActive: false,
        currentDraft: null
    });
}

function updateTeamsUI() {
    const renderPlayer = (p) => {
        if (typeof p === 'object' && p !== null) {
            return `<li>⚔️ ${p.nick} <span style="color: #ff00ff; font-size: 0.85em; margin-left: 8px;">[${p.role}]</span></li>`;
        }
        return `<li>⚔️ ${p}</li>`;
    };
    document.getElementById('blueTeam').innerHTML = blueTeam.map(renderPlayer).join('');
    document.getElementById('redTeam').innerHTML = redTeam.map(renderPlayer).join('');
}

window.declareWinner = async (team) => {
    if (!isAdmin) return;
    
    showAlert('🤡 VOTACIÓN DE JMM', '¿Deseas votar por el Jugador Más Manco (JMM) de esta partida?', [
        { text: 'NO, GUARDAR DIRECTO', action: () => processMatchResult(team, null) },
        { text: 'SÍ, VOTAR JMM', action: () => promptLVP(team) }
    ]);
};

window.promptLVP = async (team) => {
    const sessionId = Date.now().toString();
    await updateDoc(doc(db, "rooms", currentRoomId), { 
        lvpVotingActive: true,
        lvpTeam: team,
        lvpSessionId: sessionId,
        lvpVotes: {}
    });
};

function renderLvpLiveModal() {
    let modal = document.getElementById('lvpLiveModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'lvpLiveModal';
        modal.className = 'custom-alert show';
        document.body.appendChild(modal);
    }
    
    const allMatchPlayers = [...blueTeam, ...redTeam];
    
    const sortedPlayers = allMatchPlayers.map(p => typeof p === 'object' && p !== null ? p.nick : p)
        .sort((a, b) => {
            const votesA = currentLvpVotes[a] || 0;
            const votesB = currentLvpVotes[b] || 0;
            return votesB - votesA;
        });
    
    const listHtml = sortedPlayers.map(nick => {
        const votes = currentLvpVotes[nick] || 0;
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 8px 15px; margin-bottom: 5px; border-radius: 5px;">
                <span style="font-size: 1.1rem; color: #fff;">${nick}</span>
                <div style="display: flex; align-items: center; gap: 15px;">
                    <span style="color: #ff00ff; font-weight: bold;">${votes} votos</span>
                    <button class="btn btn-primary" style="padding: 5px 10px; font-size: 0.9rem;" onclick="submitLiveVote('${nick}')">VOTAR</button>
                </div>
            </div>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="custom-alert-box" style="max-width: 500px; width: 90%;">
            <h3>🤡 VOTACIÓN EN VIVO JMM</h3>
            <p style="margin-bottom: 15px;">¡Vota por el jugador más manco de la partida!</p>
            <div style="max-height: 250px; overflow-y: auto; text-align: left;">
                ${listHtml}
            </div>
            ${isAdmin ? `
            <div class="custom-alert-buttons" style="margin-top: 20px;">
                <button class="btn" style="background: #333; color: white;" onclick="cancelLvpVoting()">CANCELAR</button>
                <button class="btn btn-success" onclick="closeLvpVotingAndSave()">CERRAR Y GUARDAR</button>
            </div>
            ` : `
            <div style="margin-top: 20px; font-size: 0.9rem; color: #888;">
                Esperando a que el administrador cierre la votación...
            </div>
            `}
        </div>
    `;
}

window.submitLiveVote = async (nick) => {
    if (!currentLvpSessionId) return;
    const storageKey = `voted_lvp_${currentRoomId}_${currentLvpSessionId}`;
    if (localStorage.getItem(storageKey)) {
        return showAlert('⚠️ YA VOTASTE', 'Solo se permite un voto por persona en esta partida.');
    }
    
    try {
        await updateDoc(doc(db, "rooms", currentRoomId), {
            [`lvpVotes.${nick}`]: increment(1)
        });
        localStorage.setItem(storageKey, 'true');
    } catch (error) {
        console.error("Error voting:", error);
        showAlert('❌ ERROR', 'No se pudo guardar el voto. Posible falta de permisos en Firestore.');
    }
};

window.cancelLvpVoting = async () => {
    if (!isAdmin) return;
    await updateDoc(doc(db, "rooms", currentRoomId), { lvpVotingActive: false });
};

window.closeLvpVotingAndSave = () => {
    if (!isAdmin) return;
    let maxVotes = 0;
    let lvpPlayer = null;
    
    for (const [nick, votes] of Object.entries(currentLvpVotes)) {
        if (votes > maxVotes) {
            maxVotes = votes;
            lvpPlayer = nick;
        }
    }
    
    processMatchResult(currentLvpTeam, lvpPlayer);
};

async function processMatchResult(team, lvpPlayer) {
    showLoading(true);
    try {
        const winners = team === 'blue' ? blueTeam : redTeam;
        const losers = team === 'blue' ? redTeam : blueTeam;

        winners.forEach(p => {
            const nick = typeof p === 'object' && p !== null ? p.nick : p;
            if (!tournamentPlayers[nick]) tournamentPlayers[nick] = { points: 0, matches: 0, lvp: 0 };
            tournamentPlayers[nick].points++;
            tournamentPlayers[nick].matches++;
        });
        losers.forEach(p => {
            const nick = typeof p === 'object' && p !== null ? p.nick : p;
            if (!tournamentPlayers[nick]) tournamentPlayers[nick] = { points: 0, matches: 0, lvp: 0 };
            tournamentPlayers[nick].matches++;
        });
        
        if (lvpPlayer) {
            if (!tournamentPlayers[lvpPlayer]) tournamentPlayers[lvpPlayer] = { points: 0, matches: 0, lvp: 0 };
            tournamentPlayers[lvpPlayer].lvp = (tournamentPlayers[lvpPlayer].lvp || 0) + 1;
        }
        
        totalMatchesPlayed++;

        await saveToFirebase(false);
        await updateDoc(doc(db, "rooms", currentRoomId), { currentMatch: null, lvpVotingActive: false });

        blueTeam = [];
        redTeam = [];
        document.getElementById('teamsSection').classList.add('hidden');
        
        if (lvpPlayer) {
            showAlert('🤡 RESULTADO GUARDADO', `¡El equipo ${team === 'blue' ? 'AZUL' : 'ROJO'} ganó!\n\nSe sumó 1 punto de JMM a ${lvpPlayer}.`);
        } else {
            showAlert('🏆 VICTORIA', `¡El equipo ${team === 'blue' ? 'AZUL' : 'ROJO'} ha ganado!`);
        }
    } catch(err) {
        console.error(err);
        showAlert("❌ ERROR", "Error al guardar el resultado.");
    } finally {
        showLoading(false);
    }
}

async function cancelMatch() {
    if (!isAdmin) return;

    showAlert('⚠️ CANCELAR PARTIDA', '¿Estás seguro de que quieres cancelar esta partida? No se guardarán resultados.', [
        { text: 'NO, VOLVER', action: null },
        {
            text: 'SÍ, CANCELAR', danger: true, action: async () => {
                showLoading(true);
                try {
                    await updateDoc(doc(db, "rooms", currentRoomId), { currentMatch: null });
                    blueTeam = [];
                    redTeam = [];
                    document.getElementById('teamsSection').classList.add('hidden');
                } catch (error) {
                    console.error("Error al cancelar:", error);
                    showAlert("❌ ERROR", "No se pudo cancelar la partida.");
                } finally {
                    showLoading(false);
                }
            }
        }
    ]);
}

function updateLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    const sorted = Object.entries(tournamentPlayers).sort((a, b) => b[1].points - a[1].points || b[1].matches - a[1].matches);
    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.3);">Sin jugadores en la liga</td></tr>';
        return;
    }
    tbody.innerHTML = sorted.map(([nick, stats], i) => `<tr>
        <td class="rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</td>
        <td>${nick}</td>
        <td>${stats.points}</td>
        <td>${stats.matches}</td>
        <td>${stats.lvp || 0}</td>
    </tr>`).join('');
}

function updateTournamentProgress() {
    const landing = document.getElementById('tournamentProgressLanding');
    const room = document.getElementById('roomTournamentProgress');
    const text = `Partidas de esta liga: ${totalMatchesPlayed}`;
    if (landing) landing.textContent = text;
    if (room) room.textContent = text;
}

function updateHistory() {
    const tbody = document.getElementById('historyBody');
    if (tournamentHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: rgba(255,255,255,0.3);">Sin torneos registrados</td></tr>';
        return;
    }
    tbody.innerHTML = tournamentHistory.map(h => `<tr>
        <td>${h.date}</td>
        <td>${h.gameMode}</td>
        <td>${h.first ? h.first.nick : '-'}</td>
        <td>${h.second ? h.second.nick : '-'}</td>
        <td>${h.third ? h.third.nick : '-'}</td>
        <td>${h.matches}</td>
    </tr>`).join('');
}

async function resetTournament() {
    if (!isAdmin) return;
    const sorted = Object.entries(tournamentPlayers).sort((a, b) => b[1].points - a[1].points);
    const historyEntry = {
        date: new Date().toLocaleDateString('es-CL'),
        gameMode: 'Liga Semanal',
        first: sorted[0] ? { nick: sorted[0][0], points: sorted[0][1].points } : null,
        second: sorted[1] ? { nick: sorted[1][0], points: sorted[1][1].points } : null,
        third: sorted[2] ? { nick: sorted[2][0], points: sorted[2][1].points } : null,
        matches: `${totalMatchesPlayed} partidas`
    };
    tournamentHistory.unshift(historyEntry);
    tournamentPlayers = {};
    totalMatchesPlayed = 0;
    await saveToFirebase(true);
    showAlert('✅ LIGA CERRADA', 'Liga guardada en el historial.');
}

// Utils
window.showAlert = (title, message, buttons = [{ text: 'OK', action: null }], hasInput = false, defaultValue = '') => {
    document.getElementById('alertTitle').textContent = title;
    const msgEl = document.getElementById('alertMessage');

    if (hasInput) {
        msgEl.innerHTML = `
            <div style="margin-bottom: 10px;">${message}</div>
            <input type="text" id="alertInput" value="${defaultValue}" autocomplete="off">
        `;
        setTimeout(() => document.getElementById('alertInput').focus(), 100);
    } else {
        msgEl.innerHTML = message;
    }

    const btnContainer = document.getElementById('alertButtons');
    btnContainer.innerHTML = '';
    buttons.forEach(b => {
        const button = document.createElement('button');
        button.className = `btn ${b.danger ? 'btn-danger' : ''}`;
        button.textContent = b.text;
        button.onclick = () => {
            closeAlert();
            if (b.action) setTimeout(b.action, 50);
        };
        btnContainer.appendChild(button);
    });
    document.getElementById('alertOverlay').style.zIndex = '99998';
    document.getElementById('alertOverlay').classList.add('show');
    document.getElementById('customAlert').style.zIndex = '99999';
    document.getElementById('customAlert').classList.add('show');
};

const closeAlert = () => {
    document.getElementById('alertOverlay').classList.remove('show');
    document.getElementById('customAlert').classList.remove('show');
};

const showLoading = (show) => {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
};

// Exponer funciones
window.addNewPlayer = addNewPlayer;
window.removePlayer = removePlayer;
window.generateTeams = generateTeams;
window.declareWinner = declareWinner;
window.cancelMatch = cancelMatch;
window.renderAllPlayers = renderAllPlayers;
window.renderPlayerPool = renderPlayerPool; // <--- Y ESTA
window.setMode = (e, m) => {
    if (!isAdmin) return;
    mode = m;
    saveToFirebase(false);
};
window.setGameMode = (e, m) => {
    if (!isAdmin) return;
    gameMode = m;
    saveToFirebase(false);
};
window.confirmResetTournament = () => {
    if (!isAdmin) return;
    showAlert('📅 CERRAR LIGA', '¿Cerrar la liga y guardar en historial?', [
        { text: 'CANCELAR', action: null },
        { text: 'CERRAR', danger: true, action: resetTournament }
    ]);
};

window.syncSettings = () => {
    if (!isAdmin) return;
    captainsMode = document.getElementById('captainsModeToggle').checked;
    aramRoleSelector = document.getElementById('aramRoleSelectorToggle').checked;
    grietaDraft = document.getElementById('grietaDraftToggle').checked;
    saveToFirebase(false);
};

// --- MODO CAPITANES ---
let captains = { blue: '', red: '' };
let currentTurn = 'blue';
let availableForCaptains = [];

window.toggleCaptainsMode = () => {
    if (!isAdmin) return;
    captainsMode = document.getElementById('captainsModeToggle').checked;
    document.getElementById('captainsSelection').classList.toggle('hidden', !captainsMode);
    if (captainsMode) {
        updateCaptainSelects();
    }
};

function updateCaptainSelects() {
    const blueSelect = document.getElementById('blueCaptainSelect');
    const redSelect = document.getElementById('redCaptainSelect');
    
    if (!blueSelect || !redSelect) return;

    const currentBlue = blueSelect.value;
    const currentRed = redSelect.value;

    const options = selectedPlayers.map(p => `<option value="${p}">${p}</option>`).join('');
    const placeholder = '<option value="">Seleccionar...</option>';
    
    blueSelect.innerHTML = placeholder + options;
    redSelect.innerHTML = placeholder + options;

    if (selectedPlayers.includes(currentBlue)) blueSelect.value = currentBlue;
    if (selectedPlayers.includes(currentRed)) redSelect.value = currentRed;
}

window.selectCaptain = (side) => {
    captains[side] = document.getElementById(`${side}CaptainSelect`).value;
};

window.startCaptainSelection = () => {
    if (!captains.blue || !captains.red) {
        showAlert('⚠️ CAPITANES FALTANTES', 'Selecciona ambos capitanes.');
        return;
    }
    blueTeam = [captains.blue];
    redTeam = [captains.red];
    availableForCaptains = selectedPlayers.filter(p => p !== captains.blue && p !== captains.red);
    currentTurn = 'blue';
    draftActive = true;

    document.getElementById('captainOverlay').classList.add('show');
    document.getElementById('captainInterface').classList.remove('hidden');
    renderCaptainInterface();
    saveToFirebase(false);
};

function renderCaptainInterface() {
    const turnIndicator = document.getElementById('turnIndicator');
    const captainName = document.getElementById('currentCaptainName');
    if (turnIndicator && captainName) {
        turnIndicator.className = `turn-indicator ${currentTurn}`;
        captainName.textContent = currentTurn === 'blue' ? captains.blue : captains.red;
    }

    const availableContainer = document.getElementById('availablePlayers');
    if (availableContainer) {
        availableContainer.innerHTML = availableForCaptains.map(p => `
            <div class="selectable-player" ${isAdmin ? `onclick="window.pickPlayer('${p}')"` : ''}>${p}</div>
        `).join('');
    }

    const blueList = document.getElementById('blueCaptainTeam');
    const redList = document.getElementById('redCaptainTeam');
    if (blueList) blueList.innerHTML = blueTeam.map((p, i) => `<li>${p}${i === 0 ? ' <span class="captain-badge">CAP</span>' : ''}</li>`).join('');
    if (redList) redList.innerHTML = redTeam.map((p, i) => `<li>${p}${i === 0 ? ' <span class="captain-badge">CAP</span>' : ''}</li>`).join('');

    const finishBtn = document.getElementById('finishSelectionBtn');
    if (finishBtn) finishBtn.classList.toggle('hidden', availableForCaptains.length > 0 || !isAdmin);
}

window.pickPlayer = (nick) => {
    if (!isAdmin) return;
    if (currentTurn === 'blue') {
        blueTeam.push(nick);
        currentTurn = 'red';
    } else {
        redTeam.push(nick);
        currentTurn = 'blue';
    }
    availableForCaptains = availableForCaptains.filter(p => p !== nick);
    renderCaptainInterface();
    saveToFirebase(false);
};

window.finishCaptainSelection = () => {
    if (!isAdmin) return;
    draftActive = false;
    document.getElementById('captainOverlay').classList.remove('show');
    document.getElementById('captainInterface').classList.add('hidden');
    
    if (gameMode === 'grieta' && grietaDraft) {
        const blueRoles = [...ROLES].sort(() => Math.random() - 0.5);
        const redRoles = [...ROLES].sort(() => Math.random() - 0.5);
        blueTeam = blueTeam.map((nick, i) => ({ nick, role: blueRoles[i] || 'COMODÍN' }));
        redTeam = redTeam.map((nick, i) => ({ nick, role: redRoles[i] || 'COMODÍN' }));

        blueTeam.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
        redTeam.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    }

    updateTeamsUI();
    document.getElementById('teamsSection').classList.remove('hidden');
    saveTeamsToFirebase(); // Esto guarda el currentMatch y pone draftActive: false
};

window.copyAdminCode = (code) => {
    navigator.clipboard.writeText(code);
    showAlert("📋 COPIADO", "Código de Administrador copiado.");
};

window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
        document.getElementById('joinRoomInput').value = room;
        window.joinRoom();
    }
};
