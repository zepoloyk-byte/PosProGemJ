// ====================================================================
// === 1. CONEXIÓN A POCKETBASE EN LA NUBE ===
// ====================================================================
const pb = new PocketBase('https://sexy-starling.pikapod.net');
pb.autoCancellation(false);

// ====================================================================
// === 2. ADAPTADOR FIREBASE -> POCKETBASE (CON MOCHILA OFFLINE 🎒☁️) ===
// ====================================================================
const db = {
    enablePersistence: () => Promise.resolve(),
    collection: function(colName) {
        return {
            get: async function() {
                try {
                    let records = await pb.collection(colName).getFullList({ requestKey: null });
                    let mapa = {}; records.forEach(r => mapa[r.doc_id] = r);
                    return { forEach: (cb) => Object.values(mapa).forEach(r => cb({ id: r.doc_id, data: () => r.data })) };
                } catch(e) { console.error(e); return { forEach: ()=>{} }; }
            },
            onSnapshot: async function(callback) {
                try {
                    let cache = await pb.collection(colName).getFullList({ requestKey: null });
                    let mapa = {}; 
                    cache.forEach(r => mapa[r.doc_id] = r);
                    cache = Object.values(mapa); 
                    let emit = () => { callback({ forEach: (cb) => cache.forEach(r => cb({ id: r.doc_id, data: () => r.data })) }); };
                    emit(); 
                    pb.collection(colName).subscribe('*', function(e) {
                        if (e.action === 'create' || e.action === 'update') {
                            let idx = cache.findIndex(x => x.doc_id === e.record.doc_id);
                            if (idx > -1) cache[idx] = e.record; 
                            else cache.push(e.record); 
                        } else if (e.action === 'delete') {
                            cache = cache.filter(x => x.doc_id !== e.record.doc_id);
                        }
                        emit();
                    });
                } catch (e) { console.error("Error onSnapshot:", colName, e); }
            },
            orderBy: function(field, direction) {
                return {
                    get: async function() {
                        try {
                            let records = await pb.collection(colName).getFullList({ requestKey: null });
                            let mapa = {}; records.forEach(r => mapa[r.doc_id] = r);
                            let unicos = Object.values(mapa);
                            unicos.sort((a, b) => {
                                let valA = a.data[field], valB = b.data[field];
                                if (valA < valB) return direction === 'desc' ? 1 : -1;
                                if (valA > valB) return direction === 'desc' ? -1 : 1;
                                return 0;
                            });
                            return { forEach: (cb) => unicos.forEach(r => cb({ id: r.doc_id, data: () => r.data })) };
                        } catch(e) { return { forEach: ()=>{} }; }
                    }
                };
            },
            doc: function(docId) {
                docId = String(docId);
                return {
                    set: async function(dataObj) {
                        try {
                            let record = null;
                            try {
                                // Revisamos qué hay en la Nube antes de subir
                                record = await pb.collection(colName).getFirstListItem(`doc_id="${docId}"`);
                            } catch (e) {
                                // No existe todavía, lo creará nuevo
                            }

                            // 🛡️ ESCUDO ANTI-PRECIOS FANTASMA (Solo para el inventario)
                            if (colName === "inventario" && record && record.data) {
                                let nube = record.data;
                                let tiempoLocal = dataObj.updatedAt || 0;
                                let tiempoNube = nube.updatedAt || 0;

                                // Si la Nube tiene una edición de precio/datos más reciente que la tuya...
                                if (tiempoNube > tiempoLocal) {
                                    // Rescatamos los datos reales de la Nube para que tu venta no los aplaste
                                    dataObj.nom = nube.nom;
                                    dataObj.cos = nube.cos;
                                    dataObj.iva = nube.iva;
                                    dataObj.pv = nube.pv;
                                    dataObj.pm = nube.pm;
                                    dataObj.gan = nube.gan;
                                    dataObj.dep = nube.dep;
                                    dataObj.updatedAt = nube.updatedAt; // Heredamos su marca de tiempo

                                    // Curamos la memoria de esta computadora al instante
                                    if(typeof inv !== 'undefined') {
                                        inv[docId] = dataObj;
                                        localStorage.setItem("pos_precision_v6", JSON.stringify(inv));
                                    }
                                }
                            }

                            // Subimos el paquete (ahora sí, combinado y seguro)
                            if (record) {
                                return await pb.collection(colName).update(record.id, { doc_id: docId, data: dataObj });
                            } else {
                                return await pb.collection(colName).create({ doc_id: docId, data: dataObj });
                            }
                        } catch (e) {
                            if (e.status === 404) {
                                try { return await pb.collection(colName).create({ doc_id: docId, data: dataObj }); }
                                catch (eFatal) { throw eFatal; } 
                            }
                            
                            // 🎒 LA MAGIA: Si no hay internet, guarda en la mochila
                            console.warn(`⏳ Sin conexión. Guardando en mochila offline: [${colName}] -> ${docId}`);
                            let mochila = JSON.parse(localStorage.getItem("pos_mochila")) || [];
                            mochila = mochila.filter(m => !(m.col === colName && m.id === docId));
                            mochila.push({ col: colName, id: docId, data: dataObj });
                            localStorage.setItem("pos_mochila", JSON.stringify(mochila));
                            
                            return true; 
                        }
                    },
                    delete: async function() {
                        try {
                            let record = await pb.collection(colName).getFirstListItem(`doc_id="${docId}"`);
                            return pb.collection(colName).delete(record.id);
                        } catch (e) { console.warn("Doc no existe:", docId); }
                    },
                    onSnapshot: async function(callback) {
                        let emit = (exists, data) => callback({ exists, data: () => data });
                        try {
                            let record = await pb.collection(colName).getFirstListItem(`doc_id="${docId}"`);
                            emit(true, record.data);
                        } catch (e) { emit(false, {}); }

                        pb.collection(colName).subscribe('*', function(e) {
                            if (e.record.doc_id === docId) {
                                if (e.action === 'delete') emit(false, {});
                                else emit(true, e.record.data);
                            }
                        });
                    }
                };
            }
        
        };
    }
};

// ====================================================================
// === EL CARTERO SILENCIOSO BLINDADO (OFFLINE SYNC) ===
// ====================================================================
let tiempoInactividad = 0;
let revisarPorInactividad = null;
let vaciandoMochila = false;

async function vaciarMochilaRezagada() {
    if (!navigator.onLine || vaciandoMochila) return;
    vaciandoMochila = true; 
    try {
        let mochila = JSON.parse(localStorage.getItem("pos_mochila")) || [];
        if (mochila.length > 0) {
            mochila.forEach(tarea => {
                if (tarea.col === 'inventario' && typeof inv !== 'undefined') inv[tarea.id] = tarea.data;
            });
            if (typeof renderI === "function") renderI(); 
        }
        while (mochila.length > 0 && navigator.onLine) {
            let tarea = mochila[0];
            try {
                let record;
                try { record = await pb.collection(tarea.col).getFirstListItem(`doc_id="${tarea.id}"`); } catch(e){}
                if (record) {
                    await pb.collection(tarea.col).update(record.id, { doc_id: tarea.id, data: tarea.data });
                } else {
                    await pb.collection(tarea.col).create({ doc_id: tarea.id, data: tarea.data });
                }
                mochila.shift(); 
                localStorage.setItem("pos_mochila", JSON.stringify(mochila));
                console.log(`✅ Cartero: Paquete rezagado sincronizado (${tarea.col})`);
            } catch(e) {
                break; 
            }
        }
    } finally {
        vaciandoMochila = false; 
    }
}

setTimeout(vaciarMochilaRezagada, 1500);
setInterval(vaciarMochilaRezagada, 1800000);

function resetearContadorInactividad() {
    tiempoInactividad = 0;
    if (revisarPorInactividad) {
        clearInterval(revisarPorInactividad);
        revisarPorInactividad = null;
    }
}

window.addEventListener('load', resetearContadorInactividad);
window.addEventListener('mousemove', resetearContadorInactividad);
window.addEventListener('mousedown', resetearContadorInactividad); 
window.addEventListener('touchstart', resetearContadorInactividad);
window.addEventListener('click', resetearContadorInactividad);
window.addEventListener('keypress', resetearContadorInactividad);

setInterval(() => {
    tiempoInactividad++;
    if (tiempoInactividad >= 5 && !revisarPorInactividad) {
        vaciarMochilaRezagada();
        revisarPorInactividad = setInterval(vaciarMochilaRezagada, 60000);
    }
}, 60000); 

// ====================================================================
// === VARIABLES GLOBALES ===
// ====================================================================
let inv = {}; let ventas = []; let compras = []; let pausadas = []; let transferencias = []; let clientes = {}; let promociones = []; let movimientos = [];
let proveedores = {}; 
let usuariosData = { "Admin": { pin: "1234", tabs: ["v-tab", "c-tab", "prov-tab", "k-tab", "i-tab", "cli-tab", "pro-tab", "rec-tab", "r-tab", "u-tab", "kardex-tab"] } }; 
let configTienda = {}; 
let focusVentaIndex = -1;
let focusCompraIndex = -1;
let focusInvIndex = -1;
let currentInvKeys = [];
let timerFiltroInv;

let carV = [], carC = [], carK = [], carT = [], carR = [], tabActual = 'v-tab', forceWholesale = false, tempGranel = null;
let usuarioActual = ""; let nombreVentaActual = ""; let idTransferenciaActual = null; let telAbonoActual = "";
let provAbonoActual = ""; let provAEliminar = ""; let cliAEliminar = "";
let sucursalActual = localStorage.getItem("pos_sucursal") || "Matriz"; 
let chartBarInstance = null; let chartDeptInstance = null; let chartCajeroInstance = null; let chartHorasInstance = null;
let visorIndices = []; let currentVisorPos = -1;
let searchResultsList = [];
let focusSearchIndex = 0;
var listaSucursales = ["Matriz", "Sucursal 1", "Sucursal 2"]; 

// ====================================================================
// === RECUPERACIÓN DE DATOS LOCALES (Fallback) ===
// ====================================================================
try {
    let sSuc = localStorage.getItem("pos_lista_sucursales"); if(sSuc) listaSucursales = JSON.parse(sSuc);
    let sCfg = localStorage.getItem("pos_config_v11"); 
    if(sCfg) { let parsed = JSON.parse(sCfg); if(parsed.nombre) { configTienda = { "Matriz": parsed, "Sucursal 1": parsed, "Sucursal 2": parsed }; } else { configTienda = parsed; } } 
    else { let def = { nombre: "Mi Tienda", detalles: "Dirección de Ejemplo\nTeléfono: 555-555-5555", mensaje: "¡Gracias por su compra!" }; configTienda = { "Matriz": def, "Sucursal 1": def, "Sucursal 2": def }; }

    let sU = localStorage.getItem("pos_usuarios_v9"); if (sU) usuariosData = JSON.parse(sU);
    let sM = localStorage.getItem("pos_movimientos_v1"); if (sM) movimientos = JSON.parse(sM);
    let sProv = localStorage.getItem("pos_proveedores_v1"); if (sProv) proveedores = JSON.parse(sProv);

    let savedInv = localStorage.getItem("pos_precision_v6"); 
    if (savedInv) {
        inv = JSON.parse(savedInv);
        Object.values(inv).forEach(item => { if(item) { if(typeof item.stock === 'number') item.stock = { "Matriz": item.stock }; if(!item.stock) item.stock = {}; if(!item.dep) item.dep = "General"; if(!item.comp) item.comp = []; } });
    }
    let sV = localStorage.getItem("pos_ventas_v6"); if (sV) ventas = JSON.parse(sV);
    let sC = localStorage.getItem("pos_clientes_v7"); if (sC) clientes = JSON.parse(sC);
    let sPr = localStorage.getItem("pos_promociones_v8"); if (sPr) { let parsedPr = JSON.parse(sPr); promociones = Array.isArray(parsedPr) ? parsedPr : []; }
    let sP = localStorage.getItem("pos_pausadas_v6"); pausadas = sP ? JSON.parse(sP) : [];
    let sT = localStorage.getItem("pos_transferencias_v6"); if (sT) transferencias = JSON.parse(sT);

    if(!Array.isArray(ventas)) ventas = []; ventas.forEach(v => { if(!v.id) v.id = Date.now() + Math.floor(Math.random()*1000); });
} catch (e) { console.error("Error al leer datos:", e); }

// ====================================================================
// === LISTENERS EN TIEMPO REAL (NUBE ☁️) ===
// ====================================================================

// 📡 RADAR DE INVENTARIO EN TIEMPO REAL (CON FILTRO DE PRIORIDAD LOCAL)
db.collection("inventario").onSnapshot((querySnapshot) => {
    querySnapshot.forEach((doc) => { 
        let datosNube = doc.data();
        let datosLocales = inv[doc.id];

        // Si el producto ya existe localmente y tiene una marca de tiempo...
        if (datosLocales && datosLocales.updatedAt && datosNube.updatedAt) {
            // Si el cambio local es más NUEVO que el de la nube, protegemos nuestro precio
            if (datosLocales.updatedAt > datosNube.updatedAt) {
                // Sincronizamos solo el stock (para no descuadrarnos), pero mantenemos nuestros precios locales
                datosLocales.stock = datosNube.stock;
                datosLocales.sold_without_stock = datosNube.sold_without_stock;
                return; // Saltamos este ciclo para que no aplaste el precio local
            }
        }

        // Si la nube es más nueva o no hay conflicto, actualizamos normal
        inv[doc.id] = datosNube; 
    });
    
    console.log("📦 Inventario sincronizado (Prioridad de precio local activada).");
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv));
    if (tabActual === 'i-tab') renderI(); 
});

// Usuarios
db.collection("usuarios").onSnapshot((querySnapshot) => {
    usuariosData = {};
    querySnapshot.forEach((doc) => { usuariosData[doc.id] = doc.data(); });
   if (!usuariosData["Admin"]) usuariosData["Admin"] = { pin: "1234", tabs: ["v-tab", "c-tab", "prov-tab", "k-tab", "i-tab", "cli-tab", "pro-tab", "r-tab", "u-tab", "kardex-tab"] };
    if (typeof initLoginSelect === 'function') initLoginSelect();
    if (typeof renderUsuarios === 'function') renderUsuarios();
});

// Sucursales
db.collection("config").doc("sucursales").onSnapshot((doc) => {
    if (doc.exists && doc.data().lista && doc.data().lista.length > 0) listaSucursales = doc.data().lista; 
    else listaSucursales = ["Matriz"];
    localStorage.setItem("pos_lista_sucursales", JSON.stringify(listaSucursales));
    if (typeof renderGestSucursales === 'function') renderGestSucursales();
    if (typeof actualizarSelectsSucursales === 'function') actualizarSelectsSucursales();
}, (error) => console.warn("⚠️ No hay internet. Usando sucursales locales."));

// Clientes
db.collection("clientes").onSnapshot((querySnapshot) => {
    clientes = {};
    querySnapshot.forEach((doc) => { clientes[doc.id] = doc.data(); });
    if (tabActual === 'cli-tab') renderClientes();
});

// Proveedores
db.collection("proveedores").onSnapshot((querySnapshot) => {
    proveedores = {};
    querySnapshot.forEach((doc) => { proveedores[doc.id] = doc.data(); });
    localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores));
    if (tabActual === 'prov-tab') renderProveedores();
});

// Movimientos
db.collection("movimientos").onSnapshot((querySnapshot) => {
    movimientos = [];
    querySnapshot.forEach((doc) => { movimientos.push(doc.data()); });
    movimientos.sort((a,b) => a.id - b.id);
    if (tabActual === 'r-tab') renderCorte();
});

// Ventas (¡CORREGIDO EL ERROR DE SINTAXIS!)
db.collection("ventas").onSnapshot((querySnapshot) => {
    ventas = [];
    querySnapshot.forEach((doc) => { ventas.push(doc.data()); });
});

// Compras
db.collection("compras").onSnapshot((querySnapshot) => {
    compras = [];
    querySnapshot.forEach((doc) => { compras.push(doc.data()); });
    compras.sort((a,b) => a.id - b.id);
    localStorage.setItem("pos_compras_local", JSON.stringify(compras));
    if (document.getElementById('modalVisorCompras') && document.getElementById('modalVisorCompras').style.display === 'block') {
        if(typeof filtrarVisorCompras === 'function') filtrarVisorCompras();
    }
});

// Transferencias
db.collection("transferencias").onSnapshot((querySnapshot) => {
    transferencias = [];
    querySnapshot.forEach((doc) => { transferencias.push(doc.data()); });
    transferencias.sort((a,b) => a.id - b.id);
    actualizarContadorRecepciones();
});

// Compras Pausadas
let comprasPausadas = JSON.parse(localStorage.getItem('pos_compras_pausadas')) || [];
db.collection("compras_pausadas").onSnapshot((querySnapshot) => {
    comprasPausadas = [];
    querySnapshot.forEach((doc) => { comprasPausadas.push(doc.data()); });
    localStorage.setItem('pos_compras_pausadas', JSON.stringify(comprasPausadas));
    if (typeof actualizarBadgeComprasPausadas === 'function') actualizarBadgeComprasPausadas();
});

// Ventas Pausadas
db.collection("pausadas").onSnapshot((querySnapshot) => {
    pausadas = [];
    querySnapshot.forEach((doc) => { pausadas.push(doc.data()); });
    actualizarContadorPausadas();
});

// Configuración de Ticket
db.collection("config").doc("ticket").onSnapshot((doc) => {
    if (doc.exists) {
        configTienda = doc.data();
        localStorage.setItem("pos_config_v11", JSON.stringify(configTienda));
        if (typeof cargarConfigEnUI === 'function') cargarConfigEnUI();
    }
});

// Promociones
db.collection("promociones").onSnapshot((querySnapshot) => {
    promociones = [];
    querySnapshot.forEach((doc) => { promociones.push(doc.data()); });
    localStorage.setItem("pos_promociones_v8", JSON.stringify(promociones));
    renderPromos(); 
});
// 📡 RADAR DE KARDEX EN TIEMPO REAL
let historialKardex = []; // ¡AQUÍ ESTABA EL ERROR! Faltaba declarar esta variable global
db.collection("kardex").onSnapshot((querySnapshot) => {
    historialKardex = [];
    querySnapshot.forEach((doc) => { 
        historialKardex.push(doc.data()); 
    });
    
    // Ordenamos para que lo más nuevo salga primero
    historialKardex.sort((a, b) => b.timestamp - a.timestamp);
    console.log("📊 Historial de Kardex sincronizado.");
    
    if (tabActual === 'kardex-tab' && typeof window.renderKardex === 'function') {
        window.renderKardex(); 
    }
});

// ====================================================================
// === FUNCIONES PRINCIPALES Y UTILIDADES ===
// ====================================================================
function getFechaLocal() {
    let d = new Date(); let year = d.getFullYear(); let month = String(d.getMonth() + 1).padStart(2, '0'); let day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function updateClock() {
    let clockEl = document.getElementById('live_clock');
    if(clockEl) {
        let d = new Date();
        // Fecha limpia sin puntos extra (ej. "05 JUN 2026")
        let fecha = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase().replace(/\./g, '');
        // Hora exacta (ej. "10:56:09 PM")
        let hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).toUpperCase();
        
        // Inyectamos el diseño directo con colores modernos
        clockEl.innerHTML = `
            <div style="font-size: 11px; color: #a0aec0; letter-spacing: 1px; margin-bottom: 3px; white-space: nowrap;">
                📅 ${fecha}
            </div>
            <div style="font-size: 16px; font-weight: bold; color: #00d2ff; letter-spacing: 1px; white-space: nowrap; text-shadow: 0 0 5px rgba(0, 210, 255, 0.4);">
                🕒 ${hora}
            </div>
        `;
    }
}

