import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs, limit } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
        showAlert("❌ ERROR", error.message);
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
            
            // Mostrar código admin si es admin o dueño
            const user = auth.currentUser;
            const isOwner = user && data.ownerId === user.uid;
            
            if (isOwner) isAdmin = true;

            const adminDisplay = document.getElementById('adminCodeDisplay');
            if (isAdmin || isOwner) {
                adminDisplay.innerHTML = ` | <span style="color:#ff00ff">ADMIN:</span> ${data.adminCode} <button class="copy-btn" onclick="window.copyAdminCode('${data.adminCode}')">📋</button>`;
            } else {
                adminDisplay.innerHTML = '';
            }

            // Aplicar visibilidad de admin
            document.querySelectorAll('.admin-only').forEach(el => {
                el.classList.toggle('hidden', !isAdmin);
            });

            // Si hay un equipo generado actualmente
            if (data.currentMatch) {
                const matchChanged = data.currentMatch.timestamp !== lastMatchTimestamp;
                
                blueTeam = data.currentMatch.blueTeam;
                redTeam = data.currentMatch.redTeam;
                updateTeamsUI();

                if (matchChanged) {
                    lastMatchTimestamp = data.currentMatch.timestamp;
                    triggerRevealFanfare();
                } else {
                    document.getElementById('teamsSection').classList.remove('hidden');
                }
            } else {
                document.getElementById('teamsSection').classList.add('hidden');
                lastMatchTimestamp = null;
            }

            renderAllPlayers();
            renderPlayerPool();
            updateLeaderboard();
            updateHistory();
            updateTournamentProgress();
            
            if (document.getElementById('mainContent').classList.contains('hidden')) {
                document.getElementById('mainContent').classList.remove('hidden');
            }
        }
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
    
    const messages = ["¡PREPARANDO BATALLA!", "¡EQUIPOS LISTOS!", "¡A LA ARENA!"];
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
            allPlayers: allPlayers,
            selectedPlayers: selectedPlayers,
            mode: mode,
            gameMode: gameMode,
            tournamentPlayers: tournamentPlayers,
            tournamentHistory: tournamentHistory,
            totalMatchesPlayed: totalMatchesPlayed,
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
        { text: 'GUARDAR', action: () => {
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
        }}
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
    blueTeam = shuffled.slice(0, mode);
    redTeam = shuffled.slice(mode, mode * 2);

    updateTeamsUI();
    document.getElementById('teamsSection').classList.remove('hidden');
    saveTeamsToFirebase();
}

async function saveTeamsToFirebase() {
    if (!isAdmin) return;
    await updateDoc(doc(db, "rooms", currentRoomId), {
        currentMatch: {
            blueTeam,
            redTeam,
            gameMode,
            timestamp: new Date().toISOString()
        }
    });
}

function updateTeamsUI() {
    document.getElementById('blueTeam').innerHTML = blueTeam.map(p => `<li>⚔️ ${p}</li>`).join('');
    document.getElementById('redTeam').innerHTML = redTeam.map(p => `<li>⚔️ ${p}</li>`).join('');
}

async function declareWinner(team) {
    if (!isAdmin) return;
    const winners = team === 'blue' ? blueTeam : redTeam;
    const losers = team === 'blue' ? redTeam : blueTeam;

    winners.forEach(p => {
        if (!tournamentPlayers[p]) tournamentPlayers[p] = { points: 0, matches: 0 };
        tournamentPlayers[p].points++;
        tournamentPlayers[p].matches++;
    });
    losers.forEach(p => {
        if (!tournamentPlayers[p]) tournamentPlayers[p] = { points: 0, matches: 0 };
        tournamentPlayers[p].matches++;
    });
    totalMatchesPlayed++;

    await saveToFirebase(true);
    await updateDoc(doc(db, "rooms", currentRoomId), { currentMatch: null });
    
    blueTeam = [];
    redTeam = [];
    document.getElementById('teamsSection').classList.add('hidden');
    showAlert('🏆 VICTORIA', `¡El equipo ${team === 'blue' ? 'AZUL' : 'ROJO'} ha ganado!`);
}