async function cargarFondosDesdeNube() {
    try {
        const record = await pb.collection('config_visual').getFirstListItem('');
        if (record.fondo_login) {
            let urlLogin = pb.files.getUrl(record, record.fondo_login);
            document.getElementById('login-screen').style.backgroundImage = `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('${urlLogin}')`;
        }
        if (record.fondo_panel) {
            let urlPanel = pb.files.getUrl(record, record.fondo_panel);
            document.querySelectorAll('.panel-der').forEach(panel => {
                panel.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.75)), url('${urlPanel}')`;
            });
        }
    } catch (e) { console.warn("⚠️ Usando fondos locales por defecto."); }
}

function obtenerProductoMaestro(cod) {
    let p = inv[cod];
    if (p && p.grupo && inv[p.grupo]) return inv[p.grupo]; 
    return p;
}

window.onload = () => { 
    cargarFondosDesdeNube(); 
    document.querySelectorAll('.modal').forEach(m => document.body.appendChild(m));
    renderGestSucursales();
    setInterval(updateClock, 1000); updateClock(); initLoginSelect();
    document.getElementById('ui_sucursal').value = sucursalActual; document.getElementById('corte_sucursal').value = sucursalActual;
    actualizarEtiquetasSucursal(); cargarConfigEnUI(); 
    renderI(); renderClientes(); renderProveedores(); renderPromos(); renderUsuarios(); actualizarContadorPausadas(); actualizarContadorRecepciones();
    document.getElementById('login_pin').focus();
    let hoy = getFechaLocal(); document.getElementById('pr_ini').value = hoy; document.getElementById('corte_fecha_inicio').value = hoy; document.getElementById('corte_fecha_fin').value = hoy;
    renderCorte();
};

// ==========================================
// CAMBIO DE PESTAÑAS (MENÚ PRINCIPAL)
// ==========================================
window.changeTab = function(evt, tabName) {
    try {
        // 1. Escondemos todas las pestañas
        let tabcontent = document.getElementsByClassName("tabcontent");
        for (let i = 0; i < tabcontent.length; i++) {
            tabcontent[i].style.display = "none";
        }

        // 2. Le quitamos el color de "activo" a todos los botones
        let tablinks = document.getElementsByClassName("t-btn");
        for (let i = 0; i < tablinks.length; i++) {
            tablinks[i].className = tablinks[i].className.replace(" active", "");
        }

        // 3. Mostramos la pestaña que el usuario pidió
        let tabSeleccionada = document.getElementById(tabName);
        if (tabSeleccionada) {
            tabSeleccionada.style.display = "block";
        }
        tabActual = tabName;

        // 4. Iluminamos el botón presionado
        if (evt && evt.currentTarget) {
             evt.currentTarget.className += " active";
        } else {
             let btn = document.getElementById('btn_' + tabName);
             if (btn) btn.className += " active";
        }

        // 🚀 LA MAGIA: Si el usuario abrió el Kardex, lo dibujamos
        if (tabName === 'kardex-tab' && typeof window.renderKardex === 'function') {
            window.renderKardex();
        }

        // 🎯 NUEVO: Posicionar el cursor automáticamente
        setTimeout(() => {
            let inputObjetivo = null;
            
            if (tabName === 'v-tab') inputObjetivo = document.getElementById('v_cod'); // Ventas
            else if (tabName === 'c-tab') inputObjetivo = document.getElementById('c_cod'); // Compras
            else if (tabName === 'i-tab') inputObjetivo = document.getElementById('buscar_inv'); // Inventario

            // Si existe la casilla, ponemos el cursor sin que la pantalla salte
            if (inputObjetivo) {
                inputObjetivo.focus({ preventScroll: true });
            }
        }, 100); // Esperamos una fracción de segundo a que la pestaña esté 100% visible

    } catch (error) {
        console.error("Error al cambiar de pestaña:", error);
    }
};

function cerrarModales() { 
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); 
    setTimeout(() => { 
        if(tabActual==='v-tab') document.getElementById('v_cod').focus(); 
        if(tabActual==='c-tab') document.getElementById('c_cod').focus(); 
    }, 150); 
}

// ====================================================================
// === MÓDULO DE USUARIOS Y LOGIN ===
// ====================================================================
function initLoginSelect() { 
    let sel = document.getElementById('login_user'); 
    if(!sel) return;

    let htmlUsuarios = '';
    
    // Iteramos sobre todos los usuarios registrados
    Object.keys(usuariosData).forEach(u => {
        let datosUsuario = usuariosData[u];
        
        // El Admin siempre puede entrar a todos lados (Regla de oro)
        if (u === "Admin") {
            htmlUsuarios += `<option value="${u}">${u}</option>`;
            return;
        }

        // Revisamos si el usuario tiene permiso para la sucursal "invisible" donde está la PC
        if (datosUsuario.sucursales_permitidas) {
            if (datosUsuario.sucursales_permitidas.includes(sucursalActual)) {
                htmlUsuarios += `<option value="${u}">${u}</option>`;
            }
        } else {
            // Si es un usuario muy viejo que no tiene configuración, por defecto lo mostramos
            htmlUsuarios += `<option value="${u}">${u}</option>`;
        }
    });

    sel.innerHTML = htmlUsuarios;
}

function intentarLogin() {
    let u = document.getElementById('login_user').value; 
    let p = document.getElementById('login_pin').value;
    
    if(usuariosData[u] && usuariosData[u].pin === p) { 
        usuarioActual = u; 
        document.getElementById('ui_current_user').innerText = u; 
        document.getElementById('login-screen').style.display = 'none'; 
        
        if (u === "Admin") { 
            document.getElementById('ui_sucursal').disabled = false; 
            if(document.getElementById('corte_sucursal')) document.getElementById('corte_sucursal').disabled = false;
            if(document.getElementById('t_origen')) document.getElementById('t_origen').disabled = false;
        } else { 
            document.getElementById('ui_sucursal').disabled = true; 
            if(document.getElementById('corte_sucursal')) document.getElementById('corte_sucursal').disabled = true;
            if(document.getElementById('t_origen')) document.getElementById('t_origen').disabled = true;
        }
        
        document.querySelectorAll('.t-btn').forEach(btn => btn.style.display = 'none');
        
        // 🌟 AQUÍ ESTABA EL ERROR: Solo debe existir UNA vez la palabra "let" para esta variable
        let allowedTabs = usuariosData[u].tabs || [];
        
        // 🔒 SEGURO ANTI-BLOQUEO DEL ADMIN: 
        if (u === "Admin") {
            if (!allowedTabs.includes("u-tab")) allowedTabs.push("u-tab");           
            if (!allowedTabs.includes("kardex-tab")) allowedTabs.push("kardex-tab"); 
        }
        
        allowedTabs.forEach(tabId => { 
            let btn = document.getElementById('btn_' + tabId); 
            if(btn) btn.style.display = 'block'; 
        });
        
        if(allowedTabs.length > 0) { document.getElementById('btn_' + allowedTabs[0]).click(); }
        
        renderI();
        renderCorte(); 
        document.getElementById('login_pin').value = '';
    } else { 
        alert("PIN Incorrecto"); 
    }
}
window.filtrarUsuariosPorSucursal = function() {
    let selectorSucursal = document.getElementById('login_sucursal');
    let selectorUsuarios = document.getElementById('login_user');
    
    if(!selectorSucursal || !selectorUsuarios) return;

    let sucursalElegida = selectorSucursal.value;
    
    // Si no han elegido sucursal, vaciamos la lista de usuarios
    if (sucursalElegida === "") {
        selectorUsuarios.innerHTML = '<option value="">-- Selecciona Sucursal Primero --</option>';
        selectorUsuarios.disabled = true;
        return;
    }
    
    // Preparamos la lista
    selectorUsuarios.disabled = false;
    let htmlUsuarios = '<option value="">-- Selecciona Usuario --</option>';
    
    // Iteramos sobre todos los usuarios registrados
    Object.keys(usuariosData).forEach(u => {
        let datosUsuario = usuariosData[u];
        
        // El Admin siempre puede entrar a todos lados (Regla de oro)
        if (u === "Admin") {
            htmlUsuarios += `<option value="${u}">${u}</option>`;
            return;
        }

        // Revisamos si el usuario tiene permiso para la sucursal elegida
        if (datosUsuario.sucursales_permitidas) {
            if (datosUsuario.sucursales_permitidas.includes(sucursalElegida)) {
                htmlUsuarios += `<option value="${u}">${u}</option>`;
            }
        } else {
            // Si es un usuario muy viejo que no tiene configuración, por defecto lo mostramos para no perder el acceso
            htmlUsuarios += `<option value="${u}">${u}</option>`;
        }
    });

    selectorUsuarios.innerHTML = htmlUsuarios;
};
function cerrarSesion() { usuarioActual = ""; document.getElementById('login-screen').style.display = 'flex'; document.getElementById('login_pin').focus(); }

function renderUsuarios() {
    let html = ''; Object.keys(usuariosData).forEach(u => {
        let p = usuariosData[u]; let badges = p.tabs.map(t => `<span class="badge-kit">${t.replace('-tab','').toUpperCase()}</span>`).join(' ');
        let btnEditar = `<button style="background:var(--p); color:white; border:none; padding:5px 10px; border-radius:5px; margin-right:5px; cursor:pointer;" onclick="editarUsuario('${u}')">✏️</button>`;
        let btnEliminar = u !== 'Admin' ? `<button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="eliminarUsuario('${u}')">✕</button>` : '';
        html += `<tr><td><b>${u}</b></td><td>${badges}</td><td>${btnEditar}${btnEliminar}</td></tr>`;
    });
    if(document.getElementById('u_lista')) document.getElementById('u_lista').innerHTML = html;
}
function guardarUsuario() {
    let nom = document.getElementById('u_nombre').value.trim(); 
    let pin = document.getElementById('u_pin').value.trim();
    if(!nom || !pin) return alert("Llena nombre y PIN");
    
    let tabs = []; 
    // Lista completa incluyendo obligatoriamente el kardex-tab
    ['v-tab', 'c-tab', 'prov-tab', 'k-tab', 'i-tab', 'cli-tab', 'pro-tab', 'rec-tab', 'r-tab', 'u-tab', 'kardex-tab'].forEach(t => {
        if(document.getElementById('chk_' + t) && document.getElementById('chk_' + t).checked) tabs.push(t); 
    });
    
    if(tabs.length === 0) return alert("Debes seleccionar al menos un módulo permitido.");
    
    // 🏢 NUEVO: Recolectar sucursales marcadas
    let sucursalesSeleccionadas = Array.from(document.querySelectorAll('.cb-sucursal:checked')).map(cb => cb.value).join(',');

    // Preparar el objeto exacto (ahora incluye sucursales)
    let objetoUsuario = { pin: pin, tabs: tabs, sucursales_permitidas: sucursalesSeleccionadas };

    // 🛡️ ACTUALIZACIÓN INMEDIATA: Guardamos primero en la memoria local
    usuariosData[nom] = objetoUsuario;
    localStorage.setItem("pos_usuarios_v9", JSON.stringify(usuariosData));
    
    // Enviamos a PocketBase
    db.collection("usuarios").doc(nom).set(objetoUsuario)
    .then(() => {
        alert("✅ Usuario guardado y sincronizado en la NUBE."); 
        
        // Limpiamos los campos del formulario
        document.getElementById('u_nombre').value = ''; 
        document.getElementById('u_pin').value = ''; 
        document.getElementById('u_nombre').readOnly = false;
        document.getElementById('u_nombre').style.background = '#fff';
        
        // Desmarcar absolutamente TODOS los checks para evitar confusiones visuales
        ['v-tab', 'c-tab', 'prov-tab', 'k-tab', 'i-tab', 'cli-tab', 'pro-tab', 'rec-tab', 'r-tab', 'u-tab', 'kardex-tab'].forEach(t => {
            let chk = document.getElementById('chk_' + t);
            if(chk) chk.checked = false;
        });

        // 🏢 NUEVO: Desmarcar las sucursales al terminar
        document.querySelectorAll('.cb-sucursal').forEach(cb => cb.checked = false);

        // Redibujamos la tabla de usuarios registrados
        if(typeof renderUsuarios === 'function') renderUsuarios();
        
        // Actualizamos el menú de login
        initLoginSelect();
    })
    .catch(error => { 
        console.error(error); 
        alert("⚠️ Guardado localmente, pero hubo un bache al subir a la nube."); 
    });
}
function editarUsuario(nom) {
    let u = usuariosData[nom];
    if(!u) return;
    document.getElementById('u_nombre').value = nom;
    document.getElementById('u_pin').value = u.pin;
    document.getElementById('u_nombre').readOnly = true;
    document.getElementById('u_nombre').style.background = '#eee';

    // Limpiamos pestañas y marcamos las permitidas
    ['v-tab', 'c-tab', 'prov-tab', 'k-tab', 'i-tab', 'cli-tab', 'pro-tab', 'rec-tab', 'r-tab', 'u-tab', 'kardex-tab'].forEach(t => {
        let chk = document.getElementById('chk_' + t); 
        if(chk) chk.checked = false; 
    });
    u.tabs.forEach(t => {
        let chk = document.getElementById('chk_' + t);
        if(chk) chk.checked = true;
    });

    // 🏢 NUEVO: Limpiamos sucursales y marcamos las permitidas
    document.querySelectorAll('.cb-sucursal').forEach(cb => cb.checked = false);
    if (u.sucursales_permitidas) {
        let permitidas = u.sucursales_permitidas.split(',');
        document.querySelectorAll('.cb-sucursal').forEach(cb => {
            if (permitidas.includes(cb.value)) cb.checked = true;
        });
    } else {
        // Por defecto, si no tiene nada (ej. Admin antiguo), le marcamos todas para no bloquearlo
        document.querySelectorAll('.cb-sucursal').forEach(cb => cb.checked = true);
    }

    document.getElementById('u_nombre').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}



function eliminarUsuario(nom) {
    if(nom === 'Admin') return alert("No puedes eliminar al administrador");
    if(confirm("¿Seguro de eliminar a " + nom + "?")) {
        db.collection("usuarios").doc(nom).delete()
        .then(() => alert("Usuario eliminado"))
        .catch(e => alert("Error: " + e));
    }
}

// ====================================================================
// === SUCURSALES Y CONFIGURACIÓN ===
// ====================================================================
function cambiarSucursal(ns) { 
    if (usuarioActual !== "" && usuarioActual !== "Admin") {
        alert("❌ Acceso Denegado. Solo el Administrador puede cambiar la sucursal de trabajo.");
        document.getElementById('ui_sucursal').value = sucursalActual; 
        return; 
    }
    sucursalActual = ns; 
    localStorage.setItem("pos_sucursal", ns); 
    actualizarEtiquetasSucursal(); 
    document.getElementById('corte_sucursal').value = ns;
    if(document.getElementById('cfg_sucursal')) document.getElementById('cfg_sucursal').value = ns;
    
    // 🛡️ ESCUDO: Vaciamos todos los carritos al cambiar de sucursal para no mezclar datos
    carV = []; 
    carC = []; 
    carK = []; 
    carT = []; 
    carR = [];
    
    cargarConfigEnUI(); 
    renderI(); 
    renderCorte(); 
    renderV(); 
    renderC(); // Limpiamos visualmente la pantalla de compras
    
    actualizarContadorRecepciones(); 
    actualizarContadorPausadas(); 
    renderClientes(); 
    renderPromos();
}

function actualizarEtiquetasSucursal() { 
    document.querySelectorAll('.lbl-suc-act').forEach(el => el.innerText = sucursalActual.toUpperCase()); 
    let root = document.documentElement;
    if (sucursalActual === "Matriz") { root.style.setProperty('--p', '#007bff'); } 
    else if (sucursalActual === "Sucursal 1") { root.style.setProperty('--p', '#6f42c1');} 
    else if (sucursalActual === "Sucursal 2") { root.style.setProperty('--p', '#20c997'); }
}

function actualizarSelectsSucursales() {
    if (!listaSucursales || listaSucursales.length === 0) listaSucursales = ["Matriz"]; 
    let optionsNormal = listaSucursales.map(s => `<option value="${s}">📍 ${s}</option>`).join('');
    let optionsGlobal = '<option value="">Todas (Global)</option>' + optionsNormal;
    let optionsPromo = '<option value="Todas">Todas (Global)</option>' + optionsNormal;
    
    if(document.getElementById('ui_sucursal')) document.getElementById('ui_sucursal').innerHTML = optionsNormal;
    if(document.getElementById('cfg_sucursal')) document.getElementById('cfg_sucursal').innerHTML = optionsNormal;
    if(document.getElementById('t_origen')) document.getElementById('t_origen').innerHTML = optionsNormal;
    if(document.getElementById('t_destino')) document.getElementById('t_destino').innerHTML = optionsNormal;
    if(document.getElementById('corte_sucursal')) document.getElementById('corte_sucursal').innerHTML = optionsGlobal;
    if(document.getElementById('pr_sucursal')) document.getElementById('pr_sucursal').innerHTML = optionsPromo;
    
    // 🏢 DIBUJO DE LAS CASILLAS EN LA PESTAÑA DE AJUSTES (DISEÑO TIPO TARJETA)
    let cajaSucursales = document.getElementById('contenedor_checkbox_sucursales');
    if (cajaSucursales) {
        let htmlCheckboxes = listaSucursales.map(s => {
            let idLimpio = s.replace(/\s+/g, '_');
            return `<div style="display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: center !important; background: #ffffff !important; border: 2px solid var(--p, #0d6efd) !important; padding: 10px 15px !important; border-radius: 8px !important; cursor: pointer !important; box-shadow: 0 2px 4px rgba(0,0,0,0.1) !important;" onclick="let cb = this.querySelector('input'); cb.checked = !cb.checked;">
                <input type="checkbox" class="cb-sucursal" value="${s}" id="chk_${idLimpio}" checked style="margin: 0 10px 0 0 !important; width: 20px !important; height: 20px !important; pointer-events: none !important;">
                <span style="font-size: 15px !important; font-weight: bold !important; color: var(--p, #0d6efd) !important; margin: 0 !important; white-space: nowrap !important;">📍 ${s}</span>
            </div>`;
        }).join('');
        cajaSucursales.innerHTML = htmlCheckboxes;
    }
    
    if(document.getElementById('ui_sucursal') && typeof sucursalActual !== 'undefined' && listaSucursales.includes(sucursalActual)) {
        document.getElementById('ui_sucursal').value = sucursalActual;
    }
}
   

function renderGestSucursales() {
    let html = listaSucursales.map((s, i) => `
        <tr>
            <td><b>${s}</b></td>
            <td>
                <button style="background:var(--p); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" title="Renombrar" onclick="renombrarSucursal(${i})">✏️</button>
                ${s !== 'Matriz' ? `<button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; margin-left:5px;" title="Eliminar" onclick="eliminarSucursal(${i})">✕</button>` : ''}
            </td>
        </tr>
    `).join('');
    if(document.getElementById('lista_gest_suc')) document.getElementById('lista_gest_suc').innerHTML = html;
    actualizarSelectsSucursales();
}

function agregarSucursal() {
    let nombre = prompt("📝 Ingresa el nombre de la nueva sucursal:");
    if (!nombre) return; 
    nombre = nombre.trim();
    if (nombre === "") return alert("❌ El nombre no puede estar vacío.");
    if (listaSucursales.includes(nombre)) return alert("⚠️ Esa sucursal ya existe.");
    
    listaSucursales.push(nombre);
    db.collection("config").doc("sucursales").set({ lista: listaSucursales }).catch(e => console.log(e));
}

function renombrarSucursal(index) {
    let oldName = listaSucursales[index];
    let newName = prompt(`Ingresa el nuevo nombre para "${oldName}":`, oldName);
    if(!newName || newName.trim() === "" || newName === oldName) return;
    if(listaSucursales.some(s => s.toLowerCase() === newName.trim().toLowerCase())) return alert("❌ Ya existe.");
    
    listaSucursales[index] = newName.trim();
    db.collection("config").doc("sucursales").set({ lista: listaSucursales }).catch(e => console.log(e));
    if(sucursalActual === oldName) cambiarSucursal(newName.trim());
}

function eliminarSucursal(index) {
    let nom = listaSucursales[index];
    if(nom === 'Matriz') return alert("❌ La Matriz no se puede eliminar.");
    if(confirm(`⚠️ ¿Eliminar la sucursal "${nom}"?`)) {
        listaSucursales.splice(index, 1);
        db.collection("config").doc("sucursales").set({ lista: listaSucursales }).catch(e => console.log(e));
        if(sucursalActual === nom) cambiarSucursal('Matriz');
    }
}

function cargarConfigEnUI() {
    let sucAEditar = document.getElementById('cfg_sucursal') ? document.getElementById('cfg_sucursal').value : sucursalActual;
    let cfg = configTienda[sucAEditar] || { nombre: "Mi Tienda", detalles: "", mensaje: "", fontSize: 14 };
    
    if (document.getElementById('cfg_nombre')) document.getElementById('cfg_nombre').value = cfg.nombre || "Mi Tienda"; 
    if (document.getElementById('cfg_detalles')) document.getElementById('cfg_detalles').value = cfg.detalles || ""; 
    if (document.getElementById('cfg_mensaje')) document.getElementById('cfg_mensaje').value = cfg.mensaje || "";
    if (document.getElementById('cfg_font')) document.getElementById('cfg_font').value = cfg.fontSize || 14;

    let cfgActual = configTienda[sucursalActual] || { nombre: "Mi Tienda", detalles: "", mensaje: "¡Gracias por su compra!", fontSize: 14 };
    if(document.getElementById('ticket_print_nombre')) document.getElementById('ticket_print_nombre').innerText = cfgActual.nombre || "Mi Tienda";
    if(document.getElementById('ticket_print_detalles')) document.getElementById('ticket_print_detalles').innerText = cfgActual.detalles || "";
    if(document.getElementById('ticket_print_mensaje')) document.getElementById('ticket_print_mensaje').innerText = cfgActual.mensaje || "¡Gracias por su compra!";
    if(document.getElementById('visor_print_nombre')) document.getElementById('visor_print_nombre').innerText = cfgActual.nombre || "Mi Tienda";

    document.documentElement.style.setProperty('--ticket-font', (cfgActual.fontSize || 14) + 'px');
}

function guardarConfigTicket() {
    let sucAEditar = document.getElementById('cfg_sucursal').value;
    if(!configTienda[sucAEditar]) configTienda[sucAEditar] = {};
    configTienda[sucAEditar].nombre = document.getElementById('cfg_nombre').value.trim() || "Mi Tienda";
    configTienda[sucAEditar].detalles = document.getElementById('cfg_detalles').value.trim();
    configTienda[sucAEditar].mensaje = document.getElementById('cfg_mensaje').value.trim();
    configTienda[sucAEditar].fontSize = parseInt(document.getElementById('cfg_font').value) || 14;
    
    localStorage.setItem("pos_config_v11", JSON.stringify(configTienda));
    db.collection("config").doc("ticket").set(configTienda)
    .then(() => { alert(`✅ Formato guardado para ${sucAEditar}`); cargarConfigEnUI(); })
    .catch(err => alert("⚠️ Guardado localmente, error en nube."));
}

// ====================================================================
// === MÓDULO DE INVENTARIO (I-TAB) ===
// ====================================================================
function renderI() { 
    try {
        let container = document.getElementById('admin_total_inv_container');
        if (usuarioActual === "Admin") {
            if (container) container.style.display = 'inline-block'; 
            let totalValuacion = 0;
            Object.keys(inv).forEach(k => {
                let p = inv[k];
                if (p && p.tipo !== 'kit') {
                    let stockActual = (p.stock && p.stock[sucursalActual]) || 0;
                    let costoBase = parseFloat(p.cos) || 0;
                    totalValuacion += (stockActual * costoBase);
                }
            });
            let lbl = document.getElementById('lbl_total_inv_cost');
            if (lbl) lbl.innerText = totalValuacion.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else {
            if (container) container.style.display = 'none';
        }

        let deps = new Set();
        Object.values(inv).forEach(item => { if(item && item.dep) deps.add(item.dep); });
        let depSelect = document.getElementById('filtro_dep');
        if (depSelect) {
            let currentVal = depSelect.value;
            depSelect.innerHTML = '<option value="">📁 Todos los Deptos</option>' + 
                Array.from(deps).sort().map(d => `<option value="${d}">${d}</option>`).join('');
            depSelect.value = currentVal;
        }

        filtrarInventario(true); 
    } catch(err) { console.error("Error en renderI:", err); }
}

function filtrarInventario(mantenerFoco = false, evento = null) {
    if (evento && (evento.key === 'ArrowDown' || evento.key === 'ArrowUp' || evento.key === 'Enter')) return; 

    clearTimeout(timerFiltroInv);
    timerFiltroInv = setTimeout(() => {
        try {
            let txtInput = document.getElementById('buscar_inv');
            let txt = txtInput ? txtInput.value.toLowerCase() : '';
            let terms = txt.split(/%|\s+/).filter(t => t.trim() !== "");
            let depSelect = document.getElementById('filtro_dep');
            let depFiltro = depSelect ? depSelect.value.toLowerCase() : '';
            let tipoSelect = document.getElementById('filtro_tipo');
            let tipoFiltro = tipoSelect ? tipoSelect.value.toLowerCase() : '';
            
            let llaves = Object.keys(inv);
            currentInvKeys = []; 
            
            for (let i = 0; i < llaves.length; i++) {
                if (currentInvKeys.length >= 100) break; 
                let k = llaves[i]; let x = inv[k];
                if (!x) continue; 
                
                let searchTarget = k.toLowerCase() + " " + (x.nom || '').toLowerCase();
                let matchTxt = terms.length === 0 || terms.every(term => searchTarget.includes(term));
                let matchDep = depFiltro === "" || (x.dep || 'General').toLowerCase() === depFiltro;
                let matchTipo = tipoFiltro === "" || (x.tipo || 'pieza').toLowerCase() === tipoFiltro;
                
                if (matchTxt && matchDep && matchTipo) currentInvKeys.push(k);
            }
            
            if (!mantenerFoco && !evento) focusInvIndex = currentInvKeys.length > 0 ? 0 : -1;
            renderTablaInventario();
        } catch(err) { console.error(err); }
    }, 200);
}

function renderTablaInventario() {
    try {
        let html = '';
        for (let i = 0; i < currentInvKeys.length; i++) {
            let k = currentInvKeys[i]; let x = inv[k];
            if (!x) continue;
            
            let isFocused = (i === focusInvIndex);
            let bgRow = isFocused ? 'background:#e0f0ff; border-left: 4px solid var(--p);' : '';
            
            let st = getVirtualStock(x); 
            let fal = (x.sold_without_stock && x.sold_without_stock[sucursalActual]) || 0; 
            
            html += `<tr style="${bgRow}">
                <td>${isFocused ? '👉 ' : ''}${k}</td>
                <td>${x.nom}</td>
                <td><span class="badge-kit" style="background:#6c757d">${x.dep||'General'}</span></td>
                <td>${(x.tipo||'pieza').toUpperCase()}</td>
                <td><b>${st}</b></td>
                <td style="color:red">${fal}</td>
                <td>$${(parseFloat(x.pv)||0).toFixed(2)}</td>
                <td>
                    <button class="no-print" style="background:var(--info); color:white; border:none; padding:5px 10px; border-radius:5px; margin-right:5px; cursor:pointer;" title="Ajustar Stock" onclick="abrirAjusteStock('${k}')">📦</button>
                    <button class="no-print" style="background:var(--p); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" title="Editar Datos" onclick="abrirEditar('${k}')">✏️</button>
                </td>
            </tr>`;
        }
        let tbody = document.getElementById('i_lista');
        if (tbody) tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center">No se encontraron productos</td></tr>';
    } catch(err) { console.error(err); }
}

function getVirtualStock(p) { 
    if(p.tipo === 'kit') {
        let max = Infinity; 
        if(!p.comp || p.comp.length===0) return 0; 
        p.comp.forEach(c => { 
            let child = inv[c.cod] || {};
            let st = getVirtualStock(child); 
            let poss = Math.floor(st / (c.can||1)); 
            if(poss < max) max = poss; 
        }); 
        return max === Infinity ? 0 : max; 
    }
    if (p.grupo && inv[p.grupo]) return (inv[p.grupo].stock && inv[p.grupo].stock[sucursalActual]) || 0;
    return (p.stock && p.stock[sucursalActual]) || 0; 
}

function descontarStock(cod, cant) { 
    // 🔥 MAGIA: Redirige la resta de inventario al Maestro si pertenece a un grupo
    let item = obtenerProductoMaestro(cod); 
    let codMaestro = item === inv[cod] ? cod : inv[cod].grupo;
    
    if(!item) return; 
    if(!item.stock) item.stock = {}; 
    if(!item.sold_without_stock) item.sold_without_stock = {}; 
    
    let disp = Math.max(0, item.stock[sucursalActual] || 0); 
    if(disp >= cant) { 
        item.stock[sucursalActual] = disp - cant; 
    } else { 
        let fal = cant - disp; 
        item.stock[sucursalActual] = 0; 
        item.sold_without_stock[sucursalActual] = (item.sold_without_stock[sucursalActual] || 0) + fal; 
    } 
    
    // 🛡️ ACTUALIZACIÓN CRÍTICA: Nos aseguramos de mantener el tipo correcto (granel/pieza) en la memoria local
    if(inv[codMaestro]) {
        item.tipo = inv[codMaestro].tipo || item.tipo || 'pieza';
        item.nom = inv[codMaestro].nom || item.nom;
        item.dep = inv[codMaestro].dep || item.dep;
    }
    
    // Subir el stock actualizado a la nube SIN perder las propiedades esenciales
    if(typeof db !== 'undefined') db.collection("inventario").doc(codMaestro).set(item);
}

// Funciones de Ajuste Manual de Stock
let codAjusteStock = "";
function abrirAjusteStock(cod) {
    let p = inv[cod];
    if(!p) return;
    if(p.tipo === 'kit') return alert("❌ El stock de los KITS se calcula por sus componentes.");
    codAjusteStock = cod;
    document.getElementById('ajuste_nom').innerText = p.nom;
    document.getElementById('ajuste_stock_actual').innerText = (p.stock && p.stock[sucursalActual]) || 0;
    document.getElementById('ajuste_nuevo_stock').value = "";
    document.getElementById('ajuste_admin_pin').value = "";
    document.getElementById('modalAjusteStock').style.display = 'block';
    setTimeout(() => document.getElementById('ajuste_nuevo_stock').focus(), 100);
}

function guardarAjusteStock() {
    let nuevoStock = parseFloat(document.getElementById('ajuste_nuevo_stock').value);
    let pin = document.getElementById('ajuste_admin_pin').value;
    if (isNaN(nuevoStock) || nuevoStock < 0) return alert("⚠️ Cantidad inválida.");
    if (usuariosData["Admin"] && usuariosData["Admin"].pin === pin) {
        if(!inv[codAjusteStock].stock) inv[codAjusteStock].stock = {};
        inv[codAjusteStock].stock[sucursalActual] = nuevoStock;
        db.collection("inventario").doc(codAjusteStock).set(inv[codAjusteStock])
        .then(() => {
            let stockAnterior = parseFloat(document.getElementById('ajuste_stock_actual').innerText) || 0;
            let diferencia = nuevoStock - stockAnterior;

            registrarEnKardex(codAjusteStock, inv[codAjusteStock].nom, "AJUSTE", diferencia, inv[codAjusteStock].pv || 0, inv[codAjusteStock].cos || 0);
            document.getElementById('modalAjusteStock').style.display = 'none';
            alert("✅ Stock actualizado en la NUBE.");
        }).catch((e) => alert("❌ Error con la nube."));
    } else {
        alert("❌ PIN Incorrecto.");
        document.getElementById('ajuste_admin_pin').value = '';
        document.getElementById('ajuste_admin_pin').focus();
    }
}

function abrirAuthReiniciarInv() {
    document.getElementById('auth_reiniciar_pin').value = '';
    document.getElementById('modalAuthReiniciarInv').style.display = 'block';
    setTimeout(() => document.getElementById('auth_reiniciar_pin').focus(), 100);
}

function confirmarReiniciarInv() {
    let pin = document.getElementById('auth_reiniciar_pin').value;
    if (usuariosData["Admin"] && usuariosData["Admin"].pin === pin) {
        if(confirm("⚠️ ¿Estás seguro de poner en CERO todo el stock físico de esta sucursal?")) {
            Object.keys(inv).forEach(k => {
                if(inv[k].stock) inv[k].stock[sucursalActual] = 0; 
                db.collection("inventario").doc(k).set(inv[k]).catch(e=>console.log(e)); 
            });
            renderI();
            document.getElementById('modalAuthReiniciarInv').style.display = 'none';
            alert("🚨 Todo el stock ha sido reseteado a 0.");
        }
    } else {
        alert("❌ PIN Incorrecto.");
        document.getElementById('auth_reiniciar_pin').focus();
    }
}

// Edición de Productos
function abrirEditar(cod) { 
    let p = inv[cod]; 
    document.getElementById('e_cod_original').value = cod; 
    document.getElementById('e_cod').value = cod; 
    document.getElementById('e_dep').value = p.dep || "General"; 
    document.getElementById('e_nom').value = p.nom; 
    document.getElementById('e_tipo').value = p.tipo || 'pieza'; 
    document.getElementById('e_cos').value = p.cos || 0; 
    document.getElementById('e_iva').value = p.iva || 0; 
    document.getElementById('e_pv').value = p.pv || 0; 
    document.getElementById('e_pm').value = p.pm || 0; 
    document.getElementById('e_md').value = p.md || 10; 
    document.getElementById('e_gan').value = p.gan || 0; 
    document.getElementById('e_fal').value = (p.sold_without_stock && p.sold_without_stock[sucursalActual]) || 0; 
    document.getElementById('modalEditar').style.display = 'block'; 
}

function recalcPrecioEdicion() {
    let costo = parseFloat(document.getElementById('e_cos').value) || 0;
    let ganancia = parseFloat(document.getElementById('e_gan').value) || 0;
    let iva = parseFloat(document.getElementById('e_iva').value) || 0;
    let costoReal = costo * (1 + (iva / 100));
    let nuevoPrecio = costoReal * (1 + (ganancia / 100));
    nuevoPrecio = Math.round(nuevoPrecio * 2) / 2;
    document.getElementById('e_pv').value = nuevoPrecio.toFixed(2);
}

function recalcGanEdicion() {
    let costo = parseFloat(document.getElementById('e_cos').value) || 0;
    let precio = parseFloat(document.getElementById('e_pv').value) || 0;
    let iva = parseFloat(document.getElementById('e_iva').value) || 0;
    let costoReal = costo * (1 + (iva / 100));
    if (costoReal > 0) {
        let nuevaGan = ((precio / costoReal) - 1) * 100;
        document.getElementById('e_gan').value = nuevaGan.toFixed(2);
    }
}

  function guardarEdicion() {
    let codViejo = document.getElementById('e_cod_original').value; 
    let codNuevo = document.getElementById('e_cod').value.trim(); 
    let nuevoNom = document.getElementById('e_nom').value.trim();
    let nuevoDep = document.getElementById('e_dep').value.trim() || 'General';
    let nuevoTipo = document.getElementById('e_tipo').value;
    let nuevoCos = parseFloat(document.getElementById('e_cos').value) || 0;
    let nuevoIva = parseFloat(document.getElementById('e_iva').value) || 0;
    let nuevaGan = parseFloat(document.getElementById('e_gan').value) || 0;
    let nuevoPv = parseFloat(document.getElementById('e_pv').value) || 0;
    let nuevoPm = parseFloat(document.getElementById('e_pm').value) || 0;
    let nuevoMd = parseFloat(document.getElementById('e_md').value) || 10;
    
    if(!codNuevo) return alert("❌ El código no puede estar vacío.");
    if(!nuevoNom) return alert("❌ El nombre no puede estar vacío.");

    if (codNuevo !== codViejo) {
        if (inv[codNuevo]) return alert("⚠️ Código en uso.");
        inv[codNuevo] = JSON.parse(JSON.stringify(inv[codViejo])); 
        inv[codNuevo].nom = nuevoNom; inv[codNuevo].dep = nuevoDep; inv[codNuevo].tipo = nuevoTipo;
        inv[codNuevo].cos = nuevoCos; inv[codNuevo].iva = nuevoIva; inv[codNuevo].gan = nuevaGan;
        inv[codNuevo].pv = nuevoPv; inv[codNuevo].pm = nuevoPm; inv[codNuevo].md = nuevoMd;
        
        // 🌟 ESCUDO 1: También aquí marcamos el tiempo para el nuevo código
        inv[codNuevo].updatedAt = Date.now(); 
        
        delete inv[codViejo];
        db.collection("inventario").doc(String(codViejo)).delete();
        
        // CORREGIDO: Envoltura de datos para el adaptador
        db.collection("inventario").doc(String(codNuevo)).set(inv[codNuevo])
        .then(()=>alert("✅ Actualizado")).catch(e=>console.log(e));
    } else {
        inv[codViejo].nom = nuevoNom; inv[codViejo].dep = nuevoDep; inv[codViejo].tipo = nuevoTipo;
        inv[codViejo].cos = nuevoCos; inv[codViejo].iva = nuevoIva; inv[codViejo].gan = nuevaGan;
        inv[codViejo].pv = nuevoPv; inv[codViejo].pm = nuevoPm; inv[codViejo].md = nuevoMd;
        
        // 🌟 ESCUDO 2: Tu marca de tiempo excelente cuando el código se queda igual
        inv[codViejo].updatedAt = Date.now();
        
        // CORREGIDO: Forzamos la actualización limpia en el backend
        db.collection("inventario").doc(String(codViejo)).set(inv[codViejo])
        .then(()=>alert("✅ Guardado")).catch(e=>console.log(e));
    }
    
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); 
    
    // 📊 KARDEX BLINDADO: Usamos 'nuevoNom' directamente para evitar baches de memoria asíncrona
    let codAuditar = (codNuevo !== codViejo) ? codNuevo : codViejo;
    registrarEnKardex(codAuditar, nuevoNom, "EDICIÓN", 0, nuevoPv, nuevoCos);
    
    cerrarModales(); renderTablaInventario();
}
function procesarImportacion() {
    let text = document.getElementById('import_data').value.trim();
    if(!text) return alert("⚠️ Pega los datos primero.");
    let filas = text.split('\n'); let countNuevos = 0; let countActualizados = 0;
    for(let i = 0; i < filas.length; i++) {
        let cols = filas[i].split('\t'); 
        if(cols.length >= 2) { 
            let cod = cols[0].trim();
            if(cod !== "" && cod.toLowerCase() !== "código" && cod.toLowerCase() !== "codigo") { 
                if(!inv[cod]) { inv[cod] = { stock: {}, comp: [], sold_without_stock: {} }; countNuevos++; } 
                else { countActualizados++; }
                inv[cod].nom = cols[1] ? cols[1].trim() : "Producto Importado"; 
                inv[cod].dep = cols[2] ? cols[2].trim() : "General";
                let tipoRaw = cols[3] ? cols[3].trim().toLowerCase() : "pieza"; 
                inv[cod].tipo = (tipoRaw === 'granel' || tipoRaw === 'kit') ? tipoRaw : 'pieza';
                const cleanNum = (val) => val ? parseFloat(String(val).replace(',', '.')) : 0;
                inv[cod].cos = cleanNum(cols[4]); 
                inv[cod].pv  = cleanNum(cols[5]); 
                inv[cod].pm  = cols[6] ? cleanNum(cols[6]) : inv[cod].pv; 
                inv[cod].md  = parseInt(cols[7]) || 10;
                inv[cod].gan = cols[8] ? cleanNum(cols[8]) : 30; 
                if(inv[cod].iva === undefined) inv[cod].iva = 0;
                db.collection("inventario").doc(cod).set(inv[cod]).catch(e=>console.log(e));
            }
        }
    }
    renderI(); cerrarModales(); document.getElementById('import_data').value = ''; 
    alert(`✅ Importación exitosa.\n\nNuevos: ${countNuevos}\nActualizados: ${countActualizados}`);
}

// ====================================================================
// === MÓDULO DE VENTAS (V-TAB) ===
// ====================================================================
function handleVenta(e) { 
    if(e.key === 'Enter') { 
        try {
            let cod = document.getElementById('v_cod').value.trim(); 
            if(!cod) return;
            if(!inv[cod]) { 
                document.getElementById('pnf_cod').innerText = cod;
                document.getElementById('modalProdNoEncontrado').style.display = 'block';
                return; 
            } 
            
            let hoy = getFechaLocal(); let promoAgotada = null;
            if(Array.isArray(promociones)) { promoAgotada = promociones.find(pr => pr && pr.cod === cod && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && ( (pr.fecha_fin && hoy > pr.fecha_fin) || (pr.limite > 0 && (pr.usadas||0) >= pr.limite) )); }
            if (promoAgotada && !carV.some(item => item.cod === cod)) { 
                document.getElementById('pa_nom').innerText = inv[cod].nom || 'Producto'; 
                document.getElementById('modalPromoAgotada').style.display = 'block'; 
                setTimeout(() => document.getElementById('btn_cerrar_pa').focus(), 100); 
            }
            
            if(inv[cod].tipo === 'granel') { 
                abrirGranel(cod); 
            } else { 
                let i = carV.findIndex(x => x.cod === cod); 
                if(i > -1) { 
                    carV[i].can++; focusVentaIndex = i; 
                } else { 
                    carV.push({cod, nom: inv[cod].nom || 'Producto', can: 1, tipo: inv[cod].tipo || 'pieza'}); 
                    focusVentaIndex = carV.length - 1; 
                } 
                renderV(); 
            }
            document.getElementById('v_cod').value = ""; 
        } catch(err) { console.error(err); alert("Error al escanear: " + err.message); }
    } 
}

function irARegistrarProdVenta() {
    let cod = document.getElementById('pnf_cod').innerText;
    cerrarModales();
    document.getElementById('btn_c-tab').click();
    document.getElementById('c_cod').value = cod;
    handleCompraScan({key: 'Enter'});
}

function cerrarModalNoEncontrado() {
    cerrarModales();
    document.getElementById('v_cod').value = '';
    document.getElementById('v_cod').focus();
}

window.renderV = function() { 
    try {
        let t = 0; let hoy = getFechaLocal();
        document.getElementById('v_lista').innerHTML = carV.map((x, i) => { 
            let pO = inv[x.cod] || {}; 
            let minM = pO.md || 10; 
            
            let precioVentaNormal = pO.pv || 0;
            if (pO.pre_sucursales && pO.pre_sucursales[sucursalActual] !== undefined) precioVentaNormal = pO.pre_sucursales[sucursalActual];
            let precioMayoreo = pO.pm || precioVentaNormal;

            let aplicaMayoreo = forceWholesale && ((x.can||1) >= minM); 
            let subtotalNormal = (x.can||1) * precioVentaNormal;
            let subtotalMayoreo = aplicaMayoreo ? ((x.can||1) * precioMayoreo) : subtotalNormal;

            let subtotalPromo = subtotalNormal;
            let promoActiva = null;
            if(Array.isArray(promociones)) {
                promoActiva = promociones.find(pr => pr && pr.cod === x.cod && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && pr.fecha_ini <= hoy && (!pr.fecha_fin || pr.fecha_fin >= hoy) && (pr.limite === 0 || (pr.usadas||0) < pr.limite));
            }

            if (promoActiva) {
                if (promoActiva.tipo === 'desc') {
                    let cantA = x.can||1; 
                    if((promoActiva.limite||0) > 0) { 
                        let disp = promoActiva.limite - (promoActiva.usadas||0); 
                        if(cantA > disp) cantA = disp; 
                    } 
                    subtotalPromo = (cantA * (precioVentaNormal * (1 - (promoActiva.desc||0)/100))) + (((x.can||1) - cantA) * precioVentaNormal); 
                } else if (promoActiva.tipo === 'nxm') {
                    let nVal = promoActiva.n || 1; 
                    let grupos = Math.floor((x.can||1) / nVal); 
                    let sueltos = (x.can||1) % nVal; 
                    if((promoActiva.limite||0) > 0) { 
                        let disp = promoActiva.limite - (promoActiva.usadas||0); 
                        if(grupos > disp) { sueltos += (grupos - disp) * nVal; grupos = disp; } 
                    } 
                    subtotalPromo = (grupos * (promoActiva.m||0) * precioVentaNormal) + (sueltos * precioVentaNormal); 
                }
            }

            let s = subtotalNormal;
            let badge = x.tipo==='kit'?'<span class="badge-kit">KIT</span>':'';
            
            if (aplicaMayoreo && subtotalMayoreo < s) {
                s = subtotalMayoreo;
                badge += `<span class="badge-kit" style="background:var(--warning); color:#000;">MAYOREO</span>`;
            }

            if (promoActiva && subtotalPromo < s) {
                s = subtotalPromo;
                badge = x.tipo==='kit'?'<span class="badge-kit">KIT</span>':'';
                if(promoActiva.tipo === 'desc') badge += `<span class="badge-kit" style="background:var(--promo)">-${promoActiva.desc}%</span>`; 
                if(promoActiva.tipo === 'nxm') badge += `<span class="badge-kit" style="background:var(--promo)">${promoActiva.n}x${promoActiva.m}</span>`; 
            }

            if (x.esGranelMontoExacto !== undefined) {
                s = parseFloat(x.esGranelMontoExacto); 
                if (promoActiva && promoActiva.tipo === 'desc') badge += `<span class="badge-kit" style="background:var(--promo)">-${promoActiva.desc}%</span>`; 
            } else if (x.precioManual !== undefined) {
                s = (x.can||1) * x.precioManual; 
                badge = `<span class="badge-kit" style="background:var(--d);">MANUAL</span>`;
            }
            
            let p = s / (x.can || 1); 
            t += s; 
            
            let printName = x.nom || 'Producto'; 
            let unitPrice = p.toFixed(2);
            let isFocused = (i === focusVentaIndex);
            let bgRow = isFocused ? 'background:#e0f0ff; border-left: 4px solid var(--p);' : '';
            
            return `<tr style="${bgRow}">
                <td>${isFocused ? '👉 ' : ''}${printName} ${badge}</td>
                <td><input type="number" value="${x.can}" style="width:60px" onchange="carV[${i}].can=parseFloat(this.value)||1; delete carV[${i}].esGranelMontoExacto; window.renderV(); document.getElementById('v_cod').focus();"></td>
                <td>$<input type="number" value="${unitPrice}" style="width:80px; font-weight:bold; color:var(--p); border: 1px solid #ccc; padding: 5px; border-radius: 4px;" onchange="carV[${i}].precioManual=parseFloat(this.value)||0; delete carV[${i}].esGranelMontoExacto; window.renderV(); document.getElementById('v_cod').focus();"></td>
                <td>$${s.toFixed(2)}</td>
                <td><button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="carV.splice(${i},1); focusVentaIndex = Math.min(focusVentaIndex, carV.length - 1); window.renderV(); document.getElementById('v_cod').focus();">✕</button></td>
            </tr>`;
        }).join(''); 

        t = Math.round(t * 2) / 2; 
        document.getElementById('v_total').innerText = t.toFixed(2); 

        // Contador de Artículos
        let totalArticulos = carV.reduce((acc, x) => acc + (parseFloat(x.can) || 1), 0);
        let divContador = document.getElementById('v_contador_articulos');
        if (!divContador) {
            let totalDOM = document.getElementById('v_total');
            if (totalDOM && totalDOM.parentNode) {
                divContador = document.createElement('div');
                divContador.id = 'v_contador_articulos';
                divContador.style = "font-size: 16px; color: var(--p); font-weight: bold; margin-top: 8px;";
                totalDOM.parentNode.appendChild(divContador);
            }
        }
        if (divContador) divContador.innerText = `🛒 Total Artículos: ${Math.round(totalArticulos * 100) / 100}`;

    } catch(err) { console.error("Error renderizando lista:", err); }
};



function calcCambio() { 
    let r = parseFloat(document.getElementById('m_recibido').value) || 0; 
    let cambioVirtual = Math.max(0, r - restanteCobro);
    document.getElementById('m_cambio').innerText = "Cambio: $" + cambioVirtual.toFixed(2); 
}

// Cobro y Pagos Mixtos
let pagosCobro = []; let restanteCobro = 0;

// 1. NUEVA FUNCIÓN PARA MOSTRAR LOS BOTONES DE LAS TERMINALES
window.checkMetodoCobro = function() {
    let met = document.getElementById('m_metodo').value;
    
    // Ocultar o mostrar div de cliente de crédito
    let divCli = document.getElementById('div_cobro_cliente');
    if (divCli) divCli.style.display = (met === 'Crédito') ? 'block' : 'none';
    
    // Elementos de la interfaz
    let btnNormal = document.getElementById('btn_cobro_normal');
    let divTerminales = document.getElementById('div_botones_terminal');
    let btnMP = document.getElementById('btn_term_mp');
    let btnGN = document.getElementById('btn_term_gn');
    
    if (btnNormal && divTerminales) {
        if (met === 'Tarjeta') {
            btnNormal.style.display = 'none';
            divTerminales.style.display = 'flex';
            
            // 🌟 LEER CONFIGURACIÓN DE AJUSTES EN TIEMPO REAL
            let sucursal = typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz";
            let configMP = JSON.parse(localStorage.getItem("mp_config_" + sucursal) || "{}");
            let configGN = JSON.parse(localStorage.getItem("gn_config_" + sucursal) || "{}");
            
            // Mostrar los botones solo si la terminal está activada en ajustes
            if (btnMP) btnMP.style.display = configMP.activo ? 'block' : 'none';
            if (btnGN) btnGN.style.display = configGN.activo ? 'block' : 'none';
            
        } else {
            // Regresar al estado normal si no es tarjeta
            btnNormal.style.display = 'block';
            divTerminales.style.display = 'none';
        }
    }
    
    if (typeof calcCambio === 'function') calcCambio(); 
};

// 2. FUNCIÓN DE COBRO ACTUALIZADA CON MERCADO PAGO Y GETNET
window.agregarPagoVenta = async function(terminalSeleccionada = null) { 
    try {
        let met = document.getElementById('m_metodo').value;
        let r = parseFloat(document.getElementById('m_recibido').value) || 0;
        if (r <= 0) return alert("⚠️ Ingresa un monto válido.");

        // Si eligió tarjeta pero le dio a la tecla 'Enter' (sin hacer clic en los botones nuevos)
        if (met === 'Tarjeta' && !terminalSeleccionada) {
            return alert("👆 Por favor, elige a qué terminal enviar el cobro haciendo clic en uno de los botones (M. PAGO, GETNET o MANUAL).");
        }

        let telClienteSeleccionado = null;
        if (met === 'Crédito') { 
            telClienteSeleccionado = document.getElementById('m_cliente_select').value; 
            if(!telClienteSeleccionado) return alert("❌ Selecciona cliente."); 
        }

        let pagoAplicado = Math.min(r, Math.round(restanteCobro * 100) / 100); 
        let cambio = Math.max(0, r - pagoAplicado); 

        // 🚀🌟 CONEXIÓN A LA TERMINAL SELECCIONADA 🌟🚀
        if (met === 'Tarjeta' && terminalSeleccionada) {
            let cobroExitoso = false;
            let intentoTerminal = false;

            if (terminalSeleccionada === 'Mercado Pago') {
                intentoTerminal = true;
                cobroExitoso = await enviarCobroTerminal(pagoAplicado); // Función MP
            } 
            else if (terminalSeleccionada === 'Getnet') {
                intentoTerminal = true;
                cobroExitoso = await enviarCobroGetnet(pagoAplicado); // Función Getnet
            }
            else if (terminalSeleccionada === 'Tarjeta Manual') {
                intentoTerminal = true;
                cobroExitoso = true; // Pasa directo sin usar internet
            }

            if (intentoTerminal && !cobroExitoso) {
                let forzarCobro = confirm("⚠️ Hubo un error de conexión con " + terminalSeleccionada + ".\n\n¿Lograste cobrar el dinero directamente en la maquinita física y deseas forzar el registro de esta venta?");
                
                if (!forzarCobro) return; // Abortamos
            }
            
            // Re-etiquetamos el método de pago para que en tu ticket y corte Z salga bonito
            met = (terminalSeleccionada === 'Tarjeta Manual') ? 'Tarjeta' : terminalSeleccionada;
        }

        if (typeof pagosCobro === 'undefined') window.pagosCobro = [];
        pagosCobro.push({ metodo: met, montoAplicado: Number(pagoAplicado.toFixed(2)), montoEntregado: Number(r.toFixed(2)), cliente_tel: telClienteSeleccionado || "" });

        restanteCobro = Math.max(0, restanteCobro - pagoAplicado);
        if(typeof renderPagosCobro === "function") renderPagosCobro();

        if (restanteCobro < 0.01) { 
            window.confirmarVenta(cambio);
        } else {
            document.getElementById('m_recibido').value = restanteCobro.toFixed(2);
            document.getElementById('m_recibido').select();
            calcCambio();
        }
    } catch (err) { alert("Error en el pago: " + err.message); }
};

function renderPagosCobro() {
    document.getElementById('m_restante_div').innerText = "Falta: $" + Math.max(0, restanteCobro).toFixed(2);
    let html = pagosCobro.map((p, i) => `
        <div style="display:flex; justify-content:space-between; font-size:13px; color:#333; padding:5px; background:#f1f1f1; margin-bottom:3px; border-radius:5px;">
            <span><b>${p.metodo}</b> ${p.cliente_tel ? '(Fiado)' : ''}</span>
            <span>$${p.montoAplicado.toFixed(2)} <button onclick="quitarPagoVenta(${i})" style="background:var(--danger); color:white; border:none; border-radius:3px; cursor:pointer; padding:2px 5px; margin-left:5px;">✕</button></span>
        </div>
    `).join('');
    document.getElementById('m_lista_pagos').innerHTML = html;
}

function quitarPagoVenta(index) {
    pagosCobro.splice(index, 1);
    let total = parseFloat(document.getElementById('v_total').innerText);
    let pagado = pagosCobro.reduce((sum, p) => sum + p.montoAplicado, 0);
    restanteCobro = total - pagado;
    document.getElementById('m_recibido').value = restanteCobro.toFixed(2);
    renderPagosCobro(); calcCambio();
}

function abrirCobro() { 
    if(carV.length === 0) return; 
    let total = parseFloat(document.getElementById('v_total').innerText);
    pagosCobro = []; restanteCobro = total;
    document.getElementById('m_total').innerText = "$" + total.toFixed(2); 
    document.getElementById('m_metodo').value = "Efectivo"; 
    checkMetodoCobro(); 
    document.getElementById('m_recibido').value = restanteCobro.toFixed(2); 
    document.getElementById('m_lista_pagos').innerHTML = '';
    renderPagosCobro(); calcCambio();
    document.getElementById('modalCobro').style.display = 'block'; 
    setTimeout(() => document.getElementById('m_recibido').select(), 100); 
}

window.confirmarVenta = function(cambioFinal = 0) {
    try {
        let tot = parseFloat(document.getElementById('v_total').innerText); 
        if(tot <= 0 || isNaN(tot)) return;

        let nombresClientes = [];
        if (typeof pagosCobro !== 'undefined' && Array.isArray(pagosCobro)) {
            for (let p of pagosCobro) {
                if(p.metodo === 'Crédito') {
                    let c = clientes[p.cliente_tel];
                    if(!c) return alert("Error: Cliente no encontrado.");
                    if((c.saldo + p.montoAplicado) > (c.limite || 0)) { 
                        if(!confirm(`⚠️ El cliente ${c.nom} superará su límite de crédito. ¿Autorizar?`)) return; 
                    }
                    c.saldo += p.montoAplicado;
                    if (typeof db !== 'undefined') db.collection("clientes").doc(p.cliente_tel).set(c).catch(e => console.warn("Cliente a mochila."));
                    nombresClientes.push(c.nom);
                }
            }
        }
        
        let nomClienteTicket = nombresClientes.length > 0 ? nombresClientes.join(', ') : "Público General";
        let metodosStr = (typeof pagosCobro !== 'undefined' && pagosCobro.length > 0) ? pagosCobro.map(p => p.metodo).join(' + ') : 'Efectivo';
        let hoy = getFechaLocal(); let itemsTicketHtml = ''; let detallesParaGuardar = [];
        
        for (let x of carV) { 
            let pO = inv[x.cod] || {}; 
            
            // 1. Descontamos el stock físico
            if(pO.tipo === 'kit') { if(pO.comp) pO.comp.forEach(c => descontarStock(c.cod, (c.can || 1) * (x.can || 1))); } 
            else { descontarStock(x.cod, x.can || 1); }
            
            // 2. Precios base
            let minM = pO.md || 10; 
            let precioVentaReal = pO.pv || 0;
            if (pO.pre_sucursales && pO.pre_sucursales[sucursalActual] !== undefined) precioVentaReal = pO.pre_sucursales[sucursalActual];
            let p = (typeof forceWholesale !== 'undefined' && forceWholesale && (x.can||1) >= minM) ? (pO.pm || precioVentaReal) : precioVentaReal; 
            
            let sub = (x.can||1) * p; 

            // 🔥 3. LÓGICA DE PROMOCIONES INCORPORADA Y CONTEO 🔥
            let promoActiva = null;
            if(Array.isArray(promociones)) {
                promoActiva = promociones.find(pr => pr && pr.cod === x.cod && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && pr.fecha_ini <= hoy && (!pr.fecha_fin || pr.fecha_fin >= hoy) && (pr.limite === 0 || (pr.usadas||0) < pr.limite));
            }

            if (promoActiva && x.esGranelMontoExacto === undefined && x.precioManual === undefined) {
                let subtotalPromo = sub;
                let usosAAgregar = 0;
                
                if (promoActiva.tipo === 'desc') {
                    let cantA = x.can||1; 
                    if((promoActiva.limite||0) > 0) { 
                        let disp = promoActiva.limite - (promoActiva.usadas||0); 
                        if(cantA > disp) cantA = disp; 
                    } 
                    subtotalPromo = (cantA * (precioVentaReal * (1 - (promoActiva.desc||0)/100))) + (((x.can||1) - cantA) * precioVentaReal); 
                    usosAAgregar = cantA; // Suma 1 uso por cada pieza vendida con descuento
                } else if (promoActiva.tipo === 'nxm') {
                    let nVal = promoActiva.n || 1; 
                    let grupos = Math.floor((x.can||1) / nVal); 
                    let sueltos = (x.can||1) % nVal; 
                    if((promoActiva.limite||0) > 0) { 
                        let disp = promoActiva.limite - (promoActiva.usadas||0); 
                        if(grupos > disp) { sueltos += (grupos - disp) * nVal; grupos = disp; } 
                    } 
                    subtotalPromo = (grupos * (promoActiva.m||0) * precioVentaReal) + (sueltos * precioVentaReal); 
                    usosAAgregar = grupos; // Suma 1 uso por cada "Grupo" de promoción aplicado
                }

                if (subtotalPromo < sub) { 
                    sub = subtotalPromo; 
                    // 📈 SUMAMOS EL CONTADOR A LA BASE DE DATOS
                    promoActiva.usadas = (promoActiva.usadas || 0) + usosAAgregar;
                    if (typeof db !== 'undefined') db.collection("promociones").doc(String(promoActiva.id)).set(promoActiva);
                }
            }

            // Si se editó el precio manualmente, sobreescribe la promo
            if (x.precioManual !== undefined) sub = (x.can||1) * x.precioManual;
            if (x.esGranelMontoExacto !== undefined) sub = parseFloat(x.esGranelMontoExacto);

            // 4. Congelamos el Costo Promedio en el ticket
            let costoAUsar = pO.cos_promedio !== undefined ? parseFloat(pO.cos_promedio) : parseFloat(pO.cos);
            let costoCongelado = (costoAUsar || 0) * (1 + (parseFloat(pO.iva) || 0)/100);
            
            registrarEnKardex(x.cod, x.nom, "VENTA", -(x.can || 1), (sub / (x.can || 1)), pO.cos || 0);
            
            let printName = (x.nom || 'Producto').substring(0,15); 
            itemsTicketHtml += `<tr><td>${x.can||1}</td><td>${printName}</td><td style="text-align:right">$${sub.toFixed(2)}</td></tr>`;
            
            detallesParaGuardar.push({ cod: x.cod, nom: x.nom || 'Producto', can: x.can || 1, subtotal: sub, costo: costoCongelado, dep: pO.dep || "General" });
            
            if (typeof db !== 'undefined' && x.cod) {
                db.collection("inventario").doc(x.cod).set(inv[x.cod] || {nom: x.nom}).catch(e => console.warn("Inventario a mochila."));
            }
        }
        
        document.getElementById('ticket_fecha').innerText = new Date().toLocaleString() + " - " + sucursalActual + "\nCliente: " + nomClienteTicket;
        document.getElementById('ticket_items').innerHTML = itemsTicketHtml; 
        document.getElementById('ticket_total').innerText = tot.toFixed(2); 
        document.getElementById('ticket_metodo').innerText = metodosStr; 
        
        let celdaCambio = document.getElementById('ticket_cambio');
        if (celdaCambio) {
            let filaCambio = celdaCambio.closest('tr');
            if (filaCambio && !document.getElementById('fila_ticket_pagado')) {
                let trPagado = document.createElement('tr');
                trPagado.id = 'fila_ticket_pagado';
                trPagado.innerHTML = `<th style="text-align:left;">Pagó con:</th><td style="text-align:right;">$<span id="ticket_pagado">0.00</span></td>`;
                filaCambio.parentNode.insertBefore(trPagado, filaCambio);
            }
        }
        
        let totalPagado = (typeof pagosCobro !== 'undefined' && pagosCobro.length > 0) ? pagosCobro.reduce((sum, p) => sum + parseFloat(p.montoEntregado || 0), 0) : (tot + parseFloat(cambioFinal || 0));
        let spanPagado = document.getElementById('ticket_pagado');
        if (spanPagado) spanPagado.innerText = totalPagado.toFixed(2);
        
        document.getElementById('ticket_cambio').innerText = parseFloat(cambioFinal).toFixed(2); 
        document.getElementById('ticket_cajero').innerText = usuarioActual;
        
        let idVentaNueva = Date.now() + Math.floor(Math.random()*1000);
        let nuevaVenta = { 
            id: idVentaNueva, fecha: hoy, hora: new Date().toLocaleTimeString(), 
            cajero: usuarioActual, sucursal: sucursalActual, total: tot, 
            pagoCon: Number(totalPagado.toFixed(2)), cambio: Number(parseFloat(cambioFinal).toFixed(2)),
            metodo: metodosStr, pagos: pagosCobro, 
            items: carV.map(x=>x.nom||'').join(','), detalles: detallesParaGuardar, anulada: false 
        };

        if (typeof ventas === 'undefined') window.ventas = [];
        ventas.push(nuevaVenta);
        try { localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas.slice(-200))); } catch(e) { localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas.slice(-50))); }

        if (typeof db !== 'undefined') db.collection("ventas").doc(String(idVentaNueva)).set(nuevaVenta).catch(e => console.warn("Venta a mochila."));
        
        carV = []; nombreVentaActual = ""; forceWholesale = false; 
        
        let badgeMayoreo = document.getElementById('v_mayoreo_status');
        if(badgeMayoreo) { badgeMayoreo.innerText = "MAYOREO: DESACTIVADO"; badgeMayoreo.style.background = "#444"; badgeMayoreo.style.color = "#bbb"; }

        window.renderV();
        document.getElementById('modalCobro').style.display = 'none'; 
        document.getElementById('modalTicket').style.display = 'block'; 
        setTimeout(() => { let btnCerrar = document.getElementById('btnCerrarTicket'); if(btnCerrar) btnCerrar.focus(); }, 100);
        
    } catch(err) { alert("⚠️ Error al procesar la venta: " + err.message); }
};

// Granel
function calcGranel(p) { 
    if(p) document.getElementById('g_total_m').value = (document.getElementById('g_cant').value * (tempGranel.pv||1)).toFixed(2); 
    else document.getElementById('g_cant').value = (document.getElementById('g_total_m').value / (tempGranel.pv||1)).toFixed(3); 
}
function confirmarGranel() { 
    let c = parseFloat(document.getElementById('g_cant').value); 
    let dineroExacto = parseFloat(document.getElementById('g_total_m').value); 
    if(c > 0) { 
        carV.push({ cod: tempGranel.cod, nom: tempGranel.nom, can: c, tipo: 'granel', precioManual: (dineroExacto / c), granelDineroExacto: dineroExacto }); 
        window.renderV(); cerrarModales(); 
    } 
}
function abrirGranel(c) { 
    tempGranel = {...inv[c], cod: c}; 
    let precioReal = parseFloat(tempGranel.pv) || 0;
    if (tempGranel.pre_sucursales && tempGranel.pre_sucursales[sucursalActual] !== undefined) precioReal = parseFloat(tempGranel.pre_sucursales[sucursalActual]);
    
    let hoy = getFechaLocal();
    if (typeof promociones !== 'undefined' && Array.isArray(promociones)) {
        let promoActiva = promociones.find(pr => pr && pr.cod === c && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && pr.fecha_ini <= hoy && (!pr.fecha_fin || pr.fecha_fin >= hoy) && (pr.limite === 0 || (pr.usadas||0) < pr.limite));
        if (promoActiva && promoActiva.tipo === 'desc') precioReal = precioReal - (precioReal * (parseFloat(promoActiva.desc) / 100));
    }
    tempGranel.pv = precioReal; 
    document.getElementById('g_nom').innerText = tempGranel.nom; document.getElementById('g_cant').value = "1"; document.getElementById('g_total_m').value = precioReal.toFixed(2); 
    document.getElementById('modalGranel').style.display = 'block'; 
    let cajaKilos = document.getElementById('g_cant'); let cajaDinero = document.getElementById('g_total_m'); let buscadorPrincipal = document.getElementById('v_cod');
    cajaKilos.onkeydown = function(e) { if (e.key === 'ArrowDown') { e.preventDefault(); cajaDinero.focus(); cajaDinero.select(); } else if (e.key === 'Enter') { e.preventDefault(); confirmarGranel(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } else if (e.key === 'Escape') { e.preventDefault(); cerrarModales(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } };
    cajaDinero.onkeydown = function(e) { if (e.key === 'ArrowUp') { e.preventDefault(); cajaKilos.focus(); cajaKilos.select(); } else if (e.key === 'Enter') { e.preventDefault(); confirmarGranel(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } else if (e.key === 'Escape') { e.preventDefault(); cerrarModales(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } };
    setTimeout(() => { cajaKilos.focus(); cajaKilos.select(); }, 100); 
}

// Pausadas
function preguntarPausar() { 
    if(carV.length === 0) return; 
    let n = prompt("Nombre venta pausada:", nombreVentaActual || "Cliente "+(pausadas.length+1)); 
    if(n) { 
        let idPausada = Date.now(); 
        let nuevaPausada = { id: idPausada, nom: n, total: document.getElementById('v_total').innerText, items: [...carV], sucursal: sucursalActual }; 
        pausadas.push(nuevaPausada); localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas)); 
        if (typeof db !== 'undefined') db.collection("pausadas").doc(String(idPausada)).set(nuevaPausada);
        carV = []; forceWholesale = false;
        let badgeMayoreo = document.getElementById('v_mayoreo_status');
        if(badgeMayoreo) { badgeMayoreo.innerText = "MAYOREO: DESACTIVADO"; badgeMayoreo.style.background = "#444"; badgeMayoreo.style.color = "#bbb"; }
        window.renderV(); actualizarContadorPausadas(); 
    } 
    setTimeout(() => { let inputEscaner = document.getElementById('v_cod'); if(inputEscaner) { inputEscaner.value = ''; inputEscaner.focus(); } }, 150);
}
let pausadasFiltradas = []; let focusPausadaIndex = 0; let idxPausadaAEliminar = -1;
function abrirPausadas() { 
    if (!Array.isArray(pausadas)) pausadas = [];
    if (carV && carV.length > 0) {
        if (confirm("⚠️ TIENES UNA VENTA EN CURSO.\n\n¿Deseas poner esta venta en PAUSA primero?")) { preguntarPausar(); if (carV.length > 0) return; } else return;
    }
    pausadasFiltradas = pausadas.map((p, i) => ({...p, idx: i})).filter(p => !p.sucursal || p.sucursal === sucursalActual); 
    if (pausadasFiltradas.length === 0) return alert("📋 No tienes ninguna venta en espera.");
    focusPausadaIndex = 0; renderTablaPausadas(); document.getElementById('modalPausadas').style.display = 'block'; 
}
function renderTablaPausadas() {
    let html = pausadasFiltradas.map((p, index) => {
        let isFocused = index === focusPausadaIndex; let bgRow = isFocused ? 'background:#e0f0ff; border-left: 4px solid var(--info);' : '';
        return `<tr style="cursor:pointer; ${bgRow}" onclick="retomarVenta(${p.idx})">
            <td>${isFocused ? '👉 ' : ''}<b>${p.nom || 'Venta'}</b></td>
            <td>${(p.items || []).length} art.</td><td>$${parseFloat(p.total || 0).toFixed(2)}</td>
            <td><button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px;" onclick="event.stopPropagation(); eliminarPausada(${p.idx})">✕</button></td>
        </tr>`;
    }).join('');
    document.getElementById('p_lista').innerHTML = html;
}
function retomarVenta(i) { 
    let ventaRecuperada = pausadas[i]; carV = ventaRecuperada.items; nombreVentaActual = ventaRecuperada.nom; 
    pausadas.splice(i,1); localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas)); 
    if(ventaRecuperada && ventaRecuperada.id && typeof db !== 'undefined') db.collection("pausadas").doc(String(ventaRecuperada.id)).delete();
    window.renderV(); cerrarModales(); actualizarContadorPausadas(); 
}
function eliminarPausada(idx) {
    idxPausadaAEliminar = idx; document.getElementById('auth_pausada_user').innerText = usuarioActual; document.getElementById('auth_pausada_pin').value = '';
    document.getElementById('modalAuthPausada').style.display = 'block'; setTimeout(() => document.getElementById('auth_pausada_pin').focus(), 100);
}
function confirmarEliminarPausada() {
    let pinIngresado = document.getElementById('auth_pausada_pin').value;
    let pinCajero = usuariosData[usuarioActual] ? usuariosData[usuarioActual].pin : null; let pinAdmin = usuariosData["Admin"] ? usuariosData["Admin"].pin : null;
    if (pinIngresado === pinCajero || pinIngresado === pinAdmin) {
        let ventaAEliminar = pausadas[idxPausadaAEliminar]; 
        pausadas.splice(idxPausadaAEliminar, 1); localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas)); actualizarContadorPausadas();
        if(ventaAEliminar && ventaAEliminar.id && typeof db !== 'undefined') db.collection("pausadas").doc(String(ventaAEliminar.id)).delete();
        pausadasFiltradas = pausadas.map((p, i) => ({...p, idx: i})).filter(p => p.sucursal === sucursalActual);
        focusPausadaIndex = 0; renderTablaPausadas();
        document.getElementById('modalAuthPausada').style.display = 'none'; 
        if(pausadasFiltradas.length === 0) cerrarModales();
    } else { alert("❌ PIN Incorrecto."); document.getElementById('auth_pausada_pin').value = ''; document.getElementById('auth_pausada_pin').focus(); }
}
function actualizarContadorPausadas() {
    let lbl = document.getElementById('count_pausadas'); if (!lbl) return;
    if (Array.isArray(pausadas)) lbl.innerText = pausadas.filter(p => p.sucursal === sucursalActual).length; else { pausadas = []; lbl.innerText = "0"; }
}

// ====================================================================
// === MÓDULO DE COMPRAS (C-TAB) ===
// ====================================================================
function handleCompraScan(e) { 
    if(e.key === 'Enter') { 
        let c = document.getElementById('c_cod').value.trim(); 
        if(!c) return;
        if(inv[c]) { 
            document.getElementById('c_nom').value = inv[c].nom; 
            document.getElementById('c_dep').value = inv[c].dep || "General"; 
            document.getElementById('c_tipo').value = inv[c].tipo || "pieza";
            document.getElementById('c_cos').value = inv[c].cos || 0; 
            document.getElementById('c_iva').value = inv[c].iva || 0; 
            document.getElementById('c_pv').value = inv[c].pv || 0; 
            document.getElementById('c_pm').value = inv[c].pm || 0; 
            document.getElementById('c_md').value = inv[c].md || 10; 
            
            let cReal = (inv[c].cos || 0) * (1 + ((inv[c].iva || 0) / 100));
            document.getElementById('c_real').value = cReal.toFixed(2);
            if (cReal > 0) document.getElementById('c_gan').value = ((((inv[c].pv || 0) / cReal) - 1) * 100).toFixed(2);
            else document.getElementById('c_gan').value = inv[c].gan || 30;

            setTimeout(() => { document.getElementById('c_cant').focus(); document.getElementById('c_cant').select(); }, 50); 
        } else {
            document.getElementById('c_nom').value = ""; document.getElementById('c_dep').value = "General"; document.getElementById('c_tipo').value = "pieza";
            document.getElementById('c_cos').value = ""; document.getElementById('c_iva').value = "0"; document.getElementById('c_gan').value = "30"; 
            document.getElementById('c_pv').value = ""; document.getElementById('c_pm').value = ""; document.getElementById('c_md').value = "10"; 
            document.getElementById('c_real').value = "0.00";
            alert("🛒 Producto no registrado.");
            setTimeout(() => { document.getElementById('c_nom').focus(); }, 50); 
        }
    } 
}

function actualizarCalculosCompra() {
    let costoBase = parseFloat(document.getElementById('c_cos').value) || 0; let impuestoPorcentaje = parseFloat(document.getElementById('c_iva').value) || 0;
    let costoReal = costoBase * (1 + (impuestoPorcentaje / 100));
    document.getElementById('c_real').value = costoReal.toFixed(2);
    calcVentaDesdeGanancia();
}

function calcVentaDesdeGanancia() {
    let costoReal = parseFloat(document.getElementById('c_real').value) || 0; let porcentajeGanancia = parseFloat(document.getElementById('c_gan').value) || 0;
    let precioVenta = costoReal * (1 + (porcentajeGanancia / 100));
    precioVenta = Math.round(precioVenta * 2) / 2;
    document.getElementById('c_pv').value = precioVenta.toFixed(2);
}

function calcGananciaDesdeVenta() {
    let costoReal = parseFloat(document.getElementById('c_real').value) || 0; let precioVenta = parseFloat(document.getElementById('c_pv').value) || 0;
    if (costoReal > 0) document.getElementById('c_gan').value = (((precioVenta / costoReal) - 1) * 100).toFixed(2);
}

function manualAddToList() {
    let c = document.getElementById('c_cod').value.trim(); if(!c) return alert("⚠️ Código.");
    let nomInput = document.getElementById('c_nom').value.trim() || "Producto"; let depInput = document.getElementById('c_dep').value.trim() || "General"; let tipoInput = document.getElementById('c_tipo').value || "pieza";
    let gananciaActual = parseFloat(document.getElementById('c_gan').value) || 0; let cosInput = parseFloat(document.getElementById('c_cos').value) || 0;
    let ivaInput = parseFloat(document.getElementById('c_iva').value) || 0; let pvInput = parseFloat(document.getElementById('c_pv').value) || 0;
    let pmInput = parseFloat(document.getElementById('c_pm').value) || pvInput;  let mdInput = parseFloat(document.getElementById('c_md').value) || 10;

    if(!inv[c]) inv[c] = { nom: nomInput, dep: depInput, tipo: tipoInput, gan: gananciaActual, iva: ivaInput, cos: cosInput, pv: pvInput, pm: pmInput, md: mdInput, stock: {}, sold_without_stock: {} };
    else { inv[c].nom = nomInput; inv[c].dep = depInput; inv[c].tipo = tipoInput; inv[c].gan = gananciaActual; inv[c].iva = ivaInput; inv[c].cos = cosInput; inv[c].pv = pvInput; inv[c].pm = pmInput; inv[c].md = mdInput; }
    
    carC.push({ cod: c, nom: inv[c].nom, can: parseFloat(document.getElementById('c_cant').value) || 1, cos: parseFloat(document.getElementById('c_real').value) || cosInput, cos_base: cosInput, iva: ivaInput, desc: 0 }); 
    focusCompraIndex = carC.length - 1; renderC(); 
    document.getElementById('c_cod').value = ''; document.getElementById('c_cod').focus(); 
}

function renderC() { 
    // 🛑 1. GUARDAMOS LA POSICIÓN DE LA PANTALLA ANTES DE REDIBUJAR
    let panelIzq = document.querySelector('#c-tab .panel-izq');
    let scrollTopAnterior = panelIzq ? panelIzq.scrollTop : 0;

    let t = 0; 
    let htmlItems = carC.map((x, i) => { 
        let prodOriginal = inv[x.cod] || {};
        if (x.pre === undefined) {
            if (prodOriginal.pre_sucursales && prodOriginal.pre_sucursales[sucursalActual] !== undefined) { x.pre = prodOriginal.pre_sucursales[sucursalActual]; x.solo_sucursal = true; } 
            else { x.pre = prodOriginal.pv || 0; x.solo_sucursal = false; }
        }
        let subtotalBruto = x.can * x.cos; let descuentoEfectivo = subtotalBruto * ((x.desc || 0) / 100); let subtotalNeto = subtotalBruto - descuentoEfectivo;
        t += subtotalNeto; 
        let isFocused = (i === focusCompraIndex); let bgRow = isFocused ? 'background:#e0f0ff; border-left: 4px solid var(--s);' : ''; 

        // 🛑 2. LE AGREGAMOS "focusCompraIndex=${i};" A LOS INPUTS PARA QUE EL SISTEMA NO OLVIDE EN QUÉ FILA ESTABAS
        return `<tr style="${bgRow}">
            <td>${isFocused ? '👉 ' : ''}<b>${x.nom}</b><br><small style="color:#888">${x.cod}</small></td>
            <td><input type="number" value="${x.can}" style="width:60px; text-align:center;" onchange="carC[${i}].can=parseFloat(this.value)||1; focusCompraIndex=${i}; renderC()" ${isFocused ? 'autofocus' : ''}></td>
            <td>$<input type="number" value="${x.cos.toFixed(2)}" style="width:80px; text-align:right;" onchange="carC[${i}].cos=parseFloat(this.value)||0; focusCompraIndex=${i}; renderC()"></td>
            <td><input type="number" value="${x.desc || 0}" style="width:50px; text-align:center; color:var(--danger); font-weight:bold;" onchange="carC[${i}].desc=parseFloat(this.value)||0; focusCompraIndex=${i}; renderC()"> %</td>
            <td style="min-width: 110px; background: #fdfdfd; border-radius: 5px;">
                $<input type="number" value="${parseFloat(x.pre).toFixed(2)}" style="width:80px; text-align:right; font-weight:bold; color:var(--p); border: 1px solid #ccc; border-radius:3px;" onchange="carC[${i}].pre=parseFloat(this.value)||0; focusCompraIndex=${i}; renderC()"><br>
                <label style="font-size:11px; color:#004085; display:flex; align-items:center; gap:3px; margin-top:5px; cursor:pointer; font-weight:bold;"><input type="checkbox" ${x.solo_sucursal ? 'checked' : ''} onchange="carC[${i}].solo_sucursal=this.checked; focusCompraIndex=${i}; renderC()">Solo esta suc.</label>
            </td>
            <td style="font-weight:bold; color:#333;">$${subtotalNeto.toFixed(2)} ${x.desc > 0 ? `<br><small style="color:var(--danger)">- $${descuentoEfectivo.toFixed(2)}</small>` : ''}</td>
            <td>
                <button title="Comprar por Caja" style="background:#17a2b8; color:white; border:none; padding:5px 8px; border-radius:5px; cursor:pointer; font-weight:bold; font-size:14px;" onclick="abrirCalculadoraCaja(${i})">📦</button>
                <button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="carC.splice(${i},1); focusCompraIndex = Math.min(focusCompraIndex, carC.length - 1); renderC()">✕</button>
            </td>
        </tr>`;
    }).join('');

    let thead = `<thead style="background:#f8f9fa;"><tr><th style="text-align:left;">Producto</th><th style="text-align:left;">Cant.</th><th style="text-align:left;">Costo Unit.</th><th style="text-align:left;">Desc. %</th><th style="text-align:left; color:var(--p);">Precio Vta.</th><th style="text-align:left;">Subtotal</th><th>Acciones</th></tr></thead>`;
    document.getElementById('c_lista_tab').innerHTML = carC.length > 0 ? thead + htmlItems : ''; 
    document.getElementById('c_total_inv').innerText = t.toFixed(2); 

    // 🛑 3. RESTAURAMOS EL SCROLL AL INSTANTE (Así la pantalla no brinca)
    if (panelIzq) panelIzq.scrollTop = scrollTopAnterior;

    // 🛑 4. SILENCIAMOS EL SALTO HACIA LA BARRA DE BÚSQUEDA USANDO "preventScroll"
    setTimeout(() => { 
        let inputCod = document.getElementById('c_cod'); 
        if (inputCod && document.activeElement.tagName !== 'INPUT') {
            inputCod.focus({ preventScroll: true }); 
        }
    }, 50);
}
let isGuardandoCompra = false; // 🛡️ CANDADO ANTI-DOBLE CLIC

async function finalizarCompra() { 
    if (isGuardandoCompra) return; 
    if (carC.length === 0) return; 

    isGuardandoCompra = true; 

    try {
        let totalCompra = carC.reduce((acc, x) => acc + ((x.can * x.cos) * (1 - (x.desc||0)/100)), 0); 
        let met = document.getElementById('c_metodo_pago').value; 
        let prov = document.getElementById('c_proveedor').value.trim();
        
        // 🌟 1. LEEMOS SI LA CASILLA ESTÁ MARCADA
        let esInventarioInicial = document.getElementById('c_inventario_inicial') ? document.getElementById('c_inventario_inicial').checked : false;

        // 🚀 EL ARREGLO: Limpiamos la palabra de acentos y mayúsculas para que no haya errores
        let metSeguro = (met || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // 🌟 2. SOLO COBRAMOS DEUDAS SI NO ES INVENTARIO INICIAL
        if(!esInventarioInicial && (metSeguro.includes('pagar') || metSeguro.includes('credito'))) {
            if(!prov) {
                isGuardandoCompra = false; 
                return alert("❌ Debes ingresar el nombre del Proveedor para guardar la deuda.");
            }
            
            // Si el proveedor no existe, lo creamos
            if(!proveedores[prov]) proveedores[prov] = { saldo: 0, historial: [], sucursal: sucursalActual };
            
            // Aseguramos que se sume como número
            proveedores[prov].saldo = (parseFloat(proveedores[prov].saldo) || 0) + totalCompra;
            
            if (!proveedores[prov].historial) proveedores[prov].historial = [];
            proveedores[prov].historial.push({ fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), tipo: 'Compra', monto: totalCompra, detalle: `Compra de ${carC.length} producto(s)` });
            
            // Subimos a la nube
            if (typeof db !== 'undefined') db.collection("proveedores").doc(prov).set(proveedores[prov]).catch(e => console.log("Error proveedor:", e));
            
            localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores));
            if(typeof renderProveedores === 'function') renderProveedores();
        }
        
        // 🌟 3. SOLO RESTAMOS EFECTIVO SI NO ES INVENTARIO INICIAL
        if(!esInventarioInicial && met === 'Efectivo') {
            let efectivoActual = calcularEfectivoEnCaja();
            if(efectivoActual < totalCompra) {
                isGuardandoCompra = false; 
                if(confirm(`⚠️ No hay suficiente efectivo en caja.\nEfectivo: $${efectivoActual.toFixed(2)}\nTotal: $${totalCompra.toFixed(2)}\n\n¿Registrar un Ingreso extra en la caja ahora?`)) {
                    abrirModalMovimiento(); 
                    document.getElementById('mov_tipo').value = 'Ingreso'; 
                    document.getElementById('mov_monto').value = (totalCompra - efectivoActual).toFixed(2); 
                    document.getElementById('mov_motivo').value = 'Fondo para compra';
                    alert("👉 AVISO: Una vez que guardes el ingreso de dinero, DEBES volver a presionar 'FINALIZAR COMPRA' para que tu mercancía se suba al inventario.");
                }
                return; 
            }
            let idMov = Date.now();
            let nuevoMov = { id: idMov, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalActual, tipo: 'Retiro', monto: totalCompra, motivo: 'Compra ' + (prov ? ` (${prov})` : '') };
            movimientos.push(nuevoMov); localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos));
            if (typeof db !== 'undefined') db.collection("movimientos").doc(String(idMov)).set(nuevoMov).catch(e => console.log(e));
        }
            
        for (let x of carC) { 
            try {
                let prod = inv[x.cod];
                if (prod && prod.tipo === 'kit' && prod.comp && prod.comp.length > 0) {
                    for (let c of prod.comp) {
                        let codComp = c.cod; let maestroComp = obtenerProductoMaestro(codComp);
                        let cantTotalAumentar = (c.can || 1) * x.can; 
                        if(maestroComp) {
                            if(!maestroComp.stock) maestroComp.stock = {};
                            maestroComp.stock[sucursalActual] = (maestroComp.stock[sucursalActual] || 0) + cantTotalAumentar;
                            let docIdAActualizar = maestroComp === inv[codComp] ? codComp : inv[codComp].grupo;
                            if(typeof db !== 'undefined') await db.collection("inventario").doc(docIdAActualizar).set(maestroComp); 
                        }
                    }
                } else if (prod) {
                    let maestro = obtenerProductoMaestro(x.cod);
                    if(!maestro.stock) maestro.stock = {}; 
                    
                    let stockAnterior = maestro.stock[sucursalActual] || 0;
                    if (stockAnterior < 0) stockAnterior = 0;

                    maestro.stock[sucursalActual] = stockAnterior + x.can; 
                    
                    let conceptoKardex = esInventarioInicial ? "CARGA INICIAL" : "COMPRA";
                    registrarEnKardex(x.cod, prod.nom, conceptoKardex, x.can, x.pre || prod.pv, x.cos || prod.cos);

                    let costoCompraUnitarioBase = 0;
                    if (x.cos_base !== undefined) { 
                        costoCompraUnitarioBase = parseFloat(x.cos_base); 
                        if (x.iva !== undefined) prod.iva = x.iva; 
                    } else if (x.cos !== undefined) { 
                        costoCompraUnitarioBase = parseFloat(x.cos / (1 + ((prod.iva||0) / 100))); 
                    }

                    if (costoCompraUnitarioBase > 0) {
                        let costoHistorico = prod.cos_promedio !== undefined ? parseFloat(prod.cos_promedio) : (parseFloat(prod.cos) || 0);
                        let valorViejo = stockAnterior * costoHistorico;
                        let valorNuevo = x.can * costoCompraUnitarioBase;
                        let piezasTotales = stockAnterior + x.can;

                        let costoPromedio = (valorViejo + valorNuevo) / piezasTotales;
                        
                        prod.cos_promedio = parseFloat(costoPromedio.toFixed(2));
                        prod.cos = parseFloat(costoCompraUnitarioBase.toFixed(2));
                    }

                    if (x.pre !== undefined) {
                        if (x.solo_sucursal) {
                            if (!prod.pre_sucursales) prod.pre_sucursales = {}; 
                            prod.pre_sucursales[sucursalActual] = parseFloat(x.pre);
                        } else {
                            prod.pv = parseFloat(x.pre); 
                            if (prod.pre_sucursales && prod.pre_sucursales[sucursalActual] !== undefined) delete prod.pre_sucursales[sucursalActual];
                        }
                        prod.updatedAt = Date.now(); 
                    }
                    
                    if(typeof db !== 'undefined') {
                        await db.collection("inventario").doc(x.cod).set(prod);
                        if (maestro !== prod) {
                            await db.collection("inventario").doc(prod.grupo).set(maestro);
                        }
                    }
                }
            } catch (errorItem) {
                console.error("Error aislando producto: ", x.cod, errorItem);
            }
        }
        
        localStorage.setItem("pos_precision_v6", JSON.stringify(inv));
        let idCompra = Date.now();
        
        let metodoFinal = esInventarioInicial ? "Inventario Inicial" : met;
        
        let objetoCompra = { id: idCompra, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalActual, proveedor: prov || "General", metodo: metodoFinal, total: totalCompra, items: carC };
        compras.push(objetoCompra); localStorage.setItem("pos_compras_local", JSON.stringify(compras));
        if (typeof db !== 'undefined') await db.collection("compras").doc(String(idCompra)).set(objetoCompra).catch(e => alert("Error Nube: " + e));

        carC = []; renderC(); renderI(); renderCorte(); 
        
        if(esInventarioInicial) {
            alert("✅ Inventario cargado con éxito (No se restó dinero de caja ni se creó deuda)."); 
            document.getElementById('c_inventario_inicial').checked = false; 
        } else {
            alert("✅ Compra guardada con éxito."); 
        }

    } catch (errorGeneral) {
        console.error("Error procesando la compra:", errorGeneral);
        alert("Hubo un problema al guardar la compra, revisa tu conexión.");
    } finally {
        isGuardandoCompra = false; 
    }
}

function pausarCompraActual() {
    if(carC.length === 0) return alert("❌ Lista vacía.");
    let prov = document.getElementById('c_proveedor') ? document.getElementById('c_proveedor').value : '';
    let idCompraPausada = Date.now(); 
    let nuevaPausada = { id: idCompraPausada, hora: new Date().toLocaleTimeString(), proveedor: prov, carrito: [...carC], sucursal: sucursalActual };
    comprasPausadas.push(nuevaPausada); localStorage.setItem('pos_compras_pausadas', JSON.stringify(comprasPausadas));
    if (typeof db !== 'undefined') db.collection("compras_pausadas").doc(String(idCompraPausada)).set(nuevaPausada);
    carC = []; renderC(); if(document.getElementById('c_proveedor')) document.getElementById('c_proveedor').value = ''; actualizarBadgeComprasPausadas();
}

function abrirComprasPausadas() {
    let pausadasLocal = comprasPausadas.filter(cp => !cp.sucursal || cp.sucursal === sucursalActual);
    if (pausadasLocal.length === 0) return alert("No tienes compras en pausa.");
    let opciones = "📋 COMPRAS EN PAUSA:\n\n";
    pausadasLocal.forEach((cp, index) => { let total = cp.carrito.reduce((acc, x) => acc + ((x.can * x.cos) * (1 - (x.desc||0)/100)), 0); opciones += `[ ${index + 1} ] 🕒 ${cp.hora} - Prov: ${cp.proveedor || 'Sin nombre'} - $${total.toFixed(2)} (${cp.carrito.length} items)\n`; });
    let seleccion = prompt(opciones + "\n👉 Escribe el NÚMERO a reanudar:"); if (!seleccion) return;
    let idx = parseInt(seleccion) - 1; if (isNaN(idx) || idx < 0 || idx >= pausadasLocal.length) return alert("❌ Inválido.");
    if (carC.length > 0 && !confirm("⚠️ Tienes productos en lista actual. Se mezclarán. ¿Continuar?")) return;
    
    let compraRestaurada = pausadasLocal[idx]; carC = carC.concat(compraRestaurada.carrito);
    if(document.getElementById('c_proveedor') && compraRestaurada.proveedor) document.getElementById('c_proveedor').value = compraRestaurada.proveedor;
    if (compraRestaurada.id && typeof db !== 'undefined') db.collection("compras_pausadas").doc(String(compraRestaurada.id)).delete();
    let indexOriginal = comprasPausadas.findIndex(c => c.id === compraRestaurada.id);
    if(indexOriginal > -1) { comprasPausadas.splice(indexOriginal, 1); localStorage.setItem('pos_compras_pausadas', JSON.stringify(comprasPausadas)); }
    actualizarBadgeComprasPausadas(); renderC();
}

// ====================================================================
// === CALCULADORA DE COMPRA POR CAJA / LOTE 📦 ===
// ====================================================================

// ====================================================================
// === CALCULADORA DE COMPRA POR CAJA / LOTE 📦 ===
// ====================================================================

// ====================================================================
// === CALCULADORA DE COMPRA POR CAJA / LOTE 📦 ===
// ====================================================================

window.abrirCalculadoraCajaGlobal = function() {
    try {
        document.getElementById('caja_codigo').value = ''; 
        document.getElementById('caja_nombre_prod').innerText = '';
        document.getElementById('caja_cantidad').value = '1'; 
        document.getElementById('caja_costo_total').value = '';
        document.getElementById('caja_piezas').value = ''; 
        document.getElementById('caja_impuesto').value = '0';
        
        let descInput = document.getElementById('caja_desc');
        if(descInput) descInput.value = '0';
        
        document.getElementById('caja_pv').value = ''; 
        document.getElementById('caja_gan').value = '30';
        document.getElementById('lbl_caja_total_piezas').innerText = '0'; 
        document.getElementById('lbl_caja_costo_base').innerText = '$0.00'; 
        document.getElementById('lbl_caja_costo_real').innerText = '$0.00';
        
        document.getElementById('modalCaja').style.display = 'block'; 
        setTimeout(() => document.getElementById('caja_codigo').focus(), 100); 
    } catch(e) {
        console.error("Error al abrir calculadora vacía:", e);
    }
};

window.buscarProdCaja = function() {
    let cod = document.getElementById('caja_codigo').value.trim();
    if(inv[cod]) { 
        document.getElementById('caja_nombre_prod').innerText = "✅ " + inv[cod].nom; 
        document.getElementById('caja_impuesto').value = inv[cod].iva || 0;
        document.getElementById('caja_pv').value = parseFloat(inv[cod].pv || 0).toFixed(2);
        document.getElementById('caja_gan').value = inv[cod].gan || 30;
        
        document.getElementById('caja_cantidad').focus(); 
        document.getElementById('caja_cantidad').select(); 
    } 
    else document.getElementById('caja_nombre_prod').innerText = "❌ Producto no encontrado";
};

window.seleccionarProductoCaja = function(codigo, nombre, piezas, impuesto) {
    let p = inv[codigo] || {}; 
    
    document.getElementById('caja_codigo').value = codigo;
    document.getElementById('caja_nombre_prod').innerText = "✅ " + nombre;
    document.getElementById('caja_piezas').value = piezas;
    document.getElementById('caja_impuesto').value = impuesto;
    document.getElementById('caja_sugerencias').style.display = 'none';
    
    document.getElementById('caja_pv').value = parseFloat(p.pv || 0).toFixed(2);
    document.getElementById('caja_gan').value = p.gan || 30;
    
    document.getElementById('caja_cantidad').focus();
    document.getElementById('caja_cantidad').select();
    
    window.calcularCaja();
};

window.recalcCajaVentaDesdeGanancia = function() {
    let costoRealUnidad = parseFloat(document.getElementById('lbl_caja_costo_real').innerText.replace('$','')) || 0;
    let gan = parseFloat(document.getElementById('caja_gan').value) || 0;
    let pv = costoRealUnidad * (1 + (gan / 100));
    document.getElementById('caja_pv').value = (Math.round(pv * 2) / 2).toFixed(2); 
};

window.recalcCajaGananciaDesdeVenta = function() {
    let costoRealUnidad = parseFloat(document.getElementById('lbl_caja_costo_real').innerText.replace('$','')) || 0;
    let pv = parseFloat(document.getElementById('caja_pv').value) || 0;
    if(costoRealUnidad > 0) {
        document.getElementById('caja_gan').value = (((pv / costoRealUnidad) - 1) * 100).toFixed(2);
    }
};

window.calcularCaja = function() {
    let cantCajas = parseFloat(document.getElementById('caja_cantidad').value) || 1; 
    let costoUnaCaja = parseFloat(document.getElementById('caja_costo_total').value) || 0;
    let piezasPorCaja = parseFloat(document.getElementById('caja_piezas').value) || 1; 
    let impuesto = parseFloat(document.getElementById('caja_impuesto').value) || 0;
    
    let descInput = document.getElementById('caja_desc');
    let descuento = descInput ? (parseFloat(descInput.value) || 0) : 0; 
    
    if (piezasPorCaja <= 0) piezasPorCaja = 1;
    let piezasTotales = cantCajas * piezasPorCaja; 
    
    let costoCajaConDesc = costoUnaCaja * (1 - (descuento / 100));
    let costoBasePuro = costoUnaCaja / piezasPorCaja; 
    let costoRealUnidad = (costoCajaConDesc / piezasPorCaja) * (1 + (impuesto / 100)); 
    
    document.getElementById('lbl_caja_total_piezas').innerText = piezasTotales; 
    document.getElementById('lbl_caja_costo_base').innerText = '$' + costoBasePuro.toFixed(2); 
    document.getElementById('lbl_caja_costo_real').innerText = '$' + costoRealUnidad.toFixed(2);

    window.recalcCajaGananciaDesdeVenta();
};

window.agregarCajaACarrito = function() {
    let cod = document.getElementById('caja_codigo').value.trim(); 
    if(!inv[cod]) return alert("⚠️ Código no válido.");
    
    let cantCajas = parseFloat(document.getElementById('caja_cantidad').value) || 1; 
    let costoUnaCaja = parseFloat(document.getElementById('caja_costo_total').value) || 0;
    let piezasPorCaja = parseFloat(document.getElementById('caja_piezas').value) || 1; 
    let impuesto = parseFloat(document.getElementById('caja_impuesto').value) || 0;
    
    let descInput = document.getElementById('caja_desc');
    let descuento = descInput ? (parseFloat(descInput.value) || 0) : 0; 
    
    let precioVenta = parseFloat(document.getElementById('caja_pv').value) || 0;
    let gananciaNueva = parseFloat(document.getElementById('caja_gan').value) || 0;

    let piezasTotales = cantCajas * piezasPorCaja; 
    let costoBaseUnidadPura = (costoUnaCaja / piezasPorCaja); 
    let costoRealUnidadPura = costoBaseUnidadPura * (1 + (impuesto / 100));
    
    let itemIndex = carC.findIndex(x => x.cod === cod);
    
    if (itemIndex > -1) { 
        carC[itemIndex].can += piezasTotales; 
        carC[itemIndex].cos = parseFloat(costoRealUnidadPura.toFixed(2)); 
        carC[itemIndex].cos_base = parseFloat(costoBaseUnidadPura.toFixed(2)); 
        carC[itemIndex].iva = impuesto; 
        carC[itemIndex].desc = descuento; 
        carC[itemIndex].pre = precioVenta; 
    } else { 
        carC.push({ 
            cod: cod, nom: inv[cod].nom, can: piezasTotales, 
            cos: parseFloat(costoRealUnidadPura.toFixed(2)), cos_base: parseFloat(costoBaseUnidadPura.toFixed(2)), 
            iva: impuesto, desc: descuento, pre: precioVenta, solo_sucursal: false 
        }); 
    }
    
    inv[cod].gan = gananciaNueva;

    renderC(); 
    window.cerrarCaja();
};

window.cerrarCaja = function() { 
    document.getElementById('modalCaja').style.display = 'none'; 
    let i = document.getElementById('c_cod'); 
    if(i) { i.value=''; i.focus(); } 
};

window.abrirCalculadoraCaja = function(index) { 
    try {
        let item = carC[index]; 
        if (!item) return alert("❌ Error: No se encontró el producto en esa fila.");

        window.abrirCalculadoraCajaGlobal(); 
        
        let inputCod = document.getElementById('caja_codigo');
        if (inputCod) {
            inputCod.value = item.cod; 
            
            let p = inv[item.cod] || {};
            let nombreProd = document.getElementById('caja_nombre_prod');
            if (nombreProd) nombreProd.innerText = "✅ " + (item.nom || p.nom || "Producto");
            
            let imp = document.getElementById('caja_impuesto');
            if (imp) imp.value = item.iva !== undefined ? item.iva : (p.iva || 0);
            
            let pv = document.getElementById('caja_pv');
            if (pv) pv.value = item.pre !== undefined ? parseFloat(item.pre).toFixed(2) : parseFloat(p.pv || 0).toFixed(2);
            
            let gan = document.getElementById('caja_gan');
            if (gan) gan.value = p.gan || 30;
            
            let desc = document.getElementById('caja_desc');
            if (desc) desc.value = item.desc || 0;
            
            let inputCant = document.getElementById('caja_cantidad');
            if (inputCant) {
                inputCant.focus();
                inputCant.select();
            }
            
            window.calcularCaja();
        }
    } catch (err) {
        console.error("Error al abrir calculadora desde fila:", err);
    }
};
// ====================================================================
// === KITS Y PROMOCIONES ===
// ====================================================================
function addCompToKit() { let c = document.getElementById('k_comp_cod').value; let q = parseFloat(document.getElementById('k_comp_can').value); if(!inv[c] || inv[c].tipo === 'kit') return alert("Inválido."); carK.push({cod: c, nom: inv[c].nom, can: q}); renderK(); document.getElementById('k_comp_cod').value = ''; }
function renderK() { document.getElementById('k_comp_lista').innerHTML = carK.map((x,i) => `<tr><td>${x.nom}</td><td>${x.can}</td><td><button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px;" onclick="carK.splice(${i},1);renderK()">✕</button></td></tr>`).join(''); }
function guardarKit() { 
    let c = document.getElementById('k_cod').value.trim(); let n = document.getElementById('k_nom').value.trim(); let pv = parseFloat(document.getElementById('k_pv').value) || 0; let tipoCreacion = document.getElementById('k_tipo_creacion') ? document.getElementById('k_tipo_creacion').value : 'kit';
    if(!c || !n || carK.length === 0) return alert("Faltan datos."); 
    inv[c] = { nom: n, tipo: tipoCreacion, dep: tipoCreacion === 'kit' ? 'Kits' : 'Grupos', pv: pv, pm: pv, cos: 0, comp: [...carK], stock: {}, sold_without_stock: {} }; 
    if (tipoCreacion === 'grupo') { carK.forEach(hijo => { if (inv[hijo.cod]) { inv[hijo.cod].grupo = c; if(typeof db !== 'undefined') db.collection("inventario").doc(hijo.cod).set(inv[hijo.cod]); } }); }
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); if(typeof db !== 'undefined') db.collection("inventario").doc(c).set(inv[c]);
    alert(`✅ Guardado.`); carK = []; renderK(); renderI(); document.getElementById('k_cod').value=''; document.getElementById('k_nom').value=''; document.getElementById('k_pv').value=''; 
}

function verificarProdPromo() { let cod = document.getElementById('pr_cod').value; document.getElementById('pr_nom').value = inv[cod] ? inv[cod].nom : "No Encontrado"; }
function togglePromoCampos() { let t = document.getElementById('pr_tipo').value; if(t === 'nxm') { document.getElementById('div_pr_n').style.display = 'block'; document.getElementById('div_pr_m').style.display = 'block'; document.getElementById('div_pr_desc').style.display = 'none'; } else { document.getElementById('div_pr_n').style.display = 'none'; document.getElementById('div_pr_m').style.display = 'none'; document.getElementById('div_pr_desc').style.display = 'block'; } }
let promoEditandoId = null; // 🛡️ Memoria para saber si estamos editando

function guardarPromo() { 
    let cod = document.getElementById('pr_cod').value; if(!inv[cod]) return alert("Inválido"); 
    
    // Si estamos editando usamos el ID existente, si no, creamos uno nuevo
    let idPromo = promoEditandoId ? promoEditandoId : Date.now(); 
    
    let promo = { 
        id: idPromo, cod: cod, tipo: document.getElementById('pr_tipo').value, 
        sucursal: document.getElementById('pr_sucursal').value, 
        fecha_ini: document.getElementById('pr_ini').value, fecha_fin: document.getElementById('pr_fin').value, 
        limite: parseInt(document.getElementById('pr_limite').value) || 0, 
        usadas: promoEditandoId ? (promociones.find(p => p.id === idPromo)?.usadas || 0) : 0 // Protegemos las que ya se usaron
    }; 
    
    if(promo.tipo === 'nxm') { promo.n = parseInt(document.getElementById('pr_n').value); promo.m = parseInt(document.getElementById('pr_m').value); if(promo.n <= promo.m) return alert("N > M"); } 
    else { promo.desc = parseFloat(document.getElementById('pr_desc').value); if(promo.desc <= 0 || promo.desc > 100) return alert("Inválido"); } 
    
    if (promoEditandoId) {
        let idx = promociones.findIndex(p => p.id === promoEditandoId);
        if(idx > -1) promociones[idx] = promo;
    } else {
        promociones.push(promo); 
    }
    
    localStorage.setItem("pos_promociones_v8", JSON.stringify(promociones)); 
    if (typeof db !== 'undefined') db.collection("promociones").doc(String(idPromo)).set(promo).catch(e => console.log(e));
    
    document.getElementById('pr_cod').value = ''; document.getElementById('pr_nom').value = ''; 
    let msg = promoEditandoId ? "✅ Promoción actualizada." : "✅ Promoción creada.";
    promoEditandoId = null; // Soltamos la memoria
    renderPromos(); 
    alert(msg); 
}

function editarPromo(index) {
    let p = promociones[index];
    if(!p) return;
    promoEditandoId = p.id;
    document.getElementById('pr_cod').value = p.cod;
    document.getElementById('pr_nom').value = inv[p.cod] ? inv[p.cod].nom : "Desconocido";
    document.getElementById('pr_sucursal').value = p.sucursal || 'Todas';
    document.getElementById('pr_tipo').value = p.tipo;
    document.getElementById('pr_ini').value = p.fecha_ini || '';
    document.getElementById('pr_fin').value = p.fecha_fin || '';
    document.getElementById('pr_limite').value = p.limite || 0;
    
    if (p.tipo === 'nxm') {
        document.getElementById('pr_n').value = p.n || 1;
        document.getElementById('pr_m').value = p.m || 1;
    } else {
        document.getElementById('pr_desc').value = p.desc || 0;
    }
    togglePromoCampos();
    document.getElementById('pr_cod').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Sube la pantalla para que veas el formulario
}

function renderPromos() { 
    let hoy = getFechaLocal(); 
    let txtBusqueda = document.getElementById('buscar_promo') ? document.getElementById('buscar_promo').value.toLowerCase().trim() : '';

    let promosFiltradas = promociones.map((p, index) => ({ ...p, originalIndex: index }))
        .filter(p => p.sucursal === 'Todas' || p.sucursal === sucursalActual || (!p.sucursal && sucursalActual === 'Matriz'))
        .filter(p => {
            if (txtBusqueda === '') return true;
            let nombreProd = inv[p.cod] ? inv[p.cod].nom.toLowerCase() : '';
            return p.cod.toLowerCase().includes(txtBusqueda) || nombreProd.includes(txtBusqueda);
        });

    let html = promosFiltradas.map(p => { 
        let nombre = inv[p.cod] ? inv[p.cod].nom : 'Desconocido'; 
        let tipo = p.tipo === 'nxm' ? `Lleva ${p.n} Paga ${p.m}` : `-${p.desc}% OFF`; 
        let limiteStr = p.limite === 0 ? `Ilimitado (${p.usadas})` : `${p.usadas} / ${p.limite}`; 
        let estado = "Activa"; let colorEst = "var(--s)"; 
        
        if(p.fecha_ini && hoy < p.fecha_ini) { estado = "Programada"; colorEst = "var(--p)"; } 
        else if(p.fecha_fin && hoy > p.fecha_fin) { estado = "Expirada"; colorEst = "var(--danger)"; } 
        else if(p.limite > 0 && p.usadas >= p.limite) { estado = "Agotada"; colorEst = "var(--danger)"; } 
        
        return `<tr>
            <td><b>${nombre}</b><br><small>${p.cod}</small></td>
            <td><b>${p.sucursal || 'Todas'}</b></td>
            <td><span class="badge-kit" style="background:var(--promo)">${tipo}</span></td>
            <td>${p.fecha_ini||'---'} al ${p.fecha_fin||'---'}</td>
            <td>${limiteStr}</td>
            <td><b style="color:${colorEst}">${estado}</b></td>
            <td>
                <button style="background:var(--p); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; margin-right:5px;" onclick="editarPromo(${p.originalIndex})" title="Editar">✏️</button>
                <button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="eliminarPromo(${p.originalIndex})" title="Eliminar">✕</button>
            </td>
        </tr>`; 
    }).join('');
    
    if(document.getElementById('pr_lista')) document.getElementById('pr_lista').innerHTML = html || `<tr><td colspan="7" style="text-align:center;">No se encontraron promociones.</td></tr>`; 
}
function eliminarPromo(index) { 
    if(confirm("¿Seguro que deseas eliminar esta promoción de forma permanente?")) { 
        let promoAEliminar = promociones[index];
        
        // 🔥 MAGIA POCKETBASE: Localizar el ID nativo real en la nube antes de borrar
        if (typeof pb !== 'undefined' && promoAEliminar.id) {
            pb.collection("promociones").getFirstListItem(`doc_id="${promoAEliminar.id}"`)
            .then(record => {
                // Una vez encontrado el registro con su ID real de PocketBase, lo destruimos
                return pb.collection("promociones").delete(record.id);
            })
            .then(() => console.log("☁️ Promoción eliminada con éxito de la nube."))
            .catch(err => console.error("Error al borrar promoción en la nube:", err));
        }
        
        // Borrado de la memoria de la computadora local
        promociones.splice(index, 1); 
        localStorage.setItem("pos_promociones_v8", JSON.stringify(promociones)); 
        renderPromos(); 
    } 
}

// ====================================================================
// === CLIENTES Y PROVEEDORES ===
// ====================================================================
function renderClientes() { 
    let html = ''; let selectHtml = '<option value="">-- Seleccionar --</option>'; let count = 0;
    Object.keys(clientes).forEach(tel => { 
        let c = clientes[tel]; 
        if (c.sucursal === sucursalActual || (!c.sucursal && sucursalActual === 'Matriz')) {
            count++;
            html += `<tr><td>${tel}</td><td><b>${c.nom}</b></td><td>$${(c.limite||0).toFixed(2)}</td><td style="color:${c.saldo > 0 ? 'var(--danger)' : '#000'}; font-weight:bold;">$${(c.saldo||0).toFixed(2)}</td><td><button style="background:var(--s); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAbono('${tel}')">💲 Abonar</button> <button style="background:var(--p); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="editarCliente('${tel}')">✏️</button> <button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAuthCli('${tel}')">🗑️</button></td></tr>`; 
            selectHtml += `<option value="${tel}">${c.nom}</option>`; 
        }
    }); 
    if(document.getElementById('cli_lista')) document.getElementById('cli_lista').innerHTML = count > 0 ? html : `<tr><td colspan="5" style="text-align:center;">Vacio</td></tr>`; 
    let selectAbono = document.getElementById('m_cliente_select'); if(selectAbono) selectAbono.innerHTML = selectHtml; 
}
function filtrarClientes() { let txt = document.getElementById('buscar_cli').value.toLowerCase(); let trs = document.getElementById('cli_lista').getElementsByTagName('tr'); for(let tr of trs) { if(tr.cells.length > 1) { tr.style.display = (tr.cells[0].innerText.toLowerCase().includes(txt) || tr.cells[1].innerText.toLowerCase().includes(txt)) ? '' : 'none'; } } }
function abrirModalCliente() { document.getElementById('cli_tel').value = ''; document.getElementById('cli_tel').readOnly = false; document.getElementById('cli_nom').value = ''; document.getElementById('cli_limite').value = '1000'; document.getElementById('modalCliente').style.display = 'block'; setTimeout(()=>document.getElementById('cli_tel').focus(), 100); }
function editarCliente(tel) { document.getElementById('cli_tel').value = tel; document.getElementById('cli_tel').readOnly = true; document.getElementById('cli_nom').value = clientes[tel].nom; document.getElementById('cli_limite').value = clientes[tel].limite; document.getElementById('modalCliente').style.display = 'block'; }
function guardarCliente() { 
    let tel = document.getElementById('cli_tel').value.trim(); let nom = document.getElementById('cli_nom').value.trim(); let lim = parseFloat(document.getElementById('cli_limite').value) || 0; 
    if(!tel || !nom) return alert("Faltan datos."); 
    if(!clientes[tel]) clientes[tel] = { nom: nom, limite: lim, saldo: 0, sucursal: sucursalActual }; else { clientes[tel].nom = nom; clientes[tel].limite = lim; if(!clientes[tel].sucursal) clientes[tel].sucursal = sucursalActual; } 
    if (typeof db !== 'undefined') db.collection("clientes").doc(tel).set(clientes[tel]).then(() => { alert("✅ Guardado."); cerrarModales(); }).catch(e=>console.log(e)); 
}
function abrirModalAbono(tel) { telAbonoActual = tel; document.getElementById('abono_nom').innerText = clientes[tel].nom; document.getElementById('abono_deuda').innerText = (clientes[tel].saldo||0).toFixed(2); document.getElementById('abono_monto').value = ''; document.getElementById('modalAbono').style.display = 'block'; setTimeout(()=>document.getElementById('abono_monto').focus(), 100); }
function confirmarAbono() { 
    let monto = parseFloat(document.getElementById('abono_monto').value) || 0; if(monto <= 0) return; 
    let c = clientes[telAbonoActual]; if(!c) return; 
    if(monto > (c.saldo||0)) if(!confirm("Abono > deuda. ¿Saldo a favor?")) return; 
    let metodoPago = document.getElementById('abono_metodo_pago').value; c.saldo = (c.saldo||0) - monto; 
    db.collection("clientes").doc(telAbonoActual).set(c); 
    let idAbono = Date.now(); db.collection("ventas").doc(String(idAbono)).set({ id: idAbono, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalActual, total: monto, metodo: 'Abono ' + metodoPago, items: `Abono de ${c.nom}`, anulada: false }); 
    alert("✅ Abono registrado."); cerrarModales(); 
}
function abrirModalAuthCli(tel) { cliAEliminar = tel; document.getElementById('auth_cli_nom').innerText = clientes[tel].nom; document.getElementById('auth_admin_pin_cli').value = ''; document.getElementById('modalAuthAdminCli').style.display = 'block'; setTimeout(() => document.getElementById('auth_admin_pin_cli').focus(), 100); }
function confirmarEliminacionCli() {
    let pin = document.getElementById('auth_admin_pin_cli').value;
    if (usuariosData["Admin"] && usuariosData["Admin"].pin === pin) {
        if(confirm(`¿Eliminar a ${clientes[cliAEliminar].nom}?`)) {
            db.collection("clientes").doc(cliAEliminar).delete().then(() => { alert("✅ Eliminado"); cerrarModales(); }).catch(e=>console.log(e));
        }
    } else alert("❌ PIN Incorrecto.");
}

function renderProveedores() { 
    let html = ''; let count = 0;
    Object.keys(proveedores).forEach(nombre => { 
        let p = proveedores[nombre]; 
        if (p.sucursal === sucursalActual || (!p.sucursal && sucursalActual === 'Matriz')) {
            count++; let estadoBadge = p.saldo <= 0 ? '<span style="background:var(--s); color:white; padding:3px 8px; border-radius:12px; font-size:11px; margin-left:10px;">✅ PAGADA</span>' : '';
            html += `<tr><td><b>${nombre}</b> ${estadoBadge}</td><td style="color:${p.saldo > 0 ? 'var(--danger)' : '#000'}; font-weight:bold;">$${(p.saldo||0).toFixed(2)}</td><td><button style="background:var(--info); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirHistorialProv('${nombre}')">📋</button> <button style="background:var(--warning); color:#000; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAbonoProv('${nombre}')">💸</button> <button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAuthProv('${nombre}')">🗑️</button></td></tr>`; 
        }
    }); 
    if(document.getElementById('prov_lista')) document.getElementById('prov_lista').innerHTML = count > 0 ? html : `<tr><td colspan="3" style="text-align:center;">Vacio</td></tr>`; 
}
function abrirHistorialProv(nombre) {
    let p = proveedores[nombre]; if(!p) return;
    document.getElementById('hist_prov_nom').innerText = nombre; document.getElementById('hist_prov_saldo').innerText = (p.saldo || 0).toFixed(2);
    document.getElementById('hist_prov_status').innerHTML = p.saldo <= 0 ? '<span style="background:var(--s); color:white; padding:5px 15px; border-radius:20px; font-weight:bold;">✅ AL CORRIENTE</span>' : '<span style="background:var(--danger); color:white; padding:5px 15px; border-radius:20px; font-weight:bold;">⚠️ PENDIENTE</span>';
    document.getElementById('hist_prov_lista').innerHTML = (p.historial || []).map(h => `<tr><td>${h.fecha} ${h.hora}</td><td><b>${h.tipo}</b></td><td>${h.detalle}</td><td style="text-align:right; color:${h.tipo === 'Compra' ? 'var(--danger)' : 'var(--s)'};">...$${(h.monto||0).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="4">Vacio</td></tr>';
    document.getElementById('modalHistorialProv').style.display = 'block';
}
function abrirModalAbonoProv(nombre) { provAbonoActual = nombre; document.getElementById('abono_prov_nom').innerText = nombre; document.getElementById('abono_prov_deuda').innerText = (proveedores[nombre].saldo||0).toFixed(2); document.getElementById('abono_prov_monto').value = ''; document.getElementById('modalAbonoProv').style.display = 'block'; setTimeout(()=>document.getElementById('abono_prov_monto').focus(), 100); }
function confirmarAbonoProv() {
    let nom = document.getElementById('abono_prov_nom').innerText; let monto = parseFloat(document.getElementById('abono_prov_monto').value); let metodo = document.getElementById('abono_prov_metodo').value;
    if (isNaN(monto) || monto <= 0) return alert("❌ Monto inválido."); if (!proveedores[nom]) return; if (monto > proveedores[nom].saldo) return alert("⚠️ Mayor a deuda.");
    proveedores[nom].saldo -= monto;
    if (!proveedores[nom].historial) proveedores[nom].historial = [];
    proveedores[nom].historial.push({ fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), tipo: 'Abono', monto: monto, detalle: `Pago: ${metodo}` });
    if (metodo === 'Efectivo') {
        let idMov = Date.now(); let nm = { id: idMov, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), tipo: 'Retiro', monto: monto, motivo: `Pago: ${nom}`, cajero: usuarioActual, sucursal: sucursalActual };
        movimientos.push(nm); db.collection("movimientos").doc(String(idMov)).set(nm);
    }
    localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores)); db.collection("proveedores").doc(nom).set(proveedores[nom]);
    cerrarModales(); renderProveedores(); if (document.getElementById('r-tab').style.display === 'block') renderCorte(); alert("✅ Abono registrado.");
}
function abrirModalAuthProv(nombre) { window.provActualEliminar = nombre; document.getElementById('auth_prov_nom').innerText = nombre; document.getElementById('auth_admin_pin').value = ''; document.getElementById('modalAuthAdminProv').style.display = 'block'; setTimeout(() => document.getElementById('auth_admin_pin').focus(), 100); }
function confirmarEliminacionProv() {
    let prov = window.provActualEliminar; if (!prov || !proveedores[prov]) return;
    let pin = document.getElementById('auth_admin_pin').value;
    if (usuariosData["Admin"] && usuariosData["Admin"].pin === pin) {
        delete proveedores[prov]; localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores));
        db.collection("proveedores").doc(prov).delete(); cerrarModales(); renderProveedores(); alert("✅ Eliminado.");
    } else alert("❌ PIN.");
}

// ====================================================================
// === DASHBOARD, CORTES Y GASTOS ===
// ====================================================================
function calcularEfectivoEnCaja() {
    let hoy = getFechaLocal(); let ef = 0;
    ventas.forEach(v => {
        if(!v.anulada && (v.fecha || hoy) === hoy && v.sucursal === sucursalActual) {
            let mStr = v.metodo || '';
            if(mStr.includes('Efectivo')) {
                if (v.pagos && Array.isArray(v.pagos) && v.pagos.length > 0) { v.pagos.forEach(p => { if (p.metodo === 'Efectivo') ef += parseFloat(p.montoAplicado) || 0; }); } 
                else ef += parseFloat(v.total) || 0;
            }
        }
    });
    movimientos.forEach(m => {
        if((m.fecha || hoy) === hoy && m.sucursal === sucursalActual) {
            if(m.tipo === 'Ingreso') ef += parseFloat(m.monto) || 0; else if(m.tipo === 'Retiro') ef -= parseFloat(m.monto) || 0;
        }
    });
    return ef;
}

function abrirModalMovimiento() { document.getElementById('mov_monto').value = ''; document.getElementById('mov_motivo').value = ''; document.getElementById('modalMovimiento').style.display = 'block'; setTimeout(() => document.getElementById('mov_monto').focus(), 100); }
function guardarMovimiento() {
    let tipo = document.getElementById('mov_tipo').value; let monto = parseFloat(document.getElementById('mov_monto').value) || 0; let motivo = document.getElementById('mov_motivo').value.trim() || 'Manual';
    if(monto <= 0) return alert("❌ Monto inválido.");
    let idMov = Date.now(); let nuevoMov = { id: idMov, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalActual, tipo: tipo, monto: monto, motivo: motivo };
    movimientos.push(nuevoMov); localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos));
    db.collection("movimientos").doc(String(idMov)).set(nuevoMov).catch(e => console.log(e));
    cerrarModales(); alert(`✅ ${tipo} registrado.`); if(tabActual==='r-tab') renderCorte();
}
function registrarGasto() { let monto = parseFloat(prompt("💸 ¿Cuánto vas a retirar?")); if (isNaN(monto) || monto <= 0) return; let motivo = prompt("¿Motivo?"); if (!motivo) return; procesarRetiroCaja(monto, `GASTO: ${motivo.toUpperCase()}`); }
function registrarPrecorte() { let ef = calcularEfectivoEnCaja(); let monto = parseFloat(prompt(`✂️ PRECORTE\nEfectivo: $${ef.toFixed(2)}\n¿Cuánto retiras?`)); if (isNaN(monto) || monto <= 0) return; if (ef > 0 && monto > ef && !confirm(`⚠️ Retiras más de lo que hay. ¿Seguro?`)) return; procesarRetiroCaja(monto, "PRECORTE"); }
function procesarRetiroCaja(monto, motivo) {
    let idMov = Date.now(); let nuevoMov = { id: idMov, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalActual, tipo: 'Retiro', monto: monto, motivo: motivo };
    movimientos.push(nuevoMov); localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); db.collection("movimientos").doc(String(idMov)).set(nuevoMov);
    alert(`✅ Registrado.`); if(tabActual==='r-tab') renderCorte();
}

let movimientoPendienteCancelar = null;
function abrirCancelacionMovimientos() {
    let hoy = getFechaLocal(); let movsHoy = movimientos.filter(m => m.fecha === hoy && m.sucursal === sucursalActual);
    if(movsHoy.length === 0) return alert("No hay movimientos hoy.");
    let opciones = "📋 MOVIMIENTOS:\n\n" + movsHoy.map((m, i) => `[ ${i + 1} ] 🕒 ${m.hora} - ${m.tipo}: $${parseFloat(m.monto).toFixed(2)} (${m.motivo})`).join('\n') + "\n👉 NÚMERO a ANULAR:";
    let seleccion = prompt(opciones); if(!seleccion) return;
    let idx = parseInt(seleccion) - 1; if(isNaN(idx) || idx < 0 || idx >= movsHoy.length) return alert("❌ Inválido.");
    movimientoPendienteCancelar = movsHoy[idx];
    document.getElementById('input_pin_seguro').value = ''; document.getElementById('modal_pin_seguro').style.display = 'flex'; setTimeout(() => document.getElementById('input_pin_seguro').focus(), 100); 
}
function cerrarModalPinSeguro() { document.getElementById('modal_pin_seguro').style.display = 'none'; }
window.verificarPinYCancelar = function() {
    let pass = document.getElementById('input_pin_seguro').value;
    if (usuariosData["Admin"] && pass === usuariosData["Admin"].pin) {
        document.getElementById('modal_pin_seguro').style.display = 'none';
        if(!confirm(`¿Borrar permanentemente este ${movimientoPendienteCancelar.tipo} por $${parseFloat(movimientoPendienteCancelar.monto).toFixed(2)}?`)) return;
        let indexGlobal = movimientos.findIndex(m => m.id === movimientoPendienteCancelar.id);
        if(indexGlobal !== -1) { movimientos.splice(indexGlobal, 1); localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); }
        db.collection("movimientos").doc(String(movimientoPendienteCancelar.id)).delete();
        alert("✅ Eliminado."); if(tabActual==='r-tab') renderCorte(); 
    } else alert("❌ PIN");
};


function renderCorte() { 
    try {
        let fInicio = document.getElementById('corte_fecha_inicio').value; let fFin = document.getElementById('corte_fecha_fin').value; 
        let fCajero = document.getElementById('corte_cajero').value; let fSuc = document.getElementById('corte_sucursal').value; 
        let hoy = getFechaLocal();
        // 🌟 MINI SCRIPT PARA LLENAR LA LISTA DE CAJEROS AUTOMÁTICAMENTE 🌟
        let selectCajero = document.getElementById('corte_cajero');
        if(selectCajero && selectCajero.options.length <= 1 && ventas && ventas.length > 0) {
            // Saca los nombres de las ventas, quita los vacíos y borra los duplicados
            let cajerosUnicos = [...new Set(ventas.map(v => v.cajero).filter(Boolean))];
            // Agrega cada cajero al menú desplegable
            cajerosUnicos.forEach(c => selectCajero.innerHTML += `<option value="${c}">${c}</option>`);
        }
        // ------------------------------------------------------------------
        let ef=0, ta=0, trans=0, cr=0; let tVentas = 0, tUtilidad = 0, numVentas = 0;
        let ventasPorDia = {}, utilPorDia = {}, depsHash = {}, cajerosHash = {}, horasHash = {}, metricasCajero = {}, topProductosHash = {}; 

        let operacionesHTML = []; 

        if (!ventas || ventas.length === 0 && movimientos.length === 0) {
            if(document.getElementById('r_lista_ventas')) document.getElementById('r_lista_ventas').innerHTML = "<tr><td colspan='6' style='text-align:center'>Vacio</td></tr>";
            return;
        }

        let filteredVentas = ventas.filter(v => { let vFecha = v.fecha || hoy; return (vFecha >= fInicio && vFecha <= fFin) && (!fCajero || v.cajero === fCajero) && (!fSuc || v.sucursal === fSuc || (fSuc === "Matriz" && !v.sucursal)); });
        
        filteredVentas.forEach(v => {
            if(!v.anulada) {
                numVentas++; let tVentaTicket = parseFloat(v.total) || 0; tVentas += tVentaTicket;
                let dStr = v.fecha || hoy; let nomCajero = v.cajero || 'Desconocido';
                let fechaObj = new Date(v.id); let horaMilitar = fechaObj.getHours().toString().padStart(2, '0') + ":00"; 
                horasHash[horaMilitar] = (horasHash[horaMilitar] || 0) + tVentaTicket;
                if (!metricasCajero[nomCajero]) metricasCajero[nomCajero] = { total: 0, tickets: 0, horasUnicas: new Set() };
                metricasCajero[nomCajero].total += tVentaTicket; metricasCajero[nomCajero].tickets += 1; metricasCajero[nomCajero].horasUnicas.add(dStr + "-" + horaMilitar);
                ventasPorDia[dStr] = (ventasPorDia[dStr] || 0) + tVentaTicket; cajerosHash[nomCajero] = (cajerosHash[nomCajero] || 0) + tVentaTicket;

                if (v.pagos && Array.isArray(v.pagos) && v.pagos.length > 0) { v.pagos.forEach(p => { let m = parseFloat(p.montoAplicado) || 0; if(p.metodo === 'Efectivo') ef += m; else if(p.metodo === 'Tarjeta') ta += m; else if(p.metodo === 'Transferencia') trans += m; else if(p.metodo === 'Crédito') cr += m; }); } 
                else { let mStr = v.metodo || ''; if(mStr.includes('Efectivo')) ef += tVentaTicket; else if(mStr.includes('Tarjeta')) ta += tVentaTicket; else if(mStr.includes('Transferencia')) trans += tVentaTicket; else if(mStr.includes('Crédito')) cr += tVentaTicket; }

                let utilTicket = 0;
                if (v.detalles) { 
                    v.detalles.forEach(d => { 
                        if(d.can > 0) { 
                            let itemInv = inv[d.cod] || {}; let cosUnit = parseFloat(itemInv.cos || 0) * (1 + (parseFloat(itemInv.iva || 0)/100));
                            utilTicket += (parseFloat(d.subtotal) || 0) - (cosUnit * parseFloat(d.can || 1));
                            depsHash[d.dep || "General"] = (depsHash[d.dep || "General"] || 0) + parseFloat(d.subtotal || 0); 
                            if (!topProductosHash[d.cod]) topProductosHash[d.cod] = { nombre: d.nom || itemInv.nom || '?', cantidad: 0, total: 0 };
                            topProductosHash[d.cod].cantidad += parseFloat(String(d.can)) || 0; topProductosHash[d.cod].total += parseFloat(d.subtotal) || 0;
                        }
                    }); 
                }
                tUtilidad += utilTicket; utilPorDia[dStr] = (utilPorDia[dStr] || 0) + utilTicket;
            }
            
            let classes = v.anulada ? 'anulada-row' : ''; let tag = v.anulada ? '<span style="color:red; font-weight:bold;">[ANULADA]</span> ' : '';
            
            // 🛠️ PARCHE AQUÍ: Formateamos el texto para mostrar con cuánto pagó y su cambio de forma compacta en la descripción
            let detallePagoText = '';
            if(!v.anulada && v.pagoCon !== undefined && v.cambio !== undefined && v.pagoCon > 0) {
                detallePagoText = `<br><small style="color:#666; font-style:italic;">(Pagó: $${parseFloat(v.pagoCon).toFixed(2)} | Cambio: $${parseFloat(v.cambio).toFixed(2)})</small>`;
            }

            operacionesHTML.push({
                id: v.id,
                html: `<tr class="${classes}"><td>${v.fecha} ${v.hora}</td><td>${v.cajero}</td><td>${v.sucursal || 'Matriz'}</td><td style="font-weight:bold; color:var(--s);">+$${(parseFloat(v.total)||0).toFixed(2)}</td><td>${v.metodo}</td><td>${tag}${(v.items || '').substring(0,40)}${detallePagoText}</td></tr>`
            });
        }); 

        let ing_efectivo = 0, ret_efectivo = 0, flujo_ing_otros = 0, flujo_out_compras = 0, flujo_out_otros = 0;
        movimientos.forEach(m => {
            let mFecha = m.fecha || hoy; 
            if(mFecha >= fInicio && mFecha <= fFin && (!fCajero || m.cajero === fCajero) && (!fSuc || m.sucursal === fSuc)) { 
                let montoM = parseFloat(m.monto) || 0; let mMotivo = (m.motivo || '').toLowerCase();
                if(m.tipo === 'Ingreso') { ing_efectivo += montoM; flujo_ing_otros += montoM; } 
                else if(m.tipo === 'Retiro') { ret_efectivo += montoM; if (mMotivo.includes('compra') || mMotivo.includes('proveedor')) flujo_out_compras += montoM; else flujo_out_otros += montoM; }
                
                let isIngreso = m.tipo === 'Ingreso';
                let colorMonto = isIngreso ? 'var(--s)' : 'var(--danger)';
                let signo = isIngreso ? '+' : '-';
                operacionesHTML.push({
                    id: m.id,
                    html: `<tr style="background:#fcfcfc;"><td>${m.fecha} ${m.hora}</td><td>${m.cajero || 'Admin'}</td><td>${m.sucursal || 'Matriz'}</td><td style="font-weight:bold; color:${colorMonto};">${signo}$${montoM.toFixed(2)}</td><td><span class="badge-kit" style="background:${isIngreso?'var(--info)':'var(--danger)'}">${m.tipo.toUpperCase()}</span></td><td>${m.motivo}</td></tr>`
                });
            } 
        });

        operacionesHTML.sort((a,b) => b.id - a.id);

        if(document.getElementById('kpi_tabla_top_productos')) document.getElementById('kpi_tabla_top_productos').innerHTML = Object.values(topProductosHash).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10).map((p, i) => `<tr><td>${i + 1}</td><td><b>${p.nombre}</b></td><td>${p.cantidad}</td><td>$${p.total.toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="4">Vacio</td></tr>';
        if(document.getElementById('kpi_tabla_cajeros')) document.getElementById('kpi_tabla_cajeros').innerHTML = Object.keys(metricasCajero).sort((a,b) => metricasCajero[b].total - metricasCajero[a].total).map(nom => { let d = metricasCajero[nom]; return `<tr><td><b>${nom}</b></td><td>$${d.total.toFixed(2)}</td><td>$${(d.total / d.tickets).toFixed(2)}</td><td>$${(d.total / (d.horasUnicas.size || 1)).toFixed(2)}/hr</td></tr>`; }).join('') || '<tr><td colspan="4">Vacio</td></tr>';

        let efectivoEnCaja = ef + ing_efectivo - ret_efectivo;
        document.getElementById('kpi_ventas').innerText = "$" + tVentas.toLocaleString('es-MX', {minimumFractionDigits: 2});
        document.getElementById('kpi_ganancia').innerText = "$" + tUtilidad.toLocaleString('es-MX', {minimumFractionDigits: 2});
        document.getElementById('kpi_no_ventas').innerText = numVentas;
        document.getElementById('kpi_ticket_prom').innerText = "$" + (numVentas > 0 ? (tVentas / numVentas) : 0).toLocaleString('es-MX', {minimumFractionDigits: 2});
        document.getElementById('kpi_margen').innerText = (tVentas > 0 ? ((tUtilidad / tVentas) * 100) : 0).toFixed(2) + "%";
        
        document.getElementById('r_efectivo').innerText = "$"+efectivoEnCaja.toFixed(2); document.getElementById('r_tarjeta').innerText = "$"+ta.toFixed(2); document.getElementById('r_transferencia').innerText = "$"+trans.toFixed(2); document.getElementById('r_credito').innerText = "$"+cr.toFixed(2); document.getElementById('r_total').innerText = "$"+(ef + ta + trans).toFixed(2); 
        
        document.getElementById('r_lista_ventas').innerHTML = operacionesHTML.map(op => op.html).join('') || "<tr><td colspan='6' style='text-align:center'>No hay operaciones en este periodo</td></tr>";

        if(document.getElementById('flujo_in_efectivo')) {
            document.getElementById('flujo_in_efectivo').innerText = "$" + ef.toFixed(2); document.getElementById('flujo_in_digital').innerText = "$" + (ta + trans).toFixed(2); document.getElementById('flujo_in_otros').innerText = "$" + flujo_ing_otros.toFixed(2); document.getElementById('flujo_in_total').innerText = "$" + (ef + ta + trans + flujo_ing_otros).toFixed(2);
            document.getElementById('flujo_out_compras').innerText = "$" + flujo_out_compras.toFixed(2); document.getElementById('flujo_out_otros').innerText = "$" + flujo_out_otros.toFixed(2); document.getElementById('flujo_out_total').innerText = "$" + (flujo_out_compras + flujo_out_otros).toFixed(2);
        }

        if (typeof transferencias !== 'undefined' && document.getElementById('d_trans_env_val')) {
            let tEnvVal = 0, tRecVal = 0, tPenVal = 0; let sucFiltroTrans = fSuc || sucursalActual;
            let htmlTrans = transferencias.filter(t => { let td = new Date(t.id); return `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}` >= fInicio && `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}` <= fFin; }).map(t => {
                if (fSuc !== "" && t.origen !== sucFiltroTrans && t.destino !== sucFiltroTrans) return '';
                let val = parseFloat(t.valor) || 0;
                if (fSuc === "") { tEnvVal += val; } else { if (t.origen === sucFiltroTrans) tEnvVal += val; if (t.destino === sucFiltroTrans) { if (t.estado === 'completada') tRecVal += val; else tPenVal += val; } }
                return `<tr><td>${t.fecha.split(',')[0]}</td><td><b>${t.origen}</b> ➡️ <b>${t.destino}</b></td><td>${t.estado}</td><td>$${val.toFixed(2)}</td></tr>`;
            }).join('');
            document.getElementById('d_trans_env_val').innerText = "$" + tEnvVal.toFixed(2); document.getElementById('d_trans_rec_val').innerText = "$" + tRecVal.toFixed(2); document.getElementById('d_trans_pen_val').innerText = "$" + tPenVal.toFixed(2);
            document.getElementById('d_lista_transferencias').innerHTML = htmlTrans || '<tr><td colspan="4">Vacio</td></tr>';
        }

        actualizarGraficasBI(ventasPorDia, utilPorDia, depsHash, cajerosHash, horasHash);
    } catch(err) { console.error("Error Dashboard:", err); }
}
function actualizarGraficasBI(vDia, uDia, deps, cajs, horas) {
    if (chartBarInstance) chartBarInstance.destroy(); if (chartDeptInstance) chartDeptInstance.destroy(); if (chartCajeroInstance) chartCajeroInstance.destroy(); if (chartHorasInstance) chartHorasInstance.destroy(); 
    let fc = Object.keys(vDia).sort();
    let ctx1 = document.getElementById('chartVentasDiarias'); if(ctx1) chartBarInstance = new Chart(ctx1.getContext('2d'), { type: 'bar', data: { labels: fc, datasets: [ { label: 'Ventas', data: fc.map(f => vDia[f]), backgroundColor: '#8ea1d8' }, { label: 'Ganancia', data: fc.map(f => uDia[f]), backgroundColor: '#475399' } ] }, options: { responsive: true, maintainAspectRatio: false } });
    let ctx2 = document.getElementById('chartDept'); if(ctx2) chartDeptInstance = new Chart(ctx2.getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(deps), datasets: [{ data: Object.values(deps), backgroundColor: ['#64d0b2', '#007bff', '#28a745', '#17a2b8', '#ffc107', '#6f42c1', '#dc3545', '#fd7e14'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    let ctx3 = document.getElementById('chartCajeros'); if(ctx3) chartCajeroInstance = new Chart(ctx3.getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(cajs), datasets: [{ data: Object.values(cajs), backgroundColor: ['#994769', '#343a40', '#6c757d', '#f8d7da', '#cce5ff', '#d4edda'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    let hc = Object.keys(horas).sort();
    let ctx4 = document.getElementById('chartHoras'); if(ctx4) chartHorasInstance = new Chart(ctx4.getContext('2d'), { type: 'bar', data: { labels: hc, datasets: [{ label: 'Ventas por Hora', data: hc.map(h => horas[h]), backgroundColor: '#fd7e14' }] }, options: { responsive: true, maintainAspectRatio: false } });
}

window.descargarVentasNube = async function() {
    let fInicio = document.getElementById('corte_fecha_inicio').value; let fFin = document.getElementById('corte_fecha_fin').value; let btn = document.getElementById('btn_analizar_nube');
    btn.innerText = "⏳ DESCARGANDO..."; btn.disabled = true;
    try {
        let records = await pb.collection('ventas').getFullList({ requestKey: null }); let vNube = records.map(r => r.data).filter(v => v.fecha >= fInicio && v.fecha <= fFin);
        let mapa = {}; ventas.forEach(v => mapa[v.id] = v); vNube.forEach(v => mapa[v.id] = v); ventas = Object.values(mapa).sort((a,b) => a.id - b.id);
        alert(`✅ ${vNube.length} ventas descargadas.`); renderCorte();
    } catch(err) { alert("❌ Error: " + err.message); }
    btn.innerText = "☁️ DESCARGAR DE LA NUBE"; btn.disabled = false;
};

// ====================================================================
// === VISORES Y TICKETS (VENTAS Y COMPRAS) ===
// ====================================================================
function imprimirTicket(divId) { document.querySelectorAll('.print-active').forEach(e => e.classList.remove('print-active')); document.getElementById(divId).classList.add('print-active'); window.print(); }

function abrirVisorTickets() { 
    let searchInput = document.getElementById('visor_search'); let dateInput = document.getElementById('visor_date');
    if (searchInput) searchInput.value = ''; if (dateInput) dateInput.value = getFechaLocal();
    filtrarVisorTickets(); document.getElementById('modalVisor').style.display = 'block'; 
    if (searchInput) setTimeout(() => searchInput.focus(), 100);
}

function filtrarVisorTickets() {
    let searchInput = document.getElementById('visor_search'); let dateInput = document.getElementById('visor_date');
    let txt = searchInput ? searchInput.value.toLowerCase().trim() : ''; let selectedDate = dateInput ? dateInput.value : ''; let terms = txt.split(/\s+/); 
    visorIndices = ventas.map((v, idx) => ({...v, indexGlobal: idx})).filter(v => v.sucursal === sucursalActual);
    if (selectedDate !== '') visorIndices = visorIndices.filter(v => v.fecha === selectedDate);
    if (txt !== '') visorIndices = visorIndices.filter(v => { let clientStr = v.cliente_tel ? (clientes[v.cliente_tel] ? clientes[v.cliente_tel].nom : '') : 'Público'; return terms.every(t => `${v.id} ${v.fecha} ${v.hora} ${clientStr} ${v.cajero} ${v.metodo}`.toLowerCase().includes(t)); });
    if (visorIndices.length === 0) {
        document.getElementById('visor_counter').innerText = "0 / 0"; document.getElementById('visor_fecha').innerText = "Vacio"; document.getElementById('visor_items').innerHTML = `<tr><td colspan="3">N/A</td></tr>`; document.getElementById('visor_total').innerText = "0.00";
        if(document.getElementById('btn_anular_visor')) document.getElementById('btn_anular_visor').disabled = true;
    } else { currentVisorPos = visorIndices.length - 1; renderVisorActivo(); }
}

function navVisor(dir) { let n = currentVisorPos + dir; if(n >= 0 && n < visorIndices.length) { currentVisorPos = n; renderVisorActivo(); } }

function renderVisorActivo() {
    if (visorIndices.length === 0) return; let v = visorIndices[currentVisorPos]; 
    document.getElementById('visor_counter').innerText = (currentVisorPos + 1) + " / " + visorIndices.length;
    let clientStr = v.cliente_tel ? (clientes[v.cliente_tel] ? clientes[v.cliente_tel].nom : 'Cliente') : 'Público General';
    document.getElementById('visor_fecha').innerText = `${v.fecha||''} ${v.hora||''} - ${v.sucursal||''}\nTicket ID: ${v.id}\nCliente: ${clientStr}`;
    let html = '';
    if (v.detalles && Array.isArray(v.detalles) && v.detalles.length > 0) { 
        html = v.detalles.map((d, i) => {
            let ex = !v.anulada ? (d.can > 0 ? `<div class="no-print"><button style="background:var(--warning); color:#000; font-size:9px;" onclick="devolverArticuloVisor(${i})">↩️</button></div>` : `<div style="color:var(--danger); font-size:10px;">(Devuelto)</div>`) : '';
            return `<tr><td style="vertical-align:top;">${d.can}</td><td>${(d.nom||'').substring(0,15)} ${ex}</td><td style="text-align:right;">$${(d.subtotal||0).toFixed(2)}</td></tr>`;
        }).join(''); 
    } else html = `<tr><td colspan="3">${v.items || ''}</td></tr>`; 
    document.getElementById('visor_items').innerHTML = html; 
    document.getElementById('visor_total').innerText = (v.total||0).toFixed(2); 
    document.getElementById('visor_metodo').innerText = v.metodo || 'N/A'; 

    // 🌟 NUEVO: Le ordenamos a JavaScript llenar los campos del billete y el cambio en la copia
    let pagoConVisor = v.pagoCon !== undefined ? parseFloat(v.pagoCon) : parseFloat(v.total || 0);
    let cambioVisor = v.cambio !== undefined ? parseFloat(v.cambio) : 0;
    
    if (document.getElementById('visor_pagado')) {
        document.getElementById('visor_pagado').innerText = pagoConVisor.toFixed(2);
    }
    if (document.getElementById('visor_cambio')) {
        document.getElementById('visor_cambio').innerText = cambioVisor.toFixed(2);
    }
    // 🌟 FIN DEL NUEVO BLOQUE

    document.getElementById('visor_cajero').innerText = v.cajero || 'Admin';
    
    let btn = document.getElementById('btn_anular_visor'); 
    let sello = document.getElementById('visor_sello_anulado');
    if(v.anulada) { 
        sello.style.display = 'block'; 
        btn.disabled = true; 
        btn.innerText = "❌ ANULADA"; 
    } else { 
        sello.style.display = 'none'; 
        btn.disabled = false; 
        btn.innerText = "🔴 ANULAR"; 
    }
}

function anularVentaVisor() {
    let vRef = visorIndices[currentVisorPos]; 
    let vReal = ventas[vRef.indexGlobal]; 
    if(vReal.anulada) return;
    
    if(!confirm("¿ESTÁS SEGURO DE ANULAR ESTA VENTA?")) return;
    
    // Recorremos los detalles de la venta para devolver stock y auditar
    if(vReal.detalles) { 
        vReal.detalles.forEach(d => { 
            let item = inv[d.cod]; 
            if(item) { 
                if(!item.stock) item.stock = {}; 
                let sucDestino = vReal.sucursal || sucursalActual;
                item.stock[sucDestino] = (item.stock[sucDestino] || 0) + (d.can || 1); 
                
                // Actualizamos el inventario en la nube
                db.collection("inventario").doc(d.cod).set(item); 
            } 
            
            // 📊 KARDEX INTEGRADO: Adentro del ciclo para que registre cada producto anulado
            registrarEnKardex(d.cod, d.nom, "ANULACIÓN", (d.can || 1), 0, 0);
        }); 
    } 
    
    // Ajuste de saldo si fue venta a crédito
    if(vReal.metodo && vReal.metodo.includes('Crédito') && vReal.cliente_tel && clientes[vReal.cliente_tel]) { 
        clientes[vReal.cliente_tel].saldo -= (vReal.total || 0); 
        if(clientes[vReal.cliente_tel].saldo < 0) clientes[vReal.cliente_tel].saldo = 0; 
        db.collection("clientes").doc(vReal.cliente_tel).set(clientes[vReal.cliente_tel]); 
    }
    
    // Marcamos la venta como anulada en la base de datos
    vReal.anulada = true; 
    db.collection("ventas").doc(String(vReal.id)).set(vReal).then(() => { 
        alert("✅ Venta Anulada."); 
        visorIndices[currentVisorPos].anulada = true; 
        renderVisorActivo(); 
        renderCorte(); 
        renderI(); 
        renderClientes(); 
    });
}
function devolverArticuloVisor(indexDetalle) {
    let vRef = visorIndices[currentVisorPos]; let vReal = ventas[vRef.indexGlobal]; if(vReal.anulada) return;
    let d = vReal.detalles[indexDetalle]; if(!d || d.can <= 0) return;
    let c = parseFloat(prompt(`Devolver "${d.nom}" (Max: ${d.can}):`, "1")); if(isNaN(c) || c <= 0 || c > d.can) return;
    let m = c * (d.subtotal / d.can); if(!confirm(`Devolver ${c} uds por $${m.toFixed(2)}?`)) return;
    d.can -= c; d.subtotal -= m; vReal.total -= m; if(vReal.total <= 0) { vReal.anulada = true; vReal.total = 0; }
    let itemInv = inv[d.cod]; if(itemInv) { if(!itemInv.stock) itemInv.stock = {}; itemInv.stock[vReal.sucursal || sucursalActual] = (itemInv.stock[vReal.sucursal || sucursalActual] || 0) + c; db.collection("inventario").doc(d.cod).set(itemInv); }
    if(vReal.metodo && vReal.metodo.includes('Crédito') && vReal.cliente_tel && clientes[vReal.cliente_tel]) { clientes[vReal.cliente_tel].saldo = Math.max(0, clientes[vReal.cliente_tel].saldo - m); db.collection("clientes").doc(vReal.cliente_tel).set(clientes[vReal.cliente_tel]); } 
    else { let idMov = Date.now(); let nm = { id: idMov, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalActual, tipo: 'Retiro', monto: m, motivo: `DEVOLUCIÓN: ${d.nom}` }; movimientos.push(nm); db.collection("movimientos").doc(String(idMov)).set(nm); }
    db.collection("ventas").doc(String(vReal.id)).set(vReal).then(() => { alert("✅ Reembolso: $"+m.toFixed(2)); renderVisorActivo(); renderCorte(); renderI(); });
}

// Visor Compras
let visorComprasIndices = []; let currentVisorCompraPos = 0;
async function abrirVisorCompras() { 
    if (typeof compras !== 'undefined' && compras.length === 0) { if (typeof db_compras !== 'undefined') compras = db_compras; else if (window.comprasGlobal) compras = window.comprasGlobal; }
    if (document.getElementById('visor_compras_date')) document.getElementById('visor_compras_date').value = getFechaLocal();
    filtrarVisorCompras(); document.getElementById('modalVisorCompras').style.display = 'block'; 
}
function filtrarVisorCompras() {
    let t = document.getElementById('visor_compras_search') ? document.getElementById('visor_compras_search').value.toLowerCase().trim() : ''; let d = document.getElementById('visor_compras_date') ? document.getElementById('visor_compras_date').value : '';
    visorComprasIndices = compras.filter(c => c.sucursal === sucursalActual && (d === '' || c.fecha === d) && (t === '' || `${c.id} ${c.proveedor}`.toLowerCase().includes(t)));
    if (visorComprasIndices.length === 0) { document.getElementById('visor_compras_counter').innerText = "0 / 0"; document.getElementById('visor_compras_items').innerHTML = `<tr><td colspan="3">Vacio</td></tr>`; document.getElementById('visor_compras_total').innerText = "0.00"; } 
    else { currentVisorCompraPos = visorComprasIndices.length - 1; renderVisorCompraActiva(); }
}
function navVisorCompras(dir) { if (visorComprasIndices.length === 0) return; currentVisorCompraPos = Math.max(0, Math.min(visorComprasIndices.length - 1, currentVisorCompraPos + dir)); renderVisorCompraActiva(); }
function renderVisorCompraActiva() {
    if (visorComprasIndices.length === 0) return; let c = visorComprasIndices[currentVisorCompraPos]; 
    document.getElementById('visor_compras_counter').innerText = `${currentVisorCompraPos + 1} / ${visorComprasIndices.length}`;
    document.getElementById('visor_compras_fecha').innerText = `${c.fecha || ''} ${c.hora || ''}`; document.getElementById('visor_compras_prov').innerText = c.proveedor || 'General'; document.getElementById('visor_compras_folio').innerText = c.id || '-';
    let html = ''; let tot = 0;
    (c.items || []).forEach(x => { let sub = (x.can * (parseFloat(x.cos)||0)) * (1 - (parseFloat(x.desc)||0)/100); tot+=sub; html+=`<tr><td>${x.can}</td><td>${x.nom}</td><td style="text-align:right;">$${sub.toFixed(2)}</td></tr>`; });
    document.getElementById('visor_compras_items').innerHTML = html; document.getElementById('visor_compras_total').innerText = (c.total !== undefined ? parseFloat(c.total) : tot).toFixed(2);
}

// Analisis de Compras (Excel)
let datosComprasActuales = [];
function abrirHistorialCompras() {
    document.getElementById('modal_analisis_compras').style.display = 'flex';
    let hoy = new Date(); let h30 = new Date(); h30.setDate(hoy.getDate() - 30);
    let form = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if(!document.getElementById('filtro_compra_inicio').value) { document.getElementById('filtro_compra_inicio').value = form(h30); document.getElementById('filtro_compra_fin').value = form(hoy); }
    cargarDatosAnalisisCompras();
}
function cerrarModalAnalisisCompras() { document.getElementById('modal_analisis_compras').style.display = 'none'; }
function cargarDatosAnalisisCompras() {
    let inicio = document.getElementById('filtro_compra_inicio').value; let fin = document.getElementById('filtro_compra_fin').value; let tbody = document.getElementById('body_analisis_compras');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Cargando...</td></tr>';
    db.collection("compras").orderBy("id", "desc").get().then(qs => {
        let total = 0; let html = ''; datosComprasActuales = [];
        let dI = inicio ? new Date(inicio + "T00:00:00").getTime() : 0; let dF = fin ? new Date(fin + "T23:59:59").getTime() : Infinity;
        qs.forEach(doc => {
            let data = doc.data(); let dDate = new Date(data.id).getTime();
            if(dDate >= dI && dDate <= dF && data.sucursal === sucursalActual) {
                datosComprasActuales.push(data); let m = parseFloat(data.total) || 0; total += m;
                let lst = (data.detalles || data.items || []).map(d => `${d.can}x ${d.nom}`).join(", ");
                html += `<tr><td>${data.fecha}</td><td>${data.proveedor || 'General'}</td><td>${(data.detalles||data.items||[]).length} items</td><td style="text-align:right;">$${m.toFixed(2)}</td><td>${lst.substring(0,30)}</td></tr>`;
            }
        });
        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center;">Vacio</td></tr>'; document.getElementById('total_analisis_compras').innerText = total.toFixed(2);
    }).catch(e => tbody.innerHTML = `<tr><td colspan="5">Error</td></tr>`);
}
function exportarComprasExcel() {
    if(datosComprasActuales.length === 0) return alert("Vacio");
    let csv = "\uFEFFFECHA,HORA,PROVEEDOR,METODO PAGO,TOTAL INVERTIDO,DETALLE\n";
    datosComprasActuales.forEach(c => { let lst = (c.detalles || c.items || []).map(d => `${d.can}x ${d.nom}`).join(" | "); csv += `"${c.fecha}","${c.hora}","${c.proveedor || 'General'}","${c.metodo || ''}","${(c.total||0).toFixed(2)}","${lst}"\n`; });
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); let url = URL.createObjectURL(blob); let link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `Compras_${Date.now()}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ====================================================================
// === BUSCADOR GLOBAL Y ESCÁNER (CÁMARA) ===
// ====================================================================
let timerBusquedaModal; let ultimoTextoBuscado = null; 
function abrirBuscador() { document.getElementById('modalBuscar').style.display = 'block'; document.getElementById('b_input').value = ''; ultimoTextoBuscado = null; searchResultsList = []; focusSearchIndex = 0; buscarProductos(); setTimeout(() => document.getElementById('b_input').focus(), 100); }
function buscarProductos() { 
    clearTimeout(timerBusquedaModal);
    timerBusquedaModal = setTimeout(() => {
        let txt = document.getElementById('b_input').value.toLowerCase(); if (txt === ultimoTextoBuscado) return; ultimoTextoBuscado = txt; 
        let terms = txt.split(/%|\s+/).filter(t => t.trim() !== ""); searchResultsList = []; 
        let codigos = Object.keys(inv);
        for(let i = 0; i < codigos.length; i++) {
            let cod = codigos[i]; let p = inv[cod]; if (!p) continue;
            let match = terms.every(t => (String(cod).toLowerCase() + " " + String(p.nom || '').toLowerCase()).includes(t));
            if(terms.length === 0 || match) { searchResultsList.push({cod: cod, ...p}); if (searchResultsList.length >= 50) break; } 
        }
        focusSearchIndex = searchResultsList.length > 0 ? 0 : -1; renderTablaBuscador();
    }, 200); 
}
function renderTablaBuscador() {
    document.getElementById('b_resultados').innerHTML = searchResultsList.map((p, i) => {
        let bg = i === focusSearchIndex ? 'background:#e0f0ff; border-left: 4px solid var(--p);' : '';
        return `<tr onclick="seleccionarBusqueda('${p.cod}')" style="cursor:pointer; ${bg}"><td>${i === focusSearchIndex ? '👉 ' : ''}${p.cod}</td><td><b>${p.nom}</b></td><td>${getVirtualStock(p)}</td><td>$${(p.pv||0).toFixed(2)}</td></tr>`;
    }).join('') || '<tr><td colspan="4" style="text-align:center">Vacio</td></tr>'; 
}
function seleccionarBusqueda(cod) { 
    if (tabActual === 'c-tab') { document.getElementById('modalBuscar').style.display = 'none'; document.getElementById('c_cod').value = cod; handleCompraScan({key:'Enter'}); } 
    else { cerrarModales(); if (tabActual === 'v-tab') { document.getElementById('v_cod').value = cod; handleVenta({key:'Enter'}); } else if (tabActual === 'pro-tab') { document.getElementById('pr_cod').value = cod; verificarProdPromo(); } else if (tabActual === 'k-tab') { document.getElementById('k_comp_cod').value = cod; } }
}

let escanerCamara = null; let destinoActualEscaner = 'ventas'; 
function abrirEscanerCamara(destino = 'ventas') {
    destinoActualEscaner = destino; document.getElementById('modal_escaner').style.display = 'flex';
    escanerCamara = new Html5QrcodeScanner("lector_camara", { fps: 10, qrbox: { width: 250, height: 120 }, rememberLastUsedCamera: true }, false);
    escanerCamara.render((texto) => {
        cerrarEscanerCamara();
        try { let ctx = new (window.AudioContext || window.webkitAudioContext)(); let osc = ctx.createOscillator(); let gain = ctx.createGain(); osc.type = 'sine'; osc.frequency.value = 880; gain.gain.setValueAtTime(1, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.15); } catch(e){}
        if (destinoActualEscaner === 'compras' && document.getElementById('c_cod')) { document.getElementById('c_cod').value = texto; handleCompraScan({ key: 'Enter' }); } 
        else if (destinoActualEscaner === 'transferencias' && document.getElementById('t_cod')) { document.getElementById('t_cod').value = texto; addTransferToList(); } 
        else if (destinoActualEscaner === 'caja' && document.getElementById('caja_codigo')) { document.getElementById('caja_codigo').value = texto; buscarProdCaja(); } 
        else if (document.getElementById('v_cod')) { document.getElementById('v_cod').value = texto; handleVenta({ key: 'Enter' }); }
    }, () => {});
}
function cerrarEscanerCamara() { document.getElementById('modal_escaner').style.display = 'none'; if (escanerCamara) { escanerCamara.clear(); escanerCamara = null; } }

// ====================================================================
// === TECLADO GLOBAL (ATAJOS Y NAVEGACIÓN) ===
// ====================================================================
function focoCobro(e, nextId) {
    if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation(); 
        if (nextId === 'add') window.agregarPagoVenta(); 
        else { let n = (e.target.id === 'm_metodo' && e.target.value === 'Crédito') ? 'm_cliente_select' : nextId; let el = document.getElementById(n); if (el) { el.focus(); if (el.select) el.select(); } }
    }
}
function focoC(e, nextId, prevId) {
    if(e.key === 'Enter' || e.key === 'ArrowDown') {
        if(e.key === 'ArrowDown' && e.target.tagName === 'SELECT') return; 
        e.preventDefault();
        if(e.key === 'Enter' && nextId === 'add') manualAddToList(); else if (nextId !== 'add') { let n = document.getElementById(nextId); if (n) { n.focus(); if(n.select) n.select(); } }
    } else if (e.key === 'ArrowUp' && prevId) {
        if(e.target.tagName === 'SELECT') return; e.preventDefault(); let p = document.getElementById(prevId); if (p) { p.focus(); if(p.select) p.select(); }
    }
}
function focoCajaEnter(e, nextId) {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        if (e.target.id === 'caja_codigo') buscarProdCaja();
        if (nextId === 'btn_agregar_caja') agregarCajaACarrito(); 
        else { let n = document.getElementById(nextId); if (n) { n.focus(); n.select(); } }
    }
}
// ====================================================================
// === MÓDULO DE TRANSFERENCIAS Y FALTANTES ===
// ====================================================================

function abrirTransferencia() {
    carT = []; // Limpiamos la lista de la transferencia nueva
    
    // Reseteamos los selectores
    if (document.getElementById('t_origen')) document.getElementById('t_origen').value = sucursalActual;
    if (document.getElementById('t_destino')) document.getElementById('t_destino').value = "";
    
    // Limpiamos la tabla (usando tu ID exacto t_lista_tab)
    if (document.getElementById('t_lista_tab')) document.getElementById('t_lista_tab').innerHTML = "";
    
    // Abrimos el modal (usando tu ID exacto modalTransfer)
    let modal = document.getElementById('modalTransfer');
    if (modal) {
        modal.style.display = 'block';
        setTimeout(() => { 
            if(document.getElementById('t_cod')) document.getElementById('t_cod').focus(); 
        }, 100);
    } else {
        alert("Error: No se encontró el panel de transferencias en el HTML.");
    }
}



function reiniciarFaltantes() {
    if (!confirm("⚠️ ¿Estás seguro de poner en CERO todos los contadores de 'Faltantes / Vendidos sin Stock' en esta sucursal?")) return;

    Object.keys(inv).forEach(k => {
        let p = inv[k];
        if (p.sold_without_stock && p.sold_without_stock[sucursalActual] > 0) {
            p.sold_without_stock[sucursalActual] = 0;
            // Lo enviamos a la nube para actualizar el registro
            if (typeof db !== 'undefined') {
                db.collection("inventario").doc(k).set(p).catch(e => console.error("Error al limpiar faltante:", e));
            }
        }
    });

    localStorage.setItem("pos_precision_v6", JSON.stringify(inv));
    if (typeof renderI === 'function') renderI();
    alert("✅ Faltantes reiniciados a 0 con éxito.");
}

window.toggleMayoreo = function() {
    forceWholesale = !forceWholesale; 
    let st = document.getElementById('v_mayoreo_status'); 
    if(st) { 
        st.innerText = forceWholesale ? "MAYOREO: ACTIVADO" : "MAYOREO: DESACTIVADO"; 
        st.style.background = forceWholesale ? "var(--warning)" : "#444"; 
        st.style.color = forceWholesale ? "#000" : "#bbb"; 
    } 
    window.renderV(); 
};

window.onkeydown = (e) => { 
    if(usuarioActual === "") return;
    if (e.key === 'F1') { e.preventDefault(); let btn = document.getElementById('btn_v-tab'); if (btn && window.getComputedStyle(btn).display !== 'none') btn.click(); return; }
    if (e.key === 'F2') { e.preventDefault(); let btn = document.getElementById('btn_c-tab'); if (btn && window.getComputedStyle(btn).display !== 'none') btn.click(); return; }
    if (e.key === 'F3') { e.preventDefault(); let btn = document.getElementById('btn_i-tab'); if (btn && window.getComputedStyle(btn).display !== 'none') btn.click(); return; }

    if (document.getElementById('modalBuscar').style.display === 'block') {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (focusSearchIndex < searchResultsList.length - 1) { focusSearchIndex++; renderTablaBuscador(); } return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (focusSearchIndex > 0) { focusSearchIndex--; renderTablaBuscador(); } return; }
        if (e.key === 'Enter') { e.preventDefault(); if (focusSearchIndex >= 0 && focusSearchIndex < searchResultsList.length) seleccionarBusqueda(searchResultsList[focusSearchIndex].cod); return; }
    }
    if (document.getElementById('modalPausadas').style.display === 'block') {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (focusPausadaIndex < pausadasFiltradas.length - 1) { focusPausadaIndex++; renderTablaPausadas(); } return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (focusPausadaIndex > 0) { focusPausadaIndex--; renderTablaPausadas(); } return; }
        if (e.key === 'Enter') { e.preventDefault(); if (pausadasFiltradas.length > 0) retomarVenta(pausadasFiltradas[focusPausadaIndex].idx); else cerrarModales(); return; }
    }

    let algunModalAbierto = document.querySelector('.modal[style*="display: block"]') || document.querySelector('.modal[style*="display: flex"]');
    
    // Lista Ventas
    if (tabActual === 'v-tab' && carV.length > 0 && !algunModalAbierto) {
        let aId = document.activeElement.id; let aTag = document.activeElement.tagName;
        if (aId === 'v_cod' || aTag === 'BODY') {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (focusVentaIndex < carV.length - 1) focusVentaIndex++; window.renderV(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (focusVentaIndex > 0) focusVentaIndex--; window.renderV(); return; }
            if (e.key === 'Delete') { e.preventDefault(); if (focusVentaIndex >= 0 && focusVentaIndex < carV.length && confirm(`⚠️ ¿Eliminar "${carV[focusVentaIndex].nom}"?`)) { carV.splice(focusVentaIndex, 1); if (focusVentaIndex >= carV.length) focusVentaIndex = carV.length - 1; window.renderV(); } return; }
            if (e.key === '+' || e.key === '-') {
                e.preventDefault(); let tIdx = focusVentaIndex > -1 ? focusVentaIndex : carV.length - 1;
                if (e.key === '+') { carV[tIdx].can++; window.renderV(); } 
                else if (carV[tIdx].can > 1) { carV[tIdx].can--; window.renderV(); } 
                else if (confirm(`⚠️ ¿Quitar "${carV[tIdx].nom}"?`)) { carV.splice(tIdx, 1); if (focusVentaIndex >= carV.length) focusVentaIndex = carV.length - 1; window.renderV(); }
                return;
            }
        }
    }
    
    // Lista Compras
    if (tabActual === 'c-tab' && carC.length > 0 && !algunModalAbierto) {
        let aId = document.activeElement.id; let aTag = document.activeElement.tagName;
        if (aId === 'c_cod' || aId === 'c_cant' || aTag === 'BODY') {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (focusCompraIndex < carC.length - 1) focusCompraIndex++; renderC(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (focusCompraIndex > 0) focusCompraIndex--; renderC(); return; }
            if (e.key === 'Delete') { e.preventDefault(); if (focusCompraIndex >= 0 && focusCompraIndex < carC.length && confirm(`⚠️ ¿Eliminar "${carC[focusCompraIndex].nom}"?`)) { carC.splice(focusCompraIndex, 1); if (focusCompraIndex >= carC.length) focusCompraIndex = carC.length - 1; renderC(); } return; }
            if (e.key === '+' || e.key === '-') {
                e.preventDefault(); let tIdx = focusCompraIndex > -1 ? focusCompraIndex : carC.length - 1;
                if (e.key === '+') { carC[tIdx].can++; renderC(); } 
                else if (carC[tIdx].can > 1) { carC[tIdx].can--; renderC(); } 
                else if (confirm(`⚠️ ¿Quitar "${carC[tIdx].nom}"?`)) { carC.splice(tIdx, 1); if (focusCompraIndex >= carC.length) focusCompraIndex = carC.length - 1; renderC(); }
                return;
            }
        }
    }

    // Lista Inventario
    if (tabActual === 'i-tab' && currentInvKeys.length > 0 && !algunModalAbierto) {
        let aId = document.activeElement.id; let aTag = document.activeElement.tagName;
        if (aId === 'buscar_inv' || aTag === 'BODY') {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (focusInvIndex < currentInvKeys.length - 1) focusInvIndex++; renderTablaInventario(); asegurarVisibilidadFila(); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); if (focusInvIndex > 0) focusInvIndex--; renderTablaInventario(); asegurarVisibilidadFila(); return; }
            if (e.key === 'Enter') { e.preventDefault(); if (focusInvIndex >= 0 && focusInvIndex < currentInvKeys.length) abrirEditar(currentInvKeys[focusInvIndex]); return; }
            if (e.key === '+') { e.preventDefault(); if (focusInvIndex >= 0 && focusInvIndex < currentInvKeys.length) abrirAjusteStock(currentInvKeys[focusInvIndex]); return; }
        }
    }

    // Modales Específicos
    if (document.getElementById('modalTicket').style.display === 'block') { 
        if (e.key === 'Enter') { e.preventDefault(); cerrarModales(); return; }
        if (e.key.toLowerCase() === 'p' || e.key === '+') { e.preventDefault(); imprimirTicket('ticket_print_area'); return; }
    }
    if (document.getElementById('modalVisor').style.display === 'block') { 
        if (e.key === 'Enter') { e.preventDefault(); cerrarModales(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); navVisor(1); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); navVisor(-1); return; }
        if (e.key.toLowerCase() === 'p') { e.preventDefault(); imprimirTicket('visor_print_area'); return; }
        if (e.key === 'Delete') { e.preventDefault(); anularVentaVisor(); return; }
    }
    if (document.getElementById('modalPromoAgotada').style.display === 'block') { if (e.key === 'Enter') { e.preventDefault(); cerrarModales(); return; } }
    if (document.getElementById('modalMovimiento').style.display === 'block') { if (e.key === 'Enter') { e.preventDefault(); guardarMovimiento(); return; } }
    
    // Producto No Encontrado
    let modalNoEncontrado = document.getElementById('modalProdNoEncontrado');
    if (modalNoEncontrado && (modalNoEncontrado.style.display === 'block' || modalNoEncontrado.style.display === 'flex')) {
        if (e.key === 'Enter') { e.preventDefault(); irARegistrarProdVenta(); return; } 
        else if (e.key === 'Escape') { e.preventDefault(); cerrarModalNoEncontrado(); return; }
    }

    // Teclas Globales
    if(e.key === 'F12') { e.preventDefault(); if(document.getElementById('v-tab').style.display === 'block') abrirCobro(); if(document.getElementById('c-tab').style.display === 'block') finalizarCompra(); }
    if(e.key === 'F9' && document.getElementById('v-tab').style.display === 'block') { e.preventDefault(); abrirVisorTickets(); }
    if(e.key === 'F8') { e.preventDefault(); preguntarPausar(); }
    if(e.key === 'F7') { e.preventDefault(); if(document.getElementById('v-tab').style.display === 'block') abrirPausadas(); }
    if(e.key === 'F4') { e.preventDefault(); window.toggleMayoreo(); }
    if(e.key === 'F10') { e.preventDefault(); abrirBuscador(); }
    if(e.key === 'Escape') { cerrarModales(); }
};

// ====================================================================
// === UTILIDADES VISUALES ===
// ====================================================================
function asegurarVisibilidadFila() {
    const fila = document.querySelector('tr[style*="background:#e0f0ff"]');
    if (fila) fila.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

window.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setTimeout(() => {
            let lista = document.getElementById('v_lista');
            if (lista && lista.offsetParent !== null && typeof focusVentaIndex !== 'undefined') {
                let filaEnfocada = lista.children[focusVentaIndex];
                if (filaEnfocada) filaEnfocada.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }
});

setInterval(() => {
    let vVisible = document.getElementById('v_lista') && document.getElementById('v_lista').offsetWidth > 0;
    let cVisible = document.getElementById('c_lista_tab') && document.getElementById('c_lista_tab').offsetWidth > 0;

    // Solo bloqueamos el scroll del fondo si estamos en la pantalla de ventas o compras para evitar rebotes
    if (vVisible || cVisible) {
        document.body.classList.add('bloquear-scroll');
    } else {
        document.body.classList.remove('bloquear-scroll');
    }
}, 500);



// ====================================================================
// === FUNCIONES ADAPTADAS PARA EL BUSCADOR DE COMPRA POR CAJA 📦 ===
// ====================================================================

// 1. FILTRAR LAS SUGERENCIAS EN TIEMPO REAL MIENTRAS ESCRIBES
function filtrarBusquedaCaja(e) {
    // Evitamos que las teclas de navegación activen la búsqueda innecesariamente
    if(e && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) return; 

    let txt = document.getElementById('caja_codigo').value.trim().toLowerCase();
    let sug = document.getElementById('caja_sugerencias');
    
    // Si el buscador está vacío, escondemos el panel
    if (txt.length === 0) {
        sug.style.display = 'none';
        return;
    }

    // 🧠 MAGIA: Separamos lo que escribes por espacios para buscar término por término
    let terminos = txt.split(/%|\s+/).filter(t => t.trim() !== "");
    let llaves = Object.keys(inv);
    let filtrados = [];

    for (let i = 0; i < llaves.length; i++) {
        let cod = llaves[i];
        let p = inv[cod];
        if (!p) continue;

        // Juntamos código y nombre en un solo texto para que busque en ambos simultáneamente
        let searchTarget = String(cod).toLowerCase() + " " + String(p.nom || '').toLowerCase();
        
        // Exigimos que TODOS los pedazos de palabras escritos estén en el producto, sin importar el orden
        let match = terminos.every(t => searchTarget.includes(t));
        
        if (match) {
            filtrados.push({ codigo: cod, nom: p.nom, piezas: p.md || 12, iva: p.iva || 0 });
            // Subimos el límite a 15 sugerencias para que tengas mejor visibilidad
            if (filtrados.length >= 15) break; 
        }
    }

    if (filtrados.length === 0) {
        sug.innerHTML = '<div style="padding:10px; color:#999; font-size:14px; text-align:center;">❌ No se encontró el producto</div>';
        sug.style.display = 'block';
        return;
    }

    let html = '';
    filtrados.forEach(p => {
        // Escudo de seguridad por si el nombre trae comillas simples (ej. "Gansito 1/2")
        let nomSeguro = (p.nom || '').replace(/'/g, "\\'"); 

        html += `<div onclick="seleccionarProductoCaja('${p.codigo}', '${nomSeguro}', ${p.piezas}, ${p.iva})" 
                     style="padding:10px; cursor:pointer; border-bottom:1px solid #eee; font-size:14px; color:#333; text-align:left;"
                     onmouseover="this.style.background='#f0f8ff'" 
                     onmouseout="this.style.background='white'">
                     <strong>${p.codigo}</strong> - ${p.nom}
                 </div>`;
    });

    sug.innerHTML = html;
    sug.style.display = 'block';
}

// 2. AUTOCOMPLETAR LOS CAMPOS CUANDO ELIGES UN PRODUCTO DE LA LISTA
function seleccionarProductoCaja(codigo, nombre, piezas, impuesto) {
    let p = inv[codigo] || {}; // 🔥 Rescatamos toda la info del catálogo
    
    document.getElementById('caja_codigo').value = codigo;
    document.getElementById('caja_nombre_prod').innerText = "✅ " + nombre;
    document.getElementById('caja_piezas').value = piezas;
    document.getElementById('caja_impuesto').value = impuesto;
    document.getElementById('caja_sugerencias').style.display = 'none';
    
    // 🔥 Cargamos su Precio de Venta y Ganancia reales que tenías guardados
    document.getElementById('caja_pv').value = parseFloat(p.pv || 0).toFixed(2);
    document.getElementById('caja_gan').value = p.gan || 30;
    
    // Saltamos automáticamente a la cantidad
    document.getElementById('caja_cantidad').focus();
    document.getElementById('caja_cantidad').select();
    
    // Forzamos el recálculo
    if (typeof calcularCaja === 'function') calcularCaja();
}
// ====================================================================
// === MÓDULO DE KARDEX DE INVENTARIO 📊 ===
// ====================================================================

// Registrar un movimiento en el Kardex (Función Interna Maestro)
function registrarEnKardex(productoCod, productoNom, tipoMov, cantidad, precio, costo) {
    let idKardex = Date.now() + Math.floor(Math.random() * 1000);
    let nuevoRegistro = {
        id: idKardex,
        timestamp: Date.now(),
        fecha: getFechaLocal(),
        hora: new Date().toLocaleTimeString(),
        codigo: productoCod,
        nombre: productoNom,
        tipo: tipoMov, // VENTA, COMPRA, EDICIÓN, AJUSTE, ANULACIÓN
        cantidad: parseFloat(cantidad) || 0,
        precio: parseFloat(precio) || 0,
        costo: parseFloat(costo) || 0,
        sucursal: sucursalActual,
        cajero: usuarioActual || "Admin"
    };

    // Mandamos directo a la colección de la nube
    if (typeof db !== 'undefined') {
        db.collection("kardex").doc(String(idKardex)).set(nuevoRegistro).catch(e => console.error("Error Kardex:", e));
    }
}

window.renderKardex = function() {
    try {
        console.log("Intentando dibujar el Kardex...");
        
        let selectSuc = document.getElementById('kardex_sucursal');
        
        // Protegemos la variable por si listaSucursales no existe aún
        let sucursalesSeguras = [];
        if (typeof listaSucursales !== 'undefined' && Array.isArray(listaSucursales)) {
            sucursalesSeguras = listaSucursales;
        }

        if (selectSuc && selectSuc.innerHTML === "") {
            selectSuc.innerHTML = '<option value="">📍 Todas las Sucursales</option>' + 
                sucursalesSeguras.map(s => `<option value="${s}">📍 ${s}</option>`).join('');
        }

        // Llamamos al filtro, pero verificamos que exista primero
        if (typeof filtrarKardex === 'function') {
            filtrarKardex();
        } else {
            console.warn("⚠️ La función filtrarKardex no existe en el código aún.");
        }
        
    } catch (error) {
        console.error("❌ Error mortal al dibujar el Kardex:", error);
        alert("Ocurrió un error al cargar el Kardex. Revisa la consola (F12).");
    }
};


// Filtrar el Kardex según los inputs del usuario
window.filtrarKardex = function() {
    try {
        // 🛡️ ESCUDO: Si historialKardex no existe o no tiene datos, no hacemos nada para no romper el sistema
        if (typeof historialKardex === 'undefined' || !Array.isArray(historialKardex)) {
            console.warn("⏳ Esperando datos del Kardex...");
            return;
        }

        let txtBusqueda = document.getElementById('kardex_buscar');
        let txt = txtBusqueda ? txtBusqueda.value.toLowerCase().trim() : "";
        
        let sucSelect = document.getElementById('kardex_sucursal');
        let sucFiltro = sucSelect ? sucSelect.value : "";
        
        let tipoSelect = document.getElementById('kardex_tipo');
        let tipoFiltro = tipoSelect ? tipoSelect.value : "";

        let registrosFiltrados = historialKardex.filter(reg => {
            let matchTxt = txt === "" || (reg.codigo && reg.codigo.toLowerCase().includes(txt)) || (reg.nombre && reg.nombre.toLowerCase().includes(txt));
            let matchSuc = sucFiltro === "" || reg.sucursal === sucFiltro;
            let matchTipo = tipoFiltro === "" || reg.tipo === tipoFiltro;
            return matchTxt && matchSuc && matchTipo;
        });

        let html = '';
        registrosFiltrados.slice(0, 150).forEach(reg => { // Limitamos a 150 filas por rendimiento visual
            let colorTipo = '#000';
            if (reg.tipo === 'VENTA') colorTipo = 'var(--s)';
            if (reg.tipo === 'COMPRA') colorTipo = '#17a2b8';
            if (reg.tipo === 'EDICIÓN') colorTipo = 'var(--p)';
            if (reg.tipo === 'AJUSTE') colorTipo = '#fd7e14';
            if (reg.tipo === 'ANULACIÓN') colorTipo = 'var(--danger)';

            let precioVentaSeguro = parseFloat(reg.precio) || 0;
            let costoSeguro = parseFloat(reg.costo) || 0;
            let cantidadSegura = parseFloat(reg.cantidad) || 0;

            html += `<tr style="border-bottom: 1px solid #eee;">
                <td style="padding:8px;">${reg.fecha} <br><small style="color:#888;">${reg.hora}</small></td>
                <td style="padding:8px;"><b>${reg.nombre}</b><br><small style="color:#666;">${reg.codigo}</small></td>
                <td style="padding:8px;"><span class="badge-kit" style="background:${colorTipo}; color:white; font-weight:bold;">${reg.tipo}</span></td>
                <td style="padding:8px; text-align:center; font-weight:bold;">${cantidadSegura > 0 ? '+' : ''}${cantidadSegura}</td>
                <td style="padding:8px; text-align:right;">$${precioVentaSeguro.toFixed(2)}</td>
                <td style="padding:8px; text-align:right; color:#666;">$${costoSeguro.toFixed(2)}</td>
                <td style="padding:8px;">📍 ${reg.sucursal}</td>
                <td style="padding:8px;">👤 ${reg.cajero}</td>
            </tr>`;
        });

        let tbody = document.getElementById('kardex_tabla_body');
        if (tbody) {
            tbody.innerHTML = html || `<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">No se encontraron movimientos.</td></tr>`;
        }

    } catch (error) {
        console.error("❌ Error interno en filtrarKardex:", error);
    }
};


// ====================================================================
// === 🚚 MÓDULO UNIFICADO: TRANSFERENCIAS Y RECEPCIONES 📥 ===
// ====================================================================

// ---------------------------------------------------------
// 1. ENVIAR MERCANCÍA (SALIDAS)
// ---------------------------------------------------------
function abrirTransferencia() { 
    carT = []; 
    document.getElementById('t_cod').value = ''; 
    document.getElementById('t_origen').value = sucursalActual; 
    document.getElementById('t_destino').value = ''; 
    document.getElementById('modalTransfer').style.display = 'block'; 
    renderT(); 
    setTimeout(() => document.getElementById('t_cod').focus(), 100); 
}

function filtrarBusquedaTransferencia(e) {
    if(e && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) return; 
    let inputTransf = document.getElementById('t_cod');
    if(!inputTransf) return;
    
    let texto = inputTransf.value.toLowerCase().trim();
    let contenedor = document.getElementById('t_sugerencias');

    if (texto.length < 2) { contenedor.style.display = 'none'; return; }

    let terminos = texto.split(' ').filter(t => t.trim() !== '');
    let html = ''; let limite = 0;
    let sucursalOrigen = document.getElementById('t_origen') ? document.getElementById('t_origen').value : sucursalActual;

    for (let cod in inv) {
        let prod = inv[cod];
        if (!prod) continue;

        let nombreLower = String(prod.nom || '').toLowerCase();
        let codLower = String(cod).toLowerCase();

        // Buscador Inteligente: Coincide sin importar el orden de las palabras
        let coincide = terminos.every(termino => nombreLower.includes(termino) || codLower.includes(termino));

        if (coincide && limite < 15) {
            let stockDisponible = prod.stock ? (prod.stock[sucursalOrigen] || 0) : 0;
            let colorStock = stockDisponible > 0 ? '#28a745' : '#dc3545'; 

            html += `<div style="padding:10px; border-bottom:1px solid #eee; cursor:pointer; color:#333; display:flex; justify-content:space-between;" 
                          onmousedown="seleccionarProdTransferencia('${cod}')" 
                          onmouseover="this.style.background='#e0f0ff'" 
                          onmouseout="this.style.background='white'">
                        <div><b>${prod.nom}</b><br><small style="color:#888;">Cód: ${cod}</small></div>
                        <div style="text-align:right; font-size:12px;">
                            <span style="color:#888;">Stock en ${sucursalOrigen}:</span><br>
                            <b style="color:${colorStock}; font-size:14px;">${stockDisponible}</b>
                        </div>
                     </div>`;
            limite++;
        }
    }
    contenedor.innerHTML = html === '' ? `<div style="padding:10px; color:#888; text-align:center;">No se encontraron productos</div>` : html;
    contenedor.style.display = 'block';
}

function seleccionarProdTransferencia(cod) {
    let input = document.getElementById('t_cod');
    input.value = cod;
    document.getElementById('t_sugerencias').style.display = 'none'; 
    addTransferToList(); 
    setTimeout(() => { input.value = ''; input.focus(); }, 100);
}

function addTransferToList() { 
    let cod = document.getElementById('t_cod').value.trim(); 
    let cant = parseFloat(document.getElementById('t_cant').value)||1; 
    
    if(!inv[cod]) return alert("❌ Producto no existe."); 
    if(inv[cod].tipo === 'kit') return alert("❌ Transfiera los componentes base del kit, no el kit armado."); 
    if(cant <= 0) return; 
    
    let idx = carT.findIndex(x => x.cod === cod); 
    if(idx > -1) {
        carT[idx].can += cant; 
    } else { 
        let cBase = inv[cod].cos || 0; 
        let cReal = cBase * (1 + (inv[cod].iva||0)/100); 
        carT.push({ cod, nom: inv[cod].nom, can: cant, cReal: cReal }); 
    } 
    document.getElementById('t_cod').value = ''; 
    document.getElementById('t_cant').value = '1'; 
    document.getElementById('t_cod').focus(); 
    renderT(); 
}

function renderT() { 
    let tArt = 0, tVal = 0, ori = document.getElementById('t_origen').value; 
    document.getElementById('t_lista_tab').innerHTML = carT.map((x, i) => { 
        let sub = x.can * x.cReal; 
        tArt += x.can; tVal += sub; 
        let stOri = (inv[x.cod].stock && inv[x.cod].stock[ori]) || 0; 
        let alertClass = stOri < x.can ? 'style="color:red; font-weight:bold;"' : ''; 
        return `<tr>
            <td>${x.nom}<br><small ${alertClass}>Stock actual en ${ori}: ${stOri}</small></td>
            <td><input type="number" value="${x.can}" style="width:60px; text-align:center;" onchange="carT[${i}].can=parseFloat(this.value)||1; renderT()"></td>
            <td style="color:var(--s); font-weight:bold;">$${x.cReal.toFixed(2)}</td>
            <td>$${sub.toFixed(2)}</td>
            <td><button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="carT.splice(${i},1);renderT()">✕</button></td>
        </tr>`; 
    }).join(''); 
    document.getElementById('t_total_art').innerText = tArt; 
    document.getElementById('t_total_val').innerText = tVal.toFixed(2); 
}

function ejecutarTransferencia() { 
    let ori = document.getElementById('t_origen').value; 
    let des = document.getElementById('t_destino').value; 
    
    if(ori === des) return alert("❌ El Origen y el Destino no pueden ser iguales."); 
    if(carT.length === 0) return alert("❌ El carrito de envíos está vacío."); 
    if(!confirm(`📦 ¿Confirmas el envío de mercancía hacia ${des}?`)) return; 
    
    let idEnvio = Date.now();
    let nuevaTransferencia = { 
        id: idEnvio, 
        fecha: new Date().toLocaleString(), 
        origen: ori, destino: des, 
        items: [...carT], 
        valor: document.getElementById('t_total_val').innerText, 
        total_art: document.getElementById('t_total_art').innerText,
        estado: 'pendiente', obs: '' 
    };
    
    // Descontamos stock del origen
    carT.forEach(x => { 
        if(!inv[x.cod].stock) inv[x.cod].stock = {}; 
        let dispOri = inv[x.cod].stock[ori] || 0; 
        inv[x.cod].stock[ori] = dispOri - x.can; 
        if(typeof db !== 'undefined') db.collection("inventario").doc(x.cod).set(inv[x.cod]);
        
        // Registrar en Kardex si la función existe
        if(typeof registrarEnKardex === 'function') {
            registrarEnKardex(x.cod, x.nom, "TRANSFERENCIA (SALIDA)", -x.can, inv[x.cod].pv||0, x.cReal);
        }
    }); 
    
    transferencias.push(nuevaTransferencia); 
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); 
    localStorage.setItem("pos_transferencias_v6", JSON.stringify(transferencias)); 
    if(typeof db !== 'undefined') db.collection("transferencias").doc(String(idEnvio)).set(nuevaTransferencia);

    alert(`✅ Envío creado exitosamente. Ya fue notificado a ${des}.`); 
    carT = []; renderI(); cerrarModales(); actualizarContadorRecepciones(); 
}

// ---------------------------------------------------------
// 2. RECIBIR MERCANCÍA (ENTRADAS - 2 PASOS)
// ---------------------------------------------------------
function actualizarContadorRecepciones() { 
    let contador = document.getElementById('lbl_recepciones_count');
    if (contador && typeof transferencias !== 'undefined') {
        contador.innerText = transferencias.filter(t => t.destino === sucursalActual && t.estado === 'pendiente').length; 
    }
}

// PASO A: Abre la lista general de transferencias pendientes


// PASO B: Abre el detalle de la transferencia seleccionada
function iniciarRecepcion(id) { 
    let t = transferencias.find(x => x.id === id); 
    if(!t) return; 
    
    idTransferenciaActual = id; 
    // Copiamos los items originales y creamos una variable nueva "can_rec" para que anotes lo que realmente llegó
    carR = t.items.map(item => ({...item, can_rec: item.can})); 
    
    document.getElementById('r_proc_folio').innerText = t.id; 
    document.getElementById('r_proc_obs').value = ""; 
    document.getElementById('r_proc_cod').value = ""; 
    
    cerrarModales(); 
    document.getElementById('modalProcesarRecepcion').style.display = 'block'; 
    renderR(); 
}

// Si llega algo extra que no estaba en el paquete original
function addExtraToRecepcion() { 
    let cod = document.getElementById('r_proc_cod').value.trim(); 
    let can = parseFloat(document.getElementById('r_proc_cant').value)||1; 
    if(!inv[cod]) return alert("❌ Código no existe en catálogo."); 
    if(inv[cod].tipo === 'kit') return alert("❌ No se pueden recibir kits armados, escanea las piezas sueltas."); 
    if(can <= 0) return; 
    
    let idx = carR.findIndex(x => x.cod === cod); 
    if(idx > -1) { 
        carR[idx].can_rec += can; 
    } else { 
        let cBase = inv[cod].cos || 0; 
        let cReal = cBase * (1 + (inv[cod].iva||0)/100); 
        // Se anota con can = 0 (no lo mandaron) pero can_rec = can (sí llegó)
        carR.push({ cod, nom: inv[cod].nom, can: 0, can_rec: can, cReal: cReal }); 
    } 
    document.getElementById('r_proc_cod').value = ''; 
    document.getElementById('r_proc_cant').value = '1'; 
    document.getElementById('r_proc_cod').focus(); 
    renderR(); 
}

// 1. Variables globales para la navegación con teclado
let focusRecepcionIndex = 0;
let pendientesTrans = [];

// PASO A: Abre la lista de transferencias y la enfoca
function abrirModalRecepciones() { 
    pendientesTrans = transferencias.filter(t => t.destino === sucursalActual && t.estado === 'pendiente'); 
    focusRecepcionIndex = 0; // Reinicia el cursor
    cerrarModales(); 
    document.getElementById('modalListRecepciones').style.display = 'block'; 
    renderListaRecepciones(); // Nueva función optimizada para teclado
}

function renderListaRecepciones() {
    let tbody = document.getElementById('r_lista_pendientes');
    if (!tbody) return;

    if (pendientesTrans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#888;">No hay envíos pendientes</td></tr>';
        return;
    }

    tbody.innerHTML = pendientesTrans.map((t, i) => {
        let isFocused = (i === focusRecepcionIndex);
        let bgRow = isFocused ? 'background:#e0f0ff; border-left: 4px solid var(--orange);' : '';
        
        return `<tr style="cursor:pointer; ${bgRow}" onclick="iniciarRecepcion(${t.id})">
            <td>${isFocused ? '👉 ' : ''}${t.fecha.split(',')[0]}<br><small style="color:#aaa">ID: ${t.id}</small></td>
            <td><b>${t.origen}</b></td>
            <td style="color:var(--s); font-weight:bold;">$${t.valor}</td>
            <td><span style="background:var(--warning); color:#000; padding:3px 6px; border-radius:4px; font-size:10px; font-weight:bold">PENDIENTE</span></td>
            <td><button tabindex="-1" style="background:var(--orange); color:white; border:none; padding:8px 15px; border-radius:5px; cursor:pointer; font-weight:bold;" onclick="event.stopPropagation(); iniciarRecepcion(${t.id})">Recibir (Enter)</button></td>
        </tr>`;
    }).join('');
}

// Modificamos la tabla de recibo para que puedas bajar con las flechas
function renderR() { 
    document.getElementById('r_proc_lista_tab').innerHTML = carR.map((x, i) => {
        let alertColor = x.can !== x.can_rec ? 'background:#fff3cd;' : ''; 
        return `<tr style="${alertColor}">
            <td><small style="color:#888">${x.cod}</small></td>
            <td><b>${x.nom}</b></td>
            <td style="color:#888; font-weight:bold; text-align:center;">${x.can}</td>
            <td>
                <input type="number" id="r_input_${i}" value="${x.can_rec}" style="width:70px; font-weight:bold; color:var(--p); text-align:center;" 
                onchange="carR[${i}].can_rec=parseFloat(this.value)||0; renderR(); setTimeout(()=>document.getElementById('r_input_${i}').focus(), 50);"
                onkeydown="navegarCantidadesRecepcion(event, ${i})">
            </td>
            <td><button tabindex="-1" style="background:var(--danger); color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;" onclick="carR.splice(${i},1);renderR()">✕</button></td>
        </tr>`;
    }).join(''); 
}

// El motor para saltar entre las casillas de "Cantidad Recibida"
function navegarCantidadesRecepcion(e, i) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        // Si hay una fila abajo, salta a ella. Si es la última, salta de regreso al buscador.
        if (i < carR.length - 1) document.getElementById('r_input_' + (i + 1)).focus();
        else document.getElementById('r_proc_cod').focus();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        // Si hay fila arriba, salta. Si es la primera, salta al buscador.
        if (i > 0) document.getElementById('r_input_' + (i - 1)).focus();
        else document.getElementById('r_proc_cod').focus();
    }
}
// Paso Final: Guardar recepción y sumar el stock
function confirmarRecepcion() { 
    let tIndex = transferencias.findIndex(x => x.id === idTransferenciaActual); 
    if(tIndex === -1) return; 
    if(!confirm("📥 ¿Confirmar el ingreso físico a tu inventario?")) return; 
    
    carR.forEach(x => { 
        if(x.can_rec > 0) { 
            if(!inv[x.cod].stock) inv[x.cod].stock = {}; 
            // Sumamos lo que "realmente llegó" (can_rec)
            inv[x.cod].stock[sucursalActual] = (inv[x.cod].stock[sucursalActual] || 0) + x.can_rec; 
            
            if(typeof db !== 'undefined') db.collection("inventario").doc(x.cod).set(inv[x.cod]);
            
            if(typeof registrarEnKardex === 'function') {
                registrarEnKardex(x.cod, x.nom, "TRANSFERENCIA (ENTRADA)", x.can_rec, inv[x.cod].pv||0, x.cReal);
            }
        } 
    }); 
    
    transferencias[tIndex].estado = 'completada'; 
    transferencias[tIndex].obs = document.getElementById('r_proc_obs').value; 
    transferencias[tIndex].items_recibidos = [...carR]; 
    
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); 
    localStorage.setItem("pos_transferencias_v6", JSON.stringify(transferencias)); 
    
    if(typeof db !== 'undefined') db.collection("transferencias").doc(String(idTransferenciaActual)).set(transferencias[tIndex]);

    alert("✅ Recepción completada. El stock se sumó correctamente a tu inventario."); 
    renderI(); cerrarModales(); actualizarContadorRecepciones(); 
}


// ====================================================================
// === 🛑 MÓDULO DE CIERRE DE CAJA (CORTE Z / X) ======================
// ====================================================================


// 1. UTILIDAD: Convierte los milisegundos de forma segura
window.formatearParaInput = function(milisegundos) {
    try {
        let fecha = new Date(Number(milisegundos));
        if (isNaN(fecha.getTime())) return ""; // Si la fecha es inválida, no explota
        let tzoffset = fecha.getTimezoneOffset() * 60000; 
        return new Date(fecha.getTime() - tzoffset).toISOString().slice(0, 16);
    } catch(e) {
        return "";
    }
};


// 🌟 FUNCIÓN PARA ABRIR/CERRAR INGRESOS EXTRA (Asegúrate de que esté en tu app.js)
window.toggleDetalleIngresos = function() {
    let div = document.getElementById('cc_detalle_ingresos');
    if (div) {
        div.style.display = div.style.display === 'none' ? 'block' : 'none';
    }
};


// 1. FUNCIÓN CORREGIDA: abrirCorteCaja (Fecha y hora actual por defecto ⏰)
window.abrirCorteCaja = async function() { 
    let selectMenu = document.getElementById('cc_filtro_cajero');
    let inputInicio = document.getElementById('cc_fecha_inicio');
    let inputFin = document.getElementById('cc_fecha_fin');

    if(inputInicio) inputInicio.onchange = function() { window.calcularTotalesCorte(); };
    if(inputFin) inputFin.onchange = function() { window.calcularTotalesCorte(); };

    document.getElementById('modalCorteCaja').style.display = 'block';

    let divResultado = document.getElementById('cc_resultado_cuadre');
    let btnConfirmar = document.querySelector('.btn-final[style*="var(--danger)"]');
    
    if (divResultado) {
        divResultado.innerText = "⏳ Sincronizando datos de la nube...";
        divResultado.style.background = "#e0f0ff";
        divResultado.style.color = "#007bff";
    }
    if (btnConfirmar) btnConfirmar.disabled = true;

    // DESCARGAMOS LA NUBE
    try {
        if (typeof pb !== 'undefined') {
            let records = await pb.collection('ventas').getFullList({ requestKey: null });
            let vNube = records.map(r => r.data);
            
            let mapa = {};
            ventas.forEach(v => mapa[v.id] = v);
            vNube.forEach(v => mapa[v.id] = v);
            ventas = Object.values(mapa).sort((a,b) => a.id - b.id);
        }
    } catch(e) {
        console.warn("Sin internet. Calculando local.");
    }
    
    if (btnConfirmar) btnConfirmar.disabled = false;

    // ARMAMOS LA LISTA DE CAJEROS
    if(selectMenu) {
        let htmlCajeros = '<option value="">👤 Todos los cajeros</option>';
        let cajerosActivos = new Set();

        if (typeof ventas !== 'undefined') {
            ventas.forEach(v => { if(v.cajero) cajerosActivos.add(v.cajero.trim()); });
        }
        if (typeof movimientos !== 'undefined') {
            movimientos.forEach(m => { if(m.cajero) cajerosActivos.add(m.cajero.trim()); });
        }
        
        if (usuarioActual && usuarioActual !== 'Admin') cajerosActivos.add(usuarioActual);

        [...cajerosActivos].forEach(c => htmlCajeros += `<option value="${c}">${c}</option>`);
        selectMenu.innerHTML = htmlCajeros;
        
        selectMenu.onchange = function() { window.calcularTotalesCorte(); };

        if (usuarioActual && usuarioActual !== 'Admin') {
            selectMenu.value = usuarioActual;
        }
    }

    // 🌟 AQUÍ ESTÁ EL CAMBIO SOLICITADO: Por defecto, la fecha/hora exacta de AHORITA MISMO
    let ahoraMilisegundos = Date.now();
    let inicioSugerido = ahoraMilisegundos;

    // Intentamos buscar si hay ventas de hoy para ajustar el inicio a la primera venta del día
    let dHOY = new Date(); dHOY.setHours(0,0,0,0);
    let ventasDeHoy = ventas.filter(v => Number(v.id) >= dHOY.getTime() && v.sucursal === sucursalActual && !v.anulada);
    
    if(ventasDeHoy.length > 0) {
        // Si hay ventas hoy, la sugerencia de inicio retrocede al momento de la primera venta de hoy
        inicioSugerido = Math.min(...ventasDeHoy.map(v => Number(v.id)));
    } else {
        // Si no hay ventas, sugerimos arrancar desde el inicio del día actual (00:00) por defecto
        inicioSugerido = dHOY.getTime();
    }

    // Llenamos las cajas con Día y Hora actuales
    if(inputInicio) inputInicio.value = window.formatearParaInput(inicioSugerido);
    if(inputFin) inputFin.value = window.formatearParaInput(ahoraMilisegundos);

    window.calcularTotalesCorte(); 
    
    setTimeout(() => {
        let primerBillete = document.querySelector('.calc-den');
        if(primerBillete) { primerBillete.focus(); primerBillete.select(); }
    }, 200);
};

// 2. FUNCIÓN: cambiarTipoCorte (Lógica inteligente unificada - SIN BOTONES FANTASMA)
window.cambiarTipoCorte = function() {
    try {
        let selectCajero = document.getElementById('cc_filtro_cajero');
        let cajeroSel = selectCajero ? selectCajero.value.trim() : "";
        let inputInicio = document.getElementById('cc_fecha_inicio');
        let inputFin = document.getElementById('cc_fecha_fin');

        let ahora = Date.now();
        
        if (cajeroSel !== "") {
            // SI HAY CAJERO: Buscamos su última venta después de su último corte
            let ultimoCorteId = 0;
            if (typeof historialCortesZ !== 'undefined') {
                let cortes = historialCortesZ.filter(c => c.cajero === cajeroSel);
                if (cortes.length > 0) ultimoCorteId = Math.max(...cortes.map(c => Number(c.id) || 0));
            }
            
            let ventasFiltradas = ventas.filter(v => Number(v.id) > ultimoCorteId && (v.cajero && v.cajero.trim() === cajeroSel) && v.sucursal === sucursalActual && !v.anulada);
            
            let inicioSugerido = ahora;
            let idsValidos = ventasFiltradas.map(v => Number(v.id)).filter(id => !isNaN(id) && id > 0);
            
            if (idsValidos.length > 0) {
                inicioSugerido = Math.min(...idsValidos);
            } else {
                let d = new Date(); d.setHours(0,0,0,0);
                inicioSugerido = d.getTime();
            }

            if(inputInicio) inputInicio.value = window.formatearParaInput(inicioSugerido);
            if(inputFin) inputFin.value = window.formatearParaInput(ahora);

        } else {
            // SI SON TODOS LOS CAJEROS: Sugerimos el día completo (00:00 a 23:59)
            let d = new Date(); d.setHours(0,0,0,0);
            if(inputInicio) inputInicio.value = window.formatearParaInput(d.getTime());
            
            let dFin = new Date(); dFin.setHours(23,59,59,999);
            if(inputFin) inputFin.value = window.formatearParaInput(dFin.getTime());
        }

        window.calcularTotalesCorte();
    } catch (e) {
        console.error("Error ajustando fechas:", e);
        window.calcularTotalesCorte(); 
    }
};

// 3. FUNCIÓN ACTUALIZADA: calcularTotalesCorte (Con lista de ingresos)
window.calcularTotalesCorte = function() {
    try {
        let cajeroSel = document.getElementById('cc_filtro_cajero') ? document.getElementById('cc_filtro_cajero').value.trim() : "";
        let inputInicio = document.getElementById('cc_fecha_inicio');
        let inputFin = document.getElementById('cc_fecha_fin');

        let msInicio = inputInicio && inputInicio.value ? new Date(inputInicio.value).getTime() : 0;
        let msFin = inputFin && inputFin.value ? new Date(inputFin.value).getTime() : Infinity;

        if (isNaN(msInicio)) msInicio = 0;
        if (isNaN(msFin)) msFin = Infinity;

        let ef=0, ta=0, trans=0, cr=0, totalVentas=0;
        
        ventas.forEach(v => {
            let cumpleCajero = (cajeroSel === "" || (v.cajero && v.cajero.trim() === cajeroSel));
            let cumpleFechas = (Number(v.id) >= msInicio && Number(v.id) <= msFin);
            
            if(!v.anulada && v.sucursal === sucursalActual && cumpleCajero && cumpleFechas) {
                let tVentaTicket = parseFloat(v.total) || 0;
                totalVentas += tVentaTicket;

                if (v.pagos && Array.isArray(v.pagos) && v.pagos.length > 0) {
                    v.pagos.forEach(p => {
                        let monto = parseFloat(p.montoAplicado) || 0;
                        if(p.metodo === 'Efectivo') ef += monto;
                        else if(p.metodo === 'Tarjeta') ta += monto;
                        else if(p.metodo === 'Transferencia') trans += monto;
                        else if(p.metodo === 'Crédito') cr += monto;
                    });
                } else {
                    let mStr = v.metodo || '';
                    if(mStr.includes('Efectivo')) ef += tVentaTicket;
                    else if(mStr.includes('Tarjeta')) ta += tVentaTicket;
                    else if(mStr.includes('Transferencia')) trans += tVentaTicket;
                    else if(mStr.includes('Crédito')) cr += tVentaTicket;
                }
            }
        });

        let ing_efectivo = 0, ret_efectivo = 0;
        let listaRetirosGastos = []; 
        let listaIngresosExtra = []; // 🌟 NUEVA LISTA

        movimientos.forEach(m => {
            let cumpleCajero = (cajeroSel === "" || (m.cajero && m.cajero.trim() === cajeroSel));
            let cumpleFechas = (Number(m.id) >= msInicio && Number(m.id) <= msFin);

            if(m.sucursal === sucursalActual && cumpleCajero && cumpleFechas) {
                if (m.motivo && m.motivo.includes("RETIRO POR CORTE")) return;

                let montoM = parseFloat(m.monto) || 0;
                if(m.tipo === 'Ingreso') {
                    ing_efectivo += montoM;
                    listaIngresosExtra.push(m); // 🌟 GUARDAMOS EL INGRESO
                } else if(m.tipo === 'Retiro') {
                    ret_efectivo += montoM;
                    listaRetirosGastos.push(m);
                }
            }
        });

        let efectivoEsperado = ef + ing_efectivo - ret_efectivo;

        currentCorteData = {
            ventasTotales: totalVentas,
            efectivoVentas: ef,
            tarjeta: ta,
            transferencia: trans,
            credito: cr,
            ingresos: ing_efectivo,
            retiros: ret_efectivo,
            esperado: efectivoEsperado,
            cajeroCorte: cajeroSel || "Todos",
            fechaInicio: inputInicio ? inputInicio.value : "",
            fechaFin: inputFin ? inputFin.value : ""
        };

        // 🌟 RENDERIZAMOS LA TABLA DE GASTOS
        let htmlGastos = listaRetirosGastos.map(g => `<tr><td>${g.hora}</td><td>${g.motivo}</td><td style="text-align:right; color:red;">-$${parseFloat(g.monto).toFixed(2)}</td></tr>`).join('');
        document.getElementById('cc_lista_gastos').innerHTML = htmlGastos || '<tr><td colspan="3" style="text-align:center; color:#888;">No hubo retiros</td></tr>';
        document.getElementById('cc_detalle_gastos').style.display = 'none'; 

        // 🌟 RENDERIZAMOS LA TABLA DE INGRESOS EXTRA
        let htmlIngresos = listaIngresosExtra.map(g => `<tr><td>${g.hora}</td><td>${g.motivo}</td><td style="text-align:right; color:#28a745;">+$${parseFloat(g.monto).toFixed(2)}</td></tr>`).join('');
        let tablaIng = document.getElementById('cc_lista_ingresos');
        if (tablaIng) tablaIng.innerHTML = htmlIngresos || '<tr><td colspan="3" style="text-align:center; color:#888;">No hubo ingresos extra</td></tr>';
        let detIng = document.getElementById('cc_detalle_ingresos');
        if (detIng) detIng.style.display = 'none'; 

        document.getElementById('cc_v_efectivo').innerText = "$" + ef.toFixed(2);
        document.getElementById('cc_v_ingresos').innerText = "+$" + ing_efectivo.toFixed(2);
        document.getElementById('cc_v_retiros').innerText = "-$" + ret_efectivo.toFixed(2);
        document.getElementById('cc_v_esperado').innerText = "$" + efectivoEsperado.toFixed(2);

        document.querySelectorAll('.calc-den').forEach(input => input.value = '');
        document.getElementById('cc_fisico').value = '';
        document.getElementById('cc_resultado_cuadre').innerText = '';
        document.getElementById('cc_resultado_cuadre').style.background = 'transparent';

    } catch (e) { console.error("Error calculando:", e); }
};
// Función para mostrar/ocultar los detalles de los gastos en el corte
window.toggleDetalleGastos = function() {
    let div = document.getElementById('cc_detalle_gastos');
    if (div) {
        div.style.display = div.style.display === 'none' ? 'block' : 'none';
    }
};
// Función para mostrar/ocultar los detalles de los INGRESOS en el corte
window.toggleDetalleIngresos = function() {
    let div = document.getElementById('cc_detalle_ingresos');
    if (div) {
        div.style.display = div.style.display === 'none' ? 'block' : 'none';
    }
};

// 4. FUNCIÓN: guardarCorteCaja (Limpia de variables viejas)
window.guardarCorteCaja = function() {
    let inputFisico = document.getElementById('cc_fisico').value;
    if (inputFisico === '') return alert("❌ Debes ingresar cuánto efectivo hay en caja.");
    
    let fisico = parseFloat(inputFisico) || 0;
    let esperado = currentCorteData.esperado;
    let diferencia = fisico - esperado;

    let nombreCorte = currentCorteData.cajeroCorte === "Todos" ? "General (Z)" : "Cajero (X)";

    if (!confirm(`¿Confirmas el Corte de Caja?\n\nEfectivo Esperado: $${esperado.toFixed(2)}\nEfectivo Real: $${fisico.toFixed(2)}\nDiferencia: $${diferencia.toFixed(2)}\n\n(Se imprimirá el ticket comprobante)`)) return;

    let lblTitulo = document.getElementById('tk_corte_titulo');
    if (lblTitulo) lblTitulo.innerText = `CORTE DE CAJA`;
    
    document.getElementById('tk_corte_fecha').innerText = getFechaLocal() + " " + new Date().toLocaleTimeString();
    
    let nombreCajeroImprimir = currentCorteData.cajeroCorte === "Todos" ? "Todas las cajas" : currentCorteData.cajeroCorte;
    document.getElementById('tk_corte_cajero').innerText = nombreCajeroImprimir;
    
    document.getElementById('tk_corte_vef').innerText = "$" + currentCorteData.efectivoVentas.toFixed(2);
    document.getElementById('tk_corte_vtar').innerText = "$" + currentCorteData.tarjeta.toFixed(2);
    document.getElementById('tk_corte_vtra').innerText = "$" + currentCorteData.transferencia.toFixed(2);
    document.getElementById('tk_corte_vcre').innerText = "$" + currentCorteData.credito.toFixed(2);
    document.getElementById('tk_corte_vtot').innerText = "$" + currentCorteData.ventasTotales.toFixed(2);

    document.getElementById('tk_corte_ing').innerText = "$" + currentCorteData.ingresos.toFixed(2);
    document.getElementById('tk_corte_ret').innerText = "$" + currentCorteData.retiros.toFixed(2);

    document.getElementById('tk_corte_esp').innerText = "$" + esperado.toFixed(2);
    document.getElementById('tk_corte_fis').innerText = "$" + fisico.toFixed(2);

    let divDif = document.getElementById('tk_corte_dif_caja');
    if (diferencia === 0) {
        divDif.innerHTML = `<span>DIFERENCIA:</span> <b>✅ CUADRE PERFECTO</b>`;
    } else if (diferencia > 0) {
        divDif.innerHTML = `<span>DIFERENCIA:</span> <b style="color:black;">SOBRANTE +$${diferencia.toFixed(2)}</b>`;
    } else {
        divDif.innerHTML = `<span>DIFERENCIA:</span> <b style="color:black;">FALTANTE -$${Math.abs(diferencia).toFixed(2)}</b>`;
    }

    let idCorte = Date.now();
    let objetoCorte = {
        id: idCorte, fecha: getFechaLocal(), hora: new Date().toLocaleTimeString(), cajero: currentCorteData.cajeroCorte,
        tipo: nombreCorte, sucursal: sucursalActual, ventas_totales: currentCorteData.ventasTotales,
        efectivo_ventas: currentCorteData.efectivoVentas, ingresos: currentCorteData.ingresos,
        gastos: currentCorteData.retiros, efectivo_esperado: esperado, efectivo_real: fisico, diferencia: diferencia
    };
    
    if (typeof historialCortesZ === 'undefined') window.historialCortesZ = [];
    historialCortesZ.push(objetoCorte);
    localStorage.setItem("pos_cortes_z_v1", JSON.stringify(historialCortesZ));

    cerrarModales();
    procesarRetiroCaja(fisico, `RETIRO POR CORTE CAJA (Fondo a caja fuerte)`);
    
    setTimeout(() => { imprimirTicket('ticket_corte_print_area'); }, 500);
};

window.sumarDenominaciones = function() {
    let totalFisico = 0;
    document.querySelectorAll('.calc-den').forEach(input => {
        let valorBillete = parseFloat(input.getAttribute('data-val'));
        let cantidad = parseFloat(input.value) || 0;
        totalFisico += (valorBillete * cantidad);
    });
    
    let fisicoInput = document.getElementById('cc_fisico');
    fisicoInput.value = totalFisico > 0 ? totalFisico.toFixed(2) : '';
    window.calcularDiferenciaCorte();
};

window.calcularDiferenciaCorte = function() {
    let fisico = parseFloat(document.getElementById('cc_fisico').value) || 0;
    let esperado = currentCorteData.esperado;
    let diferencia = fisico - esperado;
    
    let divResultado = document.getElementById('cc_resultado_cuadre');

    if (diferencia === 0) {
        divResultado.innerText = "✅ CAJA CUADRADA EXACTA ($0.00)";
        divResultado.style.background = "#d4edda";
        divResultado.style.color = "#155724";
    } else if (diferencia > 0) {
        divResultado.innerText = `⚠️ SOBRANTE DE CAJA: +$${diferencia.toFixed(2)}`;
        divResultado.style.background = "#fff3cd";
        divResultado.style.color = "#856404";
    } else {
        divResultado.innerText = `🚨 FALTANTE DE CAJA: -$${Math.abs(diferencia).toFixed(2)}`;
        divResultado.style.background = "#f8d7da";
        divResultado.style.color = "#721c24";
    }
};


// ====================================================================
// === 🧮 CÁLCULO DE COSTO PROMEDIO AUTOMÁTICO (PEPS/PROMEDIO) ========
// ====================================================================
window.aplicarCostoPromedio = function(cod, cantidadEntrante, costoCompraNuevo) {
    let item = inv[cod];
    if (!item) return;

    // 1. Obtenemos cuánto tenemos y a qué costo
    let stockActual = parseFloat(item.stock[sucursalActual]) || 0;
    if (stockActual < 0) stockActual = 0; // Si había negativos por errores, partimos de cero para no arruinar la matemática

    let costoActual = parseFloat(item.cos) || 0;
    let cantNueva = parseFloat(cantidadEntrante) || 0;
    let costoNuevo = parseFloat(costoCompraNuevo) || 0;

    // 2. Aplicamos la fórmula financiera de Costo Promedio
    let valorInventarioViejo = stockActual * costoActual;
    let valorInventarioNuevo = cantNueva * costoNuevo;
    let piezasTotales = stockActual + cantNueva;

    if (piezasTotales > 0) {
        let costoPromedio = (valorInventarioViejo + valorInventarioNuevo) / piezasTotales;
        
        // 3. Actualizamos el catálogo con el nuevo costo redondeado a 2 decimales
        item.cos = costoPromedio.toFixed(2);
        
        // 4. Lo mandamos a la Nube (PocketBase) para que todas las sucursales tengan el nuevo costo
        if(typeof db !== 'undefined') {
            db.collection("inventario").doc(cod).set(item).catch(e => console.warn("Error al subir costo promedio a la nube:", e));
        }
        
        console.log(`📦 Costo Promedio de [${item.nom}] actualizado a $${item.cos}`);
    }
};
// ==========================================
// 💳 INTEGRACIÓN MERCADO PAGO (POINT SMART)
// ==========================================

// 1. Cargar las credenciales al abrir la página
async function cargarConfigMP() {
    try {
        // Buscamos si ya hay una configuración guardada para esta sucursal
        const records = await pb.collection('config_mp').getFullList({
            filter: `sucursal = "${sucursalActual}"`
        });

        if (records.length > 0) {
            let config = records[0];
            document.getElementById('mp_activo').checked = config.activo;
            document.getElementById('mp_token').value = config.access_token || "";
            document.getElementById('mp_device').value = config.device_id || "";
            
            // Guardamos esto en la memoria local para usarlo rápido al cobrar
            localStorage.setItem("mp_config_" + sucursalActual, JSON.stringify(config));
        }
    } catch (err) {
        console.log("Aún no hay configuración de MP para esta sucursal o falta la tabla.");
    }
}

// 2. Guardar las credenciales en la nube
async function guardarConfigMP() {
    let activo = document.getElementById('mp_activo').checked;
    let token = document.getElementById('mp_token').value.trim();
    let device = document.getElementById('mp_device').value.trim();

    if (activo && (!token || !device)) {
        alert("⚠️ Si activas la conexión, debes llenar el Token y el Device ID.");
        return;
    }

    let data = {
        sucursal: sucursalActual,
        activo: activo,
        access_token: token,
        device_id: device
    };

    try {
        // Revisamos si actualizamos o creamos uno nuevo
        const records = await pb.collection('config_mp').getFullList({
            filter: `sucursal = "${sucursalActual}"`
        });

        if (records.length > 0) {
            await pb.collection('config_mp').update(records[0].id, data);
        } else {
            await pb.collection('config_mp').create(data);
        }
        
        localStorage.setItem("mp_config_" + sucursalActual, JSON.stringify(data));
        alert("✅ Configuración de Mercado Pago guardada correctamente.");
        
    } catch (err) {
        console.error(err);
        alert("❌ Error al guardar. Verifica que creaste la tabla 'config_mp' en PocketBase.");
    }
}

// Llama a esta función dentro de tu función inicial (la que arranca el sistema)
// cargarConfigMP();
// ==========================================
// 🚀 ORDEN DE COBRO A TERMINAL FÍSICA
// ==========================================

async function enviarCobroTerminal(montoCobro) {
    // 1. Leemos las claves secretas desde la memoria
    let configMP = JSON.parse(localStorage.getItem("mp_config_" + sucursalActual) || "{}");
    
    // Si no está activado o faltan datos, cancelamos el viaje y cobramos de forma manual
    if (!configMP.activo || !configMP.access_token || !configMP.device_id) {
        return false; 
    }

    // 2. ✨ EFECTO VISUAL MODERNIZADO (Mini-spinner y texto pequeño)
    const elTotal = document.getElementById('m_total');
    let lblTotalOriginal = elTotal.innerText; // Guardamos el monto original

    // Reducimos el tamaño de todo el contenedor temporalmente para el estado de carga
    elTotal.style.fontSize = "16px"; 
    elTotal.style.fontWeight = "normal";
    elTotal.style.color = "#009ee3"; // Azul Mercado Pago

    // Inyectamos la estructura con el texto forzado a ser pequeño y discreto
    elTotal.innerHTML = `
        <div class="loader-mp"></div>
        <span style="font-size: 13px !important; letter-spacing: 0.5px; font-weight: 500;">CONECTANDO TERMINAL...</span>
    `;

    // 3. 🌉 EL PUENTE PROXY: Envolvemos la URL para saltar el CORS de GitHub
    const urlOriginal = `https://api.mercadopago.com/point/integration-api/devices/${configMP.device_id}/payment-intents`;
    const url = `https://corsproxy.io/?${encodeURIComponent(urlOriginal)}`;
    
    // El paquete EXACTO y limpio que exige la terminal física (¡SIN DUPLICADOS!)
    const paqueteDeCobro = {
        amount: parseFloat(montoCobro),
        additional_info: {
            print_on_terminal: true, // Imprime el ticket solo en la maquinita
            external_reference: "Ticket-" + Math.floor(Math.random() * 10000)
        }
    };

    try {
        // 4. Disparamos la orden a la nube (a través del puente)
        const respuesta = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${configMP.access_token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(paqueteDeCobro)
        });

        const resultado = await respuesta.json();

        if (respuesta.ok) {
            // ¡ÉXITO! La terminal ya recibió la orden
            elTotal.innerText = "💳 PASE TARJETA";
            alert("✅ Orden enviada. Pídele al cliente que pase o inserte su tarjeta en la terminal.");
            return true;
        } else {
            // Hubo un error de Mercado Pago (ej. formato, terminal ocupada)
            console.error("Error MP:", resultado);
            elTotal.innerText = lblTotalOriginal;
            elTotal.style.color = "var(--s)";
            alert("❌ Error en la terminal: " + (resultado.message || "Revisa si está encendida."));
            return false;
        }
    } catch (error) {
        // Error de red general
        console.error("Fallo de red:", error);
        elTotal.innerText = lblTotalOriginal;
        elTotal.style.color = "var(--s)";
        alert("⚠️ Ocurrió un problema de conexión al intentar enviar el cobro a la terminal.");
        return false;
    }
}
// ==========================================
// 💳 INTEGRACIÓN GETNET (SANTANDER)
// ==========================================

// Cambiar visualmente los campos según lo que elija el usuario
window.toggleGetnetCampos = function() {
    let tipo = document.getElementById('gn_tipo').value;
    if (tipo === 'local') {
        document.getElementById('gn_campos_local').style.display = 'block';
        document.getElementById('gn_campos_nube').style.display = 'none';
    } else {
        document.getElementById('gn_campos_local').style.display = 'none';
        document.getElementById('gn_campos_nube').style.display = 'block';
    }
};

// Cargar la configuración de Getnet al abrir
async function cargarConfigGetnet() {
    try {
        const records = await pb.collection('config_getnet').getFullList({
            filter: `sucursal = "${sucursalActual}"`
        });

        if (records.length > 0) {
            let config = records[0];
            document.getElementById('gn_activo').checked = config.activo;
            document.getElementById('gn_tipo').value = config.tipo_conexion || "local";
            document.getElementById('gn_ip').value = config.ip_local || "";
            document.getElementById('gn_token').value = config.token_nube || "";
            document.getElementById('gn_device').value = config.device_id || "";
            
            toggleGetnetCampos(); // Ajustamos la vista
            localStorage.setItem("gn_config_" + sucursalActual, JSON.stringify(config));
        }
    } catch (err) {
        console.log("Aún no hay configuración de Getnet para esta sucursal.");
    }
}

// Guardar la configuración de Getnet
async function guardarConfigGetnet() {
    let activo = document.getElementById('gn_activo').checked;
    let tipo = document.getElementById('gn_tipo').value;
    let ip = document.getElementById('gn_ip').value.trim();
    let token = document.getElementById('gn_token').value.trim();
    let device = document.getElementById('gn_device').value.trim();

    if (activo) {
        if (tipo === 'local' && !ip) return alert("⚠️ Ingresa la Dirección IP de la terminal.");
        if (tipo === 'nube' && (!token || !device)) return alert("⚠️ Faltan datos de la conexión en la nube.");
    }

    let data = {
        sucursal: sucursalActual,
        activo: activo,
        tipo_conexion: tipo,
        ip_local: ip,
        token_nube: token,
        device_id: device
    };

    try {
        const records = await pb.collection('config_getnet').getFullList({
            filter: `sucursal = "${sucursalActual}"`
        });

        if (records.length > 0) {
            await pb.collection('config_getnet').update(records[0].id, data);
        } else {
            await pb.collection('config_getnet').create(data);
        }
        
        localStorage.setItem("gn_config_" + sucursalActual, JSON.stringify(data));
        alert("✅ Configuración de Getnet guardada correctamente.");
        
    } catch (err) {
        console.error(err);
        alert("❌ Error al guardar. Verifica que creaste la tabla 'config_getnet' en PocketBase.");
    }
}

// Llama a esta función dentro de tu función que arranca el sistema para que se carguen al iniciar
// cargarConfigGetnet();
// ==========================================
// 🚀 ORDEN DE COBRO A TERMINAL GETNET
// ==========================================

async function enviarCobroGetnet(montoCobro) {
    let configGN = JSON.parse(localStorage.getItem("gn_config_" + sucursalActual) || "{}");
    
    if (!configGN.activo) return false;

    // Efecto visual Santander
    let lblTotalOriginal = document.getElementById('m_total').innerText;
    document.getElementById('m_total').innerText = "⏳ GETNET...";
    document.getElementById('m_total').style.color = "#ec0000"; // Rojo Santander

    try {
        let url = "";
        let opciones = {};

        if (configGN.tipo_conexion === "local") {
            // 📡 CONEXIÓN RED LOCAL (Wi-Fi Directo a la IP)
            url = `http://${configGN.ip_local}/api/v1/payment`; // <- URL sujeta al manual
            opciones = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: parseFloat(montoCobro) })
            };
        } else {
            // ☁️ CONEXIÓN EN LA NUBE (Clover / Smart)
            url = `https://api.getnet.com/v1/devices/${configGN.device_id}/payment`; // <- URL sujeta al manual
            opciones = {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${configGN.token_nube}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ amount: parseFloat(montoCobro) })
            };
        }

        /* ⚠️ NOTA: Este fetch está comentado hasta tener el manual exacto de la terminal.
        Cuando lo tengas, solo quitamos las diagonales "//" de las dos líneas de abajo.
        
        const respuesta = await fetch(url, opciones);
        if (respuesta.ok) return true; 
        */

        // Simulador de fallo para obligar al cajero a confirmar manual mientras no tengamos el manual
        throw new Error("API de Getnet en espera de configuración manual.");

    } catch (error) {
        console.error("Fallo Getnet:", error);
        document.getElementById('m_total').innerText = lblTotalOriginal;
        document.getElementById('m_total').style.color = "var(--s)";
        return false;
    }
}
// ====================================================================
// 🔍 FUNCIÓN MAESTRA CONECTORA PARA EL BUSCADO GLOBAL
// ====================================================================
// ====================================================================
// 🔍 FUNCIÓN MAESTRA CONECTORA PARA EL BUSCADO GLOBAL
// ====================================================================
window.seleccionarBusqueda = function(cod) {
    try {
        // 1. Cerramos el modal de búsqueda inmediatamente
        let modalBuscar = document.getElementById('modalBuscar');
        if (modalBuscar) modalBuscar.style.display = 'none';

        // 🔍 DETECCIÓN DIRECTA EN PANTALLA:
        let panelCompras = document.getElementById('compras') || document.getElementById('c-tab');
        let estoyEnPestañaCompras = panelCompras && panelCompras.style.display !== 'none' && panelCompras.style.visibility !== 'hidden';

        let panelKits = document.getElementById('k-tab');
        let estoyEnPestañaKits = panelKits && panelKits.style.display !== 'none';

        let panelPromos = document.getElementById('pro-tab');
        let estoyEnPestañaPromos = panelPromos && panelPromos.style.display !== 'none';

        if (estoyEnPestañaCompras) {
            // 📥 INYECCIÓN EN COMPRAS
            let inputC = document.getElementById('c_cod');
            if (inputC) {
                inputC.value = cod;
                setTimeout(() => { if (typeof handleCompraScan === 'function') handleCompraScan({ key: 'Enter' }); }, 50);
            }
        } 
        else if (estoyEnPestañaKits) {
            // 📦 INYECCIÓN EN KITS (Componentes)
            let inputK = document.getElementById('k_comp_cod');
            if (inputK) {
                inputK.value = cod;
                // Si quieres que al seleccionar se agregue de inmediato o haga algo, puedes poner una función aquí. 
                // Por ahora solo llenará la cajita.
                inputK.focus();
            }
        }
        else if (estoyEnPestañaPromos) {
            // 🏷️ INYECCIÓN EN PROMOCIONES
            let inputP = document.getElementById('pr_cod');
            if (inputP) {
                inputP.value = cod;
                setTimeout(() => { if (typeof verificarProdPromo === 'function') verificarProdPromo(); }, 50);
            }
        }
        else {
            // 🛒 SI NO ESTÁ EN NINGUNA DE LAS ANTERIORES, PROCEDE CON VENTAS
            cerrarModales();
            
            let panelVentas = document.getElementById('ventas');
            let estoyEnVentas = panelVentas && panelVentas.style.display !== 'none';

            if (estoyEnVentas || tabActual === 'v-tab') {
                let inputV = document.getElementById('v_cod');
                if (inputV) inputV.value = cod;
                setTimeout(() => {
                    if (typeof handleVenta === 'function') handleVenta({ key: 'Enter' });
                }, 50);
            } 
        }
    } catch (e) {
        console.error("❌ Error en seleccionarBusqueda:", e);
    }
};
// ====================================================================
// === 💸 NAVEGACIÓN RÁPIDA POR TECLADO PARA LA CALCULADORA ========
// ====================================================================

// 1. Interceptamos las teclas cuando el cajero escribe en la calculadora
document.addEventListener('keydown', function(e) {
    // Verificamos si estamos escribiendo dentro de un cuadrito de denominación (.calc-den)
    if (e.target && e.target.classList.contains('calc-den')) {
        let inputs = Array.from(document.querySelectorAll('.calc-den'));
        let index = inputs.indexOf(e.target);

        // Si presiona ENTER, Flecha Abajo o Flecha Derecha (Avanzar)
        if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault(); // Evitamos que la pantalla brinque
            
            if (index < inputs.length - 1) {
                // Brinca al siguiente billete/moneda y selecciona el texto
                inputs[index + 1].focus();
                inputs[index + 1].select();
            } else {
                // Si ya está en la última moneda ($0.50) y da Enter, salta al campo manual de EFECTIVO FÍSICO
                let campoFisico = document.getElementById('cc_fisico');
                if (campoFisico) { 
                    campoFisico.focus(); 
                    campoFisico.select(); 
                }
            }
        }
        // Si presiona Flecha Arriba o Flecha Izquierda (Retroceder)
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            if (index > 0) {
                // Regresa al billete anterior y selecciona el texto
                inputs[index - 1].focus();
                inputs[index - 1].select();
            }
        }
    }
});