async function cancelMatch() {
    if (!isAdmin) return;
    
    showAlert('⚠️ CANCELAR PARTIDA', '¿Estás seguro de que quieres cancelar esta partida? No se guardarán resultados.', [
        { text: 'NO, VOLVER', action: null },
        { text: 'SÍ, CANCELAR', danger: true, action: async () => {
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
        }}
    ]);
}

function updateLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    const sorted = Object.entries(tournamentPlayers).sort((a, b) => b[1].points - a[1].points || b[1].matches - a[1].matches);
    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: rgba(255,255,255,0.3);">Sin jugadores en la liga</td></tr>';
        return;
    }
    tbody.innerHTML = sorted.map(([nick, stats], i) => `<tr>
        <td class="rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</td>
        <td>${nick}</td>
        <td>${stats.points}</td>
        <td>${stats.matches}</td>
    </tr>`).join('');
}

function updateTournamentProgress() {
    const el = document.getElementById('tournamentProgress');
    el.textContent = `Partidas de esta liga: ${totalMatchesPlayed}`;
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
        msgEl.textContent = message;
    }

    const btnContainer = document.getElementById('alertButtons');
    btnContainer.innerHTML = '';
    buttons.forEach(b => {
        const button = document.createElement('button');
        button.className = `btn ${b.danger ? 'btn-danger' : ''}`;
        button.textContent = b.text;
        button.onclick = () => {
            if (b.action) b.action();
            closeAlert();
        };
        btnContainer.appendChild(button);
    });
    document.getElementById('alertOverlay').classList.add('show');
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
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', parseInt(b.textContent) === m));
    renderPlayerPool();
};
window.setGameMode = (e, m) => {
    if (!isAdmin) return;
    gameMode = m;
    document.querySelectorAll('.game-mode-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    document.getElementById('aramRoleSwitch').classList.toggle('hidden', m !== 'aram');
    document.getElementById('grietaDraftSwitch').classList.toggle('hidden', m !== 'grieta');
    document.getElementById('grietaCaptainsSection').classList.toggle('hidden', m !== 'grieta');
};
window.confirmResetTournament = () => {
    if (!isAdmin) return;
    showAlert('📅 CERRAR LIGA', '¿Cerrar la liga y guardar en historial?', [
        { text: 'CANCELAR', action: null },
        { text: 'CERRAR', danger: true, action: resetTournament }
    ]);
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
    const options = selectedPlayers.map(p => `<option value="${p}">${p}</option>`).join('');
    const placeholder = '<option value="">Seleccionar...</option>';
    blueSelect.innerHTML = placeholder + options;
    redSelect.innerHTML = placeholder + options;
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
    document.getElementById('captainOverlay').classList.add('show');
    document.getElementById('captainInterface').classList.remove('hidden');
    renderCaptainInterface();
};

function renderCaptainInterface() {
    const turnIndicator = document.getElementById('turnIndicator');
    const captainName = document.getElementById('currentCaptainName');
    turnIndicator.className = `turn-indicator ${currentTurn}`;
    captainName.textContent = currentTurn === 'blue' ? captains.blue : captains.red;

    document.getElementById('availablePlayers').innerHTML = availableForCaptains.map(p => `
        <div class="selectable-player" onclick="window.pickPlayer('${p}')">${p}</div>
    `).join('');

    document.getElementById('blueCaptainTeam').innerHTML = blueTeam.map((p, i) => `<li>${p}${i === 0 ? ' <span class="captain-badge">CAP</span>' : ''}</li>`).join('');
    document.getElementById('redCaptainTeam').innerHTML = redTeam.map((p, i) => `<li>${p}${i === 0 ? ' <span class="captain-badge">CAP</span>' : ''}</li>`).join('');
    document.getElementById('finishSelectionBtn').classList.toggle('hidden', availableForCaptains.length > 0);
}

window.pickPlayer = (nick) => {
    if (currentTurn === 'blue') {
        blueTeam.push(nick);
        currentTurn = 'red';
    } else {
        redTeam.push(nick);
        currentTurn = 'blue';
    }
    availableForCaptains = availableForCaptains.filter(p => p !== nick);
    renderCaptainInterface();
};

window.finishCaptainSelection = () => {
    document.getElementById('captainOverlay').classList.remove('show');
    document.getElementById('captainInterface').classList.add('hidden');
    updateTeamsUI();
    document.getElementById('teamsSection').classList.remove('hidden');
    saveTeamsToFirebase();
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