// 2. Le damos un "empujoncito" a tu función original para que enfoque el primer billete automáticamente
let abrirCorteOriginal = window.abrirCorteCaja;
window.abrirCorteCaja = function() {
    // Ejecuta todo lo que tu función original ya hacía perfectamente
    if(typeof abrirCorteOriginal === 'function') abrirCorteOriginal();
    
    // Y le agregamos este pequeño extra: colocar el cursor en los billetes de $1000
    setTimeout(() => {
        let primerBillete = document.querySelector('.calc-den');
        if(primerBillete) {
            primerBillete.focus();
            primerBillete.select();
        }
    }, 200); // Le damos 200ms para asegurar que el modal ya se abrió visualmente
};
// ====================================================================
// === ⚓ SEGURO ANTI-SALTOS Y REPARACIÓN DEL MENÚ SUPERIOR ============
// ====================================================================

// 1. Sobreescribimos la función rebelde para que no jale la pantalla hacia abajo
function cerrarModales() { 
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none'); 
    setTimeout(() => { 
        // El secreto está en el "preventScroll: true"
        if(tabActual === 'v-tab') {
            let inputV = document.getElementById('v_cod');
            if(inputV) inputV.focus({ preventScroll: true }); 
        }
        if(tabActual === 'c-tab') {
            let inputC = document.getElementById('c_cod');
            if(inputC) inputC.focus({ preventScroll: true }); 
        }
    }, 150); 
}

// 2. Obligamos a la pantalla a quedarse en la coordenada 0 (hasta arriba) al recargar
window.addEventListener('load', () => {
    setTimeout(() => window.scrollTo(0, 0), 50);
    setTimeout(() => window.scrollTo(0, 0), 150);
    setTimeout(() => window.scrollTo(0, 0), 300);
});