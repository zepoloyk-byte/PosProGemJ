// ====================================================================
// === 1. CONEXIÓN A POCKETBASE EN LA NUBE ===
// ====================================================================
const pb = new PocketBase('https://sexy-starling.pikapod.net');
pb.autoCancellation(false);

// ====================================================================
// === 2. ADAPTADOR POCKETBASE (MOTOR BLINDADO ANTI-RESET Y ANTI-CLONES) ===
// ====================================================================
// ====================================================================
// === 2. ADAPTADOR POCKETBASE (MOTOR BLINDADO ANTI-RESET Y ANTI-CLONES) ===
// ====================================================================
// ====================================================================
// === ADAPTADOR FIREBASE -> POCKETBASE (SINTAXIS Y LLAVES VERIFICADAS) ===
// ====================================================================
const db = {
    enablePersistence: () => Promise.resolve(),
    collection: function(colName) {
        return {
            get: async function() {
                try {
                    let records = await pb.collection(colName).getFullList({ requestKey: null });
                    let mapa = {}; records.forEach(r => mapa[r.doc_id || r.id] = r);
                    return { forEach: (cb) => Object.values(mapa).forEach(r => cb({ id: r.doc_id || r.id, data: () => r.data || r })) };
                } catch(e) { console.error(e); return { forEach: ()=>{} }; }
            },
            
            onSnapshot: async function(callback) {
                let intentando = false;
                let iniciarRadar = async () => {
                    if(intentando) return;
                    intentando = true;
                    try {
                        let cache = await pb.collection(colName).getFullList({ requestKey: null });
                        let mapa = {}; 
                        cache.forEach(r => { let key = r.doc_id || r.id; mapa[key] = r; });
                        cache = Object.values(mapa); 
                        
                        let emit = () => { 
                            callback({ 
                                forEach: (cb) => cache.forEach(r => {
                                    let key = r.doc_id || r.id;
                                    let dataObj = (r.data && typeof r.data === 'object') ? r.data : r;
                                    cb({ id: key, data: () => dataObj });
                                }) 
                            }); 
                        };
                        emit(); 
                        
                        pb.collection(colName).subscribe('*', function(e) {
                            let key = e.record.doc_id || e.record.id;
                            if (e.action === 'create' || e.action === 'update') {
                                let idx = cache.findIndex(x => (x.doc_id || x.id) === key);
                                if (idx > -1) cache[idx] = e.record; 
                                else cache.push(e.record); 
                            } else if (e.action === 'delete') {
                                cache = cache.filter(x => (x.doc_id || x.id) !== key);
                            }
                            emit();
                        });
                    } catch (e) { 
                        intentando = false;
                        if (e.status === 404 || e.status === 403) {
                            console.warn(`⚠️ Radar de [${colName}] pausado. Revisa permisos (API Rules) o si la colección existe.`);
                        } else {
                            console.warn(`📡 Sin internet para radar de [${colName}]. Reintentando en 5s...`);
                            setTimeout(iniciarRadar, 5000); 
                        }
                    }
                };
                iniciarRadar();
            },
            
            orderBy: function(field, direction) {
                return {
                    get: async function() {
                        try {
                            let records = await pb.collection(colName).getFullList({ requestKey: null });
                            let mapa = {}; records.forEach(r => mapa[r.doc_id || r.id] = r);
                            let unicos = Object.values(mapa);
                            unicos.sort((a, b) => {
                                let dataA = a.data || a, dataB = b.data || b;
                                let valA = dataA[field], valB = dataB[field];
                                if (valA < valB) return direction === 'desc' ? 1 : -1;
                                if (valA > valB) return direction === 'desc' ? -1 : 1;
                                return 0;
                            });
                            return { forEach: (cb) => unicos.forEach(r => cb({ id: r.doc_id || r.id, data: () => r.data || r })) };
                        } catch(e) { return { forEach: ()=>{} }; }
                    }
                };
            },
            
            doc: function(docId) {
    docId = String(docId).trim();
    return {
        set: async function(dataObj) {
            dataObj.updatedAt = Date.now();
            
            // 1. Guardado visual inmediato (RAM)
            if (colName === "inventario" && typeof inv !== 'undefined') {
                inv[docId] = dataObj;
                try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e){}
            }

            let reintentos = 3;
            for (let i = 1; i <= reintentos; i++) {
                try {
                    // LLAVE ÚNICA: Evita que PocketBase bloquee las ventas rápidas
                    let llaveUnica = `${colName}_${docId}_${Date.now()}_${Math.random()}`;

                    let record = null;
                    try { 
                        record = await pb.collection(colName).getFirstListItem(`doc_id="${docId}"`, { requestKey: llaveUnica + "_busca" }); 
                    } catch (e) {}

                    let limpio = JSON.parse(JSON.stringify(dataObj));
                    delete limpio.id; delete limpio.collectionId; delete limpio.collectionName; 
                    delete limpio.created; delete limpio.updated;
                    if (limpio.data) delete limpio.data;

                    let payload = {
                        doc_id: docId,
                        data: limpio
                    };

                    if (record) {
                        await pb.collection(colName).update(record.id, payload, { requestKey: llaveUnica + "_upd" });
                    } else {
                        await pb.collection(colName).create(payload, { requestKey: llaveUnica + "_cre" });
                    }
                    
                    return true; 

                } catch (error) {
                    let esSuperpuesta = (error.isAbort || error.status === 0 || JSON.stringify(error.response || {}) === "{}");
                    
                    // Reintento silencioso en caso de choque
                    if (esSuperpuesta && i < reintentos) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                        continue; 
                    }

                    // 🌟 MODO SILENCIOSO: Va a la mochila sin molestar con alertas
                    let motivo = error.response ? JSON.stringify(error.response.data || error.response) : error.message;
                    console.warn(`📦 Guardado en Mochila Offline [${colName} -> ${docId}]. Motivo: ${motivo || 'Fallo de red'}`);
                    
                    let mochila = JSON.parse(localStorage.getItem("pos_mochila")) || [];
                    mochila = mochila.filter(m => !(m.col === colName && m.id === docId));
                    mochila.push({ col: colName, id: docId, data: dataObj });
                    localStorage.setItem("pos_mochila", JSON.stringify(mochila));
                    
                    return false; 
                }
            }
        },

        onSnapshot: async function(callback) {
            let emit = (exists, data) => callback({ exists, data: () => data });
            let intentandoDoc = false;
            let iniciarRadarDoc = async () => {
                if(intentandoDoc) return;
                intentandoDoc = true;
                try {
                    let record = await pb.collection(colName).getFirstListItem(`doc_id="${docId}"`);
                    emit(true, record.data || record);
                    pb.collection(colName).subscribe('*', function(e) {
                        if ((e.record.doc_id || e.record.id) === docId) {
                            if (e.action === 'delete') emit(false, {});
                            else emit(true, e.record.data || e.record);
                        }
                    });
                } catch (e) { 
                    intentandoDoc = false;
                    if(e.status === 404) { emit(false, {}); } 
                    else { setTimeout(iniciarRadarDoc, 5000); } 
                }
            };
            iniciarRadarDoc();
        }
    };
}
        };
    }
};
                            
// ==========================================
// 📦 DESCONTAR STOCK CORREGIDO (CON TIMESTAMP)
// ==========================================
function descontarStock(cod, cant) { 
    let itemOriginal = inv[cod] || {}; 
    let codMaestro = (itemOriginal.grupo && inv[itemOriginal.grupo]) ? itemOriginal.grupo : cod;
    let itemMaestro = inv[codMaestro] || itemOriginal;
    
    if (!itemMaestro) return; 
    
    // Normalizamos el objeto de stock por sucursal
    if (typeof itemMaestro.stock !== 'object' || itemMaestro.stock === null || Array.isArray(itemMaestro.stock)) {
        let stockNumerico = parseFloat(itemMaestro.stock) || parseFloat(itemMaestro.existencia) || parseFloat(itemMaestro.can) || 0;
        itemMaestro.stock = {};
        itemMaestro.stock[sucursalActual] = stockNumerico;
    }

    if (!itemMaestro.sold_without_stock) itemMaestro.sold_without_stock = {}; 
    
    let disp = Math.max(0, parseFloat(itemMaestro.stock[sucursalActual]) || 0); 
    let cantRestar = parseFloat(cant) || 0;

    if (disp >= cantRestar) { 
        itemMaestro.stock[sucursalActual] = parseFloat((disp - cantRestar).toFixed(3)); 
    } else { 
        let fal = cantRestar - disp; 
        itemMaestro.stock[sucursalActual] = 0; 
        itemMaestro.sold_without_stock[sucursalActual] = parseFloat(((parseFloat(itemMaestro.sold_without_stock[sucursalActual]) || 0) + fal).toFixed(3)); 
    } 
    
    // 🌟 MARCA DE TIEMPO OBLIGATORIA: Invalida el caché viejo de la nube
    itemMaestro.updatedAt = Date.now();
    inv[codMaestro] = itemMaestro;
    
    // Guardado directo en PocketBase
    if (typeof db !== 'undefined') {
        db.collection("inventario").doc(String(codMaestro)).set(itemMaestro)
            .then(() => console.log(`✅ Stock de [${codMaestro}] actualizado en la nube.`))
            .catch(e => console.error("❌ Error al guardar venta en la nube:", e));
    }
}
// ====================================================================
// === EL CARTERO SILENCIOSO BLINDADO (OFFLINE SYNC CORREGIDO) ===
// ====================================================================
let tiempoInactividad = 0;
let revisarPorInactividad = null;
let vaciandoMochila = false;

async function vaciarMochilaRezagada() {
    if (!navigator.onLine || vaciandoMochila) return;
    vaciandoMochila = true; 
    
    try {
        let mochila = JSON.parse(localStorage.getItem("pos_mochila")) || [];
        if (mochila.length === 0) return;

        let clientePB = typeof pb !== 'undefined' ? pb : (typeof db !== 'undefined' ? db : null);
        if (!clientePB) return;

        while (mochila.length > 0 && navigator.onLine) {
            let tarea = mochila[0];
            
            // 1. Mapeo de colecciones obsoletas para evitar Error 404
            let colLimpia = tarea.col === 'productos' ? 'inventario' : tarea.col;
            let docId = String(tarea.id).trim();

            try {
                let record = null;
                try { 
                    record = await clientePB.collection(colLimpia).getFirstListItem(`doc_id="${docId}"`); 
                } catch(e){}

                // 2. Limpieza de metadatos internos
                let dataObj = tarea.data || {};
                let limpio = typeof dataObj === 'object' ? JSON.parse(JSON.stringify(dataObj)) : {};
                delete limpio.id; delete limpio.collectionId; delete limpio.collectionName; 
                delete limpio.created; delete limpio.updated;

                // 3. Empaquetado esparcido para actualizar columnas reales de PocketBase
                let payload = {
                    ...limpio,
                    doc_id: docId,
                    data: limpio
                };

                if (record) {
                    await clientePB.collection(colLimpia).update(record.id, payload);
                } else {
                    await clientePB.collection(colLimpia).create(payload);
                }

                // 4. Si tuvo éxito, lo quitamos de la cola
                mochila.shift(); 
                localStorage.setItem("pos_mochila", JSON.stringify(mochila));
                console.log(`✅ Cartero: Paquete rezagado sincronizado (${colLimpia} -> ${docId})`);

            } catch(e) {
                console.warn(`⚠️ Cartero: Paquete descartado por error de formato en [${colLimpia} -> ${docId}]:`, e);
                // 🚀 CLAVE ANTI-BLOQUEO: Si el paquete da error (ej. 400/404), se descarta para NO trabar la cola
                mochila.shift(); 
                localStorage.setItem("pos_mochila", JSON.stringify(mochila));
            }
        }
    } catch(errGeneral) {
        console.error("Error general en el cartero silencioso:", errGeneral);
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
let filtroTopActual = 'cantidad'; // Valor por defecto

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
        let idLimpio = String(doc.id).trim();
        let datosNube = normalizarProducto(doc.data());
        let datosLocales = inv[idLimpio] ? normalizarProducto(inv[idLimpio]) : null;

        // Protección de cambios locales recientes
        if (datosLocales && datosLocales.updatedAt > datosNube.updatedAt) {
            datosLocales.stock = datosNube.stock;
            datosLocales.sold_without_stock = datosNube.sold_without_stock;
            inv[idLimpio] = datosLocales;
            return;
        }

        inv[idLimpio] = datosNube; 
    });
    
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv));
    if (typeof tabActual !== 'undefined' && tabActual === 'i-tab' && typeof renderI === 'function') renderI(); 
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
    
    // 💾 PARCHE 1: Respaldo inmediato en disco duro (Offline)
    localStorage.setItem("pos_clientes_v7", JSON.stringify(clientes));
    
    actualizarSelectClientesCobro();
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

// 🚀 RADAR ULTRARRÁPIDO DE VENTAS (Cero demoras al abrir)
// 🚀 RADAR ULTRARRÁPIDO DE VENTAS CORREGIDO
async function iniciarRadarVentasVeloz() {
    let mapa = {};
    
    // 🛡️ 1. Primero cargamos lo local de inmediato para tener datos en pantalla y que no se quede en cero
    let ventasLocales = JSON.parse(localStorage.getItem("pos_ventas_v6") || "[]");
    ventasLocales.forEach(v => { if(v && v.id) mapa[v.id] = v; });
    ventas = Object.values(mapa).sort((a,b) => a.id - b.id);
    if (typeof renderCorte === 'function') renderCorte();

    try {
        let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).substring(0, 10);
        
        console.log("☁️ Descargando ventas del día:", hoy);

        // 👇 SOLUCIÓN: Comillas simples ('') alrededor de ${hoy}
        let records = await pb.collection('ventas').getFullList({
            filter: `data.fecha >= '${hoy}'`, 
            requestKey: null
        });

        console.log("☁️ Registros recibidos:", records.items.length);

        records.items.forEach(r => {
            // Conservamos los datos Y el ID real del documento
            let ticketNube = {
                ...(r.data || {}),
                id: r.doc_id || r.id || (r.data ? r.data.id : null)
            };

            if (!ticketNube.id) {
                console.warn("⚠️ Ticket sin ID, se ignora:", r);
                return;
            }

            if (!ventas.some(vLocal => String(vLocal.id) === String(ticketNube.id))) {
                ventas.push(ticketNube);
            }
        });

        console.log("📦 Ventas después de descarga:", ventas.length);
        if (typeof renderCorte === 'function') renderCorte();

    } catch (e) {
        console.error("❌ Error al auto-descargar el día en radar:", e);
    }

    // 📡 Mantenemos la oreja parada para ventas nuevas en vivo
    pb.collection("ventas").subscribe('*', function(e) {
        if (e.action === 'create' || e.action === 'update') {
            if (e.record && e.record.data) {
                let idx = ventas.findIndex(x => String(x.id) === String(e.record.data.id));
                if (idx > -1) ventas[idx] = e.record.data;
                else ventas.push(e.record.data);
            }
        } else if (e.action === 'delete') {
            if (e.record && e.record.data) {
                ventas = ventas.filter(x => String(x.id) !== String(e.record.data.id));
            }
        }
        localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas.slice(-300))); // RAM ligera
        if (tabActual === 'r-tab' && typeof renderCorte === 'function') renderCorte();
    });
}
iniciarRadarVentasVeloz();
// Compras (Radar Inmune a pérdida de IDs en PikaPod)
db.collection("compras").onSnapshot((querySnapshot) => {
    let nuevasCompras = [];
    
    querySnapshot.forEach((doc) => { 
        let data = typeof doc.data === 'function' ? doc.data() : doc;
        if (data) {
            // 🛡️ REPARACIÓN MÁGICA: Si PikaPod borró el ID, se lo inyectamos de vuelta a la fuerza
            data.id = data.id || data.doc_id || doc.id;
            data.doc_id = data.doc_id || doc.id;
            nuevasCompras.push(data);
        }
    });
    
    compras = nuevasCompras.sort((a,b) => a.id - b.id);
    try { localStorage.setItem("pos_compras_local", JSON.stringify(compras)); } catch(e){}
    
    if (document.getElementById('modalVisorCompras') && document.getElementById('modalVisorCompras').style.display === 'block') {
        if(typeof filtrarVisorCompras === 'function') filtrarVisorCompras();
    }
});

// Transferencias (Radar Inmune a pérdida de IDs en PikaPod)
db.collection("transferencias").onSnapshot((querySnapshot) => {
    let nuevasTransferencias = [];
    
    querySnapshot.forEach((doc) => { 
        let data = typeof doc.data === 'function' ? doc.data() : doc;
        if (data) {
            // 🛡️ REPARACIÓN MÁGICA: Si PikaPod borró el ID del JSON, se lo inyectamos de vuelta a la fuerza
            data.id = data.id || data.doc_id || doc.id;
            data.doc_id = data.doc_id || doc.id;
            nuevasTransferencias.push(data);
        }
    });
    
    transferencias = nuevasTransferencias.sort((a,b) => a.id - b.id);
    try { localStorage.setItem("pos_transferencias_v6", JSON.stringify(transferencias)); } catch(e){}
    
    if (typeof actualizarContadorRecepciones === 'function') actualizarContadorRecepciones();
    
    // Si tienes la ventana de envíos abierta, que se refresque solita y le quite lo "Corrupto"
    let modal = document.getElementById('modalListRecepciones');
    if (modal && (modal.style.display === 'block' || modal.style.display === 'flex')) {
        if (typeof renderListaRecepciones === 'function') renderListaRecepciones();
    }
});
// Compras Pausadas
let comprasPausadas = JSON.parse(localStorage.getItem('pos_compras_pausadas')) || [];
db.collection("compras_pausadas").onSnapshot((querySnapshot) => {
    comprasPausadas = [];
    querySnapshot.forEach((doc) => { comprasPausadas.push(doc.data()); });
    localStorage.setItem('pos_compras_pausadas', JSON.stringify(comprasPausadas));
    if (typeof actualizarBadgeComprasPausadas === 'function') actualizarBadgeComprasPausadas();
});


// =========================================================
// 🟢 RADAR ÚNICO DE VENTAS PAUSADAS
// CONSERVA TODAS LAS SUCURSALES
// =========================================================
db.collection("pausadas").onSnapshot((querySnapshot) => {
    // console.log("📡 RADAR PAUSADAS ACTIVADO");
    
    let nuevasPausadas = [];
    if (!querySnapshot) return;

    querySnapshot.forEach((doc) => {
        let venta = typeof doc.data === "function" ? doc.data() : doc;
        if (!venta) return;
        
        // Blindaje de seguridad para asegurar que el ID siempre exista
        if (!venta.id) venta.id = doc.id;
        
        nuevasPausadas.push(venta);
    });

    // 🌟 1. RESTAURAMOS EL PUENTE
    pausadas = nuevasPausadas;

    // 🌟 2. GUARDAMOS EL RESPALDO LOCAL
    localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas));

    // 🌟 3. AVISAMOS A LA PANTALLA QUE ACTUALICE EL CONTADOR
    if (typeof actualizarContadorPausadas === 'function') {
        actualizarContadorPausadas();
    }

    // 🌟 4. SI EL MODAL ESTÁ ABIERTO, LO REDIBUJAMOS EN TIEMPO REAL
    let modal = document.getElementById('modalPausadas');
    if (modal && modal.style.display === 'block' && typeof abrirPausadas === 'function') {
        // Ejecutamos abrirPausadas() pasivamente para que aplique los filtros de sucursal
        let sucLimpia = String(typeof sucursalActual !== 'undefined' ? sucursalActual : '').replace(/📍/g, '').trim();
        pausadasFiltradas = pausadas.filter(p => {
            if(!p || p.nom === "FANTASMA") return false;
            if(!p.sucursal) return true;
            return (String(p.sucursal).replace(/📍/g, '').trim() === sucLimpia);
        });
        if (typeof renderTablaPausadas === 'function') renderTablaPausadas();
    }
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
// ====================================================================
// 📡 RADAR DE KARDEX EN TIEMPO REAL Y DIBUJADO
// ====================================================================

// 1. EL RADAR (Sincronización segura)
if (window.radarKardexActivo) {
    console.warn("⚠️ El radar de Kardex ya estaba activo. Evitando clonación.");
} else {
    window.radarKardexActivo = true; 
    
    // Cargamos lo que haya en memoria rápido para no esperar al internet
    window.historialKardex = JSON.parse(localStorage.getItem("pos_kardex_v1") || "[]");

    if (typeof db !== 'undefined') {
        db.collection("kardex").onSnapshot((querySnapshot) => {
            let tempKardex = [];
            querySnapshot.forEach((doc) => { 
                let data = typeof doc.data === 'function' ? doc.data() : doc;
                tempKardex.push(data); 
            });
            
            // Ordenamos para que lo más nuevo salga primero
            tempKardex.sort((a, b) => b.timestamp - a.timestamp);
            window.historialKardex = tempKardex;
            
            // Guardamos un respaldo en el disco duro (Máximo 1000 registros para no saturar)
            try { localStorage.setItem("pos_kardex_v1", JSON.stringify(window.historialKardex.slice(0, 1000))); } catch(e){}
            
            console.log("📊 Historial de Kardex sincronizado. Registros:", window.historialKardex.length);
            
            if (typeof window.renderKardex === 'function') {
    window.renderKardex(); 
}
        });
    }
}

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
                <i class="fa-regular fa-calendar-days"></i> ${fecha}
            </div>
            <div style="font-size: 16px; font-weight: bold; color: #00d2ff; letter-spacing: 1px; white-space: nowrap; text-shadow: 0 0 5px rgba(0, 210, 255, 0.4);">
                <i class="fa-regular fa-clock"></i> ${hora}
            </div>
        `;
    }
}

// ====================================================================
// === 🎨 CARGA Y SUBIDA DE FONDOS PERSONALIZADOS ===
// ====================================================================
window.cargarFondosDesdeNube = async function() {
    try {
        // 🔥 ANTI-CACHÉ ABSOLUTO: Le ordenamos a la base de datos que traiga la información más reciente
        const records = await pb.collection('config_visual').getFullList({ 
            requestKey: null,
            sort: '-updated' // <-- Esto fuerza a que siempre lea el cambio más nuevo
        });

        if (records.length > 0) {
            const record = records[0];
            let tiempoExacto = new Date().getTime(); // Número único para engañar a la imagen
            
            // 1. Fondo Login
            if (record.fondo_login) {
                let urlLogin = pb.files.getUrl(record, record.fondo_login) + '?t=' + tiempoExacto;
                let bgLogin = document.getElementById('login-screen');
                if(bgLogin) {
                    bgLogin.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('${urlLogin}')`;
                }
            }
            
            // 2. Fondo Panel Derecho (Con Efecto Cine / Fade)
            if (record.fondo_panel) {
                let urlPanel = pb.files.getUrl(record, record.fondo_panel) + '?t=' + tiempoExacto;
                
                document.querySelectorAll('.panel-der').forEach(panel => {
                    // Inyectamos el degradado (oscuro abajo, transparente arriba) y la imagen nueva
                    panel.style.backgroundImage = `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.85) 75%, rgba(0,0,0,0.95) 100%), url('${urlPanel}')`;
                    panel.style.backgroundSize = "cover";
                    panel.style.backgroundPosition = "center";
                    panel.style.backgroundRepeat = "no-repeat"; // Protege para que no se formen mosaicos
                });
            }
        }
    } catch (e) {
        console.warn("⚠️ Error al consultar el diseño visual a la base de datos:", e);
    }
};

// El motor para enviar las imágenes desde tu sistema
window.subirFondos = async function() {
    let fileLogin = document.getElementById('file_fondo_login').files[0];
    let filePanel = document.getElementById('file_fondo_panel').files[0];
    let fileMarca = document.getElementById('file_marca_agua').files[0]; 
    
    if (!fileLogin && !filePanel && !fileMarca) return alert("⚠️ Selecciona al menos una imagen para subir.");

    let btnTxt = document.getElementById('btn_txt_fondos');
    let txtOriginal = btnTxt.innerText;
    btnTxt.innerText = "⏳ SUBIENDO IMÁGENES A LA NUBE...";
    
    try {
        let nombreSucursal = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();

        let formData = new FormData();
        if (fileLogin) formData.append('fondo_login', fileLogin);
        if (filePanel) formData.append('fondo_panel', filePanel);
        if (fileMarca) formData.append('marca_agua', fileMarca);
        formData.append('sucursal', nombreSucursal);

        // 🌟 BUSCAMOS SI YA EXISTE UN REGISTRO EXCLUSIVO DE ESTA SUCURSAL
        const records = await pb.collection('config_visual').getFullList({ 
            filter: `sucursal='${nombreSucursal}'`,
            requestKey: null 
        });
        
        if (records.length > 0) {
            // Actualiza solo el de esta sucursal
            await pb.collection('config_visual').update(records[0].id, formData);
        } else {
            // Crea un registro nuevo para esta sucursal
            await pb.collection('config_visual').create(formData);
        }

        alert(`✅ Imágenes actualizadas para la sucursal: ${nombreSucursal}`);
        
        document.getElementById('file_fondo_login').value = '';
        document.getElementById('file_fondo_panel').value = '';
        if(document.getElementById('file_marca_agua')) document.getElementById('file_marca_agua').value = '';
        
        if (typeof window.actualizarMarcaDeAgua === 'function') window.actualizarMarcaDeAgua();
        
    } catch (error) {
        console.error("Error al subir fondos:", error);
        alert("❌ Ocurrió un error al subir las imágenes.");
    } finally {
        btnTxt.innerText = txtOriginal;
    }
};

function obtenerProductoMaestro(cod) {
    let p = inv[cod];
    if (!p) return null;
    
    // Si tiene un "grupo" (que usaremos como el puente al Maestro) y ese Maestro existe
    if (p.grupo && inv[p.grupo]) {
        return inv[p.grupo]; 
    }
    
    // Si no tiene grupo, él mismo es su propio Maestro
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
    if (typeof renderKardex === 'function') window.renderKardex();
};

// =========================================================================
// 🔀 ENRUTADOR PRINCIPAL (AUTO-RESCATE INFALIBLE)
// =========================================================================
window.changeTab = function(evt, tabName) {
    try {
        // 🚀 0. AUTO-RESCATE NIVEL DIOS: Extrae el Kardex de donde esté y lo pone junto a Ventas
        let tabKardex = document.getElementById('kardex-tab');
        let tabVentas = document.getElementById('v-tab') || document.querySelector('.tabcontent');
        
        if (tabKardex && tabVentas && tabKardex.parentElement !== tabVentas.parentElement) {
            tabVentas.parentElement.appendChild(tabKardex);
            console.log("✅ Kardex liberado del calabozo HTML y reubicado.");
        }

        // 1. Ocultar estrictamente SOLO los contenedores de contenido
        document.querySelectorAll('.tabcontent').forEach(tab => {
            tab.style.display = "none";
        });

        // 2. Remover el estado visual activo solo de los botones de pestaña
        document.querySelectorAll('.t-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // 3. Encender exclusivamente la pestaña solicitada
        let tabDestino = document.getElementById(tabName);
        if (tabDestino) {
            tabDestino.style.display = "block";
        }
        window.tabActual = tabName;

        // 4. Iluminar el botón presionado
        if (evt && evt.currentTarget) {
            evt.currentTarget.classList.add('active');
        } else {
            let btn = document.getElementById('btn_' + tabName);
            if (btn) btn.classList.add('active');
        }

        // 5. Disparadores de ciclo de vida por módulo (Silenciosos)
        if (tabName === 'kardex-tab' && typeof window.renderKardex === 'function') {
            window.renderKardex();
        }
        if (tabName === 'audi-tab' && typeof cargarBorradoresPendientes === 'function') {
            cargarBorradoresPendientes();
        }

        // 6. Autoenfoque inteligente del cursor
        setTimeout(() => {
            let inputObjetivo = null;
            
            if (tabName === 'v-tab' || tabName === 'ventas-tab') inputObjetivo = document.getElementById('v_cod');
            else if (tabName === 'c-tab' || tabName === 'compras-tab') inputObjetivo = document.getElementById('c_cod');
            else if (tabName === 'i-tab' || tabName === 'inv-tab') inputObjetivo = document.getElementById('buscar_inv');
            else if (tabName === 'kardex-tab') inputObjetivo = document.getElementById('kardex_buscar');

            if (inputObjetivo) {
                inputObjetivo.focus({ preventScroll: true });
            }
        }, 100);

    } catch (error) {
        console.error("❌ Error al cambiar de pestaña:", error);
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

window.intentarLogin = function() {
    let u = document.getElementById('login_user').value; 
    let p = document.getElementById('login_pin').value;
    
    if(usuariosData[u] && usuariosData[u].pin === p) { 
        usuarioActual = u; 
        document.getElementById('ui_current_user').innerText = u; 
        document.getElementById('login-screen').style.display = 'none'; 
        
        // 👉 AQUI GUARDAMOS EL USUARIO GLOBAL PARA EL RADAR DE AUDITORÍAS
        window.usuarioActivoGlobal = u;

        if (u === "Admin") { 
            document.getElementById('ui_sucursal').disabled = false; 
            if(document.getElementById('corte_sucursal')) document.getElementById('corte_sucursal').disabled = false;
            if(document.getElementById('t_origen')) document.getElementById('t_origen').disabled = false;
        } else { 
            // Bloqueamos el selector para que el cajero solo opere en la sucursal donde hizo login
            document.getElementById('ui_sucursal').disabled = true; 
            if(document.getElementById('corte_sucursal')) document.getElementById('corte_sucursal').disabled = true;
            if(document.getElementById('t_origen')) document.getElementById('t_origen').disabled = true;
        }
        
        document.querySelectorAll('.t-btn').forEach(btn => btn.style.display = 'none');
        
        let allowedTabs = usuariosData[u].tabs || [];
        
        // 🔒 SEGURO ANTI-BLOQUEO DEL ADMIN: 
        if (u === "Admin") {
            if (!allowedTabs.includes("u-tab")) allowedTabs.push("u-tab");          
            if (!allowedTabs.includes("kardex-tab")) allowedTabs.push("kardex-tab"); 
            if (!allowedTabs.includes("audi-tab")) allowedTabs.push("audi-tab"); 
        }
        
        // =================================================================
        // 🛡️ GUARDIÁN DE PERMISOS: INVENTARIO CIEGO Y AUDITORÍAS
        // =================================================================
        setTimeout(() => {
            let misPermisos = usuariosData[u].permisos || []; 
            let esAdmin = (u === "Admin");

            let btnInvCiego = document.getElementById('btn_hacer_inv_ciego');
            if (btnInvCiego) {
                btnInvCiego.style.display = (esAdmin || misPermisos.includes('inv_ciego')) ? 'inline-block' : 'none';
            }

            let btnAuditoria = document.getElementById('btn_audi-tab');
            if (btnAuditoria) {
                btnAuditoria.style.display = (esAdmin || misPermisos.includes('auditoria')) ? 'inline-block' : 'none';
            }
        }, 300);
        
        allowedTabs.forEach(tabId => { 
            let btn = document.getElementById('btn_' + tabId); 
            if(btn) btn.style.display = 'block'; 
        });
        
        if(allowedTabs.length > 0) { document.getElementById('btn_' + allowedTabs[0]).click(); }
        
        if(typeof renderI === 'function') renderI();
        if(typeof renderCorte === 'function') renderCorte(); 
        document.getElementById('login_pin').value = '';


        // =================================================================
        // 🏪 🚨 AUTO-ROAMING DE TURNO (MULTISUCURSAL)
        // =================================================================
        setTimeout(async () => {
            let sucNombre = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();

            try {
                // 🌟 BUSCAMOS EL TURNO EXCLUSIVO DEL CAJERO (Sin importar dónde lo abrió)
                let urlSesion = `https://sexy-starling.pikapod.net/api/collections/cajas_sesiones/records?filter=(estado='abierta'%20%26%26%20cajero='${u}')&sort=-created&limit=1&_t=${Date.now()}`;
                let res = await fetch(urlSesion, { cache: 'no-store' });
                
                if (res.ok) {
                    let data = await res.json();
                    if (data.items && data.items.length > 0) {
                        let sesionNube = data.items[0];
                        
                        // 🌟 ENGANCHE AUTOMÁTICO SILENCIOSO
                        window.sesionCajaActual = sesionNube.data || sesionNube;
                        try { localStorage.setItem("pos_sesion_caja", JSON.stringify(window.sesionCajaActual)); } catch(e){}
                        
                        console.log("✅ Turno flotante enlazado:", window.sesionCajaActual.id);
                        
                        if (typeof mostrarAvisoRapido === 'function') {
                            mostrarAvisoRapido(`✅ Turno sincronizado automáticamente.`);
                        }
                    } else {
                        // Si no hay turnos a su nombre, limpiamos su memoria
                        window.sesionCajaActual = null;
                        try { localStorage.removeItem("pos_sesion_caja"); } catch(e){}
                    }
                }
            } catch(e) {
                console.error("Error al buscar sesión en la nube:", e);
            }
            
            // ACTUALIZAMOS LA UI VISUAL (BOTONES ROJO Y VERDE)
            if (typeof actualizarIndicadorTurnoUI === 'function') {
                actualizarIndicadorTurnoUI();
            }
            
            if (typeof actualizarMarcaDeAgua === 'function') {
                actualizarMarcaDeAgua();
            }

            // SI ESTÁ CERRADO, AHÍ SÍ LE PREGUNTAMOS SI QUIERE ABRIR UNO NUEVO
            if (!window.sesionCajaActual || window.sesionCajaActual.estado !== 'abierta') {
                let deseaAbrir = confirm(`🏪 No tienes ningún turno abierto, ${u}.\n\n¿Deseas INICIAR TURNO e ingresar el Fondo Inicial ahora?`);
                
                if (deseaAbrir && typeof abrirMontoInicialCaja === 'function') {
                    abrirMontoInicialCaja();
                }
            }
        }, 400);

    } else { 
        alert("PIN Incorrecto"); 
    }
};
window.actualizarMarcaDeAgua = async function() {
    let nombreSucursal = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();
    
    // 🌟 AHORA BUSCAMOS EL PANEL IZQUIERDO COMPLETO
    let contenedorPanel = document.querySelector('.panel-izq');
    if (!contenedorPanel) return; 

    try {
        let urlPB = `https://sexy-starling.pikapod.net/api/collections/config_visual/records?filter=(sucursal='${nombreSucursal}')`;
        let respuesta = await fetch(urlPB);
        let data = await respuesta.json();

        if (data.items && data.items.length > 0) {
            let configVisual = data.items[0];
            
            if (configVisual.marca_agua) {
                let urlLogo = `https://sexy-starling.pikapod.net/api/files/${configVisual.collectionId}/${configVisual.id}/${configVisual.marca_agua}`;
                
                // Aplicamos la variable CSS al panel izquierdo
                contenedorPanel.style.setProperty('--logo-sucursal', `url('${urlLogo}')`);
            } else {
                contenedorPanel.style.setProperty('--logo-sucursal', `none`);
            }
        }
    } catch (error) {
        console.error("Error al descargar la marca de agua:", error);
    }
};
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
    
    // Recolectar sucursales marcadas
    let sucursalesSeleccionadas = Array.from(document.querySelectorAll('.cb-sucursal:checked')).map(cb => cb.value).join(',');

    // 🎯 CORRECCIÓN: Recolectamos el estado de las casillas especiales
    let permisos = [];
    if (document.getElementById('perm_inv_ciego') && document.getElementById('perm_inv_ciego').checked) permisos.push('inv_ciego');
    if (document.getElementById('perm_auditoria') && document.getElementById('perm_auditoria').checked) permisos.push('auditoria');

    // Preparar el objeto incluyendo la propiedad 'permisos'
    let objetoUsuario = { 
        pin: pin, 
        tabs: tabs, 
        sucursales_permitidas: sucursalesSeleccionadas,
        permisos: permisos // <-- ¡Esto es lo que faltaba guardar!
    };

    // Actualización inmediata local
    usuariosData[nom] = objetoUsuario;
    localStorage.setItem("pos_usuarios_v9", JSON.stringify(usuariosData));
    
    // Enviamos a PocketBase
    db.collection("usuarios").doc(nom).set(objetoUsuario)
    .then(() => {
        alert("✅ Usuario guardado y sincronizado en la NUBE."); 
        
        document.getElementById('u_nombre').value = ''; 
        document.getElementById('u_pin').value = ''; 
        document.getElementById('u_nombre').readOnly = false;
        document.getElementById('u_nombre').style.background = '#fff';
        
        // Limpiar checks estándar
        ['v-tab', 'c-tab', 'prov-tab', 'k-tab', 'i-tab', 'cli-tab', 'pro-tab', 'rec-tab', 'r-tab', 'u-tab', 'kardex-tab'].forEach(t => {
            let chk = document.getElementById('chk_' + t);
            if(chk) chk.checked = false;
        });

        // 🎯 CORRECCIÓN: Limpiar los nuevos checks especiales
        if (document.getElementById('perm_inv_ciego')) document.getElementById('perm_inv_ciego').checked = false;
        if (document.getElementById('perm_auditoria')) document.getElementById('perm_auditoria').checked = false;

        document.querySelectorAll('.cb-sucursal').forEach(cb => cb.checked = false);

        if(typeof renderUsuarios === 'function') renderUsuarios();
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

    // 🌟 LIMPIEZA: Nos aseguramos de guardar el nombre puro sin el emoji del pin (📍)
    sucursalActual = String(ns || "").replace(/📍/g, '').trim(); 
    
    localStorage.setItem("pos_sucursal", sucursalActual); 
    actualizarEtiquetasSucursal(); 
    
    if (document.getElementById('corte_sucursal')) document.getElementById('corte_sucursal').value = sucursalActual;
    if (document.getElementById('cfg_sucursal')) document.getElementById('cfg_sucursal').value = sucursalActual;
    
    // 🛡️ ESCUDO: Vaciamos todos los carritos al cambiar de sucursal
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

    // 🌟 AHORA SÍ: Dentro de la función para que se ejecute en cada cambio
    if (typeof renderProveedores === 'function') {
        renderProveedores();
    }
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
            
            // 🌟 DETECTOR DE ESPEJOS
            let esEspejo = x.grupo && inv[x.grupo];
            let pMaestro = esEspejo ? inv[x.grupo] : x;
            let codMaestro = esEspejo ? x.grupo : k;

            // Obligamos a que calcule el stock y faltantes usando al Maestro
            let st = getVirtualStock(pMaestro); 
            let fal = (pMaestro.sold_without_stock && pMaestro.sold_without_stock[sucursalActual]) || 0; 
            let precioUnidad = parseFloat(pMaestro.pv) || 0;
            
            // 🎨 DISEÑO DIFERENCIADO PARA EL NOMBRE
            let celdaNombre = esEspejo 
                ? `${x.nom} <span class="badge-kit" style="background:#17a2b8; font-size:0.75em; margin-left:5px; padding:2px 6px;" title="Hereda inventario de: ${pMaestro.nom}">🔗 ESPEJO</span>` 
                : x.nom;
            
            // 🎨 DISEÑO ATENUADO PARA STOCK Y PRECIO
            let celdaStock = esEspejo
                ? `<td style="color:#aaa; font-style:italic;" title="Stock compartido con el código ${codMaestro}"><b>${st}</b> 🔗</td>`
                : `<td><b>${st}</b></td>`;
                
            let celdaPrecio = esEspejo
                ? `<td style="color:#aaa; font-style:italic;" title="Precio heredado">$${precioUnidad.toFixed(2)}</td>`
                : `<td>$${precioUnidad.toFixed(2)}</td>`;

            html += `<tr style="${bgRow}">
                <td>${isFocused ? '👉 ' : ''}${k}</td>
                <td>${celdaNombre}</td>
                <td><span class="badge-kit" style="background:#6c757d">${x.dep||'General'}</span></td>
                <td>${(x.tipo||'pieza').toUpperCase()}</td>
                ${celdaStock}
                <td style="color:red">${fal}</td>
                ${celdaPrecio}
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

// Asegúrate de que la función anterior haya cerrado bien con su llave } antes de pegar esto:

window.descontarStock = function(cod, cantidad) {
    try {
        let cantNum = parseFloat(cantidad) || 0;
        let p = inv[cod];
        if (!p) return;

        let sucReal = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();
        
        // 🛡️ 1. PRESERVAMOS PROPIEDADES CRÍTICAS (Evitamos que pierda GRANEL)
        let tipoOriginal = p.tipo || "GRANEL";
        if (!p.stock) p.stock = {};

        // 2. Actualización en memoria local
        let stockPrevio = 0;
        if (typeof p.stock === 'object') {
            stockPrevio = parseFloat(p.stock[sucReal]) || 0;
            p.stock[sucReal] = parseFloat((stockPrevio - cantNum).toFixed(3));
        } else {
            stockPrevio = parseFloat(p.stock) || 0;
            p.stock = parseFloat((stockPrevio - cantNum).toFixed(3));
        }

        // Mantenemos la propiedad tipo intacta
        p.tipo = tipoOriginal;

        // Actualizar en variables globales locales
        if (typeof inv !== 'undefined' && inv[cod]) inv[cod].tipo = tipoOriginal;
        if (typeof productos !== 'undefined' && productos[cod]) productos[cod] = p;

        // Guardar respaldo local en LocalStorage
        try {
            if (typeof inv !== 'undefined') localStorage.setItem("pos_inventario_v1", JSON.stringify(inv));
            if (typeof productos !== 'undefined') localStorage.setItem("pos_productos_v1", JSON.stringify(productos));
        } catch(e) {}

        // 3. Actualización en la Nube (Sincronizamos 'productos' e 'inventario' sin borrar propiedades)
        if (typeof db !== 'undefined' && db) {
            
            // Método A: Si usas Firebase Oficial con FieldValue
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue) {
                let campoStock = `stock.${sucReal}`;
                let payload = {
                    [campoStock]: firebase.firestore.FieldValue.increment(-cantNum),
                    tipo: tipoOriginal // 🔥 Mantenemos el tipo siempre
                };

                db.collection("inventario").doc(String(cod)).set(payload, { merge: true }).catch(e => {});
                db.collection("inventario").doc(String(cod)).set(payload, { merge: true }).catch(e => {});
            } 
            // Método B: Si usas DB local / PocketBase / Alternativa
            else {
                let datosActualizados = {
                    stock: p.stock,
                    tipo: tipoOriginal,
                    nombre: p.nombre || p.nom || "Producto"
                };

                if (typeof db.collection === 'function') {
                    // Usamos UPDATE si existe para no destruir campos
                    if (typeof db.collection("inventario").doc(String(cod)).update === 'function') {
                        db.collection("inventario").doc(String(cod)).update(datosActualizados).catch(() => {
                            db.collection("inventario").doc(String(cod)).set(p, { merge: true });
                        });
                        db.collection("inventario").doc(String(cod)).update(datosActualizados).catch(() => {
                            db.collection("inventario").doc(String(cod)).set(p, { merge: true });
                        });
                    } else {
                        db.collection("inventario").doc(String(cod)).set(p, { merge: true }).catch(e => {});
                        db.collection("inventario").doc(String(cod)).set(p, { merge: true }).catch(e => {});
                    }
                }
            }
        }
    } catch (err) {
        console.error("Error en descontarStock:", err);
    }
};
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
    
    // 🌟 NUEVO: Capturamos el Código Maestro
    let inputGrupo = document.getElementById('e_grupo');
    let nuevoGrupo = inputGrupo ? inputGrupo.value.trim() : "";

    if(!codNuevo) return alert("❌ El código no puede estar vacío.");
    if(!nuevoNom) return alert("❌ El nombre no puede estar vacío.");
    
    // Validamos que el Maestro exista (para que no lo enlacen a un fantasma)
    if (nuevoGrupo && !inv[nuevoGrupo]) {
        return alert(`❌ El Código Maestro "${nuevoGrupo}" no existe en el inventario.`);
    }
    // Evitamos que un producto sea su propio maestro en un bucle infinito
    if (nuevoGrupo === codNuevo) {
        return alert("❌ Un producto no puede ser maestro de sí mismo.");
    }

    let pO = inv[codViejo] || {};
    let stockReal = 0;
    if (pO.stock && typeof pO.stock === 'object') {
        stockReal = parseFloat(pO.stock[sucursalActual]) || 0;
    } else {
        stockReal = parseFloat(pO.stock) || parseFloat(pO.existencia) || parseFloat(pO.can) || 0;
    }

    if (codNuevo !== codViejo) {
        if (inv[codNuevo]) return alert("⚠️ Código en uso.");
        inv[codNuevo] = JSON.parse(JSON.stringify(inv[codViejo])); 
        inv[codNuevo].nom = nuevoNom; inv[codNuevo].dep = nuevoDep; inv[codNuevo].tipo = nuevoTipo;
        inv[codNuevo].cos = nuevoCos; inv[codNuevo].iva = nuevoIva; inv[codNuevo].gan = nuevaGan;
        inv[codNuevo].pv = nuevoPv; inv[codNuevo].pm = nuevoPm; inv[codNuevo].md = nuevoMd;
        
        // 🌟 NUEVO: Asignamos el enlace Maestro
        if (nuevoGrupo) {
            inv[codNuevo].grupo = nuevoGrupo;
        } else {
            delete inv[codNuevo].grupo; // Si lo dejaron vacío, rompemos el enlace
        }
        
        inv[codNuevo].updatedAt = Date.now(); 
        
        delete inv[codViejo];
        db.collection("inventario").doc(String(codViejo)).delete();
        
        db.collection("inventario").doc(String(codNuevo)).set(inv[codNuevo])
        .then(()=>alert("✅ Actualizado")).catch(e=>console.log(e));
    } else {
        inv[codViejo].nom = nuevoNom; inv[codViejo].dep = nuevoDep; inv[codViejo].tipo = nuevoTipo;
        inv[codViejo].cos = nuevoCos; inv[codViejo].iva = nuevoIva; inv[codViejo].gan = nuevaGan;
        inv[codViejo].pv = nuevoPv; inv[codViejo].pm = nuevoPm; inv[codViejo].md = nuevoMd;
        
        // 🌟 NUEVO: Asignamos el enlace Maestro
        if (nuevoGrupo) {
            inv[codViejo].grupo = nuevoGrupo;
        } else {
            delete inv[codViejo].grupo;
        }
        
        inv[codViejo].updatedAt = Date.now();
        
        db.collection("inventario").doc(String(codViejo)).set(inv[codViejo])
        .then(()=>alert("✅ Guardado")).catch(e=>console.log(e));
    }
    
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); 
    
    let codAuditar = (codNuevo !== codViejo) ? codNuevo : codViejo;
    if (typeof registrarEnKardex === 'function') {
        registrarEnKardex(codAuditar, nuevoNom, "EDICIÓN", 0, nuevoPv, nuevoCos, stockReal, stockReal);
    }
    
    cerrarModales(); renderTablaInventario();
}
function eliminarProductoDesdeEdicion() {
    let cod = document.getElementById('e_cod_original').value;
    if (!cod || !inv[cod]) return alert("❌ No se encontró el producto.");

    let pO = inv[cod];
    let nom = pO.nom || "Desconocido";

    // Pedimos confirmación extrema para evitar accidentes
    if (!confirm(`⚠️ ¿Estás COMPLETAMENTE SEGURO de eliminar "${nom}" del inventario?\nEsta acción borrará el producto de la nube.`)) return;

    // 📸 FOTOGRAFÍA (Leemos el stock antes de que el producto desaparezca)
    let stockReal = 0;
    if (pO.stock && typeof pO.stock === 'object') {
        stockReal = parseFloat(pO.stock[sucursalActual]) || 0;
    } else {
        stockReal = parseFloat(pO.stock) || parseFloat(pO.existencia) || parseFloat(pO.can) || 0;
    }

    // 1. Lo borramos localmente de la RAM
    delete inv[cod];
    localStorage.setItem("pos_precision_v6", JSON.stringify(inv));

    // 2. Lo borramos de Firebase / PocketBase
    db.collection("inventario").doc(String(cod)).delete()
    .then(() => {
        alert("🗑️ Producto eliminado exitosamente.");

        // 🌟 KARDEX: Registramos la muerte del producto. (Cant. en negativo, Stock Después = 0)
        if (typeof registrarEnKardex === 'function') {
            registrarEnKardex(cod, nom, "AJUSTE", -stockReal, pO.pv||0, pO.cos||0, stockReal, 0);
        }

        cerrarModales();
        renderTablaInventario();
    })
    .catch(e => {
        console.error("Error al borrar:", e);
        alert("Error al eliminar el producto de la nube.");
    });
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
            let codOriginal = document.getElementById('v_cod').value.trim(); 
            if(!codOriginal) return;
            
            let pOriginal = inv[codOriginal];
            if(!pOriginal) { 
                document.getElementById('pnf_cod').innerText = codOriginal;
                document.getElementById('modalProdNoEncontrado').style.display = 'block';
                return; 
            } 
            
            // 🌟 MAGIA MAESTRO-ESCLAVO: Buscamos al Jefe absoluto de este código
            let pMaestro = obtenerProductoMaestro(codOriginal);
            
            let hoy = getFechaLocal(); 
            let promoAgotada = null;
            
            // Evaluamos promociones usando el código original o el código del Maestro
            if(Array.isArray(promociones)) { 
                promoAgotada = promociones.find(pr => 
                    pr && (pr.cod === codOriginal || pr.cod === pMaestro.grupo) && 
                    (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && 
                    ( (pr.fecha_fin && hoy > pr.fecha_fin) || (pr.limite > 0 && (pr.usadas||0) >= pr.limite) )
                ); 
            }
            
            if (promoAgotada && !carV.some(item => item.cod === codOriginal)) { 
                document.getElementById('pa_nom').innerText = pOriginal.nom || 'Producto'; 
                document.getElementById('modalPromoAgotada').style.display = 'block'; 
                setTimeout(() => document.getElementById('btn_cerrar_pa').focus(), 100); 
            }
            
            // 🌟 El tipo de venta (Granel o Pieza) lo dicta el Maestro, no el dependiente
            if(pMaestro.tipo === 'granel') { 
                abrirGranel(codOriginal); 
            } else { 
                let i = carV.findIndex(x => x.cod === codOriginal); 
                if(i > -1) { 
                    carV[i].can++; 
                    focusVentaIndex = i; 
                } else { 
                    // Inyectamos la referencia del Maestro en el carrito
                    carV.push({
                        cod: codOriginal, 
                        nom: pOriginal.nom || 'Producto', 
                        can: 1, 
                        tipo: pMaestro.tipo || 'pieza',
                        maestro_cod: (pOriginal.grupo && inv[pOriginal.grupo]) ? pOriginal.grupo : codOriginal 
                    }); 
                    focusVentaIndex = carV.length - 1; 
                } 
                renderV(); 
            }
            document.getElementById('v_cod').value = ""; 
        } catch(err) { 
            console.error(err); 
            alert("Error al escanear: " + err.message); 
        }
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
            
            // 🌟 MAGIA MAESTRO-ESPEJO: Identificamos quién manda sobre este código
            let pOriginal = inv[x.cod] || {}; 
            let codMaestro = x.maestro_cod || (pOriginal.grupo && inv[pOriginal.grupo] ? pOriginal.grupo : x.cod);
            let pMaestro = inv[codMaestro] || pOriginal;
            
            // Extraemos las reglas de negocio directamente del Maestro
            let minM = pMaestro.md || 10; 
            
            let precioVentaNormal = pMaestro.pv || 0;
            if (pMaestro.pre_sucursales && pMaestro.pre_sucursales[sucursalActual] !== undefined) precioVentaNormal = pMaestro.pre_sucursales[sucursalActual];
            let precioMayoreo = pMaestro.pm || precioVentaNormal;

            let aplicaMayoreo = forceWholesale && ((x.can||1) >= minM); 
            let subtotalNormal = (x.can||1) * precioVentaNormal;
            let subtotalMayoreo = aplicaMayoreo ? ((x.can||1) * precioMayoreo) : subtotalNormal;

            let subtotalPromo = subtotalNormal;
            let promoActiva = null;
            if(Array.isArray(promociones)) {
                // Buscamos si hay promo para el código específico o para su Maestro
                promoActiva = promociones.find(pr => pr && (pr.cod === x.cod || pr.cod === codMaestro) && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && pr.fecha_ini <= hoy && (!pr.fecha_fin || pr.fecha_fin >= hoy) && (pr.limite === 0 || (pr.usadas||0) < pr.limite));
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
            
            // Conservamos el nombre original del producto escaneado
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
        if (divContador) divContador.innerHTML = `<i class="fa-solid fa-cart-shopping"></i> Total Artículos: ${Math.round(totalArticulos * 100) / 100}`;

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
        // 🚨 1. SI LA CUENTA YA ESTÁ EN $0.00, FINALIZAMOS LA VENTA DE INMEDIATO
        if (typeof restanteCobro !== 'undefined' && restanteCobro <= 0.001) {
            let elCambio = document.getElementById('m_cambio');
            let cambioCalc = elCambio ? (parseFloat(elCambio.innerText.replace('$', '')) || 0) : 0;
            
            if (typeof window.confirmarVenta === 'function') {
                window.confirmarVenta(cambioCalc);
            }
            return;
        }

        let metSelect = document.getElementById('m_metodo');
        let met = metSelect ? metSelect.value : 'Efectivo';
        let r = parseFloat(document.getElementById('m_recibido').value) || 0;
        if (r <= 0) return alert("⚠️ Ingresa un monto válido.");

        let term = terminalSeleccionada ? String(terminalSeleccionada).trim() : null;

        if (met === 'Tarjeta' && !term) {
            return alert("👆 Por favor, elige a qué terminal enviar el cobro haciendo clic en uno de los botones (M. PAGO, GETNET o MANUAL).");
        }

        let telClienteSeleccionado = null;
        if (met.includes('Crédit') || met.includes('Credit') || met.includes('Fiado')) { 
            telClienteSeleccionado = document.getElementById('m_cliente_select') ? document.getElementById('m_cliente_select').value : null; 
            if (!telClienteSeleccionado) return alert("❌ Selecciona a un cliente para poder fiarle."); 
        }

        let pagoAplicado = Math.min(r, Math.round(restanteCobro * 100) / 100); 
        let cambio = Math.max(0, r - pagoAplicado); 
        let metodoEtiqueta = met;

        // 2. PROCESAMIENTO DE TERMINALES
        if (met === 'Tarjeta' && term) {
            let cobroExitoso = false;
            let errorMensaje = "";
            let esManual = (term.toUpperCase().includes('MANUAL'));

            if (esManual) {
                cobroExitoso = true;
            } else if (term === 'Mercado Pago') {
                try {
                    if (typeof enviarCobroTerminal === 'function') {
                        cobroExitoso = await enviarCobroTerminal(pagoAplicado);
                    }
                } catch (e) {
                    errorMensaje = e.message || "UNAUTHORIZED / Error de conexión";
                    cobroExitoso = false;
                }
            } else if (term === 'Getnet') {
                try {
                    if (typeof enviarCobroGetnet === 'function') {
                        cobroExitoso = await enviarCobroGetnet(pagoAplicado);
                    }
                } catch (e) {
                    errorMensaje = e.message || "UNAUTHORIZED / Error de conexión";
                    cobroExitoso = false;
                }
            }

            // Si la terminal falla, preguntamos si se realizó el cobro físico
            if (!cobroExitoso && !esManual) {
                let msjPregunta = `⚠️ No se pudo conectar con la terminal (${term}).\n` +
                                  (errorMensaje ? `Detalle: ${errorMensaje}\n\n` : "\n") +
                                  `¿Se realizó el pago manualmente en la maquinita física y deseas registrar este pago para continuar?`;
                
                let aceptarManual = confirm(msjPregunta);

                if (!aceptarManual) {
                    return; // Si da clic en Cancelar, detiene la operación
                }

                metodoEtiqueta = 'Tarjeta';
            } else {
                metodoEtiqueta = esManual ? 'Tarjeta' : term;
            }
        }

        // 3. REGISTRAR PAGO EN MEMORIA
        if (typeof pagosCobro === 'undefined') window.pagosCobro = [];
        
        pagosCobro.push({ 
            metodo: metodoEtiqueta, 
            montoAplicado: Number(pagoAplicado.toFixed(2)), 
            montoEntregado: Number(r.toFixed(2)), 
            cliente_tel: telClienteSeleccionado || "" 
        });

        restanteCobro = Math.max(0, restanteCobro - pagoAplicado);
        if (typeof renderPagosCobro === "function") renderPagosCobro();

        // 4. SI TRAS ESTE PAGO EL RESTANTE LLEGA A $0.00, DISPARAR CONFIRMACIÓN
        if (restanteCobro < 0.01) { 
            if (typeof window.confirmarVenta === 'function') {
                window.confirmarVenta(cambio);
            }
        } else {
            let elRecibido = document.getElementById('m_recibido');
            if (elRecibido) {
                elRecibido.value = restanteCobro.toFixed(2);
                elRecibido.select();
            }
            if (typeof calcCambio === 'function') calcCambio();
        }
    } catch (err) { 
        alert("Error al procesar el pago: " + err.message); 
    }
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
    // 🎯 DOBLE SEGURO: Forzamos la carga de clientes al centavo justo antes de abrir la ventana
    if (typeof actualizarSelectClientesCobro === 'function') {
        actualizarSelectClientesCobro();
    }

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

// ====================================================================
// 📊 MOTOR ANALÍTICO: ACUMULADOR DIARIO EN TIEMPO REAL
// ====================================================================
async function actualizarAcumuladorDiario(venta, esAnulacion = false) {
    let docId = venta.fecha + "_" + (venta.sucursal || "Matriz");
    let factor = esAnulacion ? -1 : 1; // Si es anulación, el factor resta en lugar de sumar

    let tot = parseFloat(venta.total) || 0;
    let esAbono = (venta.metodo || '').toLowerCase().includes('abono');
    
    // Los abonos no suman como "venta nueva" ni generan ganancia
    let numV = (esAnulacion || esAbono) ? 0 : 1; 
    if (!esAnulacion && !esAbono) numV = 1;
    if (esAnulacion && !esAbono) numV = -1;

    let ganancia = 0;
    if(venta.detalles && !esAbono) {
        venta.detalles.forEach(d => {
            let costo = parseFloat(d.costo) || 0;
            ganancia += (parseFloat(d.subtotal) || 0) - (costo * parseFloat(d.can || 1));
        });
    }

    let ef = 0, ta = 0, tr = 0, cr = 0;
    if (venta.pagos && Array.isArray(venta.pagos) && venta.pagos.length > 0) {
        venta.pagos.forEach(p => {
            let m = parseFloat(p.montoAplicado) || 0;
            if(p.metodo === 'Efectivo') ef += m;
            else if(p.metodo === 'Tarjeta') ta += m;
            else if(p.metodo === 'Transferencia') tr += m;
            else if(p.metodo === 'Crédito') cr += m;
        });
    } else {
        let mStr = venta.metodo || '';
        if(mStr.includes('Efectivo')) ef += tot;
        else if(mStr.includes('Tarjeta')) ta += tot;
        else if(mStr.includes('Transferencia')) tr += tot;
        else if(mStr.includes('Crédito')) cr += tot;
    }

    // 1. Cargamos de la memoria local para no depender del internet y evitar sobrescrituras
    let memoriaAcumuladores = JSON.parse(localStorage.getItem('pos_resumenes_diarios') || "{}");
    let acumulador = memoriaAcumuladores[docId] || {
        fecha: venta.fecha, sucursal: venta.sucursal || "Matriz",
        ventas_totales: 0, ganancia_neta: 0, num_ventas: 0,
        efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0
    };

    // 2. Ejecutamos la suma (o resta) matemática
    if(!esAbono) acumulador.ventas_totales = (parseFloat(acumulador.ventas_totales) || 0) + (tot * factor);
    acumulador.ganancia_neta = (parseFloat(acumulador.ganancia_neta) || 0) + (ganancia * factor);
    acumulador.num_ventas = (parseInt(acumulador.num_ventas) || 0) + numV;

    acumulador.efectivo = (parseFloat(acumulador.efectivo) || 0) + (ef * factor);
    acumulador.tarjeta = (parseFloat(acumulador.tarjeta) || 0) + (ta * factor);
    acumulador.transferencia = (parseFloat(acumulador.transferencia) || 0) + (tr * factor);
    acumulador.credito = (parseFloat(acumulador.credito) || 0) + (cr * factor);

    // 3. Guardamos los nuevos totales en el disco duro (por seguridad)
    memoriaAcumuladores[docId] = acumulador;
    localStorage.setItem('pos_resumenes_diarios', JSON.stringify(memoriaAcumuladores));

    // 4. Disparamos la actualización a PocketBase de forma silenciosa e instantánea
    db.collection("resumenes_diarios").doc(docId).set(acumulador);
    console.log(`📊 Acumulador Analítico [${docId}] actualizado en tiempo real.`);
}
// =========================================================================
// 📦 LECTOR UNIVERSAL DE STOCK MULTI-SUCURSAL
// =========================================================================
function obtenerStockRealSucursal(prod, suc) {
    if (!prod) return 0;
    let s = String(suc || (typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz')).replace(/📍/g, '').trim();

    // 1. Búsqueda en mapas anidados de sucursales
    if (prod.sucursales && typeof prod.sucursales === 'object') {
        let val = prod.sucursales[s];
        if (val !== undefined) return typeof val === 'object' ? (parseFloat(val.can || val.stock || 0)) : (parseFloat(val) || 0);
    }
    if (prod.stock_sucursales && typeof prod.stock_sucursales === 'object') {
        let val = prod.stock_sucursales[s];
        if (val !== undefined) return parseFloat(val) || 0;
    }
    if (prod.existencias && typeof prod.existencias === 'object') {
        let val = prod.existencias[s];
        if (val !== undefined) return parseFloat(val) || 0;
    }
    if (prod.stock && typeof prod.stock === 'object') {
        let val = prod.stock[s];
        if (val !== undefined) return parseFloat(val) || 0;
    }

    // 2. Búsqueda por llaves compuestas dinámicas
    if (prod['can_' + s] !== undefined) return parseFloat(prod['can_' + s]) || 0;
    if (prod['stock_' + s] !== undefined) return parseFloat(prod['stock_' + s]) || 0;

    // 3. Fallback a stock general plano
    if (prod.can !== undefined) return parseFloat(prod.can) || 0;
    if (prod.stock !== undefined && typeof prod.stock !== 'object') return parseFloat(prod.stock) || 0;
    if (prod.existencia !== undefined) return parseFloat(prod.existencia) || 0;

    return 0;
}

// ====================================================================
// 🛒 CONFIRMAR VENTA (CONECTADA AL ACUMULADOR)
// ====================================================================
// ====================================================================
// 🛒 CONFIRMAR VENTA (CON CANDADO ANTI-DUPLICADOS)
// ====================================================================
window.ventaEnProceso = false; // 🛡️ Candado global

window.confirmarVenta = async function(cambioFinal = 0) {
    // 🛡️ 1. REVISAMOS EL CANDADO. Si ya está trabajando, ignoramos el clic fantasma.
    if (window.ventaEnProceso) {
        console.warn("⏳ Ignorando clic adicional: La venta ya se está procesando...");
        return; 
    }
    
    // 🛡️ 2. CERRAMOS EL CANDADO
    window.ventaEnProceso = true;

    try {
        let tot = parseFloat(document.getElementById('v_total').innerText); 
        if(tot <= 0 || isNaN(tot)) return;

        let elRecibido = document.getElementById('m_recibido');
        let valRecibido = elRecibido ? parseFloat(elRecibido.value) : 0;
        
        let pagosActuales = typeof pagosCobro !== 'undefined' ? pagosCobro : (window.pagosCobro || []);
        let sumaEntregada = 0;
        let nombresClientes = [];

        // 🌟 1. ID ÚNICO DE LA VENTA
        let idVentaNueva = Date.now() + Math.floor(Math.random()*1000);

        if (Array.isArray(pagosActuales) && pagosActuales.length > 0) {
            for (let p of pagosActuales) {
                sumaEntregada += (parseFloat(p.montoEntregado) || parseFloat(p.montoAplicado) || 0);
                
                let metodoLimpio = p.metodo ? p.metodo.trim().toLowerCase() : '';
                
                if(metodoLimpio === 'crédito' || metodoLimpio === 'credito') {
                    let telCliente = p.cliente_tel || (typeof window.telVentaActual !== 'undefined' ? window.telVentaActual : null);
                    
                    if (!telCliente || !clientes[telCliente]) {
                        let nombrePantalla = typeof window.nombreVentaActual !== 'undefined' ? window.nombreVentaActual : '';
                        let clienteRescatado = Object.values(clientes).find(cl => cl.nom === nombrePantalla);
                        if (clienteRescatado) {
                            telCliente = clienteRescatado.tel || clienteRescatado.id;
                        } else {
                            alert("⚠️ ALERTA: No se encontró la cuenta del cliente para sumarle el crédito. Selecciona un cliente de la lista.");
                            return;
                        }
                    }

                    let c = clientes[telCliente];
                    let montoDeuda = parseFloat(p.montoAplicado) || 0;
                    
                    if((c.saldo + montoDeuda) > (c.limite || 0) && (c.limite || 0) > 0) { 
                        if(!confirm(`⚠️ El cliente ${c.nom} superará su límite de crédito. ¿Autorizar?`)) return; 
                    }
                    
                    c.saldo = (parseFloat(c.saldo) || 0) + montoDeuda;
                    if (typeof sucursalActual !== 'undefined') { c.sucursal_ultima_compra = sucursalActual; }

                    if (!c.historial) c.historial = [];
                    let fechaHoy = (typeof getFechaLocal === 'function') ? getFechaLocal() : new Date().toISOString().split('T')[0];
                    let horaActual = new Date().toLocaleTimeString();
                    
                    c.historial.push({
                        detalle: "Ticket #" + idVentaNueva,
                        fecha: fechaHoy,
                        hora: horaActual,
                        id_venta: idVentaNueva,
                        monto: montoDeuda,
                        tipo: "Cargo (Compra)"
                    });

                    // Soporte para PB en clientes
                    if (typeof pb !== 'undefined') {
                        try {
                            let provNube = await pb.collection('clientes').getFirstListItem(`id="${telCliente}" || tel="${telCliente}"`);
                            provNube.saldo = c.saldo;
                            provNube.historial = c.historial;
                            await pb.collection('clientes').update(provNube.id, provNube);
                        } catch(e) { console.warn("Error cliente PB"); }
                    } else if (typeof db !== 'undefined') { 
                        db.collection("clientes").doc(String(telCliente)).set(c)
                          .then(() => console.log(`✅ Deuda y Ticket de $${montoDeuda} guardados en ${c.nom}`))
                          .catch(e => console.warn("Error subiendo deuda a la nube.", e)); 
                    }
                    
                    nombresClientes.push(c.nom);
                }
            }
        }

        let totalPagado = Math.max(sumaEntregada, valRecibido, (tot + (parseFloat(cambioFinal) || 0)));
        if (totalPagado < tot) totalPagado = tot + (parseFloat(cambioFinal) || 0);
        
        let cambioReal = totalPagado - tot;
        if (cambioReal < 0) cambioReal = 0;

        let clienteGlobal = (typeof window.nombreVentaActual !== 'undefined' && window.nombreVentaActual !== "") ? window.nombreVentaActual : "Público General";
        let nomClienteTicket = nombresClientes.length > 0 ? nombresClientes.join(', ') : clienteGlobal;
        let metodosStr = (pagosActuales.length > 0) ? pagosActuales.map(p => p.metodo).join(' + ') : 'Efectivo';

        let hoy = (typeof getFechaLocal === 'function') ? getFechaLocal() : new Date().toISOString().split('T')[0];
        let horaVenta = new Date().toLocaleTimeString();
        let itemsTicketHtml = ''; 
        let detallesParaGuardar = [];
        let sumaTotalCobrada = 0;

        let suc = typeof sucursalActual !== 'undefined' ? sucursalActual : '';
        let usr = typeof usuarioActual !== 'undefined' ? usuarioActual : '';

       for (let x of carV) { 
            let pOriginal = inv[x.cod] || {}; 
            let codMaestro = x.maestro_cod || (pOriginal.grupo && inv[pOriginal.grupo] ? pOriginal.grupo : x.cod);
            let pMaestro = inv[codMaestro] || pOriginal;

            let cantVendida = parseFloat(x.can) || 1;

            // 🌟 1. LECTURA PRECISA DEL STOCK ANTES DEL COBRO
            let stockAntes = obtenerStockRealSucursal(pMaestro, suc);
            if (stockAntes === 0 && pOriginal) {
                stockAntes = obtenerStockRealSucursal(pOriginal, suc);
            }

            // 🌟 2. EJECUCIÓN DEL DESCUENTO DE STOCK LOCAL
            if(pOriginal.tipo === 'kit') { 
                if(pOriginal.comp) pOriginal.comp.forEach(c => { 
                    let compMaestro = (inv[c.cod] && inv[c.cod].grupo && inv[inv[c.cod].grupo]) ? inv[c.cod].grupo : c.cod;
                    if(typeof descontarStock === 'function') descontarStock(compMaestro, (c.can || 1) * cantVendida); 
                }); 
            } else { 
                if(typeof descontarStock === 'function') descontarStock(codMaestro, cantVendida); 
            }
            
            // 🌟 3. LECTURA DEL STOCK DESPUÉS DEL COBRO
            let stockDespues = obtenerStockRealSucursal(pMaestro, suc);
            if (stockDespues === stockAntes) {
                stockDespues = stockAntes - cantVendida;
            }

            // 🚀 PARCHE ANTI-LIMBO: FORZAR EL GUARDADO LOCAL INMEDIATO
            if (!pMaestro.stock) pMaestro.stock = {};
            pMaestro.stock[suc] = stockDespues;
            try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e) {}

            let minM = pMaestro.md || 10; 
            let precioVentaNormal = pMaestro.pv || 0;
            if (pMaestro.pre_sucursales && typeof sucursalActual !== 'undefined' && pMaestro.pre_sucursales[sucursalActual] !== undefined) {
                precioVentaNormal = pMaestro.pre_sucursales[sucursalActual];
            }
            let precioMayoreo = pMaestro.pm || precioVentaNormal;

            let aplicaMayoreo = (typeof forceWholesale !== 'undefined' && forceWholesale) && (cantVendida >= minM); 
            let subtotalNormal = cantVendida * precioVentaNormal;
            let subtotalMayoreo = aplicaMayoreo ? (cantVendida * precioMayoreo) : subtotalNormal;

            let subtotalPromo = subtotalNormal;
            let promoActiva = null;
            if(typeof promociones !== 'undefined' && Array.isArray(promociones)) {
                promoActiva = promociones.find(pr => pr && (pr.cod === x.cod || pr.cod === codMaestro) && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === (typeof sucursalActual !== 'undefined' ? sucursalActual : 'Todas')) && pr.fecha_ini <= hoy && (!pr.fecha_fin || pr.fecha_fin >= hoy) && (pr.limite === 0 || (pr.usadas||0) < pr.limite));
            }

            if (promoActiva) {
                if (promoActiva.tipo === 'desc') {
                    let cantA = cantVendida; 
                    if((promoActiva.limite||0) > 0) { 
                        let disp = promoActiva.limite - (promoActiva.usadas||0); 
                        if(cantA > disp) cantA = disp; 
                    } 
                    subtotalPromo = (cantA * (precioVentaNormal * (1 - (promoActiva.desc||0)/100))) + ((cantVendida - cantA) * precioVentaNormal); 
                } else if (promoActiva.tipo === 'nxm') {
                    let nVal = promoActiva.n || 1; 
                    let grupos = Math.floor(cantVendida / nVal); 
                    let sueltos = cantVendida % nVal; 
                    if((promoActiva.limite||0) > 0) { 
                        let disp = promoActiva.limite - (promoActiva.usadas||0); 
                        if(grupos > disp) { sueltos += (grupos - disp) * nVal; grupos = disp; } 
                    } 
                    subtotalPromo = (grupos * (promoActiva.m||0) * precioVentaNormal) + (sueltos * precioVentaNormal); 
                }
            }

            let s = subtotalNormal;
            let etiquetaDescuento = "";

            if (aplicaMayoreo && subtotalMayoreo < s) {
                s = subtotalMayoreo;
                etiquetaDescuento = "Precio Mayoreo";
            }
            if (promoActiva && subtotalPromo < s) {
                s = subtotalPromo;
                if(promoActiva.tipo === 'desc') etiquetaDescuento = `Desc (${promoActiva.desc}%)`;
                if(promoActiva.tipo === 'nxm') etiquetaDescuento = `Promo ${promoActiva.n}x${promoActiva.m}`;
            }

            if (x.esGranelMontoExacto !== undefined) {
                s = parseFloat(x.esGranelMontoExacto); 
            } else if (x.precioManual !== undefined) {
                s = cantVendida * x.precioManual; 
                etiquetaDescuento = "Precio Manual";
            }

            let subCobrado = s;
            sumaTotalCobrada += subCobrado;
            let printName = (x.nom || 'Producto').substring(0,15); 
            
            itemsTicketHtml += `<tr><td style="vertical-align:top;">${cantVendida}</td><td>${printName}</td><td style="text-align:right">$${subtotalNormal.toFixed(2)}</td></tr>`;
            
            if (subtotalNormal > subCobrado + 0.01) {
                let ahorroItem = subtotalNormal - subCobrado;
                if(etiquetaDescuento === "") {
                    let porcentaje = Math.round((ahorroItem / subtotalNormal) * 100);
                    etiquetaDescuento = `Desc (${porcentaje}%)`;
                }
                itemsTicketHtml += `<tr><td colspan="2" style="text-align:right; font-size:11px;">↳ ${etiquetaDescuento}:</td><td style="text-align:right; font-size:11px;">-$${ahorroItem.toFixed(2)}</td></tr>`;
            }

            let costoUnitario = parseFloat(pMaestro.cos || pOriginal.cos || pMaestro.pc || pOriginal.pc || 0);
            detallesParaGuardar.push({ 
                cod: x.cod, 
                nom: x.nom || 'Producto', 
                can: cantVendida, 
                subtotal: subCobrado, 
                pv: precioVentaNormal, 
                costo: costoUnitario,
                dep: pOriginal.dep || "General" 
            });
            
            // 🌟 4. CREACIÓN ATÓMICA DEL REGISTRO KARDEX
            let regKardex = {
                id: Date.now() + "_" + Math.floor(Math.random()*1000),
                fecha: hoy,
                hora: horaVenta,
                codigo: x.cod,
                nombre: x.nom || 'Producto',
                tipo: 'VENTA',
                cantidad: -cantVendida,
                stock_antes: stockAntes,
                stock_despues: stockDespues,
                precio: parseFloat(subCobrado / cantVendida) || precioVentaNormal,
                costo: costoUnitario,
                sucursal: suc,
                cajero: usr,
                id_venta: idVentaNueva
            };

            if (typeof window.historialKardex !== 'undefined' && Array.isArray(window.historialKardex)) {
                window.historialKardex.unshift(regKardex);
            }
            if (typeof window.kardex !== 'undefined' && Array.isArray(window.kardex)) {
                window.kardex.unshift(regKardex);
            }

            if (typeof db !== 'undefined') {
                db.collection("kardex").doc(String(regKardex.id)).set(regKardex).catch(e => console.warn("Kardex offline:", e));
            } else if (typeof pb !== 'undefined') {
                pb.collection('kardex').create(regKardex).catch(e => console.warn("Kardex pb offline:", e));
            }

            // 🌟 5. ACTUALIZACIÓN INTELIGENTE DE STOCK (Buscador PB/FB)
            if (typeof pb !== 'undefined' && codMaestro) { 
                try {
                    let idBuscar = String(codMaestro);
                    let pNube = await pb.collection('inventario').getFirstListItem(`doc_id="${idBuscar}"`);
                    
                    if (pNube.data) {
                        if (!pNube.data.stock) pNube.data.stock = {};
                        
                        // 🚀 PARCHE: Mandamos a la nube el número exacto del Kardex, no dejamos que reste a ciegas
                        pNube.data.stock[suc] = stockDespues;
                        pNube.data.updatedAt = Date.now();
                        
                        await pb.collection('inventario').update(pNube.id, pNube);
                    }
                } catch(e) {
                    console.warn("PocketBase no encontró el producto al intentar restar la venta.", e);
                }
            } else if (typeof db !== 'undefined' && codMaestro) { 
                try {
                    let docSnap = await db.collection("inventario").doc(String(codMaestro)).get();
                    if (docSnap.exists) {
                        let productoRealNube = docSnap.data();
                        
                        if (suc !== '' && productoRealNube.inv_sucursales && productoRealNube.inv_sucursales[suc] !== undefined) {
                            productoRealNube.inv_sucursales[suc] -= cantVendida;
                        } else if (productoRealNube.can !== undefined) {
                            productoRealNube.can -= cantVendida;
                        }
                        await db.collection("inventario").doc(String(codMaestro)).set(productoRealNube);
                    }
                } catch(e) {
                    console.warn("Error al restar el inventario en FB.", e);
                }
            }
        }

        if (sumaTotalCobrada > (tot + 0.01)) {
            let ahorroGlobal = sumaTotalCobrada - tot;
            itemsTicketHtml += `<tr><td colspan="2" style="text-align:right;"><b>DESC. REDONDEO:</b></td><td style="text-align:right;">-$${ahorroGlobal.toFixed(2)}</td></tr>`;
        }

        let elFecha = document.getElementById('ticket_fecha');
        if (elFecha) elFecha.innerText = new Date().toLocaleString() + " - " + suc + "\nCliente: " + nomClienteTicket;
        
        let elItems = document.getElementById('ticket_items');
        if (elItems) elItems.innerHTML = itemsTicketHtml; 
        
        let elTotal = document.getElementById('ticket_total');
        if (elTotal) elTotal.innerText = tot.toFixed(2); 
        
        let elMetodo = document.getElementById('ticket_metodo');
        if (elMetodo) elMetodo.innerText = metodosStr; 
        
        let elPagado = document.getElementById('ticket_pagado');
        if (elPagado) elPagado.innerText = totalPagado.toFixed(2);

        let elCambio = document.getElementById('ticket_cambio');
        if (elCambio) elCambio.innerText = cambioReal.toFixed(2); 
        
        let elCajero = document.getElementById('ticket_cajero');
        if (elCajero) elCajero.innerText = usr;
        
        let nuevaVenta = { 
            id: idVentaNueva, fecha: hoy, hora: horaVenta, 
            cajero: usr, sucursal: suc, total: tot, 
            nom: nomClienteTicket,
            metodo: metodosStr, pagos: pagosActuales, 
            recibido: totalPagado, cambio: cambioReal,    
            items: carV.map(x=>x.nom||'').join(','), detalles: detallesParaGuardar, anulada: false 
        };

        if (typeof ventas === 'undefined') window.ventas = [];
        ventas.push(nuevaVenta);
        try { localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas.slice(-200))); } catch(e) { localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas.slice(-50))); }

        // 🚀 AHORA SÍ: GUARDADO DE LA VENTA EN POCKETBASE (Y FIREBASE DE RESPALDO)
        if (typeof pb !== 'undefined') {
            // 🚀 CORRECCIÓN: Clonamos la venta y borramos tu ID de 13 dígitos
            let ventaNube = { ...nuevaVenta }; 
            delete ventaNube.id;               
            
            pb.collection("ventas").create(ventaNube).catch(e => console.warn("Venta a PB offline.", e));
        } else if (typeof db !== 'undefined') { 
            db.collection("ventas").doc(String(idVentaNueva)).set(nuevaVenta).catch(e => console.warn("Venta a FB offline.")); 
        }
        
        carV = []; nombreVentaActual = ""; 
        if (typeof forceWholesale !== 'undefined') forceWholesale = false; 
        if (typeof pagosCobro !== 'undefined') pagosCobro.length = 0; window.pagosCobro = [];
        if (typeof restanteCobro !== 'undefined') restanteCobro = 0; window.restanteCobro = 0;

        let badgeMayoreo = document.getElementById('v_mayoreo_status');
        if(badgeMayoreo) { badgeMayoreo.innerText = "MAYOREO: DESACTIVADO"; badgeMayoreo.style.background = "#444"; badgeMayoreo.style.color = "#bbb"; }

        // ⚡ 1. MOSTRAR EL TICKET INSTANTÁNEAMENTE
        let modalCobro = document.getElementById('modalCobro');
        if (modalCobro) modalCobro.style.display = 'none'; 
        
        let modalTicket = document.getElementById('modalTicket');
        if (modalTicket) modalTicket.style.display = 'block';

        // ⚡ 2. MANDAR EL TRABAJO PESADO A SEGUNDO PLANO
        setTimeout(() => {
            if(typeof window.renderV === "function") window.renderV(); else if(typeof renderV === "function") renderV();
            if(typeof window.renderClientes === "function") window.renderClientes();
            
            let btnCerrar = document.getElementById('btnCerrarTicket'); 
            if(btnCerrar) btnCerrar.focus();
        }, 50); 
        let btnCobrar = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('PROCESANDO'));
        if (btnCobrar) { btnCobrar.innerText = "💳 MANUAL"; btnCobrar.style.pointerEvents = "auto"; btnCobrar.style.backgroundColor = ""; }
        
    } catch(err) { 
        console.error("Error catastrofico en Venta:", err); 
        alert("⚠️ Hubo un error al procesar la venta: " + err.message); 
    } finally {
        // 🛡️ 3. ABRIMOS EL CANDADO (Se ejecuta siempre al final, haya error o no)
        setTimeout(() => {
            window.ventaEnProceso = false;
        }, 1000); // 1 segundo de enfriamiento para limpiar la pantalla por completo
    }
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
        let nuevoItem = { 
            cod: tempGranel.cod, 
            nom: tempGranel.nom, 
            can: c, 
            tipo: 'granel', 
            precioManual: (dineroExacto / c), 
            granelDineroExacto: dineroExacto 
        };

        // 🌟 EL TRUCO: Le pegamos la etiqueta de la promoción para que el sistema la cuente
        if (tempGranel.promo_ref) {
            nuevoItem.promo_ref = tempGranel.promo_ref;
            nuevoItem.usos_promo = c; // Contará los kilos/gramos exactos en la base de datos
        }

        carV.push(nuevoItem); 
        
        if(typeof window.renderV === 'function') window.renderV(); 
        else if(typeof renderV === 'function') renderV();
        
        cerrarModales(); 
    } 
}

function abrirGranel(c) { 
    tempGranel = {...inv[c], cod: c}; 
    let precioReal = parseFloat(tempGranel.pv) || 0;
    if (tempGranel.pre_sucursales && tempGranel.pre_sucursales[sucursalActual] !== undefined) precioReal = parseFloat(tempGranel.pre_sucursales[sucursalActual]);
    
    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    
    if (typeof promociones !== 'undefined' && Array.isArray(promociones)) {
        let promoActiva = promociones.find(pr => pr && pr.cod === c && (!pr.sucursal || pr.sucursal === 'Todas' || pr.sucursal === sucursalActual) && pr.fecha_ini <= hoy && (!pr.fecha_fin || pr.fecha_fin >= hoy) && (pr.limite === 0 || (pr.usadas||0) < pr.limite));
        
        if (promoActiva && promoActiva.tipo === 'desc') {
            precioReal = precioReal - (precioReal * (parseFloat(promoActiva.desc) / 100));
            // 🌟 GUARDAMOS LA REFERENCIA DE LA PROMOCIÓN EN LA MEMORIA TEMPORAL
            tempGranel.promo_ref = promoActiva; 
        }
    }
    
    tempGranel.pv = precioReal; 
    document.getElementById('g_nom').innerText = tempGranel.nom; 
    document.getElementById('g_cant').value = "1"; 
    document.getElementById('g_total_m').value = precioReal.toFixed(2); 
    document.getElementById('modalGranel').style.display = 'block'; 
    
    let cajaKilos = document.getElementById('g_cant'); 
    let cajaDinero = document.getElementById('g_total_m'); 
    let buscadorPrincipal = document.getElementById('v_cod');
    
    cajaKilos.onkeydown = function(e) { if (e.key === 'ArrowDown') { e.preventDefault(); cajaDinero.focus(); cajaDinero.select(); } else if (e.key === 'Enter') { e.preventDefault(); confirmarGranel(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } else if (e.key === 'Escape') { e.preventDefault(); cerrarModales(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } };
    cajaDinero.onkeydown = function(e) { if (e.key === 'ArrowUp') { e.preventDefault(); cajaKilos.focus(); cajaKilos.select(); } else if (e.key === 'Enter') { e.preventDefault(); confirmarGranel(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } else if (e.key === 'Escape') { e.preventDefault(); cerrarModales(); if(buscadorPrincipal){buscadorPrincipal.value=''; buscadorPrincipal.focus();} } };
    
    setTimeout(() => { cajaKilos.focus(); cajaKilos.select(); }, 100); 
}

// Pausadas
// =========================================================
// 🛑 INICIO DEL BLOQUE MAESTRO DE VENTAS PAUSADAS
// =========================================================

// =========================================================
// 🛑 VENTAS PAUSADAS
// =========================================================

// =========================================================
// 🛑 VENTAS PAUSADAS (VERSIÓN ORIGINAL INTACTA)
// =========================================================

function preguntarPausar() { 
    if(carV.length === 0) return; 
    let n = prompt("Nombre venta pausada:", nombreVentaActual || "Cliente "+(pausadas.length+1)); 
    if(n) { 
        let idNuevo = String(Date.now());
        let idPausada = window.idVentaPausadaActual ? window.idVentaPausadaActual : idNuevo; 
        
        // Conservamos todas las propiedades originales y aseguramos 'can', 'cant' y 'cantidad'
        let itemsLimpios = carV.map(item => {
            let q = item.can || item.cant || item.cantidad || 1;
            return {
                ...item,
                can: q,
                cant: q,
                cantidad: q
            };
        });

        let nuevaPausada = { 
            id: String(idPausada), 
            nom: n, 
            total: document.getElementById('v_total').innerText, 
            items: itemsLimpios, 
            sucursal: typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz" 
        }; 
        
        pausadas = pausadas.filter(p => String(p.id) !== String(idPausada)); 
        pausadas.push(nuevaPausada); 
        localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas)); 
        
        // CÓDIGO ORIGINAL DE NUBE
        try { 
            if (typeof db !== 'undefined') {
                if (typeof db.collection("pausadas").create === 'function') {
                    db.collection("pausadas").create(nuevaPausada).catch(() => {
                        if(typeof db.collection("pausadas").update === 'function') {
                            db.collection("pausadas").update(String(idPausada), nuevaPausada);
                        }
                    });
                } else if (db.collection("pausadas").doc) {
                    db.collection("pausadas").doc(String(idPausada)).set(nuevaPausada);
                }
            }
        } catch(e) { console.error("Error al subir a la nube:", e); }
        
        carV = []; 
        forceWholesale = false; 
        window.idVentaPausadaActual = null;
        let badgeMayoreo = document.getElementById('v_mayoreo_status');
        if(badgeMayoreo) { 
            badgeMayoreo.innerText = "MAYOREO: DESACTIVADO"; 
            badgeMayoreo.style.background = "#444"; 
            badgeMayoreo.style.color = "#bbb"; 
        }
        window.renderV(); 
        actualizarContadorPausadas(); 
    } 
    setTimeout(() => { 
        let inputEscaner = document.getElementById('v_cod'); 
        if(inputEscaner) { inputEscaner.value = ''; inputEscaner.focus(); } 
    }, 150);
}

// =========================================================
// RETOMAR VENTA (BORRADO FANTASMA)
// =========================================================

function retomarVenta(idBuscar) { 
    let i = pausadas.findIndex(p => String(p.id) === String(idBuscar));
    if(i === -1) return;

    let ventaRecuperada = pausadas[i];
    carV = Array.isArray(ventaRecuperada.items) ? ventaRecuperada.items : [];
    nombreVentaActual = ventaRecuperada.nom || "Venta";
    window.idVentaPausadaActual = String(ventaRecuperada.id);

    pausadas.splice(i, 1);
    localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas));

    // 👻 SOBREESCRITURA FANTASMA (En vez de borrar, la vaciamos)
    try {
        if (typeof db !== 'undefined') {
            let idStr = String(ventaRecuperada.id);
            let payloadFantasma = { id: idStr, nom: 'FANTASMA', sucursal: 'FANTASMA', items: [], updatedAt: Date.now() };

            if (typeof db.collection("pausadas").update === 'function') {
                db.collection("pausadas").update(idStr, payloadFantasma).catch(e=>{});
            } else if (db.collection("pausadas").doc) {
                db.collection("pausadas").doc(idStr).set(payloadFantasma).catch(e=>{});
            }
        }
    } catch(e) { console.error("Error fantasma:", e); }

    if (typeof window.renderV === 'function') window.renderV();
    if (typeof cerrarModales === 'function') cerrarModales();
    actualizarContadorPausadas();
}

// =========================================================
// CONFIRMAR ELIMINAR (BORRADO FANTASMA)
// =========================================================

function confirmarEliminarPausada() {
    let pinElemento = document.getElementById('auth_pausada_pin');
    let pinIngresado = pinElemento ? pinElemento.value : '';
    let pinCajero = (typeof usuariosData !== 'undefined' && usuariosData[usuarioActual]) ? usuariosData[usuarioActual].pin : null;
    let pinAdmin = (typeof usuariosData !== 'undefined' && usuariosData["Admin"]) ? usuariosData["Admin"].pin : null;

    if(pinIngresado !== pinCajero && pinIngresado !== pinAdmin) {
        alert("❌ PIN Incorrecto.");
        if (pinElemento) {
            pinElemento.value = '';
            pinElemento.focus();
        }
        return;
    }

    let i = pausadas.findIndex(p => String(p.id) === String(idPausadaAEliminar));
    if(i !== -1) {
        let ventaAEliminar = pausadas[i];
        
        pausadas.splice(i, 1);
        localStorage.setItem("pos_pausadas_v6", JSON.stringify(pausadas));

        // 👻 SOBREESCRITURA FANTASMA
        try {
            if (ventaAEliminar && typeof db !== 'undefined') {
                let idStr = String(ventaAEliminar.id);
                let payloadFantasma = { id: idStr, nom: 'FANTASMA', sucursal: 'FANTASMA', items: [], updatedAt: Date.now() };

                if (typeof db.collection("pausadas").update === 'function') {
                    db.collection("pausadas").update(idStr, payloadFantasma).catch(e=>{});
                } else if (db.collection("pausadas").doc) {
                    db.collection("pausadas").doc(idStr).set(payloadFantasma).catch(e=>{});
                }
            }
        } catch(e) { console.error("Error fantasma:", e); }
    }

    actualizarContadorPausadas();

    let sucLimpia = String(typeof sucursalActual !== 'undefined' ? sucursalActual : '').replace(/📍/g, '').trim();
    pausadasFiltradas = pausadas.filter(p => {
        if(!p || p.nom === "FANTASMA") return false;
        if(!p.sucursal) return true;
        return (String(p.sucursal).replace(/📍/g, '').trim() === sucLimpia);
    });

    focusPausadaIndex = 0;
    if (typeof renderTablaPausadas === 'function') renderTablaPausadas();

    let modal = document.getElementById('modalAuthPausada');
    if(modal) modal.style.display = 'none';

    if(pausadasFiltradas.length === 0 && typeof cerrarModales === 'function') { 
        cerrarModales(); 
    }
}

// =========================================================
// VARIABLES
// =========================================================

let pausadasFiltradas = [];

let focusPausadaIndex = 0;

let idPausadaAEliminar = null;



// =========================================================
// ABRIR PAUSADAS
// =========================================================

// =========================================================
// 1. ABRIR PAUSADAS (CON FILTRO ESTRICTO)
// =========================================================
function abrirPausadas() { 
    if(!Array.isArray(pausadas)) pausadas = [];

    let mapa = new Map();
    pausadas.forEach(p => {
        if(!p) return;
        if(!p.id) p.id = String(Date.now()) + Math.random();
        mapa.set(String(p.id), p);
    });
    pausadas = Array.from(mapa.values());

    if(carV && carV.length > 0) {
        if(confirm("⚠️ TIENES UNA VENTA EN CURSO.\n\n¿Deseas poner esta venta en PAUSA primero?")) {
            preguntarPausar();
        }
        return;
    }

    // 🌟 FILTRO ESTRICTO DE SUCURSAL
    let sucLimpia = String(typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz').replace(/📍/g, '').trim().toLowerCase();

    pausadasFiltradas = pausadas.filter(p => {
        if(!p || p.nom === "FANTASMA") return false;
        let sucVenta = String(p.sucursal || 'Matriz').replace(/📍/g, '').trim().toLowerCase();
        return sucVenta === sucLimpia;
    });

    if(pausadasFiltradas.length === 0) {
        return alert("📋 No tienes ninguna venta en espera en esta sucursal.");
    }

    focusPausadaIndex = 0;
    renderTablaPausadas();

    let modal = document.getElementById('modalPausadas');
    if(modal) modal.style.display = 'block';
}

// =========================================================
// 2. ACTUALIZAR CONTADOR (CON FILTRO ESTRICTO)
// =========================================================
function actualizarContadorPausadas() {
    let lbl = document.getElementById('count_pausadas');
    if(!lbl) return;

    let mapa = new Map();
    pausadas.forEach(p => {
        if(p && p.id) mapa.set(String(p.id), p);
    });
    pausadas = Array.from(mapa.values());

    // 🌟 FILTRO ESTRICTO DE SUCURSAL
    let sucLimpia = String(typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz').replace(/📍/g, '').trim().toLowerCase();

    lbl.innerText = pausadas.filter(p => {
        if(!p || p.nom === "FANTASMA") return false;
        let sucVenta = String(p.sucursal || 'Matriz').replace(/📍/g, '').trim().toLowerCase();
        return sucVenta === sucLimpia;
    }).length;
}
// =========================================================
// TABLA
// =========================================================

function renderTablaPausadas() {

    let html =
        pausadasFiltradas
            .map((p, index) => {

                let isFocused =
                    index === focusPausadaIndex;


                let bgRow =
                    isFocused
                        ? 'background:#e0f0ff; border-left: 4px solid var(--info);'
                        : '';


                return `
                    <tr
                        style="cursor:pointer; ${bgRow}"
                        onclick="retomarVenta('${String(p.id)}')"
                    >

                        <td>
                            ${isFocused ? '👉 ' : ''}
                            <b>
                                ${p.nom || 'Venta'}
                            </b>
                        </td>

                        <td>
                            ${(p.items || []).length} art.
                        </td>

                        <td>
                            $${parseFloat(
                                p.total || 0
                            ).toFixed(2)}
                        </td>

                        <td>

                            <button
                                style="
                                    background:var(--danger);
                                    color:white;
                                    border:none;
                                    padding:5px 10px;
                                    border-radius:5px;
                                "
                                onclick="
                                    event.stopPropagation();
                                    eliminarPausada('${String(p.id)}')
                                "
                            >
                                ✕
                            </button>

                        </td>

                    </tr>
                `;

            })
            .join('');


    let lista =
        document.getElementById(
            'p_lista'
        );


    if(lista) {
        lista.innerHTML = html;
    }

}





// =========================================================
// ELIMINAR PAUSADA
// =========================================================

function eliminarPausada(idTarget) {

    idPausadaAEliminar =
        String(idTarget);


    let usuarioElemento =
        document.getElementById(
            'auth_pausada_user'
        );


    if(usuarioElemento) {

        usuarioElemento.innerText =
            typeof usuarioActual !== 'undefined'
                ? usuarioActual
                : 'Cajero';

    }


    let pinElemento =
        document.getElementById(
            'auth_pausada_pin'
        );


    if(pinElemento) {
        pinElemento.value = '';
    }


    let modal =
        document.getElementById(
            'modalAuthPausada'
        );


    if(modal) {

        modal.style.display =
            'block';

    }


    setTimeout(() => {

        if(pinElemento) {
            pinElemento.focus();
        }

    }, 100);

}









// =========================================================
// 🛑 FIN DEL BLOQUE MAESTRO DE VENTAS PAUSADAS
// =========================================================
// ====================================================================
// === MÓDULO DE COMPRAS (C-TAB) ===
// ====================================================================
function handleCompraScan(e) { 
    if(e.key === 'Enter') { 
        let c = document.getElementById('c_cod').value.trim(); 
        if(!c) return;
        
        // 🌟 1. ESCONDER ALERTA AL ESCANEAR UN CÓDIGO NUEVO
        let alertPromo = document.getElementById('c_promo_alert');
        if(alertPromo) alertPromo.style.display = 'none';

        if(inv[c]) { 
            let pOriginal = inv[c];
            let codMaestro = c;
            let pMaestro = pOriginal;

            if (pOriginal.grupo && inv[pOriginal.grupo]) {
                codMaestro = pOriginal.grupo;
                pMaestro = inv[codMaestro];
                
                alert(`⚠️ CÓDIGO DEPENDIENTE DETECTADO\n\n"${pOriginal.nom}" es un espejo.\n\nLa compra y el stock se registrarán directamente en su Producto Maestro:\n👉 ${pMaestro.nom}`);
                
                document.getElementById('c_cod').value = codMaestro;
            }

            // 🌟 2. RADAR DE PROMOCIONES ACTIVAS
            let hoy = (typeof getFechaLocal === 'function') ? getFechaLocal() : new Date().toISOString().split('T')[0];
            let promoActiva = null;
            let promoIndexReal = -1; // Guardaremos su posición en la base de datos

            if (typeof promociones !== 'undefined' && Array.isArray(promociones)) {
                promociones.forEach((pr, idx) => {
                    if (pr && (pr.cod === c || pr.cod === codMaestro) && 
                        (pr.sucursal === 'Todas' || pr.sucursal === sucursalActual || (!pr.sucursal && sucursalActual === 'Matriz')) && 
                        (!pr.fecha_ini || pr.fecha_ini === '' || pr.fecha_ini <= hoy) && 
                        (!pr.fecha_fin || pr.fecha_fin === '' || pr.fecha_fin >= hoy) && 
                        (!pr.limite || pr.limite === 0 || (pr.usadas||0) < pr.limite)) {
                        promoActiva = pr;
                        promoIndexReal = idx; 
                    }
                });
            }

            // 🌟 3. MOSTRAR EL BANNER SI SE DETECTA LA PROMOCIÓN
            if (promoActiva && alertPromo) {
                let precioNormal = parseFloat(pMaestro.pv) || 0;
                let txtPromo = "";
                
                if (promoActiva.tipo === 'desc') {
                    let pPromo = precioNormal * (1 - (parseFloat(promoActiva.desc)/100));
                    txtPromo = `🎁 <b>¡TIENE PROMOCIÓN!</b> Descuento del <b>${promoActiva.desc}%</b>. Precio al público con promo: <b style="font-size:16px;">$${pPromo.toFixed(2)}</b>`;
                } else if (promoActiva.tipo === 'nxm') {
                    txtPromo = `🎁 <b>¡TIENE PROMOCIÓN!</b> Tipo 2x1: <b>LLEVA ${promoActiva.n} Y PAGA ${promoActiva.m}</b>.`;
                }
                
                // Inyectamos el texto y el botón con enlace directo
                alertPromo.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span>${txtPromo}</span>
                        <button type="button" onclick="irEditarPromoDesdeCompras(${promoIndexReal})" style="background:#0d6efd; color:white; border:none; padding:6px 14px; border-radius:4px; font-weight:bold; cursor:pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: all 0.2s;">✏️ Editar/Eliminar Promo</button>
                    </div>
                `;
                alertPromo.style.display = 'block';
            }

            // Continuamos llenando las cajas normalmente...
            document.getElementById('c_nom').value = pMaestro.nom || ""; 
            document.getElementById('c_dep').value = pMaestro.dep || "General"; 
            document.getElementById('c_tipo').value = pMaestro.tipo || "pieza";
            document.getElementById('c_cos').value = pMaestro.cos || 0; 
            document.getElementById('c_iva').value = pMaestro.iva || 0; 
            document.getElementById('c_pv').value = pMaestro.pv || 0; 
            document.getElementById('c_pm').value = pMaestro.pm || 0; 
            document.getElementById('c_md').value = pMaestro.md || 10; 
            
            let cReal = (pMaestro.cos || 0) * (1 + ((pMaestro.iva || 0) / 100));
            document.getElementById('c_real').value = cReal.toFixed(2);
            
            if (cReal > 0) {
                document.getElementById('c_gan').value = ((((pMaestro.pv || 0) / cReal) - 1) * 100).toFixed(2);
            } else {
                document.getElementById('c_gan').value = pMaestro.gan || 30;
            }

            setTimeout(() => { document.getElementById('c_cant').focus(); document.getElementById('c_cant').select(); }, 50); 
        } else {
            document.getElementById('c_nom').value = ""; 
            document.getElementById('c_dep').value = "General"; 
            document.getElementById('c_tipo').value = "pieza";
            document.getElementById('c_cos').value = ""; 
            document.getElementById('c_iva').value = "0"; 
            document.getElementById('c_gan').value = "30"; 
            document.getElementById('c_pv').value = ""; 
            document.getElementById('c_pm').value = ""; 
            document.getElementById('c_md').value = "10"; 
            document.getElementById('c_real').value = "0.00";
            alert("🛒 Producto no registrado.");
            setTimeout(() => { document.getElementById('c_nom').focus(); }, 50); 
        }
    } 
}
// ====================================================================
// 🚀 PUENTE: DE COMPRAS A EDICIÓN DE PROMOCIONES
// ====================================================================
window.irEditarPromoDesdeCompras = function(indexReal) {
    // 1. Cambiamos a la pestaña de promociones
    let btnPromo = document.getElementById('btn_pro-tab');
    if (btnPromo) btnPromo.click();
    
    // 2. Le damos medio segundo a la pantalla para dibujarse, y abrimos el editor
    setTimeout(() => {
        if (typeof editarPromo === 'function') {
            editarPromo(indexReal);
        }
    }, 300);
};

function actualizarCalculosCompra() {
    let costoBase = parseFloat(document.getElementById('c_cos').value) || 0; let impuestoPorcentaje = parseFloat(document.getElementById('c_iva').value) || 0;
    let costoReal = costoBase * (1 + (impuestoPorcentaje / 100));
    document.getElementById('c_real').value = costoReal.toFixed(2);
    calcVentaDesdeGanancia();
}

// ==========================================
// 🪄 MOTOR AUTOMÁTICO DE COMBOS (KITS)
// ==========================================
function autoArmarCombos() {
    // 1. Buscamos todos los combos/kits que tienes guardados en tu inventario
    let todosLosKits = Object.values(inv).filter(p => p.tipo === 'kit' && p.comp && p.comp.length > 0);

    todosLosKits.forEach(kit => {
        let cantidadDeCombosAFormar = Infinity;

        // 2. Revisamos si el cliente trae todos los artículos sueltos necesarios
        kit.comp.forEach(c => {
            let articuloEnCarrito = carV.find(x => x.cod === c.cod);
            if (articuloEnCarrito) {
                // Vemos para cuántos combos nos alcanza con este producto
                let alcances = Math.floor(articuloEnCarrito.can / c.can);
                if (alcances < cantidadDeCombosAFormar) cantidadDeCombosAFormar = alcances;
            } else {
                cantidadDeCombosAFormar = 0; // Falta este producto, abortamos el combo
            }
        });

        // 3. ¡Bingo! El cliente tiene todo lo necesario para armar el combo
        if (cantidadDeCombosAFormar > 0 && cantidadDeCombosAFormar !== Infinity) {
            
            // A. Descontamos los artículos individuales (para no cobrarlos doble)
            kit.comp.forEach(c => {
                let articuloEnCarrito = carV.find(x => x.cod === c.cod);
                articuloEnCarrito.can -= (c.can * cantidadDeCombosAFormar);
                articuloEnCarrito.subtotal = articuloEnCarrito.can * parseFloat(articuloEnCarrito.pre);
                articuloEnCarrito.final_subtotal = articuloEnCarrito.subtotal;
            });

            // B. Borramos de la pantalla los artículos que quedaron en cero
            carV = carV.filter(x => x.can > 0);

            // C. Insertamos el Combo estrella con su precio rebajado
            let comboExistente = carV.find(x => x.cod === kit.cod);
            let precioCombo = parseFloat(kit.pre) || 0; // Aquí toma el precio del Kit

            if (comboExistente) {
                comboExistente.can += cantidadDeCombosAFormar;
                comboExistente.subtotal = comboExistente.can * precioCombo;
                comboExistente.final_subtotal = comboExistente.subtotal;
            } else {
                carV.push({
                    cod: kit.cod,
                    nom: "✨ " + kit.nom,
                    can: cantidadDeCombosAFormar,
                    pre: precioCombo,
                    subtotal: precioCombo * cantidadDeCombosAFormar,
                    final_subtotal: precioCombo * cantidadDeCombosAFormar
                });
            }
        }
    });
}
function calcVentaDesdeGanancia() {
    let costoReal = parseFloat(document.getElementById('c_real').value) || 0; let porcentajeGanancia = parseFloat(document.getElementById('c_gan').value) || 0;
    let precioVenta = costoReal * (1 + (porcentajeGanancia / 100));
    precioVenta = Math.round(precioVenta * 2) / 2;
    document.getElementById('c_pv').value = precioVenta.toFixed(2);
}

function calcGananciaDesdeVenta() {
    let costoReal = parseFloat(document.getElementById('c_real').value) || 0; 
    let precioVenta = parseFloat(document.getElementById('c_pv').value) || 0;
    
    // 🌟 MAGIA MAESTRO-ESPEJO: Detectamos si este producto tiene un Jefe asignado
    let inputGrupo = document.getElementById('c_grupo'); // Asumiendo que c_grupo es el ID de la casilla del Maestro
    let codMaestro = inputGrupo ? inputGrupo.value.trim() : "";
    
    // Si tiene un Maestro y este existe en el inventario, tomamos el costo del Jefe
    if (codMaestro && typeof inv !== 'undefined' && inv[codMaestro]) {
        let pMaestro = inv[codMaestro];
        
        // Obtenemos el costo del Maestro (tomando en cuenta si tiene costo promedio o IVA)
        let costoMaestro = parseFloat(pMaestro.cos_promedio !== undefined ? pMaestro.cos_promedio : (pMaestro.cos || 0));
        let ivaMaestro = parseFloat(pMaestro.iva) || 0;
        
        // Sobreescribimos el costoReal con el del Jefe
        costoReal = costoMaestro * (1 + (ivaMaestro / 100));
        
        // Si el precio de venta está vacío, también usamos el del Jefe por defecto
        if (precioVenta === 0) {
            precioVenta = parseFloat(pMaestro.pv) || 0;
        }
    }

    // Hacemos la matemática final solo si hay un costo válido
    if (costoReal > 0) {
        document.getElementById('c_gan').value = (((precioVenta / costoReal) - 1) * 100).toFixed(2);
    } else {
        document.getElementById('c_gan').value = "0.00";
    }
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





// Controla el comportamiento al cambiar el método de pago principal
function evaluarMetodoSeleccionado() {
    let met = document.getElementById('c_metodo_pago').value;
    let chkInv = document.getElementById('c_inventario_inicial');
    let inputProv = document.getElementById('c_proveedor');

    // Si eligen Pago Mixto, desmarcamos inventario inicial por consistencia
    if (met === "Mixto" && chkInv) {
        chkInv.checked = false;
    }
    
    // Si eligen crédito, le damos un sutil recordatorio visual para el proveedor
    if (met === "Credito" && inputProv) {
        inputProv.style.borderColor = "#dc3545"; 
        inputProv.placeholder = "⚠️ ESCRIBE EL NOMBRE DEL PROVEEDOR AQUÍ...";
    } else if (inputProv) {
        inputProv.style.borderColor = "#ccc";
        inputProv.placeholder = "Nombre de proveedor o General...";
    }
}

// Controla el comportamiento al marcar la casilla de Inventario Inicial
function evaluarInventarioInicial(checkbox) {
    let selectMetodo = document.getElementById('c_metodo_pago');
    if (checkbox.checked && selectMetodo) {
        // Al ser inventario inicial, forzamos temporalmente a efectivo simulado
        // ya que la función maestra 'procesarGuardadoEInventario' saltará los flujos de dinero
        selectMetodo.value = "Efectivo"; 
    }
}


// ==========================================
// 🛠️ HERRAMIENTAS DE INTEGRACIÓN CON POCKETBASE
// ==========================================

// 1. "El Aplanador": Elimina carpetas 'data' anidadas (efecto muñeca matrioshka)
window.limpiarProductoParaNube = function(obj) {
    if (!obj) return {};
    let limpio = { ...obj };
    while (limpio.data !== undefined) {
        let dataInterna = typeof limpio.data === 'object' && limpio.data !== null ? limpio.data : {};
        delete limpio.data;
        limpio = { ...dataInterna, ...limpio };
    }
    delete limpio.id; 
    delete limpio.collectionId; 
    delete limpio.collectionName; 
    delete limpio.created; 
    delete limpio.updated;
    return limpio;
};

// 2. Guardado Seguro: Busca por doc_id exacto (sin alterar el código) y actualiza o crea
window.guardarProductoEnNube = async function(codigoReal, objetoProducto) {
    let clientePB = typeof pb !== 'undefined' ? pb : (typeof db !== 'undefined' ? db : null);
    if (!clientePB) return;
    
    try {
        let codStr = String(codigoReal);
        let prodLimpio = window.limpiarProductoParaNube(objetoProducto);

        // Busca si el producto ya existe en PocketBase por su código real
        let existentes = await clientePB.collection('inventario').getList(1, 1, {
            filter: `doc_id = '${codStr}'`,
            requestKey: null
        }).catch(() => ({ items: [] }));

        let payload = {
            doc_id: codStr,
            data: prodLimpio
        };

        if (existentes.items && existentes.items.length > 0) {
            // Si ya existe, actualiza usando su ID interno real de PocketBase
            let idInternoPB = existentes.items[0].id;
            await clientePB.collection('inventario').update(idInternoPB, payload);
        } else {
            // Si no existe, crea un nuevo registro sin alterar el doc_id
            await clientePB.collection('inventario').create(payload);
        }
    } catch (e) {
        console.error("Error guardando producto en nube:", codigoReal, e);
    }
};
// ====================================================================
// 🧹 SANITIZADOR UNIFICADO DE TIPOS DE DATOS (BLINDAJE DE RAM Y NUBE)
// ====================================================================
function normalizarProducto(p) {
    if (!p || typeof p !== 'object') p = {};

    // 1. Forzar que stock sea SIEMPRE un Objeto por sucursales
    if (typeof p.stock !== 'object' || p.stock === null || Array.isArray(p.stock)) {
        let valNumerico = parseFloat(p.stock) || parseFloat(p.existencia) || 0;
        p.stock = {};
        p.stock[sucursalActual || "Matriz"] = valNumerico;
    }

    // 2. Forzar que sold_without_stock sea Objeto
    if (typeof p.sold_without_stock !== 'object' || p.sold_without_stock === null || Array.isArray(p.sold_without_stock)) {
        p.sold_without_stock = {};
    }

    // 3. Forzar números estrictos en precios y costos
    p.pv = parseFloat(p.pv) || 0;
    p.cos = parseFloat(p.cos) || 0;
    p.pm = parseFloat(p.pm) || p.pv;
    p.gan = parseFloat(p.gan) || 0;
    p.iva = parseFloat(p.iva) || 0;

    // 4. Forzar que updatedAt sea un Timestamp válido
    p.updatedAt = parseInt(p.updatedAt) || Date.now();

    // 5. Arreglos y texto
    p.nom = String(p.nom || "Producto Sin Nombre").trim();
    p.dep = String(p.dep || "General").trim();
    p.tipo = String(p.tipo || "pieza").trim();
    p.comp = Array.isArray(p.comp) ? p.comp : [];

    return p;
}

// ==========================================
// 📦 LÓGICA DE COMPRAS DE PROVEEDORES
// ==========================================

let isGuardandoCompra = false; // Candado anti-doble clic

window.finalizarCompra = async function() { 
    if (isGuardandoCompra) return; 
    if (typeof carC === 'undefined' || carC.length === 0) return; 

    let totalCompra = carC.reduce((acc, x) => acc + ((x.can * x.cos) * (1 - (x.desc||0)/100)), 0); 
    
    let inputMetodo = document.getElementById('c_metodo_pago');
    let inputProveedor = document.getElementById('c_proveedor');
    let inputInventario = document.getElementById('c_inventario_inicial');

    if (!inputMetodo) return alert("❌ ERROR: El sistema no encuentra el menú de Método de Pago.");

    let met = inputMetodo.value; 
    let prov = inputProveedor ? inputProveedor.value.trim() : "";
    let esInventarioInicial = inputInventario ? inputInventario.checked : false;

    let sucReal = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();
    let esPagoCredito = (met === "Credito" || met === "Crédito" || met.toLowerCase().includes("crédito"));

    if (!esInventarioInicial && esPagoCredito && !prov) {
        return alert("❌ Error: Para registrar una compra a CRÉDITO es obligatorio escribir el nombre del Proveedor.");
    }

    if (esInventarioInicial) {
        isGuardandoCompra = true;
        try {
            await window.procesarGuardadoEInventario(totalCompra, "Inventario Inicial", { metodo: "Inventario Inicial", sucursal: sucReal });
            alert("✅ Inventario inicial cargado con éxito.");
        } catch (e) { console.error(e); } finally { isGuardandoCompra = false; }
    } else if (met === "Mixto") {
        if (typeof abrirPagoMixtoCompra === 'function') abrirPagoMixtoCompra(totalCompra); 
    } else if (esPagoCredito) {
        isGuardandoCompra = true;
        try {
            let metaPago = { metodo: met, es_credito: true, monto_credito: totalCompra, sucursal: sucReal };
            await window.procesarGuardadoEInventario(totalCompra, met, metaPago);
            alert("✅ Compra a crédito registrada en la sucursal: " + sucReal);
        } catch (e) { console.error(e); } finally { isGuardandoCompra = false; }
    } else {
        isGuardandoCompra = true;
        try {
            let metaPago = { metodo: met, sucursal: sucReal, cajas_afectadas: met === "Efectivo" ? { "Caja_Actual": totalCompra } : { "Banco_Directo": totalCompra } };
            await window.procesarGuardadoEInventario(totalCompra, met, metaPago);
            alert("✅ Compra directa procesada en la sucursal: " + sucReal);
        } catch (e) { console.error(e); } finally { isGuardandoCompra = false; }
    }
};

window.procesarGuardadoEInventario = async function(totalCompra, metodoNombre, metaPago) {
    let prov = document.getElementById('c_proveedor') ? document.getElementById('c_proveedor').value.trim() : "";
    let esInventarioInicial = document.getElementById('c_inventario_inicial') ? document.getElementById('c_inventario_inicial').checked : false;

    // --- 1. Lógica para actualizar existencias y costos ---
    for (let x of carC) { 
        try {
            let prod = inv[x.cod];
            if (prod && prod.tipo === 'kit' && prod.comp && prod.comp.length > 0) {
                for (let c of prod.comp) {
                    let codComp = c.cod; 
                    let maestroComp = typeof obtenerProductoMaestro === 'function' ? obtenerProductoMaestro(codComp) : inv[codComp];
                    let cantTotalAumentar = (c.can || 1) * x.can; 
                    
                    if (maestroComp) {
                        if (!maestroComp.stock) maestroComp.stock = {};
                        maestroComp.stock[sucursalActual] = (maestroComp.stock[sucursalActual] || 0) + cantTotalAumentar;
                        maestroComp.updatedAt = Date.now();
                        
                        let docIdAActualizar = maestroComp === inv[codComp] ? codComp : inv[codComp].grupo;
                        
                        // 🌟 ESCUDO PARA KITS (DOBLE ACTUALIZACIÓN COMO EN AJUSTE_STOCK)
                        if (typeof pb !== 'undefined' && docIdAActualizar) {
                            try {
                                let idBuscarKit = String(docIdAActualizar);
                                let pNube = await pb.collection("inventario").getFirstListItem(`id="${idBuscarKit}" || cod="${idBuscarKit}" || codigo="${idBuscarKit}"`);
                                
                                if (!pNube.stock) pNube.stock = {};
                                if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                                
                                let nuevoStockK = (parseFloat(pNube.stock[sucursalActual]) || 0) + cantTotalAumentar;
                                pNube.stock[sucursalActual] = nuevoStockK;
                                pNube.inv_sucursales[sucursalActual] = nuevoStockK;
                                pNube.updatedAt = Date.now();
                                
                                await pb.collection("inventario").update(pNube.id, pNube);
                            } catch(e) { console.warn("Error PB Kit", e); }
                            
                        } else if (typeof db !== 'undefined' && docIdAActualizar) {
                            try {
                                let docSnap = await db.collection("inventario").doc(String(docIdAActualizar)).get();
                                if (docSnap.exists) {
                                    let pNube = docSnap.data();
                                    
                                    if (!pNube.stock) pNube.stock = {};
                                    if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                                    
                                    let nuevoStockK = (parseFloat(pNube.stock[sucursalActual]) || 0) + cantTotalAumentar;
                                    pNube.stock[sucursalActual] = nuevoStockK;
                                    pNube.inv_sucursales[sucursalActual] = nuevoStockK;
                                    pNube.updatedAt = Date.now();
                                    
                                    await db.collection("inventario").doc(String(docIdAActualizar)).set(pNube);
                                }
                            } catch(e) { console.warn("Error FB Kit", e); }
                        }
                    }
                }
            } else if (prod) {
                let maestro = typeof obtenerProductoMaestro === 'function' ? obtenerProductoMaestro(x.cod) : inv[x.cod];
                
                let stockAntesReal = 0;
                if (maestro.stock && typeof maestro.stock === 'object') {
                    stockAntesReal = parseFloat(maestro.stock[sucursalActual]) || 0;
                } else {
                    stockAntesReal = parseFloat(maestro.stock) || parseFloat(maestro.existencia) || parseFloat(maestro.can) || 0;
                }
                if (stockAntesReal < 0) stockAntesReal = 0;

                let stockDespuesReal = stockAntesReal + parseFloat(x.can);

                if (!maestro.stock) maestro.stock = {}; 
                maestro.stock[sucursalActual] = stockDespuesReal; 
                
                let conceptoKardex = esInventarioInicial ? "CARGA INICIAL" : "COMPRA";
                
                if (typeof registrarEnKardex === 'function') {
                    registrarEnKardex(x.cod, prod.nom, conceptoKardex, x.can, x.pre || prod.pv, x.cos || prod.cos, stockAntesReal, stockDespuesReal);
                }

                let costoCompraUnitarioBase = 0;
                if (x.cos_base !== undefined) { 
                    costoCompraUnitarioBase = parseFloat(x.cos_base); 
                    if (x.iva !== undefined) prod.iva = x.iva; 
                } else if (x.cos !== undefined) { 
                    costoCompraUnitarioBase = parseFloat(x.cos / (1 + ((prod.iva||0) / 100))); 
                }

                if (costoCompraUnitarioBase > 0) {
                    let costoHistorico = prod.cos_promedio !== undefined ? parseFloat(prod.cos_promedio) : (parseFloat(prod.cos) || 0);
                    let valorViejo = stockAntesReal * costoHistorico;
                    let valorNuevo = x.can * costoCompraUnitarioBase;
                    let piezasTotales = stockAntesReal + x.can;
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
                }
                
                prod.updatedAt = Date.now(); 
                if (maestro !== prod) maestro.updatedAt = Date.now();
                
               // 🌟 ESCUDO PARA PRODUCTOS NORMALES 
                if (typeof pb !== 'undefined' && x.cod) {
                    try {
                        // 1. Buscamos en la columna correcta que sí existe en tu tabla: 'doc_id'
                        let pNube = await pb.collection("inventario").getFirstListItem(`doc_id="${x.cod}"`);
                        
                        // 2. Entramos a la caja 'data' que es donde realmente tienes el stock y precios
                        if (!pNube.data.stock) pNube.data.stock = {};
                        
                        let nuevoStockP = (parseFloat(pNube.data.stock[sucursalActual]) || 0) + parseFloat(x.can);
                        pNube.data.stock[sucursalActual] = nuevoStockP;
                        
                        if (prod.cos !== undefined) pNube.data.cos = prod.cos;
                        if (prod.cos_promedio !== undefined) pNube.data.cos_promedio = prod.cos_promedio;
                        if (prod.iva !== undefined) pNube.data.iva = prod.iva;
                        if (prod.pv !== undefined) pNube.data.pv = prod.pv;
                        if (prod.pre_sucursales) pNube.data.pre_sucursales = prod.pre_sucursales;
                        pNube.data.updatedAt = Date.now();

                        // Actualizamos el registro completo
                        await pb.collection("inventario").update(pNube.id, pNube);

                        // Si es un producto con Grupo/Maestro
                        if (maestro !== prod && prod.grupo) {
                            let mNube = await pb.collection("inventario").getFirstListItem(`doc_id="${prod.grupo}"`);
                            
                            if (!mNube.data.stock) mNube.data.stock = {};
                            
                            let nuevoStockG = (parseFloat(mNube.data.stock[sucursalActual]) || 0) + parseFloat(x.can);
                            mNube.data.stock[sucursalActual] = nuevoStockG;
                            mNube.data.updatedAt = Date.now();
                            
                            await pb.collection("inventario").update(mNube.id, mNube);
                        }
                    } catch(e) { console.warn("Error PB Compra:", e); }

                } else if (typeof db !== 'undefined' && x.cod) {
                    // ... (Aquí dejas tu código de Firebase "db" tal cual lo tienes) ...
                    try {
                        let docSnap = await db.collection("inventario").doc(String(x.cod)).get();
                        if (docSnap.exists) {
                            let pNube = docSnap.data();
                            
                            if (!pNube.stock) pNube.stock = {};
                            if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                            
                            let nuevoStockP = (parseFloat(pNube.stock[sucursalActual]) || 0) + parseFloat(x.can);
                            pNube.stock[sucursalActual] = nuevoStockP;
                            pNube.inv_sucursales[sucursalActual] = nuevoStockP;
                            
                            if (prod.cos !== undefined) pNube.cos = prod.cos;
                            if (prod.cos_promedio !== undefined) pNube.cos_promedio = prod.cos_promedio;
                            if (prod.iva !== undefined) pNube.iva = prod.iva;
                            if (prod.pv !== undefined) pNube.pv = prod.pv;
                            if (prod.pre_sucursales) pNube.pre_sucursales = prod.pre_sucursales;
                            pNube.updatedAt = Date.now();

                            await db.collection("inventario").doc(String(x.cod)).set(pNube);
                        }
                        
                        if (maestro !== prod && prod.grupo) {
                            let mSnap = await db.collection("inventario").doc(String(prod.grupo)).get();
                            if (mSnap.exists) {
                                let mNube = mSnap.data();
                                
                                if (!mNube.stock) mNube.stock = {};
                                if (!mNube.inv_sucursales) mNube.inv_sucursales = {};
                                
                                let nuevoStockG = (parseFloat(mNube.stock[sucursalActual]) || 0) + parseFloat(x.can);
                                mNube.stock[sucursalActual] = nuevoStockG;
                                mNube.inv_sucursales[sucursalActual] = nuevoStockG;
                                mNube.updatedAt = Date.now();
                                
                                await db.collection("inventario").doc(String(prod.grupo)).set(mNube);
                            }
                        }
                    } catch(e) { console.warn("Error FB Compra:", e); }
                }
            }
        } catch (errorItem) {
            console.error("Error aislando producto: ", x.cod, errorItem);
        }
    }

    // --- 2. Guardado de datos original usando el objeto 'db' ---
    try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e) {}
    let idCompra = Date.now();
    
    let objetoCompra = { 
        id: idCompra, 
        doc_id: String(idCompra), 
        fecha: typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0], 
        hora: new Date().toLocaleTimeString(), 
        cajero: usuarioActual, 
        sucursal: sucursalActual, 
        proveedor: prov || "General", 
        metodo: metodoNombre, 
        total: totalCompra, 
        items: carC,
        ...metaPago 
    };
    
    if (typeof compras === 'undefined') window.compras = [];
    compras.push(objetoCompra); 
    
    if (compras.length > 100) compras = compras.slice(-100);
    
    try { 
        localStorage.setItem("pos_compras_local", JSON.stringify(compras)); 
    } catch(e) {
        localStorage.removeItem("pos_compras_local");
        compras = compras.slice(-20); 
        try { localStorage.setItem("pos_compras_local", JSON.stringify(compras)); } catch(err) {}
    }
    
    // ☁️ Guardado en Firebase
    if (typeof db !== 'undefined') {
        await db.collection("compras").doc(String(idCompra)).set(objetoCompra).catch(e => console.error("Error Nube Compras FB: ", e));
    }
    
    // ☁️ Guardado en PocketBase (Con el truco del ID para que no lo rechace)
    if (typeof pb !== 'undefined') {
        try {
            let compraNube = { ...objetoCompra };
            delete compraNube.id; 
            await pb.collection("compras").create(compraNube);
        } catch(e) {
            console.warn("Error Nube Compras PB:", e);
        }
    }

    // --- 3. PARCHE DE AUDITORÍA CONTABLE ---
    if (metaPago && metaPago.metodo === "Mixto Especial" && metaPago.cajas_afectadas) {
        let cajas = metaPago.cajas_afectadas;
        for (let cajeroAfectado of Object.keys(cajas)) {
            let montoRetirado = parseFloat(cajas[cajeroAfectado]) || 0;
            if (montoRetirado > 0 && cajeroAfectado !== "Banco_Directo") {
                let idMov = Date.now() + Math.floor(Math.random() * 1000); 
                let nuevoRetiro = {
                    id: idMov,
                    fecha: typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0],
                    hora: new Date().toLocaleTimeString(),
                    cajero: cajeroAfectado, 
                    sucursal: sucursalActual,
                    tipo: 'Retiro',
                    monto: montoRetirado,
                    motivo: `COMPRA MIXTA ESP. (Fondo tomado por Admin para proveedor: ${prov || "General"})`
                };
                if (typeof movimientos !== 'undefined') {
                    movimientos.push(nuevoRetiro);
                    try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); } catch(e) {}
                }
                if (typeof db !== 'undefined') {
                    await db.collection("movimientos").doc(String(idMov)).set(nuevoRetiro).catch(e => console.error("Error retiro auditoría:", e));
                }
            }
        }
    }

    // --- 4. Anotar la deuda en la libreta del proveedor ---
    if (metaPago && metaPago.es_credito && metaPago.monto_credito > 0) {
        let nomInput = prov || "Proveedor General";
        let nomLimpio = nomInput.split('_')[0]; 
        let sucLimpia = String(sucursalActual || "").replace(/📍/g, '').trim();
        let idUnico = nomLimpio + "_" + sucLimpia;
        
        if (typeof proveedores === 'undefined') window.proveedores = {};
        
        if (!proveedores[idUnico]) {
            proveedores[idUnico] = { nom: nomLimpio, sucursal: sucLimpia, saldo: 0, historial: [] };
        } else {
            proveedores[idUnico].nom = nomLimpio;
            proveedores[idUnico].sucursal = sucLimpia;
        }
        
        proveedores[idUnico].saldo = (proveedores[idUnico].saldo || 0) + metaPago.monto_credito;
        if (!proveedores[idUnico].historial) proveedores[idUnico].historial = [];
        proveedores[idUnico].historial.push({ 
            fecha: typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0], 
            hora: new Date().toLocaleTimeString(), 
            tipo: 'Compra', 
            monto: metaPago.monto_credito, 
            detalle: `Folio Ticket Nube: ${idCompra}` 
        });

        try { localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores)); } catch(e) {}

        if (typeof db !== 'undefined') {
            db.collection("proveedores").doc(idUnico).set(proveedores[idUnico]).catch(e => console.warn("Error Firebase:", e));
        }

        if (typeof pb !== 'undefined') {
            let provCrear = { doc_id: String(idUnico), data: proveedores[idUnico] };
            pb.collection("proveedores").getFirstListItem(`doc_id="${idUnico}"`).then(pvNube => {
                pvNube.data = proveedores[idUnico];
                pb.collection("proveedores").update(pvNube.id, pvNube);
            }).catch(e => {
                pb.collection("proveedores").create(provCrear);
            });
        }
        if (typeof renderProveedores === 'function') renderProveedores();
    }
    
    // --- 5. Limpieza del carrito ---
    carC = []; 
    if (typeof renderC === 'function') renderC(); 
    if (typeof renderI === 'function') renderI(); 
    if (typeof renderCorte === 'function') renderCorte(); 
    let checkInventario = document.getElementById('c_inventario_inicial');
    if (checkInventario && checkInventario.checked) checkInventario.checked = false; 
};

// ==========================================
// ✏️ AJUSTE MANUAL DE STOCK
// ==========================================

window.guardarAjusteStock = async function() {
    let nuevoStock = parseFloat(document.getElementById('ajuste_nuevo_stock').value);
    let pin = document.getElementById('ajuste_admin_pin').value;
    
    if (isNaN(nuevoStock) || nuevoStock < 0) return alert("⚠️ Cantidad inválida.");
    
    if (usuariosData["Admin"] && usuariosData["Admin"].pin === pin) {
        let pO = inv[codAjusteStock] || {};
        let codMaestro = (pO.grupo && inv[pO.grupo]) ? pO.grupo : codAjusteStock;
        let pMaestro = inv[codMaestro] || pO;

        let stockAntesReal = 0;
        if (pMaestro.stock && typeof pMaestro.stock === 'object') {
            stockAntesReal = parseFloat(pMaestro.stock[sucursalActual]) || 0;
        } else {
            stockAntesReal = parseFloat(pMaestro.stock) || parseFloat(pMaestro.existencia) || parseFloat(pMaestro.can) || 0;
        }

        let stockDespuesReal = parseFloat(nuevoStock.toFixed(3));
        let diferencia = parseFloat((stockDespuesReal - stockAntesReal).toFixed(3));

        if (typeof pMaestro.stock !== 'object' || pMaestro.stock === null) {
            pMaestro.stock = {};
        }
        
        // 1. Ajuste en la memoria local (Esto se guarda sí o sí)
        pMaestro.stock[sucursalActual] = stockDespuesReal;
        try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch (e) { }

        let guardadoExitoso = false;

        // 🌟 ESCUDO ANTI-DUPLICADOS (Buscador inteligente)
        if (typeof pb !== 'undefined') {
            try {
                let idBuscar = String(codMaestro); 
                // En lugar de buscar por ID estricto, buscamos dentro de la columna 'cod' o 'codigo'
                let pNube = await pb.collection('inventario').getFirstListItem(`id="${idBuscar}" || cod="${idBuscar}" || codigo="${idBuscar}"`);
                
                if (!pNube.stock) pNube.stock = {};
                if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                
                pNube.stock[sucursalActual] = stockDespuesReal;
                pNube.inv_sucursales[sucursalActual] = stockDespuesReal;
                if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) pNube.can = stockDespuesReal;
                
                // Actualizamos usando el ID interno real que PocketBase le haya asignado (Evita duplicados)
                await pb.collection('inventario').update(pNube.id, pNube);
                guardadoExitoso = true;
            } catch (errPb) {
                console.warn("PocketBase no localizó el código. Pasando a sistema secundario...");
            }
        }

        // INTENTO 2: Sistema original db (Solo usamos .set para evitar el error de .get)
        if (!guardadoExitoso && typeof db !== 'undefined') {
            try {
                await db.collection("inventario").doc(String(codMaestro)).set(pMaestro);
                guardadoExitoso = true;
            } catch (errFb) {
                console.error("Error en base de datos secundaria:", errFb);
            }
        }

        // FIN DEL PROCESO
        if (guardadoExitoso) {
            if (typeof registrarEnKardex === 'function') {
                registrarEnKardex(codAjusteStock, pO.nom, "AJUSTE", diferencia, pO.pv || 0, pO.cos || 0, stockAntesReal, stockDespuesReal);
            }
            document.getElementById('modalAjusteStock').style.display = 'none';
            alert("✅ Stock ajustado y guardado correctamente.");
        } else {
            // Si ambos fallan por falta de internet, no bloqueamos al usuario, confirmamos que se guardó local
            document.getElementById('modalAjusteStock').style.display = 'none';
            alert("⚠️ Stock guardado localmente (La nube no respondió o estás offline).");
        }
        
        if (typeof renderTablaInventario === 'function') renderTablaInventario();
        if (typeof renderI === 'function') renderI(); 

    } else {
        alert("❌ PIN Incorrecto.");
        document.getElementById('ajuste_admin_pin').value = '';
        document.getElementById('ajuste_admin_pin').focus();
    }
};

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
    let html = ''; 
    let count = 0;
    
    let sucActiva = (typeof sucursalActual !== 'undefined' ? sucursalActual : '').toString();
    let sucursalFiltro = sucActiva.replace(/📍/g, '').trim().toLowerCase();

    Object.keys(clientes).forEach(clave => { 
        let c = clientes[clave]; 
        
        let sucCli = c.sucursal ? String(c.sucursal).replace(/📍/g, '').trim() : 'Matriz';
        let sucCliLimpia = sucCli.toLowerCase();

        // 🌟 CONDICIÓN: Aislamiento total por sucursal
        let mostrar = (sucursalFiltro === 'todas' || sucursalFiltro === '' || sucursalFiltro === sucCliLimpia);

        if (mostrar) {
            count++;
            
            // 🌟 TRUCO VISUAL: Mostramos el teléfono limpio (Ej. "1") aunque internamente sea "1_Matriz"
            let telParaMostrar = c.tel || clave.split('_')[0];

            let badgeSucursal = `<br><small style="color:gray; font-size:10px;">📍 ${sucCli}</small>`;
            
            html += `<tr>
                <td>${telParaMostrar}</td>
                <td><b>${c.nom}</b> ${badgeSucursal}</td>
                <td>$${(parseFloat(c.limite)||0).toFixed(2)}</td>
                <td style="color:${c.saldo > 0 ? 'var(--danger)' : '#000'}; font-weight:bold;">$${(parseFloat(c.saldo)||0).toFixed(2)}</td>
                <td>
                    <button title="Ver Estado de Cuenta" style="background:var(--info); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirHistorialCli('${clave}')">📋</button>
                    <button title="Recibir Abono" style="background:var(--s); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAbono('${clave}')">💲</button> 
                    <button title="Editar Cliente" style="background:var(--p); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="editarCliente('${clave}')">✏️</button> 
                    <button title="Eliminar Cliente" style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAuthCli('${clave}')">🗑️</button>
                </td>
            </tr>`; 
        }
    }); 
    
    let tbody = document.getElementById('cli_lista');
    if (tbody) {
        tbody.innerHTML = count > 0 ? html : `<tr><td colspan="5" style="text-align:center; padding:15px; color:gray;">No hay clientes en esta sucursal</td></tr>`; 
    }
    
    if (typeof actualizarSelectClientesCobro === 'function') {
        actualizarSelectClientesCobro();
    }
}
function filtrarClientes() { let txt = document.getElementById('buscar_cli').value.toLowerCase(); let trs = document.getElementById('cli_lista').getElementsByTagName('tr'); for(let tr of trs) { if(tr.cells.length > 1) { tr.style.display = (tr.cells[0].innerText.toLowerCase().includes(txt) || tr.cells[1].innerText.toLowerCase().includes(txt)) ? '' : 'none'; } } }
function abrirModalCliente() { document.getElementById('cli_tel').value = ''; document.getElementById('cli_tel').readOnly = false; document.getElementById('cli_nom').value = ''; document.getElementById('cli_limite').value = '1000'; document.getElementById('modalCliente').style.display = 'block'; setTimeout(()=>document.getElementById('cli_tel').focus(), 100); }
function editarCliente(tel) { document.getElementById('cli_tel').value = tel; document.getElementById('cli_tel').readOnly = true; document.getElementById('cli_nom').value = clientes[tel].nom; document.getElementById('cli_limite').value = clientes[tel].limite; document.getElementById('modalCliente').style.display = 'block'; }
function guardarCliente() { 
    let telInput = document.getElementById('cli_tel').value.trim(); 
    let nom = document.getElementById('cli_nom').value.trim(); 
    let lim = parseFloat(document.getElementById('cli_limite').value) || 0; 
    
    if(!telInput || !nom) return alert("⚠️ Faltan datos (Teléfono o Nombre)."); 
    
    // 🛡️ Limpiamos la sucursal
    let sucLimpia = String(sucursalActual || "").replace(/📍/g, '').trim();
    
    // 🌟 MAGIA DE AISLAMIENTO: Creamos un ID único por sucursal (Ej. "1_Matriz")
    let idUnico = telInput + "_" + sucLimpia;
    
    if(!clientes[idUnico]) {
        // Creamos un cliente 100% independiente para esta sucursal
        clientes[idUnico] = { tel: telInput, nom: nom, limite: lim, saldo: 0, sucursal: sucLimpia }; 
    } else { 
        // Actualizamos solo el de esta sucursal
        clientes[idUnico].nom = nom; 
        clientes[idUnico].limite = lim; 
        clientes[idUnico].sucursal = sucLimpia;
        clientes[idUnico].tel = telInput; // Guardamos el número original por si acaso
    } 
    
    // 💾 Guardado
    localStorage.setItem("pos_clientes_v7", JSON.stringify(clientes));

    if (typeof db !== 'undefined') {
        db.collection("clientes").doc(idUnico).set(clientes[idUnico]).then(() => { 
            alert("✅ Cliente guardado de forma independiente en: " + sucLimpia); 
            if(typeof cerrarModales === 'function') cerrarModales(); 
            if(typeof renderClientes === 'function') renderClientes(); 
        }).catch(e => console.log("Error al guardar en la nube:", e)); 
    } else {
        alert("✅ Cliente guardado localmente."); 
        if(typeof cerrarModales === 'function') cerrarModales(); 
        if(typeof renderClientes === 'function') renderClientes();
    }
}
function abrirModalAbono(tel) { telAbonoActual = tel; document.getElementById('abono_nom').innerText = clientes[tel].nom; document.getElementById('abono_deuda').innerText = (clientes[tel].saldo||0).toFixed(2); document.getElementById('abono_monto').value = ''; document.getElementById('modalAbono').style.display = 'block'; setTimeout(()=>document.getElementById('abono_monto').focus(), 100); }
window.confirmarAbono = function() {
    // 1. Usamos tu variable original exacta
    let telCli = telAbonoActual; 
    
    if(!telCli || !clientes[telCli]) return alert("❌ Cliente no encontrado. Cierra la ventana e intenta de nuevo.");
    
    let c = clientes[telCli];
    let monto = parseFloat(document.getElementById('abono_monto').value) || 0;
    let metodo = document.getElementById('abono_metodo_pago').value;
    
    if (monto <= 0) return alert("❌ Ingresa un monto válido mayor a 0.");
    
    // 2. Tomamos el saldo global real
    let saldoAnterior = parseFloat(c.saldo) || 0;

    // 3. DESCONTAMOS LA DEUDA
    c.saldo = parseFloat(Math.max(0, saldoAnterior - monto).toFixed(2));
    
    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    let hora = new Date().toLocaleTimeString();

    // 4. REGISTRAR EN EL ESTADO DE CUENTA
    if (!c.historial) c.historial = [];
    c.historial.push({
        id_venta: Date.now(), 
        fecha: hoy, 
        hora: hora,
        tipo: 'Abono', 
        monto: -monto, 
        detalle: `Pago en ${metodo}`
    });

    // 5. GUARDAR EN MEMORIA Y EN LA NUBE
    clientes[telCli] = c;
    try { localStorage.setItem("pos_clientes_v7", JSON.stringify(clientes)); } catch(e){}
    if (typeof db !== 'undefined') {
        try { db.collection("clientes").doc(String(telCli)).set(c); } catch(e) {}
    }

    // 6. REGISTRAR EL INGRESO EN LA CAJA
    if (metodo === "Efectivo") {
        let idMov = Date.now();
        let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Cajero';
        let idSesionTurno = (window.sesionCajaActual ? window.sesionCajaActual.id : null);
        let sucMov = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';

        let nuevoMov = { 
            id: idMov, 
            id_sesion_caja: idSesionTurno, 
            fecha: hoy, 
            hora: hora, 
            cajero: miNombre, 
            sucursal: sucMov, 
            tipo: "Ingreso", 
            monto: monto, 
            motivo: `Abono de deuda: ${c.nom}` 
        };
        
        if(typeof movimientos === 'undefined') window.movimientos = [];
        movimientos.push(nuevoMov); 
        
        try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); } catch(e){}
        if (typeof db !== 'undefined') {
            try { db.collection("movimientos").doc(String(idMov)).set(nuevoMov); } catch(e) {}
        }
    }

    // Cerramos la ventana
    document.getElementById('modalAbono').style.display = 'none';
    
    // 7. 🌟 FORZAMOS A LA PANTALLA A DIBUJAR LA TABLA ACTUALIZADA 🌟
    if (typeof renderClientes === 'function') renderClientes();
    if (typeof filtrarClientes === 'function') filtrarClientes(); 
    if (typeof renderCorte === 'function') renderCorte();
    
    alert(`✅ Abono de $${monto} registrado.\nNuevo saldo de ${c.nom}: $${c.saldo}`);
};
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
    let html = ''; 
    let count = 0;

    // 🛡️ Extraemos la sucursal activa de forma segura
    let sucActiva = (typeof sucursalActual !== 'undefined' ? sucursalActual : '').toString();
    let sucursalFiltro = sucActiva.replace(/📍/g, '').trim().toLowerCase();

    if (!typeof proveedores === 'object' || proveedores === null) return;

    Object.keys(proveedores).forEach(nombre => { 
        let p = proveedores[nombre]; 
        
        // Asignamos sucursal o 'Matriz' si es antiguo
        let sucProv = p.sucursal ? String(p.sucursal).replace(/📍/g, '').trim() : 'Matriz'; 
        let sucProvLimpia = sucProv.toLowerCase();

        // Si estamos en 'todas', '' o coincide la sucursal
        let mostrar = (sucursalFiltro === 'todas' || sucursalFiltro === '' || sucursalFiltro === sucProvLimpia);

        if (mostrar) {
            count++; 
            let saldoReal = parseFloat(p.saldo) || 0;
            // Si el saldo es menor a 0.01 se considera PAGADA para evitar decimales infinitos
            let estadoBadge = saldoReal <= 0.01 ? '<span style="background:var(--s); color:white; padding:3px 8px; border-radius:12px; font-size:11px; margin-left:10px;">✅ PAGADA</span>' : '';
            
            html += `<tr>
                <td>
                    <b>${nombre}</b> ${estadoBadge} <br>
                    <small style="color:gray; font-size:10px;">📍 ${sucProv}</small>
                </td>
                <td style="color:${saldoReal > 0.01 ? 'var(--danger)' : '#000'}; font-weight:bold;">$${Math.max(0, saldoReal).toFixed(2)}</td>
                <td>
                    <button style="background:var(--info); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirHistorialProv('${nombre}')">📋</button> 
                    <button style="background:var(--warning); color:#000; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAbonoProv('${nombre}')">💸</button> 
                    <button style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;" onclick="abrirModalAuthProv('${nombre}')">🗑️</button>
                </td>
            </tr>`; 
        }
    }); 
    
    let tbody = document.getElementById('prov_lista');
    if (tbody) {
        tbody.innerHTML = count > 0 ? html : `<tr><td colspan="3" style="text-align:center; padding:15px; color:gray;">No hay proveedores registrados en esta sucursal</td></tr>`; 
    }
}
function abrirHistorialProv(nombre) {
    let p = proveedores[nombre]; if(!p) return;
    document.getElementById('hist_prov_nom').innerText = nombre; document.getElementById('hist_prov_saldo').innerText = (p.saldo || 0).toFixed(2);
    document.getElementById('hist_prov_status').innerHTML = p.saldo <= 0 ? '<span style="background:var(--s); color:white; padding:5px 15px; border-radius:20px; font-weight:bold;">✅ AL CORRIENTE</span>' : '<span style="background:var(--danger); color:white; padding:5px 15px; border-radius:20px; font-weight:bold;">⚠️ PENDIENTE</span>';
    document.getElementById('hist_prov_lista').innerHTML = (p.historial || []).map(h => `<tr><td>${h.fecha} ${h.hora}</td><td><b>${h.tipo}</b></td><td>${h.detalle}</td><td style="text-align:right; color:${h.tipo === 'Compra' ? 'var(--danger)' : 'var(--s)'};">...$${(h.monto||0).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="4">Vacio</td></tr>';
    document.getElementById('modalHistorialProv').style.display = 'block';
}
function abrirModalAbonoProv(nombre) { provAbonoActual = nombre; document.getElementById('abono_prov_nom').innerText = nombre; document.getElementById('abono_prov_deuda').innerText = (proveedores[nombre].saldo||0).toFixed(2); document.getElementById('abono_prov_monto').value = ''; document.getElementById('modalAbonoProv').style.display = 'block'; setTimeout(()=>document.getElementById('abono_prov_monto').focus(), 100); }
window.confirmarAbonoProv = function() {
    // 1. Usamos tu variable original (igual que con los clientes) o buscamos por nombre
    let idProv = typeof provAbonoActual !== 'undefined' ? provAbonoActual : null;

    if (!idProv || !proveedores[idProv]) {
        let provHtml = document.getElementById('abono_prov_nom').innerText || "";
        let provBuscado = provHtml.trim().toLowerCase();
        
        idProv = Object.keys(proveedores).find(key => {
            let p = proveedores[key];
            let nombreP = p.nom || p.nombre || p.proveedor || "";
            return nombreP.trim().toLowerCase() === provBuscado;
        });
    }

    if (!idProv || !proveedores[idProv]) {
        return alert("❌ Proveedor no encontrado. Cierra la ventana e intenta de nuevo.");
    }

    let p = proveedores[idProv];
    let monto = parseFloat(document.getElementById('abono_prov_monto').value) || 0;
    let metodo = document.getElementById('abono_prov_metodo').value;

    if (monto <= 0) return alert("❌ Ingresa un monto válido mayor a 0.");

    // 2. DETECTOR DE VARIABLES (Busca cómo se llama la deuda y el nombre en tu sistema)
    let nombreReal = p.nom || p.nombre || p.proveedor || "Proveedor";
    let deudaAnterior = parseFloat(p.deuda !== undefined ? p.deuda : p.saldo) || 0;

    // 3. DESCONTAMOS LA DEUDA
    let nuevaDeuda = parseFloat(Math.max(0, deudaAnterior - monto).toFixed(2));
    
    // Lo guardamos en la variable correcta
    if (p.deuda !== undefined) p.deuda = nuevaDeuda;
    else p.saldo = nuevaDeuda;

    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    let hora = new Date().toLocaleTimeString();

    // 4. REGISTRAR EN EL HISTORIAL
    if (!p.historial) p.historial = [];
    p.historial.push({
        id_movimiento: Date.now(),
        fecha: hoy,
        hora: hora,
        tipo: 'Abono / Pago',
        monto: monto, 
        detalle: `Pago en ${metodo}`
    });

    // 5. GUARDAR EN MEMORIA Y EN LA NUBE
    proveedores[idProv] = p;
    try { localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores)); } catch(e){}
    
    if (typeof db !== 'undefined') {
        try { db.collection("proveedores").doc(String(idProv)).set(p); } catch(e) {}
    }

    // 6. REGISTRAR LA SALIDA DE DINERO EN CAJA (Gasto)
    if (metodo === "Efectivo") {
        let idMov = Date.now();
        let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Cajero';
        let idSesionTurno = (window.sesionCajaActual ? window.sesionCajaActual.id : null);
        let sucMov = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';

        let nuevoMov = { 
            id: idMov, 
            id_sesion_caja: idSesionTurno, 
            fecha: hoy, 
            hora: hora, 
            cajero: miNombre, 
            sucursal: sucMov, 
            tipo: "Retiro",
            monto: monto, 
            motivo: `Pago a proveedor: ${nombreReal}` 
        };
        
        if (typeof movimientos === 'undefined') window.movimientos = [];
        movimientos.push(nuevoMov); 
        
        try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); } catch(e){}
        if (typeof db !== 'undefined') {
            try { db.collection("movimientos").doc(String(idMov)).set(nuevoMov); } catch(e) {}
        }
    }

    // 7. CERRAR Y ACTUALIZAR PANTALLA
    document.getElementById('modalAbonoProv').style.display = 'none';
    
    if (typeof renderProveedores === 'function') renderProveedores();
    if (typeof renderCorte === 'function') renderCorte();
    
    alert(`✅ Pago de $${monto} aplicado correctamente.\nNueva deuda de ${nombreReal}: $${nuevaDeuda}`);
};
function abrirModalAuthProv(nombre) { window.provActualEliminar = nombre; document.getElementById('auth_prov_nom').innerText = nombre; document.getElementById('auth_admin_pin').value = ''; document.getElementById('modalAuthAdminProv').style.display = 'block'; setTimeout(() => document.getElementById('auth_admin_pin').focus(), 100); }
function confirmarEliminacionProv() {
    let prov = window.provActualEliminar; 
    if (!prov || !proveedores[prov]) return;
    
    let pin = document.getElementById('auth_admin_pin').value;
    
    if (usuariosData["Admin"] && usuariosData["Admin"].pin === pin) {
        // 1. Borramos de la memoria local
        delete proveedores[prov]; 
        try { localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores)); } catch(e) {}
        
        // 2. 🛡️ Borramos en Firebase (BLINDADO CONTRA CRASHES)
        if (typeof db !== 'undefined') {
            try {
                // Si esto falla, ya no estrellará todo el sistema
                db.collection("proveedores").doc(prov).delete().catch(e => console.warn("Error FB", e));
            } catch (errDB) {
                console.warn("Omitiendo Firebase, el comando no es compatible:", errDB);
            }
        }

        // 3. 🚀 BORRAMOS EN POCKETBASE (El que de verdad importa)
        if (typeof pb !== 'undefined') {
            pb.collection("proveedores").getFirstListItem(`doc_id="${prov}"`).then(pvNube => {
                pb.collection("proveedores").delete(pvNube.id).catch(e => console.warn("Error borrando en PB", e));
            }).catch(e => console.warn("No encontrado en PB", e));
        }
        
        if (typeof cerrarModales === 'function') cerrarModales(); 
        if (typeof renderProveedores === 'function') renderProveedores(); 
        
        alert("✅ Proveedor eliminado correctamente.");
    } else {
        alert("❌ PIN Incorrecto.");
    }
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

// 🔄 1. DETECTOR VISUAL DE TRANSFERENCIA
function toggleDestinoTransferencia() {
    let tipo = document.getElementById('mov_tipo').value;
    let bloque = document.getElementById('bloque_destino_transferencia');
    let selectDestino = document.getElementById('mov_cajero_destino');
    
    if (tipo === 'Transferencia') {
        bloque.style.display = 'flex';
        if (selectDestino) {
            selectDestino.innerHTML = "";
            let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Admin';
            
            // Lista mágica de las cajas de tu negocio
            let cajerosActivos = new Set(["Admin", "Martin", "Erika", "Yaqui", "Are", "Rigel", "Heigts", "Alex"]);
            
            cajerosActivos.forEach(cajero => {
                // No te puedes transferir a ti mismo
                if (cajero.toLowerCase() !== miNombre.toLowerCase()) {
                    let saldoC = typeof calcularCajaFisicaReal === 'function' ? calcularCajaFisicaReal(cajero) : 0;
                    selectDestino.innerHTML += `<option value="${cajero}">${cajero} (Saldo: $${saldoC.toFixed(2)})</option>`;
                }
            });
        }
    } else {
        bloque.style.display = 'none';
    }
}

// 🚪 2. ABRIR EL MODAL LIMPITO (Fiel a tus enfoques de foco)
function abrirModalMovimiento() { 
    document.getElementById('mov_monto').value = ''; 
    document.getElementById('mov_motivo').value = ''; 
    document.getElementById('mov_tipo').value = 'Ingreso';
    document.getElementById('bloque_destino_transferencia').style.display = 'none'; // oculto por defecto
    document.getElementById('modalMovimiento').style.display = 'block'; 
    setTimeout(() => document.getElementById('mov_monto').focus(), 100); 
}

// 💾 3. GUARDADO CONTABLE DOBLE VÍA
// ==========================================
// MÓDULO DE TRANSFERENCIAS Y AVISOS
// ==========================================

window.mostrarAvisoRapido = function(mensaje) {
    let toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '30px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)'; 
    toast.style.backgroundColor = '#28a745'; 
    toast.style.color = '#fff';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0px 4px 12px rgba(0,0,0,0.3)';
    toast.style.zIndex = '999999';
    toast.style.fontFamily = 'Arial, sans-serif';
    toast.style.fontSize = '15px';
    toast.style.fontWeight = 'bold';
    toast.style.textAlign = 'center';
    
    toast.innerHTML = mensaje.replace(/\n/g, '<br>');
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 3500);
};

window.guardarMovimiento = async function() {
    let tipo = document.getElementById('mov_tipo').value; 
    let monto = parseFloat(document.getElementById('mov_monto').value) || 0; 
    let motivo = document.getElementById('mov_motivo').value.trim() || 'Manual';
    
    if(monto <= 0) {
        if(typeof mostrarAvisoRapido === 'function') mostrarAvisoRapido("❌ Monto inválido.");
        else alert("❌ Monto inválido.");
        return;
    }
    
    let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Admin';
    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    let hora = new Date().toLocaleTimeString();
    let sucMov = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';
    let idSesionTurno = (window.sesionCajaActual ? window.sesionCajaActual.id : null);

    if (tipo === 'Transferencia') {
        let cajeroDestino = document.getElementById('mov_cajero_destino').value;
        if (!cajeroDestino) {
            if(typeof mostrarAvisoRapido === 'function') mostrarAvisoRapido("❌ Selecciona quién recibirá el dinero.");
            else alert("❌ Selecciona quién recibirá el dinero.");
            return;
        }

        let idBase = Date.now();
        let descripcionUnica = `🔄 TRASPASO ENVIADO: a ${cajeroDestino} (${motivo.toUpperCase()})`;

        let mRetiro = { 
            id: idBase, id_sesion_caja: idSesionTurno, fecha: hoy, hora: hora, 
            cajero: miNombre, sucursal: sucMov, tipo: 'Retiro', monto: monto, motivo: descripcionUnica 
        };
        
        // 🔥 CORRECCIÓN AQUÍ: Forzamos la creación del arreglo si no existe
        window.movimientos = window.movimientos || [];
        window.movimientos.push(mRetiro);

        try {
            await fetch("https://sexy-starling.pikapod.net/api/collections/movimientos/records", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ doc_id: String(idBase), data: mRetiro })
            });

            let datosTransferencia = {
                doc_id: String(idBase), emisor: miNombre, receptor: cajeroDestino, monto: monto,
                fecha: hoy, hora: hora, estado: "pendiente",
                data: { id: idBase, emisor: miNombre, receptor: cajeroDestino, monto: monto, fecha: hoy, hora: hora, estado: "pendiente" }
            };
            
            await fetch("https://sexy-starling.pikapod.net/api/collections/transferencias/records", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(datosTransferencia)
            });
        } catch (e) {
            console.error("Error guardando en la nube:", e);
        }

        cerrarModales(); 
        if(typeof mostrarAvisoRapido === 'function') mostrarAvisoRapido(`✅ Traspaso enviado.\nSe descontaron $${monto.toFixed(2)} de tu caja.`);
        else alert(`✅ Traspaso enviado.\nSe descontaron $${monto.toFixed(2)} de tu caja.`);
    
    } else {
        let idMov = Date.now(); 
        let nuevoMov = { 
            id: idMov, id_sesion_caja: idSesionTurno, fecha: hoy, hora: hora, 
            cajero: miNombre, sucursal: sucMov, tipo: tipo, monto: monto, motivo: motivo 
        };

        // 🔥 CORRECCIÓN AQUÍ: Forzamos la creación del arreglo si no existe
        window.movimientos = window.movimientos || [];
        window.movimientos.push(nuevoMov); 

        try {
            await fetch("https://sexy-starling.pikapod.net/api/collections/movimientos/records", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ doc_id: String(idMov), data: nuevoMov })
            });
        } catch (e) {}

        cerrarModales(); 
        if(typeof mostrarAvisoRapido === 'function') mostrarAvisoRapido(`✅ ${tipo} registrado.`);
        else alert(`✅ ${tipo} registrado.`);
    }

    try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(window.movimientos)); } catch (e) {}
    if (typeof renderCorte === 'function') renderCorte();
};

window.abrirModalDevolucion = async function(idRecord, datosModal) {
    let monto = parseFloat(datosModal.monto) || 0;
    let idSesionTurno = (window.sesionCajaActual ? window.sesionCajaActual.id : null);
    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    let hora = new Date().toLocaleTimeString();
    let sucMov = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';
    let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Admin';

    let nuevoMov = {
        id: Date.now(), 
        id_sesion_caja: idSesionTurno, 
        fecha: hoy, 
        hora: hora,
        cajero: miNombre, 
        sucursal: sucMov, 
        tipo: "Ingreso", 
        monto: monto,
        motivo: `↩️ REEMBOLSO: Traspaso rechazado`
    };

    // 🔥 CORRECCIÓN AQUÍ: Forzamos la creación del arreglo si no existe
    window.movimientos = window.movimientos || [];
    window.movimientos.push(nuevoMov);

    try {
        await fetch("https://sexy-starling.pikapod.net/api/collections/movimientos/records", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doc_id: String(nuevoMov.id), data: nuevoMov })
        });

        await fetch(`https://sexy-starling.pikapod.net/api/collections/transferencias/records/${idRecord}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: "cancelada", "data.estado": "cancelada" })
        });
    } catch(e) {}

    try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(window.movimientos)); } catch (e) {}
    if (typeof renderCorte === 'function') renderCorte();

    if (typeof mostrarAvisoRapido === 'function') mostrarAvisoRapido(`✅ Reembolso de $${monto.toFixed(2)} devuelto a tu caja.`);
};




function registrarGasto() { let monto = parseFloat(prompt("💸 ¿Cuánto vas a retirar?")); if (isNaN(monto) || monto <= 0) return; let motivo = prompt("¿Motivo?"); if (!motivo) return; procesarRetiroCaja(monto, `GASTO: ${motivo.toUpperCase()}`); }
window.registrarPrecorte = function() { 
    let ef = (typeof calcularEfectivoEnCaja === 'function') ? calcularEfectivoEnCaja() : (currentCorteData ? currentCorteData.esperado : 0); 
    let monto = parseFloat(prompt(`✂️ PRECORTE DE CAJA\nEfectivo Esperado: $${ef.toFixed(2)}\n¿Cuánto vas a retirar a bóveda/dueño?`)); 
    
    if (isNaN(monto) || monto <= 0) return; 
    monto = parseFloat(monto.toFixed(2));

    if (ef > 0 && monto > ef && !confirm(`⚠️ El monto a retirar ($${monto.toFixed(2)}) es mayor al efectivo calculado ($${ef.toFixed(2)}). ¿Deseas continuar?`)) return; 
    
    procesarRetiroCaja(monto, "PRECORTE"); 
};

window.procesarRetiroCaja = function(monto, motivo) {
    let montoLimpio = parseFloat(parseFloat(monto).toFixed(2));
    if (isNaN(montoLimpio) || montoLimpio <= 0) return alert("❌ Monto inválido.");

    let idMov = Date.now(); 
    let nuevoMov = { 
        id: idMov, 
        id_sesion_caja: (window.sesionCajaActual ? window.sesionCajaActual.id : null), // 👈 VÍNCULO CON EL TURNO
        fecha: (typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0]), 
        hora: new Date().toLocaleTimeString(), 
        cajero: (typeof usuarioActual !== 'undefined' ? usuarioActual : "Admin"), 
        sucursal: (typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz"), 
        tipo: 'Retiro', 
        monto: montoLimpio, 
        motivo: motivo 
    };

    if (typeof movimientos !== 'undefined') {
        movimientos.push(nuevoMov); 
        // 🛡️ Paracaídas de memoria local
        try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); } catch(e){}
    }

    if (typeof db !== 'undefined') {
        db.collection("movimientos").doc(String(idMov)).set(nuevoMov)
          .catch(e => console.error("Error guardando retiro en nube:", e));
    }

    alert(`✅ Registrado retiro por $${montoLimpio.toFixed(2)} (${motivo})`); 

    if (typeof tabActual !== 'undefined' && tabActual === 'r-tab' && typeof renderCorte === 'function') {
        renderCorte();
    }
};

let movimientoPendienteCancelar = null;

window.abrirCancelacionMovimientos = function() {
    let hoy = (typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0]); 
    let sucReal = String(sucursalActual || "").replace(/📍/g, '').trim();
    let sesionActiva = (typeof sesionCajaActual !== 'undefined' && sesionCajaActual && sesionCajaActual.estado === 'abierta') ? sesionCajaActual : null;

    // 🌟 FILTRADO INTELIGENTE: Si hay turno nocturno activo, busca los movimientos de ese turno; si no, busca por la fecha del calendario.
    let movsDelTurno = movimientos.filter(m => {
        let esMismaSucursal = (!m.sucursal || m.sucursal === sucReal || (sucReal === "Matriz" && !m.sucursal));
        if (!m || m.anulado) return false;

        if (sesionActiva) {
            return m.id_sesion_caja === sesionActiva.id && esMismaSucursal;
        }
        return m.fecha === hoy && esMismaSucursal;
    });

    if (movsDelTurno.length === 0) {
        return alert("⚠️ No hay movimientos o gastos registrados en el turno de hoy para cancelar.");
    }

    let opciones = "📋 CANCELACIÓN DE MOVIMIENTOS / GASTOS:\n\n" + 
        movsDelTurno.map((m, i) => `[ ${i + 1} ] 🕒 ${m.hora} - ${m.tipo.toUpperCase()}: $${parseFloat(m.monto).toFixed(2)} (${m.motivo})`).join('\n') + 
        "\n\n👉 Ingresa el NÚMERO del movimiento que deseas ANULAR:";

    let seleccion = prompt(opciones); 
    if (!seleccion) return;

    let idx = parseInt(seleccion) - 1; 
    if (isNaN(idx) || idx < 0 || idx >= movsDelTurno.length) {
        return alert("❌ Selección inválida.");
    }

    movimientoPendienteCancelar = movsDelTurno[idx];
    
    // Mostramos el modal de seguridad para solicitar el PIN de Administrador
    let inputPin = document.getElementById('input_pin_seguro');
    let modalPin = document.getElementById('modal_pin_seguro');
    
    if (inputPin && modalPin) {
        inputPin.value = ''; 
        modalPin.style.display = 'flex'; 
        setTimeout(() => inputPin.focus(), 100); 
    } else {
        // Si no existe modal, usamos un prompt directo de respaldo
        let pass = prompt("🔒 Ingrese PIN de Administrador para confirmar la anulación:");
        if (pass) ejecutarAnulacionMovimiento(pass);
    }
};

// 🌟 FUNCIÓN QUE REALIZA LA ANULACIÓN DEFINTIVA TRAS VALIDAR EL PIN
window.ejecutarAnulacionMovimiento = function(pinIngresado) {
    if (!movimientoPendienteCancelar) return;

    let pass = pinIngresado || (document.getElementById('input_pin_seguro') ? document.getElementById('input_pin_seguro').value : "");
    
    if (!usuariosData || !usuariosData["Admin"] || usuariosData["Admin"].pin !== pass) {
        return alert("❌ PIN de Administrador incorrecto. Operación cancelada.");
    }

    try {
        let mov = movimientoPendienteCancelar;
        let idMov = mov.id;

        // 1. Marcamos como anulado localmente
        let mIndex = movimientos.findIndex(m => m.id == idMov);
        if (mIndex !== -1) {
            movimientos[mIndex].anulado = true;
            movimientos[mIndex].motivo = `[ANULADO] ${movimientos[mIndex].motivo}`;
        }

        // 🛡️ Paracaídas de memoria local
        try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); } catch(e){}

        // ☁️ 🚀 BLINDAJE FIREBASE: Solo actualizamos la bandera 'anulado'
        if (typeof db !== 'undefined') {
            db.collection("movimientos").doc(String(idMov)).set({
                anulado: true,
                motivo: `[ANULADO] ${mov.motivo}`
            }, { merge: true }).catch(e => console.error("Error al anular movimiento en la nube:", e));
        }

        let modalPin = document.getElementById('modal_pin_seguro');
        if (modalPin) modalPin.style.display = 'none';

        alert(`✅ Movimiento de $${parseFloat(mov.monto).toFixed(2)} (${mov.motivo}) cancelado correctamente.`);
        
        movimientoPendienteCancelar = null;

        // Refrescamos la pantalla de corte
        if (typeof renderCorte === 'function') renderCorte();

    } catch (error) {
        console.error("Error al cancelar movimiento:", error);
        alert("❌ Ocurrió un error al intentar cancelar el movimiento.");
    }
};
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


window.renderCorte = function() { 
    try {
        // 🔥 AUTO-REPARADOR DE MENÚS: Obligamos a los filtros a actualizar la pantalla al instante
        let elSucursal = document.getElementById('corte_sucursal');
        if (elSucursal && !elSucursal.dataset.vinculado) { elSucursal.addEventListener('change', window.renderCorte); elSucursal.dataset.vinculado = "true"; }
        
        let elCajero = document.getElementById('corte_cajero');
        if (elCajero && !elCajero.dataset.vinculado) { elCajero.addEventListener('change', window.renderCorte); elCajero.dataset.vinculado = "true"; }

        let elInicio = document.getElementById('corte_fecha_inicio');
        if (elInicio && !elInicio.dataset.vinculado) { elInicio.addEventListener('change', window.renderCorte); elInicio.dataset.vinculado = "true"; }

        let elFin = document.getElementById('corte_fecha_fin');
        if (elFin && !elFin.dataset.vinculado) { elFin.addEventListener('change', window.renderCorte); elFin.dataset.vinculado = "true"; }

        let fInicio = elInicio ? elInicio.value : ''; 
        let fFin = elFin ? elFin.value : ''; 
        let fCajero = elCajero ? elCajero.value.trim() : ''; 
        
        // 🛡️ ESCUDO ANTI-ESPACIOS
        let fSuc = elSucursal ? String(elSucursal.value).replace(/📍/g, '').trim() : ''; 
        let hoy = (typeof getFechaLocal === 'function') ? getFechaLocal() : new Date().toISOString().split('T')[0];

        let sesionActiva = (typeof sesionCajaActual !== 'undefined' && sesionCajaActual && sesionCajaActual.estado === 'abierta') ? sesionCajaActual : null;
        let esFiltroHistorico = (fInicio && fInicio !== hoy) || (fFin && fFin !== hoy);

        let mapaVentas = {};
        (window.ventas || []).forEach(v => { if(v && v.id) mapaVentas[v.id] = v; });
        (window.ventasHistoricasTemporales || []).forEach(v => { if(v && v.id) mapaVentas[v.id] = v; });
        let todasLasVentas = Object.values(mapaVentas).sort((a,b) => a.id - b.id);

        let mapaMovs = {};
        (window.movimientos || []).forEach(m => { if(m && m.id) mapaMovs[m.id] = m; });
        (window.movsHistoricosTemporales || []).forEach(m => { if(m && m.id) mapaMovs[m.id] = m; });
        let todosLosMovs = Object.values(mapaMovs).sort((a,b) => a.id - b.id);

        let mapaCompras = {};
        (window.compras || []).forEach(c => { if(c && c.id) mapaCompras[c.id] = c; });
        let todasLasCompras = Object.values(mapaCompras).sort((a,b) => a.id - b.id);

        if(elCajero && elCajero.options.length <= 1 && todasLasVentas.length > 0) {
            let cajerosUnicos = [...new Set(todasLasVentas.map(v => v.cajero).filter(Boolean))];
            cajerosUnicos.forEach(c => elCajero.innerHTML += `<option value="${c}">${c}</option>`);
        }
        
        let ef=0, ta=0, trans=0, cr=0; let tVentas = 0, tUtilidad = 0, numVentas = 0;
        let ventasPorDia = {}, utilPorDia = {}, depsHash = {}, cajerosHash = {}, horasHash = {}, metricasCajero = {}, topProductosHash = {}; 
        let operacionesHTML = []; 

        if (todasLasVentas.length === 0 && todosLosMovs.length === 0 && todasLasCompras.length === 0) {
            if(document.getElementById('r_lista_ventas')) document.getElementById('r_lista_ventas').innerHTML = "<tr><td colspan='6' style='text-align:center'>Vacio</td></tr>";
            if (typeof dibujarTopProductos === 'function') dibujarTopProductos(topProductosHash);
            if (typeof actualizarGraficasBI === 'function') actualizarGraficasBI({}, {}, {}, {}, {});
            return;
        }

        // ==========================================
        // 🌟 1. FILTRO DE VENTAS (TU LÓGICA BLINDADA)
        // ==========================================
        let filteredVentas = todasLasVentas.filter(v => { 
            let vSuc = String(v.sucursal || "Matriz").replace(/📍/g, '').trim();
            let vCaj = String(v.cajero || "").trim();

            if (sesionActiva && !esFiltroHistorico) {
                return (v.id_sesion_caja === sesionActiva.id || v.fecha === hoy) && 
                       (!fCajero || vCaj === fCajero) && 
                       (!fSuc || vSuc === fSuc);
            }
            let vFecha = v.fecha || hoy; 
            return (vFecha >= fInicio && vFecha <= fFin) && 
                   (!fCajero || vCaj === fCajero) && 
                   (!fSuc || vSuc === fSuc); 
        });
        
        filteredVentas.forEach(v => {
            if(!v.anulada) {
                let tVentaTicket = parseFloat(v.total) || 0; 
                let dStr = v.fecha || hoy; 
                let nomCajero = v.cajero || 'Desconocido';
                let esAbono = (v.metodo || '').toLowerCase().includes('abono');

                if (!esAbono) {
                    numVentas++; 
                    tVentas += tVentaTicket;
                    let fechaObj = new Date(v.id); let horaMilitar = fechaObj.getHours().toString().padStart(2, '0') + ":00"; 
                    horasHash[horaMilitar] = (horasHash[horaMilitar] || 0) + tVentaTicket;
                    
                    if (!metricasCajero[nomCajero]) metricasCajero[nomCajero] = { total: 0, tickets: 0, horasUnicas: new Set() };
                    metricasCajero[nomCajero].total += tVentaTicket; 
                    metricasCajero[nomCajero].tickets += 1; 
                    metricasCajero[nomCajero].horasUnicas.add(dStr + "-" + horaMilitar);
                    
                    ventasPorDia[dStr] = (ventasPorDia[dStr] || 0) + tVentaTicket; 
                    cajerosHash[nomCajero] = (cajerosHash[nomCajero] || 0) + tVentaTicket;
                }

                if (v.pagos && Array.isArray(v.pagos) && v.pagos.length > 0) { 
                    v.pagos.forEach(p => { 
                        let m = parseFloat(p.montoAplicado) || 0; 
                        if(p.metodo === 'Efectivo') ef += m; else if(p.metodo === 'Tarjeta') ta += m; else if(p.metodo === 'Transferencia') trans += m; else if(p.metodo === 'Crédito') cr += m; 
                    }); 
                } else { 
                    let mStr = v.metodo || ''; 
                    if(mStr.includes('Efectivo')) ef += tVentaTicket; else if(mStr.includes('Tarjeta')) ta += tVentaTicket; else if(mStr.includes('Transferencia')) trans += tVentaTicket; else if(mStr.includes('Crédito')) cr += tVentaTicket; 
                }

                let utilTicket = 0; 
                let listaItemsTicket = v.detalles || (Array.isArray(v.items) ? v.items : []);

                if (listaItemsTicket.length > 0 && !esAbono) { 
                    listaItemsTicket.forEach(d => { 
                        if(d.can > 0) { 
                            let costoUnitario = parseFloat(d.costo) || parseFloat(d.cos) || 0;
                            if (costoUnitario === 0 && typeof inv !== 'undefined' && inv[d.cod]) {
                                let pCat = inv[d.cod];
                                let costoBase = parseFloat(pCat.cos_promedio !== undefined ? pCat.cos_promedio : (pCat.cos || 0));
                                let ivaProd = parseFloat(pCat.iva) || 0;
                                costoUnitario = costoBase * (1 + (ivaProd / 100));
                            }
                            let subtotalItem = parseFloat(d.subtotal) || 0;
                            if (subtotalItem === 0) {
                                let precioVenta = parseFloat(d.pv) || 0;
                                if (precioVenta === 0 && typeof inv !== 'undefined' && inv[d.cod]) {
                                    precioVenta = parseFloat(inv[d.cod].pv) || 0;
                                }
                                subtotalItem = parseFloat(d.can || 1) * precioVenta;
                            }
                            let gananciaArticulo = subtotalItem - (costoUnitario * parseFloat(String(d.can) || 1));
                            utilTicket += gananciaArticulo;
                            depsHash[d.dep || "General"] = (depsHash[d.dep || "General"] || 0) + subtotalItem; 
                            if (!topProductosHash[d.cod]) {
                                topProductosHash[d.cod] = { nombre: d.nom || 'Producto Desconocido', cantidad: 0, total: 0, ganancia: 0 };
                            }
                            let cantItem = parseFloat(d.can) || 0;
                            topProductosHash[d.cod].cantidad += cantItem; 
                            topProductosHash[d.cod].total += subtotalItem;
                            topProductosHash[d.cod].ganancia += gananciaArticulo;
                        }
                    }); 
                }
                tUtilidad += utilTicket; 
                utilPorDia[dStr] = (utilPorDia[dStr] || 0) + utilTicket;
            }
            
            let classes = v.anulada ? 'anulada-row' : ''; let tag = v.anulada ? '<span style="color:red; font-weight:bold;">[ANULADA]</span> ' : '';
            let detallePagoText = v.pagoCon !== undefined && v.pagoCon > 0 ? `<br><small style="color:#666; font-style:italic;">(Pagó: $${parseFloat(v.pagoCon).toFixed(2)} | Cambio: $${parseFloat(v.cambio).toFixed(2)})</small>` : '';
            let itemsTexto = Array.isArray(v.items) ? v.items.map(x=>x.nom).join(', ') : (v.items || '');

            operacionesHTML.push({
                id: v.id,
                html: `<tr class="${classes}"><td>${v.fecha} ${v.hora}</td><td>${v.cajero}</td><td>${v.sucursal || 'Matriz'}</td><td style="font-weight:bold; color:var(--s);">+$${(parseFloat(v.total)||0).toFixed(2)}</td><td>${v.metodo}</td><td>${tag}${itemsTexto.substring(0,40)}${detallePagoText}</td></tr>`
            });
        }); 

        let ing_efectivo = 0, ret_efectivo = 0, flujo_ing_otros = 0, flujo_out_compras = 0, flujo_out_otros = 0;
        let listaRetirosGastos = []; 
        let listaIngresosExtra = []; 

        // ==========================================
        // 🌟 2. FILTRO DE MOVIMIENTOS (TU LÓGICA BLINDADA)
        // ==========================================
        todosLosMovs.forEach(m => {
            let mFecha = m.fecha || hoy; 
            let mSuc = String(m.sucursal || "Matriz").replace(/📍/g, '').trim();
            let mCaj = String(m.cajero || "").trim();

            if(mFecha >= fInicio && mFecha <= fFin && (!fCajero || mCaj === fCajero) && (!fSuc || mSuc === fSuc)) { 
                let montoM = parseFloat(m.monto) || 0; let mMotivo = (m.motivo || '').toLowerCase();
                
                if(m.tipo === 'Ingreso') { 
                    ing_efectivo += montoM; flujo_ing_otros += montoM; 
                    listaIngresosExtra.push(m);
                } else if(m.tipo === 'Retiro') { 
                    ret_efectivo += montoM; 
                    if (mMotivo.includes('compra') || mMotivo.includes('proveedor')) flujo_out_compras += montoM; else flujo_out_otros += montoM; 
                    listaRetirosGastos.push(m);
                }
                
                let isIngreso = m.tipo === 'Ingreso';
                operacionesHTML.push({
                    id: m.id,
                    html: `<tr style="background:#fcfcfc;"><td>${m.fecha} ${m.hora}</td><td>${m.cajero || 'Admin'}</td><td>${m.sucursal || 'Matriz'}</td><td style="font-weight:bold; color:${isIngreso?'var(--s)':'var(--danger)'};">${isIngreso?'+':'-'}$${montoM.toFixed(2)}</td><td><span class="badge-kit" style="background:${isIngreso?'var(--info)':'var(--danger)'}">${m.tipo.toUpperCase()}</span></td><td>${m.motivo}</td></tr>`
                });
            } 
        });

        // ==========================================
        // 🌟 3. FILTRO DE COMPRAS (TU LÓGICA BLINDADA)
        // ==========================================
        let comprasEfectivoTotal = 0;
        let filteredCompras = todasLasCompras.filter(c => {
            if (c.anulada) return false;
            let cSuc = String(c.sucursal || "Matriz").replace(/📍/g, '').trim();
            let cCaj = String(c.cajero || "").trim();

            if (sesionActiva && !esFiltroHistorico) {
                return (c.id_sesion_caja === sesionActiva.id || c.fecha === hoy) && (!fCajero || cCaj === fCajero) && (!fSuc || cSuc === fSuc);
            }
            let cFecha = c.fecha || hoy;
            return cFecha >= fInicio && cFecha <= fFin && (!fCajero || cCaj === fCajero) && (!fSuc || cSuc === fSuc);
        });

        filteredCompras.forEach(c => {
            let mMetodo = String(c.metodo || '').toLowerCase();
            let totalC = parseFloat(c.total) || 0;
            if (mMetodo.includes('efectivo')) comprasEfectivoTotal += totalC;
        });

        let efectivoEnCaja = ef + ing_efectivo - ret_efectivo - comprasEfectivoTotal;
        
        currentCorteData = {
            fondoInicial: 0, ventasTotales: tVentas, gananciaNeta: tUtilidad, numVentas: numVentas,     
            efectivoVentas: ef, tarjeta: ta, transferencia: trans, credito: cr,
            ingresos: ing_efectivo, retiros: ret_efectivo, comprasEfectivo: comprasEfectivoTotal,
            esperado: efectivoEnCaja, cajeroCorte: fCajero || "Todos", fechaInicio: fInicio, fechaFin: fFin
        };

        // 📊 INYECCIÓN DE TOTALES EN PANTALLA
        if(document.getElementById('kpi_ventas')) document.getElementById('kpi_ventas').innerText = "$" + tVentas.toLocaleString('es-MX', {minimumFractionDigits: 2});
        if(document.getElementById('kpi_ganancia')) document.getElementById('kpi_ganancia').innerText = "$" + tUtilidad.toLocaleString('es-MX', {minimumFractionDigits: 2});
        if(document.getElementById('kpi_no_ventas')) document.getElementById('kpi_no_ventas').innerText = numVentas;
        if(document.getElementById('kpi_ticket_prom')) document.getElementById('kpi_ticket_prom').innerText = "$" + (numVentas > 0 ? (tVentas / numVentas) : 0).toLocaleString('es-MX', {minimumFractionDigits: 2});
        if(document.getElementById('kpi_margen')) document.getElementById('kpi_margen').innerText = (tVentas > 0 ? ((tUtilidad / tVentas) * 100) : 0).toFixed(2) + "%";
        if(document.getElementById('r_efectivo')) document.getElementById('r_efectivo').innerText = "$"+efectivoEnCaja.toFixed(2); 
        if(document.getElementById('r_tarjeta')) document.getElementById('r_tarjeta').innerText = "$"+ta.toFixed(2); 
        if(document.getElementById('r_transferencia')) document.getElementById('r_transferencia').innerText = "$"+trans.toFixed(2); 
        if(document.getElementById('r_credito')) document.getElementById('r_credito').innerText = "$"+cr.toFixed(2); 
        if(document.getElementById('r_total')) document.getElementById('r_total').innerText = "$"+(ef + ta + trans).toFixed(2); 

        // 🚀 LÍMITE VISUAL (250 FILAS MÁXIMO PARA QUE NO SE CONGELE)
        let contVentas = document.getElementById('r_lista_ventas');
        if(contVentas) {
            let maxFilas = 250; 
            let htmlInyectar = operacionesHTML.slice(0, maxFilas).map(op => op.html).join('');
            
            if (operacionesHTML.length > maxFilas) {
                htmlInyectar += `<tr><td colspan='6' style='text-align:center; background:#ffefc0; color:#856404; font-weight:bold; padding: 10px;'>⚠️ Se muestran ${maxFilas} operaciones visualmente para que tu PC no se trabe. Tus totales SÍ incluyen las ${operacionesHTML.length} operaciones calculadas.</td></tr>`;
            }
            contVentas.innerHTML = htmlInyectar || "<tr><td colspan='6' style='text-align:center'>No hay operaciones en este rango</td></tr>";
        }

        let htmlGastos = listaRetirosGastos.map(g => `<tr><td>${g.hora || ''}</td><td>${g.motivo || 'Retiro'}</td><td style="text-align:right; color:red;">-$${parseFloat(g.monto).toFixed(2)}</td></tr>`).join('');
        let cg = document.getElementById('cc_lista_gastos'); if(cg) cg.innerHTML = htmlGastos || '<tr><td colspan="3" style="text-align:center; color:#888;">No hubo retiros</td></tr>';
        
        let htmlIngresos = listaIngresosExtra.map(g => `<tr><td>${g.hora || ''}</td><td>${g.motivo || 'Ingreso'}</td><td style="text-align:right; color:#28a745;">+$${parseFloat(g.monto).toFixed(2)}</td></tr>`).join('');
        let ci = document.getElementById('ci_lista_ingresos') || document.getElementById('cc_lista_ingresos'); if(ci) ci.innerHTML = htmlIngresos || '<tr><td colspan="3" style="text-align:center; color:#888;">No hubo ingresos extra</td></tr>';

        let elemDetalleTexto = document.getElementById('cierre_detalle_texto') || document.getElementById('cc_detalle_arqueo');
        if (elemDetalleTexto) {
            let txt = "";
            if (listaIngresosExtra.length > 0) {
                txt += "🟢 OTROS INGRESOS (Abonos, Entradas):\n";
                listaIngresosExtra.forEach(i => txt += ` + $${parseFloat(i.monto).toFixed(2)} | 📥 ${i.motivo} (${i.hora || ''})\n`);
                txt += "\n";
            }
            if (listaRetirosGastos.length > 0) {
                txt += "🔴 GASTOS Y RETIROS (Salidas, Traspasos):\n";
                listaRetirosGastos.forEach(r => txt += ` - $${parseFloat(r.monto).toFixed(2)} | 🔄 ${r.motivo} (${r.hora || ''})\n`);
            }
            if (!txt) txt = "(No hay ingresos ni gastos extra registrados en este turno)";
            elemDetalleTexto.innerText = txt;
        }

        let htmlCajerosKpi = Object.keys(metricasCajero).map(c => {
            let m = metricasCajero[c];
            let hrs = m.horasUnicas.size > 0 ? m.horasUnicas.size : 1;
            return `<tr><td><b>${c}</b></td><td>$${m.total.toFixed(2)}</td><td>$${(m.tickets>0?(m.total/m.tickets):0).toFixed(2)}</td><td style="color:var(--orange); font-weight:bold;">$${(m.total/hrs).toFixed(2)}</td></tr>`;
        }).join('');
        if(document.getElementById('kpi_tabla_cajeros')) document.getElementById('kpi_tabla_cajeros').innerHTML = htmlCajerosKpi || '<tr><td colspan="4" style="text-align:center;">Vacio</td></tr>';

        if(document.getElementById('flujo_in_efectivo')) {
            document.getElementById('flujo_in_efectivo').innerText = "$" + ef.toFixed(2); 
            document.getElementById('flujo_in_digital').innerText = "$" + (ta + trans).toFixed(2); 
            document.getElementById('flujo_in_otros').innerText = "$" + flujo_ing_otros.toFixed(2); 
            document.getElementById('flujo_in_total').innerText = "$" + (ef + ta + trans + flujo_ing_otros).toFixed(2);
            document.getElementById('flujo_out_compras').innerText = "$" + (flujo_out_compras + comprasEfectivoTotal).toFixed(2); 
            document.getElementById('flujo_out_otros').innerText = "$" + flujo_out_otros.toFixed(2); 
            document.getElementById('flujo_out_total').innerText = "$" + (flujo_out_compras + comprasEfectivoTotal + flujo_out_otros).toFixed(2);
        }

        if (typeof dibujarTopProductos === 'function') window.dibujarTopProductos(topProductosHash);
        if (typeof actualizarGraficasBI === 'function') window.actualizarGraficasBI(ventasPorDia, utilPorDia, depsHash, cajerosHash, horasHash);
        
    } catch(err) { console.error("Error Dashboard:", err); }
};
// ====================================================================
// ☁️ DESCARGAR TICKETS DEL PASADO (BLINDADO CONTRA PÉRDIDA DE IDs)
// ====================================================================
window.descargarVentasNube = async function() {
    let fInicio = document.getElementById('corte_fecha_inicio').value; 
    let fFin = document.getElementById('corte_fecha_fin').value; 
    let btn = document.getElementById('btn_analizar_nube');
    
    if (!fInicio || !fFin) return alert("⚠️ Por favor, selecciona primero un rango de fechas.");
    
    btn.innerText = "⏳ DESCARGANDO TICKETS..."; 
    btn.disabled = true;

    try {
        // 1. Descargamos las VENTAS
        let ventasNube = [];
        let pagV = 1; let totalPagV = 1;
        while(pagV <= totalPagV) {
            let resV = await pb.collection('ventas').getList(pagV, 500, {
                filter: `data.fecha >= "${fInicio}" && data.fecha <= "${fFin}"`,
                requestKey: null
            });
            if(pagV === 1) totalPagV = resV.totalPages;
            
            // 🛡️ INYECTOR DE IDs: Le devolvemos su folio a cada venta
            resV.items.forEach(r => {
                let d = r.data || {};
                d.id = d.id || r.doc_id || r.id;
                ventasNube.push(d);
            });
            pagV++;
        }

        // 2. Descargamos los MOVIMIENTOS (Ingresos/Gastos)
        let movsNube = [];
        let pagM = 1; let totalPagM = 1;
        while(pagM <= totalPagM) {
            let resM = await pb.collection('movimientos').getList(pagM, 500, {
                filter: `data.fecha >= "${fInicio}" && data.fecha <= "${fFin}"`,
                requestKey: null
            });
            if(pagM === 1) totalPagM = resM.totalPages;
            
            // 🛡️ INYECTOR DE IDs: Le devolvemos su folio a cada movimiento
            resM.items.forEach(r => {
                let d = r.data || {};
                d.id = d.id || r.doc_id || r.id;
                movsNube.push(d);
            });
            pagM++;
        }

        // 3. Guardamos los datos reparados en la RAM temporalmente
        window.ventasHistoricasTemporales = ventasNube;
        window.movsHistoricosTemporales = movsNube;
        
        alert(`✅ Éxito: Se descargaron ${ventasNube.length} ventas y ${movsNube.length} movimientos.\n\nGráficas y detalles listos.`); 
        
        // Refrescamos ambos motores gráficos
        if (typeof renderCorte === 'function') renderCorte();
        if (typeof calcularTotalesCorte === 'function') calcularTotalesCorte();
        
    } catch(err) { 
        alert("❌ Error al consultar la nube: " + err.message); 
    } finally {
        btn.innerText = "☁️ DESCARGAR DE LA NUBE"; 
        btn.disabled = false;
    }
};
function actualizarGraficasBI(vDia, uDia, deps, cajs, horas) {
    if (chartBarInstance) chartBarInstance.destroy(); if (chartDeptInstance) chartDeptInstance.destroy(); if (chartCajeroInstance) chartCajeroInstance.destroy(); if (chartHorasInstance) chartHorasInstance.destroy(); 
    let fc = Object.keys(vDia).sort();
    let ctx1 = document.getElementById('chartVentasDiarias'); if(ctx1) chartBarInstance = new Chart(ctx1.getContext('2d'), { type: 'bar', data: { labels: fc, datasets: [ { label: 'Ventas', data: fc.map(f => vDia[f]), backgroundColor: '#8ea1d8' }, { label: 'Ganancia', data: fc.map(f => uDia[f]), backgroundColor: '#475399' } ] }, options: { responsive: true, maintainAspectRatio: false } });
    let ctx2 = document.getElementById('chartDept'); if(ctx2) chartDeptInstance = new Chart(ctx2.getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(deps), datasets: [{ data: Object.values(deps), backgroundColor: ['#64d0b2', '#007bff', '#28a745', '#17a2b8', '#ffc107', '#6f42c1', '#dc3545', '#fd7e14'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    let ctx3 = document.getElementById('chartCajeros'); if(ctx3) chartCajeroInstance = new Chart(ctx3.getContext('2d'), { type: 'doughnut', data: { labels: Object.keys(cajs), datasets: [{ data: Object.values(cajs), backgroundColor: ['#994769', '#343a40', '#6c757d', '#f8d7da', '#cce5ff', '#d4edda'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    let hc = Object.keys(horas).sort();
    let ctx4 = document.getElementById('chartHoras'); if(ctx4) chartHorasInstance = new Chart(ctx4.getContext('2d'), { type: 'bar', data: { labels: hc, datasets: [{ label: 'Ventas por Hora', data: hc.map(h => horas[h]), backgroundColor: '#fd7e14' }] }, options: { responsive: true, maintainAspectRatio: false } });
}

// ====================================================================
// ☁️ DESCARGAR ESTADÍSTICAS DEL PASADO DE FORMA INDEPENDIENTE
// ====================================================================

// ====================================================================
// === VISORES Y TICKETS (VENTAS Y COMPRAS) ===
// ====================================================================
function imprimirTicket(divId) { document.querySelectorAll('.print-active').forEach(e => e.classList.remove('print-active')); document.getElementById(divId).classList.add('print-active'); window.print(); }




// 🌟 UNA SOLA DECLARACIÓN GLOBAL PARA CONTROLAR EL MES
let ultimaFechaMesDescargada = "";

async function abrirVisorTickets() { 
    let searchInput = document.getElementById('visor_search'); 
    let dateInput = document.getElementById('visor_date');
    
    if (searchInput) searchInput.value = ''; 
    
    // Aseguramos que el input inicie con el formato YYYY-MM-DD correcto
    if (dateInput) {
        let hoy = new Date();
        let m = (hoy.getMonth() + 1).toString().padStart(2, '0');
        let d = hoy.getDate().toString().padStart(2, '0');
        dateInput.value = `${hoy.getFullYear()}-${m}-${d}`;
    }
    
    await filtrarVisorTickets(); 
    document.getElementById('modalVisor').style.display = 'block'; 
    if (searchInput) setTimeout(() => searchInput.focus(), 100);
}
let ultimaFechaVisor = "";

async function filtrarVisorTickets() {
    console.log("🔎 ===== INICIO FILTRO VISOR =====");

    let searchInput = document.getElementById('visor_search');
    let dateInput = document.getElementById('visor_date');

    let txt = searchInput ? searchInput.value.toLowerCase().trim() : '';
    let selectedDate = dateInput ? dateInput.value : '';
    let terms = txt ? txt.split(/\s+/) : [];

    // =====================================================
    // DESCARGAR DÍA DESDE LA NUBE
    // =====================================================
    if (selectedDate !== '' && typeof pb !== 'undefined') {
        if (selectedDate !== ultimaFechaVisor) {
            ultimaFechaVisor = selectedDate;
            let counterEl = document.getElementById('visor_counter');
            if (counterEl) counterEl.innerText = "⚡...";

            try {
                let records = await pb.collection('ventas').getFullList({
                    filter: `data.fecha ~ "${selectedDate}"`,
                    requestKey: null
                });

                records.forEach(r => {
                    // 🛡️ Mapeo blindado para evitar tickets corruptos
                    let ticketNube = {
                        ...(r.data || r),
                        id: r.doc_id || r.id || (r.data && r.data.id)
                    };

                    // 🛡️ Si el ticket no tiene ID, lo descartamos (evita el "undefined")
                    if (!ticketNube || !ticketNube.id) return;

                    let existe = ventas.some(v => String(v.id) === String(ticketNube.id));
                    if (!existe) {
                        ventas.push(ticketNube);
                    }
                });
            } catch (e) {
                console.error("❌ Error descargando día:", e);
            }
        }
    }

    // =====================================================
    // UNIFICAR TODAS LAS FUENTES Y ELIMINAR DUPLICADOS
    // =====================================================
    let todasLasVentas = [];
    let idsVistos = new Set(); // 🛡️ Doble candado anti-duplicados

    ventas.forEach(v => {
        if (v && v.id && !idsVistos.has(String(v.id))) {
            idsVistos.add(String(v.id));
            todasLasVentas.push(v);
        }
    });

    if (window.ventasHistoricasTemporales && Array.isArray(window.ventasHistoricasTemporales)) {
        window.ventasHistoricasTemporales.forEach(t => {
            if (t && t.id && !idsVistos.has(String(t.id))) {
                idsVistos.add(String(t.id));
                todasLasVentas.push(t);
            }
        });
    }

    // =====================================================
    // FILTRO DE SUCURSAL Y FECHA
    // =====================================================
    const limpiarSucursal = valor => String(valor || "").replace(/📍/g, "").trim().toLowerCase();
    const sucursalFiltro = limpiarSucursal(typeof sucursalActual !== "undefined" ? sucursalActual : "");

    let resultado = todasLasVentas.filter(v => {
        let sucVenta = limpiarSucursal(v.sucursal);
        return (!sucVenta || sucursalFiltro === "todas" || sucVenta === sucursalFiltro);
    });

    if (selectedDate !== '') {
        resultado = resultado.filter(v => {
            if (!v.fecha) return false;
            return (String(v.fecha).trim() === selectedDate);
        });
    }

    // =====================================================
    // FILTRO DE BÚSQUEDA (CON CAJERO Y CRÉDITOS RESTAURADOS)
    // =====================================================
    if (terms.length > 0) {
        resultado = resultado.filter(v => {
            
            // Rescate del nombre del cliente
            let clientStr = v.cliente || v.nom || 'Público';
            if (clientStr === 'Público' || clientStr === 'Público General') {
                if (v.cliente_tel && typeof clientes !== 'undefined' && clientes[v.cliente_tel]) {
                    clientStr = clientes[v.cliente_tel].nom;
                } else if (v.pagos && Array.isArray(v.pagos)) {
                    let pCred = v.pagos.find(p => p.metodo && p.metodo.toLowerCase().includes('crédit'));
                    if (pCred && pCred.cliente_tel && typeof clientes !== 'undefined' && clientes[pCred.cliente_tel]) {
                        clientStr = clientes[pCred.cliente_tel].nom;
                    }
                }
            }

            let productosStr = "";
            if (v.detalles && Array.isArray(v.detalles)) {
                productosStr = v.detalles.map(d => `${d.cod || ''} ${d.nom || ''} ${d.cod_maestro || ''}`).join(" ");
            } else if (v.items) {
                productosStr = v.items;
            }

            // 🌟 AQUI ESTA LA CORRECCIÓN: Le devolvimos la hora y el cajero al buscador
            let textoBuscable = `
                ${v.id || ''}
                ${v.fecha || ''}
                ${v.hora || ''}
                ${clientStr}
                ${v.cajero || ''}
                ${v.metodo || ''}
                ${productosStr}
            `.toLowerCase();

            return terms.every(t => textoBuscable.includes(t));
        });
    }

    // =====================================================
    // ASIGNAR UNA SOLA VEZ E INYECTAR NOMBRE PARA EL TICKET
    // =====================================================
    visorIndices = resultado.map((v, idx) => {
        let nombreRecuperado = v.cliente || v.nom;
        
        if (!nombreRecuperado || nombreRecuperado === "Público General") {
            if (v.cliente_tel && typeof clientes !== 'undefined' && clientes[v.cliente_tel]) {
                nombreRecuperado = clientes[v.cliente_tel].nom;
            } else if (v.pagos && Array.isArray(v.pagos)) {
                let pCredito = v.pagos.find(p => p.metodo && p.metodo.toLowerCase().includes('crédit'));
                if (pCredito && pCredito.cliente_tel && typeof clientes !== 'undefined' && clientes[pCredito.cliente_tel]) {
                    nombreRecuperado = clientes[pCredito.cliente_tel].nom;
                }
            }
        }

        return {
            ...v,
            cliente: nombreRecuperado || "Público General",
            nom: nombreRecuperado || "Público General",
            indexGlobal: idx
        };
    });

    // =====================================================
    // RENDER
    // =====================================================
    if (visorIndices.length === 0) {
        let counter = document.getElementById('visor_counter'); if(counter) counter.innerText = "0 / 0";
        let vFecha = document.getElementById('visor_fecha'); if(vFecha) vFecha.innerText = "Vacío";
        let vItems = document.getElementById('visor_items'); if(vItems) vItems.innerHTML = `<tr><td colspan="3">N/A</td></tr>`;
        let vTotal = document.getElementById('visor_total'); if(vTotal) vTotal.innerText = "0.00";
        let btnAnular = document.getElementById('btn_anular_visor'); if(btnAnular) btnAnular.disabled = true;
    } else {
        currentVisorPos = visorIndices.length - 1;
        if(typeof renderVisorActivo === 'function') renderVisorActivo();
    }
}
function navVisor(dir) { let n = currentVisorPos + dir; if(n >= 0 && n < visorIndices.length) { currentVisorPos = n; renderVisorActivo(); } }

function renderVisorActivo() {
    if (visorIndices.length === 0) return; 
    let v = visorIndices[currentVisorPos]; 
    document.getElementById('visor_counter').innerText = (currentVisorPos + 1) + " / " + visorIndices.length;
    // ✅ LÓGICA REFACCIONADA (Lee directamente la propiedad ya procesada)
    let clientStr = v.cliente || v.nom || 'Público General';
    
    document.getElementById('visor_fecha').innerText = `${v.fecha||''} ${v.hora||''} - ${v.sucursal||''}\nTicket ID: ${v.id}\nCliente: ${clientStr}`;
    let html = '';
    let sumaTotalCobrada = 0;

    if (v.detalles && Array.isArray(v.detalles) && v.detalles.length > 0) { 
        html = v.detalles.map((d, i) => {
            let ex = !v.anulada ? (d.can > 0 ? `<div class="no-print"><button style="background:var(--warning); color:#000; font-size:9px;" onclick="devolverArticuloVisor(${i})">↩️</button></div>` : `<div style="color:var(--danger); font-size:10px;">(Devuelto)</div>`) : '';
            
            let importeCobrado = parseFloat(d.subtotal) || parseFloat(d.importe) || 0;
            let cantidad = parseFloat(d.can) || 1;
            
            // Leemos el precio original que guardamos en confirmarVenta
            let precioNormal = parseFloat(d.pv) || 0;
            if (precioNormal === 0 && typeof inv !== 'undefined' && inv[d.cod]) {
                precioNormal = parseFloat(inv[d.cod].pv) || 0;
            }
            let subtotalNormal = cantidad * precioNormal;
            
            if (subtotalNormal < importeCobrado || precioNormal === 0) {
                subtotalNormal = importeCobrado;
            }
            
            sumaTotalCobrada += importeCobrado;
            
            let rowHtml = `<tr><td style="vertical-align:top;">${d.can}</td><td>${(d.nom||'').substring(0,15)} ${ex}</td><td style="text-align:right;">$${subtotalNormal.toFixed(2)}</td></tr>`;
            
            // 🌟 SI EL TICKET REGISTRÓ DESCUENTO, LO COLOCAMOS DEBAJO DEL PRODUCTO
            if (subtotalNormal > importeCobrado + 0.01) {
                let ahorroItem = subtotalNormal - importeCobrado;
                let porcentaje = Math.round((ahorroItem / subtotalNormal) * 100);
                rowHtml += `<tr><td colspan="2" style="text-align:right; font-size:11px;">↳ Desc (${porcentaje}%):</td><td style="text-align:right; font-size:11px;">-$${ahorroItem.toFixed(2)}</td></tr>`;
            }

            return rowHtml;
        }).join(''); 
    } else {
        html = `<tr><td colspan="3">${v.items || ''}</td></tr>`; 
    }
    
    // Descuento global (Si existen diferencias de centavos/redondeo final)
    let totVenta = parseFloat(v.total) || 0;
    if (sumaTotalCobrada > (totVenta + 0.01)) {
        let ahorroGlobal = sumaTotalCobrada - totVenta;
        html += `<tr><td colspan="2" style="text-align:right;"><b>DESC. EXTRA:</b></td><td style="text-align:right;">-$${ahorroGlobal.toFixed(2)}</td></tr>`;
    }

    document.getElementById('visor_items').innerHTML = html; 
    document.getElementById('visor_total').innerText = totVenta.toFixed(2); 
    document.getElementById('visor_metodo').innerText = v.metodo || 'N/A'; 

    let pagoConVisor = v.recibido !== undefined ? parseFloat(v.recibido) : (v.pagoCon !== undefined ? parseFloat(v.pagoCon) : parseFloat(v.total || 0));
    let cambioVisor = v.cambio !== undefined ? parseFloat(v.cambio) : 0;
    
    let elPagado = document.getElementById('visor_pagado');
    if (elPagado) elPagado.innerText = pagoConVisor.toFixed(2);
    
    let elCambio = document.getElementById('visor_cambio');
    if (elCambio) elCambio.innerText = cambioVisor.toFixed(2);

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

// ====================================================================
// 🗑️ ANULAR VENTA DESDE EL VISOR (CON ESCUDO ANTI-SOBREESCRITURA)
// ====================================================================
window.anularVentaVisor = async function() {
    let vVisor = visorIndices[currentVisorPos];
    if (!vVisor) { alert("❌ No se encontró la venta."); return; }

    let vReal = ventas.find(v => String(v.id) === String(vVisor.id)) || vVisor;
    if (vReal.anulada) { alert("⚠️ Esta venta ya está anulada."); return; }

    if (!confirm("¿Anular esta venta?\n\nSe devolverá el stock al sistema y se ajustarán las gráficas.")) { return; }

    console.log("🔴 ANULANDO VENTA:", vReal);

    // =====================================================
    // 1. DEVOLUCIÓN DE INVENTARIO
    // =====================================================
    if (Array.isArray(vReal.detalles) && vReal.detalles.length > 0) {
        for (let d of vReal.detalles) {
            let cantidad = parseFloat(d.can) || 0;
            if (cantidad <= 0) continue;

            let sucursalVenta = vReal.sucursal || (typeof sucursalActual !== "undefined" ? sucursalActual : "Matriz");
            let codigoVenta = String(d.cod || d.codigo || "");
            let productoOriginal = inv[codigoVenta] || null;
            
            let codMaestro = d.cod_maestro || (productoOriginal ? (productoOriginal.cod_maestro || productoOriginal.grupo || codigoVenta) : codigoVenta);
            codMaestro = String(codMaestro);

            if (!inv[codMaestro] && inv[codigoVenta]) codMaestro = codigoVenta;
            if (!inv[codMaestro]) continue;

            let producto = inv[codMaestro];

            if (!producto.stock || typeof producto.stock !== "object") {
                let stockAnteriorGeneral = parseFloat(producto.stock) || parseFloat(producto.existencia) || parseFloat(producto.can) || 0;
                producto.stock = {};
                producto.stock[sucursalVenta] = stockAnteriorGeneral;
            }
            let stockAntes = parseFloat(producto.stock[sucursalVenta]) || 0;
            let stockDespues = parseFloat((stockAntes + cantidad).toFixed(3));
            producto.stock[sucursalVenta] = stockDespues;

            if (typeof registrarEnKardex === "function") {
                try { await registrarEnKardex(codMaestro, d.nom || producto.nom, "ANULACIÓN", cantidad, 0, 0, stockAntes, stockDespues, sucursalVenta); } catch (e) {}
            }

            if (typeof pb !== "undefined" && codMaestro) {
                try {
                    let pNube = await pb.collection("inventario").getFirstListItem(`id="${codMaestro}" || cod="${codMaestro}" || codigo="${codMaestro}"`);
                    if (sucursalVenta !== "" && pNube.inv_sucursales && pNube.inv_sucursales[sucursalVenta] !== undefined) {
                        pNube.inv_sucursales[sucursalVenta] += cantidad;
                    } else if (pNube.can !== undefined) {
                        pNube.can += cantidad;
                    }
                    await pb.collection("inventario").update(pNube.id, pNube);
                } catch (e) { console.error("❌ Error PB inventario:", e); }
            } else if (typeof db !== "undefined" && codMaestro) {
                try {
                    let docSnap = await db.collection("inventario").doc(String(codMaestro)).get();
                    if (docSnap.exists) {
                        let pNube = docSnap.data();
                        if (sucursalVenta !== "" && pNube.inv_sucursales && pNube.inv_sucursales[sucursalVenta] !== undefined) pNube.inv_sucursales[sucursalVenta] += cantidad;
                        else if (pNube.can !== undefined) pNube.can += cantidad;
                        await db.collection("inventario").doc(String(codMaestro)).set(pNube);
                    }
                } catch (e) { console.error("❌ Error FB inventario:", e); }
            }
        }
    }

    try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch (e) {}

    // =====================================================
    // 3. AJUSTE DE CRÉDITO Y RESTO DE LA ANULACIÓN
    // =====================================================
    let met = String(vReal.metodo || "").toLowerCase();
    let esCredito = vReal.es_credito || met.includes("cr");
    let idCliente = vReal.cliente_tel || vReal.cliente || vReal.cli || vReal.nom_cliente || "";

    if (esCredito && idCliente && typeof clientes !== "undefined") {
        let claveCliente = clientes[idCliente] ? idCliente : Object.keys(clientes).find(k => k === idCliente || clientes[k].nom === idCliente || clientes[k].tel === idCliente);
        if (claveCliente && clientes[claveCliente]) {
            let dineroARestar = parseFloat(vReal.monto_credito) || parseFloat(vReal.total) || 0;
            let saldoActual = parseFloat(clientes[claveCliente].saldo) || 0;
            clientes[claveCliente].saldo = parseFloat(Math.max(0, saldoActual - dineroARestar).toFixed(2));

            if (!Array.isArray(clientes[claveCliente].historial)) clientes[claveCliente].historial = [];
            clientes[claveCliente].historial.push({
                id_venta: vReal.id,
                fecha: typeof getFechaLocal === "function" ? getFechaLocal() : new Date().toISOString().split("T")[0],
                hora: new Date().toLocaleTimeString(),
                tipo: "Anulación",
                monto: -dineroARestar,
                detalle: `Anulación Ticket #${vReal.id}`
            });

            try { localStorage.setItem("pos_clientes_v1", JSON.stringify(clientes)); } catch (e) {}
            if (typeof db !== "undefined") {
                try { await db.collection("clientes").doc(String(claveCliente)).set(clientes[claveCliente]); } catch (e) {}
            }
        }
    }

    // =====================================================
    // 4. MARCAR VENTA COMO ANULADA (CORREGIDO PARA NUBE PB)
    // =====================================================
    vReal.anulada = true;
    vVisor.anulada = true;
    let indiceVenta = ventas.findIndex(v => String(v.id) === String(vReal.id));
    if (indiceVenta !== -1) ventas[indiceVenta].anulada = true;

    // 🚀 ACTUALIZAMOS LA VENTA EN LA NUBE PARA QUE LOS DEMÁS CELULARES SE ENTEREN
    if (typeof pb !== "undefined") {
        try {
            let idBuscar = String(vReal.doc_id || vReal.id);
            try {
                await pb.collection("ventas").update(idBuscar, vReal);
            } catch(e) {
                let vNube = await pb.collection("ventas").getFirstListItem(`id="${idBuscar}" || doc_id="${idBuscar}"`);
                await pb.collection("ventas").update(vNube.id, vReal);
            }
        } catch (errNube) { console.error("Error marcando venta como anulada en PB", errNube); }
    } else if (typeof db !== "undefined") {
        try { await db.collection("ventas").doc(String(vReal.id)).set(vReal); } catch (e) {}
    }

    if (typeof actualizarAcumuladorDiario === "function") {
        try { actualizarAcumuladorDiario(vReal, true); } catch (e) {}
    }

    try { localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas)); } catch (e) {}

    alert("✅ Venta anulada correctamente.\n\n📦 El stock fue devuelto al inventario.");

    if (typeof renderVisorActivo === "function") renderVisorActivo();
    if (typeof renderCorte === "function") renderCorte();
    if (typeof renderTablaInventario === "function") renderTablaInventario();
    else if (typeof renderI === "function") renderI();
    if (typeof renderClientes === "function") renderClientes();
};
window.devolverArticuloVisor = async function(indexDetalle) {
    let vRef = visorIndices[currentVisorPos]; 
    if (!vRef) return;

    // 🌟 CORRECCIÓN CRÍTICA: Buscar el ticket por su ID real, NO por su posición
    let vReal = ventas.find(v => String(v.id) === String(vRef.id));
    if (!vReal) vReal = ventas[vRef.indexGlobal] || vRef;

    if(vReal.anulada) {
        alert("⚠️ Esta venta ya está anulada completamente.");
        return;
    }

    let d = vReal.detalles ? vReal.detalles[indexDetalle] : (vReal.items ? vReal.items[indexDetalle] : null); 
    if(!d || d.can <= 0) return;

    let c = parseFloat(prompt(`Devolver "${d.nom}" (Max: ${d.can}):`, "1")); 
    if(isNaN(c) || c <= 0 || c > d.can) return;

    let m = c * (d.subtotal / d.can); 
    if(!confirm(`Devolver ${c} uds por $${m.toFixed(2)}?`)) return;

    d.can = parseFloat((d.can - c).toFixed(3)); 
    d.subtotal = parseFloat((d.subtotal - m).toFixed(2)); 
    vReal.total = parseFloat((vReal.total - m).toFixed(2)); 

    if(vReal.total <= 0) { 
        vReal.anulada = true; 
        vReal.total = 0; 
    }

    let sucursalVenta = vReal.sucursal || sucursalActual;
    let pOriginal = inv[d.cod] || {}; 
    let codMaestro = d.cod_maestro || (pOriginal.grupo && inv[pOriginal.grupo] ? pOriginal.grupo : d.cod);
    let pMaestro = inv[codMaestro] || pOriginal;

    let stockAntesReal = 0;
    if (pMaestro.stock && typeof pMaestro.stock === 'object') {
        stockAntesReal = parseFloat(pMaestro.stock[sucursalVenta]) || 0;
    } else {
        stockAntesReal = parseFloat(pMaestro.stock) || parseFloat(pMaestro.existencia) || parseFloat(pMaestro.can) || 0;
    }
    let stockDespuesReal = parseFloat((stockAntesReal + c).toFixed(3));

    if(inv[codMaestro]) { 
        if(!inv[codMaestro].stock) inv[codMaestro].stock = {}; 
        inv[codMaestro].stock[sucursalVenta] = stockDespuesReal; 

        // 🌟 ESCUDO ANTI-DUPLICADOS PARA DEVOLUCIÓN (Buscador Inteligente PB)
        if (typeof pb !== 'undefined' && codMaestro) { 
            try {
                let idBuscar = String(codMaestro);
                let pNube = await pb.collection('inventario').getFirstListItem(`id="${idBuscar}" || cod="${idBuscar}" || codigo="${idBuscar}"`);
                
                if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                
                if (sucursalVenta !== '' && pNube.inv_sucursales[sucursalVenta] !== undefined) {
                    pNube.inv_sucursales[sucursalVenta] += c; // Suma en vivo
                } else if (pNube.can !== undefined) {
                    pNube.can += c;
                }
                await pb.collection('inventario').update(pNube.id, pNube);
            } catch(e) {
                console.warn("PocketBase no localizó el código. Guardado local.");
            }
        } else if (typeof db !== 'undefined' && codMaestro) { 
            try {
                let docSnap = await db.collection("inventario").doc(String(codMaestro)).get();
                if (docSnap.exists) {
                    let pNube = docSnap.data();
                    if (sucursalVenta !== '' && pNube.inv_sucursales && pNube.inv_sucursales[sucursalVenta] !== undefined) {
                        pNube.inv_sucursales[sucursalVenta] += c;
                    } else if (pNube.can !== undefined) {
                        pNube.can += c;
                    }
                    await db.collection("inventario").doc(String(codMaestro)).set(pNube);
                }
            } catch(e) { console.warn("Error FB.", e); }
        }
    }

    if (typeof registrarEnKardex === 'function') {
        registrarEnKardex(codMaestro, d.nom, "ANULACIÓN PARCIAL", c, 0, 0, stockAntesReal, stockDespuesReal, sucursalVenta);
    }

    let met = String(vReal.metodo || "").toLowerCase();
    let esCredito = vReal.es_credito || met.includes('cr');
    let idCliente = vReal.cliente_tel || vReal.cliente || vReal.cli || vReal.nom_cliente || "";

    if (esCredito && idCliente) {
        let claveCliente = clientes[idCliente] ? idCliente : Object.keys(clientes).find(k => k === idCliente || clientes[k].nom === idCliente || clientes[k].tel === idCliente);
        if (claveCliente && clientes[claveCliente]) {
            let saldoActual = parseFloat(clientes[claveCliente].saldo) || 0;
            clientes[claveCliente].saldo = parseFloat((Math.max(0, saldoActual - m)).toFixed(2));
            try { localStorage.setItem("pos_clientes_v1", JSON.stringify(clientes)); } catch(e){}

            // Escudo PB Clientes
            if (typeof pb !== 'undefined') {
                try {
                    let provNube = await pb.collection('clientes').getFirstListItem(`id="${claveCliente}" || tel="${claveCliente}"`);
                    provNube.saldo = (parseFloat(provNube.saldo) || 0) - m;
                    await pb.collection('clientes').update(provNube.id, provNube);
                } catch(e) { console.warn("Error restando deuda cliente PB"); }
            } else if (typeof db !== 'undefined') {
                db.collection("clientes").doc(String(claveCliente)).set({ saldo: firebase.firestore.FieldValue.increment(-m) }, { merge: true }).catch(e => console.error(e));
            }
        }
    } else { 
        let idMov = Date.now(); 
        let nm = { id: idMov, fecha: (typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0]), hora: new Date().toLocaleTimeString(), cajero: usuarioActual, sucursal: sucursalVenta, tipo: 'Retiro', monto: parseFloat(m.toFixed(2)), motivo: `DEVOLUCIÓN PARCIAL: ${d.nom}` }; 
        if (typeof movimientos !== 'undefined') {
            movimientos.push(nm); 
            try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(movimientos)); } catch(e){}
        }
        if (typeof db !== 'undefined') {
            db.collection("movimientos").doc(String(idMov)).set(nm).catch(e => console.error(e)); 
        }
    }

    try { localStorage.setItem("pos_ventas_v6", JSON.stringify(ventas)); } catch(e){}

    // 🚀 ACTUALIZAMOS EL TICKET EN LA NUBE PARA QUE TODOS LO VEAN MODIFICADO
    try {
        if (typeof pb !== 'undefined') {
            let idBuscar = String(vReal.doc_id || vReal.id);
            try {
                await pb.collection("ventas").update(idBuscar, vReal);
            } catch(e) {
                let vNube = await pb.collection("ventas").getFirstListItem(`id="${idBuscar}" || doc_id="${idBuscar}"`);
                await pb.collection("ventas").update(vNube.id, vReal);
            }
        } else if (typeof db !== 'undefined') {
            await db.collection("ventas").doc(String(vReal.id)).set(vReal);
        }

        alert("✅ Devolución procesada en la nube: $" + m.toFixed(2)); 
        if(typeof renderVisorActivo === 'function') renderVisorActivo(); 
        if(typeof renderCorte === 'function') renderCorte(); 
        if(typeof renderTablaInventario === 'function') renderTablaInventario(); 
        else if(typeof renderI === 'function') renderI(); 
        if(typeof renderClientes === 'function') renderClientes(); 
    } catch(err) {
        alert("⚠️ Devolución guardada en memoria local (No hay conexión).");
    }
}

// Visor Compras
let visorComprasIndices = []; let currentVisorCompraPos = 0;
async function abrirVisorCompras() { 
    if (typeof compras !== 'undefined' && compras.length === 0) { if (typeof db_compras !== 'undefined') compras = db_compras; else if (window.comprasGlobal) compras = window.comprasGlobal; }
    if (document.getElementById('visor_compras_date')) document.getElementById('visor_compras_date').value = getFechaLocal();
    filtrarVisorCompras(); document.getElementById('modalVisorCompras').style.display = 'block'; 
}
function filtrarVisorCompras() {
    let t = document.getElementById('visor_compras_search') ? document.getElementById('visor_compras_search').value.toLowerCase().trim() : ''; 
    let d = document.getElementById('visor_compras_date') ? document.getElementById('visor_compras_date').value : '';
    
    visorComprasIndices = compras.filter(c => c.sucursal === sucursalActual && (d === '' || c.fecha === d) && (t === '' || `${c.id} ${c.proveedor}`.toLowerCase().includes(t)));
    
    if (visorComprasIndices.length === 0) { 
        document.getElementById('visor_compras_counter').innerText = "0 / 0"; 
        document.getElementById('visor_compras_items').innerHTML = `<tr><td colspan="3">Vacio</td></tr>`; 
        document.getElementById('visor_compras_total').innerText = "0.00"; 
        
        // 🔴 Si no hay resultados en la búsqueda, escondemos el botón rojo para evitar errores
        let btnAnular = document.getElementById("btn_anular_compra_visor");
        if (btnAnular) btnAnular.style.display = "none";
        
    } else { 
        currentVisorCompraPos = visorComprasIndices.length - 1; 
        renderVisorCompraActiva(); 
    }
}

function renderVisorCompraActiva() {
    if (visorComprasIndices.length === 0) return; 
    let c = visorComprasIndices[currentVisorCompraPos]; 
    
    document.getElementById('visor_compras_counter').innerText = `${currentVisorCompraPos + 1} / ${visorComprasIndices.length}`;
    document.getElementById('visor_compras_fecha').innerText = `${c.fecha || ''} ${c.hora || ''}`; 
    document.getElementById('visor_compras_prov').innerText = c.proveedor || 'General'; 
    document.getElementById('visor_compras_folio').innerText = c.id || '-';
    
    let html = ''; let tot = 0;
    (c.items || []).forEach(x => { 
        let sub = (x.can * (parseFloat(x.cos)||0)) * (1 - (parseFloat(x.desc)||0)/100); 
        tot+=sub; 
        html+=`<tr><td>${x.can}</td><td>${x.nom}</td><td style="text-align:right;">$${sub.toFixed(2)}</td></tr>`; 
    });
    
    document.getElementById('visor_compras_items').innerHTML = html; 
    document.getElementById('visor_compras_total').innerText = (c.total !== undefined ? parseFloat(c.total) : tot).toFixed(2);

    // --- ✨ NUEVA LÓGICA COPIADA DE VENTAS PARA EL SELLO ANULADA ---
    let btnAnular = document.getElementById("btn_anular_compra_visor");
    
    // Eliminamos cualquier contenedor de marca previo para que no se dupliquen al avanzar tickets
    let marcaPrevia = document.getElementById("marca_anulada_compras");
    if (marcaPrevia) marcaPrevia.remove();

    if (c.anulada === true) {
        // 1. Creamos el hermoso letrero inclinado encima del ticket
        let contenedorPrint = document.getElementById("visor_compras_print_area");
        let selloHTML = `
            <div id="marca_anulada_compras" style="
                position: absolute; top: 35%; left: 5%; width: 90%;
                border: 5px solid #000; color: #000;
                font-size: 34px; font-weight: bold; text-align: center;
                transform: rotate(-20deg); background: rgba(255,255,255,0.9);
                padding: 10px 0; user-select: none; pointer-events: none; z-index: 10;
            ">ANULADA</div>
        `;
        contenedorPrint.insertAdjacentHTML('beforeend', selloHTML);

        // 2. Cambiamos el botón inferior para que se vuelva gris y diga "❌ ANULADA"
        if (btnAnular) {
            btnAnular.style.display = "block";
            btnAnular.style.background = "#888"; // Gris de desactivado
            btnAnular.innerText = "❌ ANULADA";
            btnAnular.removeAttribute("onclick"); // Le quitamos la función para que ya no haga nada
        }
    } else {
        // Si el ticket está sano y salvo, el botón vuelve a la normalidad
        if (btnAnular) {
            btnAnular.style.display = "block";
            btnAnular.style.background = "#dc3545"; // Rojo vivo
            btnAnular.innerText = "🗑️ ANULAR";
            btnAnular.setAttribute("onclick", `anularCompraAdmin('${c.id}')`);
        }
    }
}
function navVisorCompras(dir) { if (visorComprasIndices.length === 0) return; currentVisorCompraPos = Math.max(0, Math.min(visorComprasIndices.length - 1, currentVisorCompraPos + dir)); renderVisorCompraActiva(); }


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
    let inicio = document.getElementById('filtro_compra_inicio').value; 
    let fin = document.getElementById('filtro_compra_fin').value; 
    let tbody = document.getElementById('body_analisis_compras');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Cargando...</td></tr>';

    db.collection("compras").orderBy("id", "desc").get().then(qs => {
        let total = 0; let html = ''; datosComprasActuales = [];
        let dI = inicio ? new Date(inicio + "T00:00:00").getTime() : 0; 
        let dF = fin ? new Date(fin + "T23:59:59").getTime() : Infinity;
        
        qs.forEach(doc => {
            let data = doc.data(); let dDate = new Date(data.id).getTime();
            if(dDate >= dI && dDate <= dF && data.sucursal === sucursalActual) {
                datosComprasActuales.push(data); 
                let m = parseFloat(data.total) || 0; total += m;
                let lst = (data.detalles || data.items || []).map(d => `${d.can}x ${d.nom}`).join(", ");
                
                // Dibujamos la fila NORMAL (sin el botón rojo, porque ese ya está en el visor)
                html += `<tr><td>${data.fecha}</td><td>${data.proveedor || 'General'}</td><td>${(data.detalles||data.items||[]).length} items</td><td style="text-align:right;">$${m.toFixed(2)}</td><td>${lst.substring(0,30)}...</td></tr>`;
            }
        });
        
        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center;">Vacio</td></tr>'; 
        document.getElementById('total_analisis_compras').innerText = total.toFixed(2);
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
        let txt = document.getElementById('b_input').value.toLowerCase(); 
        
        // 🛑 ELIMINAMOS el bloqueo que causaba el "efecto fantasma" al buscar lo mismo dos veces
        ultimoTextoBuscado = txt; 
        
        let terms = txt.split(/%|\s+/).filter(t => t.trim() !== ""); 
        searchResultsList = []; 
        let codigos = Object.keys(inv);
        
        for(let i = 0; i < codigos.length; i++) {
            let cod = codigos[i]; 
            let pOriginal = inv[cod]; 
            if (!pOriginal) continue;
            
            let match = terms.every(t => (String(cod).toLowerCase() + " " + String(pOriginal.nom || '').toLowerCase()).includes(t));
            
            if(terms.length === 0 || match) { 
                
                // 🌟 MAGIA MAESTRO-ESPEJO: Detectamos si es variante y jalamos los datos del Jefe
                let pMaestro = (pOriginal.grupo && inv[pOriginal.grupo]) ? inv[pOriginal.grupo] : pOriginal;
                
                // Armamos el resultado inyectándole siempre el Precio y Stock más fresco
                searchResultsList.push({
                    ...pOriginal, // Trae el nombre y la foto del espejo
                    cod: cod,
                    pv: pMaestro.pv !== undefined ? pMaestro.pv : pOriginal.pv, // Precio Real
                    stock: pMaestro.stock !== undefined ? pMaestro.stock : pOriginal.stock, // Stock Real
                    cos: pMaestro.cos !== undefined ? pMaestro.cos : pOriginal.cos // Costo Real
                }); 
                
                if (searchResultsList.length >= 50) break; 
            } 
        }
        
        focusSearchIndex = searchResultsList.length > 0 ? 0 : -1; 
        if (typeof renderTablaBuscador === 'function') renderTablaBuscador();
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



let html5QrcodeScannerPrincipal = null;

window.abrirEscanerCamara = function(destinoInputId = 'v_cod') {
    // ==========================================
    // 🧹 1. BARREDORA: MATAMOS CUALQUIER CÁMARA ABIERTA
    // ==========================================
    if (typeof apagarCamaraCiego === 'function') {
        try { apagarCamaraCiego(); } catch(e){}
    }
    if (html5QrcodeScannerPrincipal) {
        try { html5QrcodeScannerPrincipal.stop(); } catch(e){}
        html5QrcodeScannerPrincipal = null;
    }

    // ==========================================
    // 🖼️ 2. CONSTRUCCIÓN DE LA PANTALLA
    // ==========================================
    let modal = document.getElementById('modal-camara-ventas');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-camara-ventas';
        modal.innerHTML = `
            <div style="background:white; padding:15px; border-radius:10px; width:95%; max-width:400px; text-align:center;">
                <h3 style="margin-top:0; color:#333;">📷 Escanea el Código</h3>
                <div id="lector-qr-ventas" style="width:100%; min-height:250px; background:#000; margin-bottom:10px;"></div>
                
                <div id="log-celular" style="background:#f8d7da; color:#721c24; font-size:12px; padding:10px; margin-bottom:15px; text-align:left; border-radius:5px; word-wrap:break-word;">
                    Limpiando hardware...
                </div>

                <button onclick="cerrarEscanerCamara()" style="padding:15px 20px; background:#dc3545; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer; width:100%;">Cancelar y Cerrar</button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.cssText = 'display:flex !important; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.9); z-index:999999; flex-direction:column; justify-content:center; align-items:center;';

    let log = document.getElementById('log-celular');
    log.innerHTML = "⏳ Ventana lista. Encendiendo motor...<br>";

    // ==========================================
    // 🚀 3. ENCENDIDO SEGURO
    // ==========================================
    setTimeout(() => {
        try {
            html5QrcodeScannerPrincipal = new Html5Qrcode("lector-qr-ventas");
            
            html5QrcodeScannerPrincipal.start(
                { facingMode: "environment" }, 
                {
                    fps: 15,
                    qrbox: { width: 250, height: 150 },
                    formatsToSupport: [ 
                        Html5QrcodeSupportedFormats.EAN_13, 
                        Html5QrcodeSupportedFormats.EAN_8, 
                        Html5QrcodeSupportedFormats.CODE_128,
                        Html5QrcodeSupportedFormats.UPC_A
                    ]
                },
                (codigoDetectado) => {
                    if (navigator.vibrate) navigator.vibrate(80);
                    cerrarEscanerCamara();
                    
                    let input = document.getElementById(destinoInputId);
                    if(input) {
                        input.value = codigoDetectado;
                        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter' }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
                    }
                },
                (error) => { /* Silenciar estática */ }
            ).then(() => {
                log.innerHTML += "✅ ¡Cámara conectada con éxito!<br>";
                log.style.background = "#d4edda";
                log.style.color = "#155724";
            }).catch(err => {
                log.innerHTML += `<br><b>🚨 ERROR:</b> ${err}`;
            });
        } catch (e) {
            log.innerHTML += `<br><b>💥 ERROR FATAL:</b> ${e}`;
        }
    }, 600); 
};

window.cerrarEscanerCamara = function() {
    let modal = document.getElementById('modal-camara-ventas');
    if(modal) modal.style.display = 'none';
    
    if (html5QrcodeScannerPrincipal) {
        html5QrcodeScannerPrincipal.stop().then(() => {
            html5QrcodeScannerPrincipal = null;
        }).catch(err => {
            html5QrcodeScannerPrincipal = null;
        });
    }
};
// ==========================================
// 🛑 APAGADO DE EMERGENCIA AL SALIR / RECARGAR
// ==========================================
window.addEventListener('beforeunload', () => {
    if (html5QrcodeScannerPrincipal) {
        try { html5QrcodeScannerPrincipal.stop(); } catch(e){}
    }
    if (typeof apagarCamaraCiego === 'function') {
        try { apagarCamaraCiego(); } catch(e){}
    }
});

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
window.registrarEnKardex = function(productoCod, productoNom, tipoMov, cantidad, precio, costo, stockAntes, stockDespues, sucursalInyectada = null) {
    
    // 🌟 1. IDENTIFICAR LA SUCURSAL EXACTA
    let sucKardex = sucursalInyectada ? sucursalInyectada : String(typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz').replace(/📍/g, '').trim();

    // 🌟 MAGIA MAESTRO-ESPEJO: El Escudo Definitivo
    let pOriginal = inv[productoCod] || {};
    let esEspejo = pOriginal.grupo && inv[pOriginal.grupo];
    let codigoFinal = esEspejo ? pOriginal.grupo : productoCod;
    
    if (esEspejo && (tipoMov === "EDICIÓN" || tipoMov === "AJUSTE")) {
        let pMaestro = inv[codigoFinal];
        let stockMaestro = 0;
        if (pMaestro.stock && typeof pMaestro.stock === 'object') {
            stockMaestro = parseFloat(pMaestro.stock[sucKardex]) || 0; 
        } else {
            stockMaestro = parseFloat(pMaestro.stock) || parseFloat(pMaestro.existencia) || parseFloat(pMaestro.can) || 0;
        }
        stockAntes = stockMaestro;
        stockDespues = stockMaestro;
    }

    // 🛡️ REDONDEO QUIRÚRGICO: Evitamos la "basura matemática" de JavaScript
    let c_cantidad = parseFloat(parseFloat(cantidad).toFixed(3)) || 0;
    let c_stockAntes = parseFloat(parseFloat(stockAntes).toFixed(3)) || 0;
    let c_stockDespues = parseFloat(parseFloat(stockDespues).toFixed(3)) || 0;
    
    let c_precio = parseFloat(parseFloat(precio).toFixed(2)) || 0;
    let c_costo = parseFloat(parseFloat(costo).toFixed(2)) || 0;

    let idKardex = Date.now() + Math.floor(Math.random() * 1000);
    let nuevoRegistro = {
        id: idKardex,
        timestamp: Date.now(),
        fecha: (typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0]),
        hora: new Date().toLocaleTimeString(),
        
        // 🚀 GUARDAMOS EN LA BÓVEDA DEL MAESTRO
        codigo: codigoFinal, 
        nombre: productoNom, 
        tipo: tipoMov,
        
        // 📸 FOTOGRAFÍAS CORREGIDAS A 3 DECIMALES
        cantidad: c_cantidad,
        stock_antes: c_stockAntes,
        stock_despues: c_stockDespues,
        
        // 💸 DINERO CORREGIDO A 2 DECIMALES
        precio: c_precio,
        costo: c_costo,
        
        sucursal: sucKardex, 
        cajero: (typeof usuarioActual !== 'undefined' ? usuarioActual : "Admin")
    };

    // ☁️ 🚀 SUBIDA A LA NUBE DIRECTA (Sin saturar localStorage)
    if (typeof db !== 'undefined') {
        db.collection("kardex").doc(String(idKardex)).set(nuevoRegistro).catch(e => console.error("❌ Error guardando Kardex en Nube:", e));
    }
}

// =========================================================================
// 📊 RENDERIZADO PASIVO DEL KARDEX (NO ALTERA PESTAÑAS)
// =========================================================================
window.renderKardex = function() {
    try {
        // ❌ ELIMINAMOS cualquier instrucción de "display = 'block'" o "display = 'none'" aquí.
        // Esa responsabilidad ahora es 100% exclusiva de changeTab().

        // 1. Poblar selector de sucursales (solo si está vacío)
        let selectSuc = document.getElementById('kardex_sucursal');
        let sucursalesSeguras = (typeof listaSucursales !== 'undefined' && Array.isArray(listaSucursales)) 
            ? listaSucursales 
            : [];

        if (selectSuc && (selectSuc.innerHTML === "" || selectSuc.options.length <= 1)) {
            selectSuc.innerHTML = '<option value="">📍 Todas las Sucursales</option>' + 
                sucursalesSeguras.map(s => `<option value="${s}">📍 ${s}</option>`).join('');
        }

        // 2. Dibujar y filtrar los datos (silenciosamente en segundo plano)
        if (typeof window.filtrarKardex === 'function') {
            window.filtrarKardex();
        }
        
    } catch (error) {
        console.error("❌ Error en renderKardex:", error);
    }
};
// 1. INICIALIZAR LA MEMORIA DEL KARDEX AL CARGAR LA PÁGINA
try {
    let kardexGuardado = localStorage.getItem("pos_kardex_v1");
    if (kardexGuardado) {
        window.historialKardex = JSON.parse(kardexGuardado);
    } else {
        window.historialKardex = [];
    }
} catch(e) { 
    window.historialKardex = []; 
}


// =========================================================================
// 🕒 MOTOR DE NORMALIZACIÓN Y PARSEO CRONOLÓGICO DE KARDEX
// =========================================================================
function parsearFechaHoraKardex(reg) {
    if (!reg) return 0;
    if (reg.created) return new Date(reg.created).getTime();
    if (reg.timestamp && !isNaN(reg.timestamp)) return Number(reg.timestamp);

    let f = String(reg.fecha || '1970-01-01').trim();
    let h = String(reg.hora || '00:00:00').trim().toLowerCase();

    // Normalizar formato DD/MM/YYYY a YYYY-MM-DD
    if (f.includes('/')) {
        let p = f.split('/');
        if (p.length === 3 && p[2].length === 4) {
            f = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
        }
    }

    // Normalizar formato 12 horas (a.m. / p.m.) a formato militar de 24 horas
    if (h.includes('m')) {
        let esPM = h.includes('p.m.') || h.includes('pm');
        let soloNumeros = h.replace(/[^0-9:]/g, '');
        let partesH = soloNumeros.split(':');
        let horas = parseInt(partesH[0], 10) || 0;
        let minutos = partesH[1] || '00';
        let segundos = partesH[2] || '00';

        if (esPM && horas < 12) horas += 12;
        if (!esPM && horas === 12) horas = 0;
        h = `${String(horas).padStart(2, '0')}:${minutos}:${segundos}`;
    }

    let dt = new Date(`${f}T${h}`);
    return isNaN(dt.getTime()) ? 0 : dt.getTime();
}

// =========================================================================
// 📊 CONTROLADOR DE FILTRADO, ORDENAMIENTO Y RENDERIZADO DEL KARDEX
// =========================================================================
window.filtrarKardex = function() {
    try {
        // 🛡️ Normalización de la fuente de datos en memoria (Soporta Array u Object)
        let fuente = window.historialKardex || window.kardex || (typeof kardex !== 'undefined' ? kardex : []);
        let registros = Array.isArray(fuente) ? fuente : Object.values(fuente);

        // Captura reactiva de valores desde el DOM
        let txtInput = document.getElementById('kardex_buscar');
        let txt = txtInput ? txtInput.value.toLowerCase().trim() : "";
        
        let sucSelect = document.getElementById('kardex_sucursal');
        let sucFiltro = sucSelect ? sucSelect.value.replace(/📍/g, '').trim().toLowerCase() : "";
        
        let tipoSelect = document.getElementById('kardex_tipo');
        let tipoFiltro = tipoSelect ? tipoSelect.value.trim().toUpperCase() : "";

        let fIniInput = document.getElementById('kardex_fecha_ini');
        let fIni = fIniInput ? fIniInput.value : "";

        let fFinInput = document.getElementById('kardex_fecha_fin');
        let fFin = fFinInput ? fFinInput.value : "";

        // Pipeline de filtrado
        let filtrados = registros.filter(reg => {
            if (!reg) return false;

            // 1. Filtro por texto (Código o Nombre)
            let cod = String(reg.codigo || '').toLowerCase();
            let nom = String(reg.nombre || '').toLowerCase();
            let matchTxt = txt === "" || cod.includes(txt) || nom.includes(txt);

            // 2. Filtro por sucursal
            let sucReg = String(reg.sucursal || '').replace(/📍/g, '').trim().toLowerCase();
            let matchSuc = sucFiltro === "" || sucReg === sucFiltro;

            // 3. Filtro por tipo de movimiento
            let tipoReg = String(reg.tipo || '').toUpperCase();
            let matchTipo = tipoFiltro === "" || tipoReg.includes(tipoFiltro);

            // 4. Filtro por rango de fechas normalizado
            let fReg = String(reg.fecha || '');
            if (fReg.includes('/')) {
                let p = fReg.split('/');
                if (p.length === 3 && p[2].length === 4) {
                    fReg = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
                }
            }
            let matchFIni = fIni === "" || fReg >= fIni;
            let matchFFin = fFin === "" || fReg <= fFin;

            return matchTxt && matchSuc && matchTipo && matchFIni && matchFFin;
        });

        // 🌟 ORDENAMIENTO CRONOLÓGICO: Más reciente primero (Descendente)
        filtrados.sort((a, b) => parsearFechaHoraKardex(b) - parsearFechaHoraKardex(a));

        let html = '';
        
        // Renderizado optimizado para los primeros 300 registros
        filtrados.slice(0, 300).forEach(reg => {
            let tipoLimpio = String(reg.tipo || '').toUpperCase();
            let colorTipo = '#000';
            
            if (tipoLimpio.includes('VENTA')) colorTipo = 'var(--s)';
            else if (tipoLimpio.includes('COMPRA')) colorTipo = '#17a2b8';
            else if (tipoLimpio.includes('EDICIÓN')) colorTipo = 'var(--p)';
            else if (tipoLimpio.includes('AJUSTE')) colorTipo = '#fd7e14';
            else if (tipoLimpio.includes('ANULACIÓN')) colorTipo = 'var(--danger)';
            else if (tipoLimpio.includes('TRANSFERENCIA')) colorTipo = '#6f42c1';

            let cant = parseFloat(reg.cantidad) || 0;
            let colorCant = cant > 0 ? 'var(--s)' : (cant < 0 ? 'var(--danger)' : '#666');

            html += `<tr style="border-bottom: 1px solid #eee;">
                <td style="padding:8px;">${reg.fecha || ''}<br><small style="color:#888;">${reg.hora || ''}</small></td>
                <td style="padding:8px;"><b>${reg.nombre || 'Sin Nombre'}</b><br><small style="color:#666;">${reg.codigo || ''}</small></td>
                <td style="padding:8px;"><span class="badge-kit" style="background:${colorTipo}; color:white; font-weight:bold; padding:2px 6px; border-radius:4px; font-size:11px;">${tipoLimpio}</span></td>
                <td style="padding:8px; text-align:center; font-weight:bold; color:${colorCant};">${cant > 0 ? '+' : ''}${cant}</td>
                <td style="padding:8px; text-align:center; color:#666; background:rgba(0,0,0,0.02);">${reg.stock_antes !== undefined ? reg.stock_antes : '-'}</td>
                <td style="padding:8px; text-align:center; font-weight:bold; color:var(--p); background:rgba(0,0,0,0.04);">${reg.stock_despues !== undefined ? reg.stock_despues : '-'}</td>
                <td style="padding:8px; text-align:right;">$${(parseFloat(reg.precio) || 0).toFixed(2)}</td>
                <td style="padding:8px; text-align:right; color:#666;">$${(parseFloat(reg.costo) || 0).toFixed(2)}</td>
                <td style="padding:8px;">📍 ${reg.sucursal || ''}</td>
                <td style="padding:8px;">👤 ${reg.cajero || reg.usuario || ''}</td>
            </tr>`;
        });

        let tbody = document.getElementById('kardex_tabla_body');
        if (tbody) {
            tbody.innerHTML = html || `<tr><td colspan="10" style="text-align:center; padding:20px; color:#999;">No se encontraron movimientos registrados con los filtros seleccionados.</td></tr>`;
        }

    } catch (error) {
        console.error("❌ Error en filtrarKardex:", error);
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
    let codOriginal = document.getElementById('t_cod').value.trim(); 
    let cant = parseFloat(document.getElementById('t_cant').value)||1; 
    
    if(!inv[codOriginal]) return alert("❌ Producto no existe."); 
    
    // 🌟 MAGIA MAESTRO-ESPEJO: Detectamos si depende de un Jefe
    let pOriginal = inv[codOriginal];
    let codMaestro = (pOriginal.grupo && inv[pOriginal.grupo]) ? pOriginal.grupo : codOriginal;
    let pMaestro = inv[codMaestro];

    if(pMaestro.tipo === 'kit') return alert("❌ Transfiera los componentes base del kit, no el kit armado."); 
    if(cant <= 0) return; 
    
    // Buscamos si el producto MAESTRO ya está en la lista para solo sumarle
    let idx = carT.findIndex(x => String(x.cod) === String(codMaestro)); 
    if(idx > -1) { 
        carT[idx].can += cant; 
    } else { 
        let cBase = pMaestro.cos || 0; 
        let cReal = cBase * (1 + (pMaestro.iva||0)/100); 
        // Agregamos al carrito usando los datos del Jefe absoluto
        carT.push({ cod: codMaestro, nom: pMaestro.nom, can: cant, cReal: cReal }); 
    } 
    document.getElementById('t_cod').value = ''; 
    document.getElementById('t_cant').value = '1'; 
    document.getElementById('t_cod').focus(); 
    renderT(); 
}

// Si llega algo extra que no estaba en el paquete original
function addExtraToRecepcion() { 
    let codOriginal = document.getElementById('r_proc_cod').value.trim(); 
    let can = parseFloat(document.getElementById('r_proc_cant').value)||1; 
    
    if(!inv[codOriginal]) return alert("❌ Código no existe en catálogo."); 
    
    // 🌟 MAGIA MAESTRO-ESPEJO EN RECEPCIÓN
    let pOriginal = inv[codOriginal];
    let codMaestro = (pOriginal.grupo && inv[pOriginal.grupo]) ? pOriginal.grupo : codOriginal;
    let pMaestro = inv[codMaestro];

    if(pMaestro.tipo === 'kit') return alert("❌ No se pueden recibir kits armados, escanea las piezas sueltas."); 
    if(can <= 0) return; 
    
    let idx = carR.findIndex(x => String(x.cod) === String(codMaestro)); 
    if(idx > -1) { 
        carR[idx].can_rec += can; 
    } else { 
        let cBase = pMaestro.cos || 0; 
        let cReal = cBase * (1 + (pMaestro.iva||0)/100); 
        // Se anota con can = 0 (no lo mandaron) pero can_rec = can (sí llegó)
        carR.push({ cod: codMaestro, nom: pMaestro.nom, can: 0, can_rec: can, cReal: cReal }); 
    } 
    document.getElementById('r_proc_cod').value = ''; 
    document.getElementById('r_proc_cant').value = '1'; 
    document.getElementById('r_proc_cod').focus(); 
    renderR(); 
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

window.ejecutarTransferencia = function() { 
    try {
        let elemOri = document.getElementById('t_origen') || document.getElementById('traspaso_desde') || document.getElementById('m_origen');
        let elemDes = document.getElementById('t_destino') || document.getElementById('traspaso_hacia') || document.getElementById('m_destino');

        let ori = elemOri ? elemOri.value : "";
        let des = elemDes ? elemDes.value : "";
        
        let oriLimpio = String(ori || "").replace(/📍/g, '').trim();
        let desLimpio = String(des || "").replace(/📍/g, '').trim();
        
        if (!desLimpio) return alert("⚠️ Por favor selecciona la sucursal de destino (HACIA:).");
        if (!oriLimpio) return alert("⚠️ Por favor selecciona la sucursal de origen (DESDE:).");
        if (oriLimpio === desLimpio) return alert("❌ El Origen y el Destino no pueden ser iguales."); 
        if (typeof carT === 'undefined' || !carT || carT.length === 0) return alert("❌ El carrito de envíos está vacío."); 
        
        if (!confirm(`📦 ¿Confirmas el envío de mercancía desde ${oriLimpio} hacia ${desLimpio}?`)) return; 
        
        let idEnvio = Date.now();
        
        carT.forEach(x => { 
            let codigoProducto = x.cod || x.id;
            let pOriginal = (typeof inv !== 'undefined' && inv[codigoProducto]) ? inv[codigoProducto] : {};
            let codMaestro = (pOriginal.grupo && inv && inv[pOriginal.grupo]) ? pOriginal.grupo : codigoProducto;
            let pMaestro = (typeof inv !== 'undefined' && inv[codMaestro]) ? inv[codMaestro] : pOriginal;

            if (!pMaestro.stock || typeof pMaestro.stock !== 'object') {
                let stockAntiguo = parseFloat(pMaestro.stock) || 0;
                pMaestro.stock = {}; 
                pMaestro.stock['Matriz'] = stockAntiguo;
            }
            
            let stockAntesReal = parseFloat(pMaestro.stock[oriLimpio]) || 0;
            let cantEnviar = parseFloat(x.can || x.cantidad || 1);
            let stockDespuesReal = parseFloat((stockAntesReal - cantEnviar).toFixed(3));
            
            // Ajuste en la memoria local
            pMaestro.stock[oriLimpio] = stockDespuesReal; 
            
            // 🌟 ESCUDO ANTI-SOBREESCRITURA (POCKETBASE / FIREBASE)
            if (typeof pb !== 'undefined' && codMaestro) { 
                pb.collection('inventario').getOne(String(codMaestro)).then(pNube => {
                    // Restamos solo la cantidad enviada a lo que sea que haya en la nube en este instante
                    if (pNube.stock && typeof pNube.stock === 'object') {
                        pNube.stock[oriLimpio] = (parseFloat(pNube.stock[oriLimpio]) || 0) - cantEnviar;
                    }
                    if (pNube.inv_sucursales && typeof pNube.inv_sucursales === 'object') {
                        pNube.inv_sucursales[oriLimpio] = (parseFloat(pNube.inv_sucursales[oriLimpio]) || 0) - cantEnviar;
                    }
                    if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) {
                        pNube.can -= cantEnviar;
                    }
                    pb.collection('inventario').update(String(codMaestro), pNube).catch(e => console.warn("Error PB:", e));
                }).catch(e => console.warn("Error leyendo stock en PB:", e));
            } else if (typeof db !== 'undefined' && db.collection) {
                db.collection("inventario").doc(String(codMaestro)).get().then(docSnap => {
                    if (docSnap.exists) {
                        let pNube = docSnap.data();
                        if (pNube.stock && typeof pNube.stock === 'object') {
                            pNube.stock[oriLimpio] = (parseFloat(pNube.stock[oriLimpio]) || 0) - cantEnviar;
                        }
                        if (pNube.inv_sucursales && typeof pNube.inv_sucursales === 'object') {
                            pNube.inv_sucursales[oriLimpio] = (parseFloat(pNube.inv_sucursales[oriLimpio]) || 0) - cantEnviar;
                        }
                        if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) {
                            pNube.can -= cantEnviar;
                        }
                        db.collection("inventario").doc(String(codMaestro)).set(pNube);
                    }
                }).catch(e => console.warn("Error FB.", e));
            }
            
            if (typeof registrarEnKardex === 'function') {
                registrarEnKardex(codMaestro, x.nom || "Producto", "TRANSFERENCIA (SALIDA)", -cantEnviar, parseFloat(pMaestro.pv) || parseFloat(pOriginal.pv) || 0, parseFloat(x.cReal) || parseFloat(pMaestro.cos) || parseFloat(pOriginal.cos) || 0, stockAntesReal, stockDespuesReal, oriLimpio);
            }
            x.cod = codMaestro;
        }); 
        
        let elTotalVal = document.getElementById('t_total_val') || document.getElementById('lbl_costo_lote');
        let elTotalArt = document.getElementById('t_total_art') || document.getElementById('lbl_total_articulos');

        let nuevaTransferencia = { 
            id: idEnvio, 
            fecha: new Date().toLocaleString(), 
            origen: oriLimpio, 
            destino: desLimpio, 
            items: [...carT], 
            valor: elTotalVal ? elTotalVal.innerText : "$0.00", 
            total_art: elTotalArt ? elTotalArt.innerText : String(carT.length),
            estado: 'pendiente', 
            obs: '' 
        };
        
        if (typeof transferencias === 'undefined') window.transferencias = [];
        transferencias.push(nuevaTransferencia); 
        
        try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e) {}
        try { localStorage.setItem("pos_transferencias_v6", JSON.stringify(transferencias)); } catch(e) {}
        
        if (typeof db !== 'undefined' && db.collection) {
            db.collection("transferencias").doc(String(idEnvio)).set(nuevaTransferencia).catch(e => console.error("Error al subir:", e));
        }

        alert(`✅ Envío creado exitosamente. Notificado a ${desLimpio}.`); 
        
        carT = []; 
        if (typeof renderCarT === 'function') renderCarT();
        if (typeof renderTraspaso === 'function') renderTraspaso();
        if (typeof renderI === 'function') renderI(); 
        if (typeof actualizarContadorRecepciones === 'function') actualizarContadorRecepciones(); 

        document.querySelectorAll('.modal, .w3-modal').forEach(m => {
            if (m.style.display === 'block' || m.style.display === 'flex') m.style.display = 'none';
        });

    } catch (err) {
        alert("⚠️ Hubo un detalle al procesar la transferencia:\n" + err.message);
    }
};
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




// REEMPLAZO 1: renderListaRecepciones (Escudo contra paquetes corruptos)
function renderListaRecepciones() {
    let tbody = document.getElementById('r_lista_pendientes');
    if (!tbody) return;

    // Volvemos a filtrar por seguridad
    pendientesTrans = transferencias.filter(t => t.destino === sucursalActual && (t.estado === 'pendiente' || t.estado === 'Pendiente'));

    if (pendientesTrans.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#888;">No hay envíos pendientes</td></tr>';
        return;
    }

    tbody.innerHTML = pendientesTrans.map((t, i) => {
        let isFocused = (i === focusRecepcionIndex);
        let bgRow = isFocused ? 'background:#e0f0ff; border-left: 4px solid var(--orange);' : '';
        
        // 🛡️ Extracción de ID ABSOLUTAMENTE SEGURA
        let idReal = t.id || t.doc_id || t.folio || "Error_Ghost_" + i;
        
        let fechaReal = t.fecha ? String(t.fecha).split(',')[0] : "Sin fecha";
        let montoReal = parseFloat(t.valor || t.monto || 0).toFixed(2);
        let origenReal = t.origen || t.emisor || 'Desconocido';
        
       return `<tr style="cursor:pointer; ${bgRow}" onclick="iniciarRecepcion('${idReal}')">
            <td>${isFocused ? '👉 ' : ''}${fechaReal}<br><small style="color:#aaa">ID: ${String(idReal).replace('Error_Ghost_', 'Corrupto ')}</small></td>
            <td><b>${origenReal}</b></td>
            <td style="color:var(--s); font-weight:bold;">$${montoReal}</td>
            <td><span style="background:var(--warning); color:#000; padding:3px 6px; border-radius:4px; font-size:10px; font-weight:bold">PENDIENTE</span></td>
            <td>
                <div style="display: flex; gap: 5px; align-items: stretch; justify-content: flex-start;">
                    <button tabindex="-1" style="background:var(--orange); color:white; border:none; padding:8px 15px; border-radius:5px; cursor:pointer; font-weight:bold;" onclick="event.stopPropagation(); iniciarRecepcion('${idReal}')">
                        Recibir
                    </button>
                    <button onclick="event.stopPropagation(); borrarRecepcion('${idReal}', ${i})" style="background: var(--danger, #dc3545); color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Borrar recepción">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// REEMPLAZO 2: iniciarRecepcion (Evita que el sistema colapse si el paquete no tiene productos)
function iniciarRecepcion(id) { 
    if (String(id).includes("Error_Ghost")) {
        return alert("❌ Este es un paquete vacío o dañado de pruebas anteriores. Por favor, bórralo con el botón rojo del basurero.");
    }

    let t = transferencias.find(x => String(x.id) === String(id) || String(x.doc_id) === String(id)); 
    if(!t) return alert("❌ No se encontró la transferencia."); 
    
    idTransferenciaActual = id; 
    
    // 🛡️ PARACAÍDAS: Si por algún motivo t.items está vacío, creamos una lista vacía para que ".map" no explote
    let itemsSeguros = Array.isArray(t.items) ? t.items : [];
    carR = itemsSeguros.map(item => ({...item, can_rec: item.can || item.cantidad || 1})); 
    
    document.getElementById('r_proc_folio').innerText = t.id || id; 
    document.getElementById('r_proc_obs').value = ""; 
    document.getElementById('r_proc_cod').value = ""; 
    
    cerrarModales(); 
    document.getElementById('modalProcesarRecepcion').style.display = 'block'; 
    renderR(); 
}

// REEMPLAZO 3: borrarRecepcion (Asegura la eliminación del registro fantasma tanto local como en la nube)
window.borrarRecepcion = function(idRecepcion, indiceGhost) {
    if (!confirm("⚠️ ¿Estás seguro de que deseas eliminar este paquete?")) return;

    // 1. Limpieza Local (Memoria RAM y Disco Duro)
    if (typeof pendientesTrans !== 'undefined') {
        if (String(idRecepcion).includes("Error_Ghost")) {
            pendientesTrans.splice(indiceGhost, 1);
        } else {
            pendientesTrans = pendientesTrans.filter(t => String(t.id) !== String(idRecepcion) && String(t.doc_id) !== String(idRecepcion));
        }
    }
    
    if (typeof transferencias !== 'undefined') {
        transferencias = transferencias.filter(t => String(t.id) !== String(idRecepcion) && String(t.doc_id) !== String(idRecepcion));
        try { localStorage.setItem("pos_transferencias_v6", JSON.stringify(transferencias)); } catch(e){}
    }

    // 2. Limpieza en la Nube (Solo si no es fantasma)
    if (typeof db !== 'undefined' && !String(idRecepcion).includes("Error_Ghost")) {
        // Intentamos borrar mediante Firebase (PikaPod Adapter)
        db.collection("transferencias").doc(String(idRecepcion)).delete().catch(e => {
            // Si el adaptador falla, usamos el puente directo a PikaPod
            if(typeof pb !== 'undefined') {
                pb.collection("transferencias").getFirstListItem(`doc_id="${idRecepcion}" || id="${idRecepcion}"`)
                .then(record => pb.collection("transferencias").delete(record.id))
                .catch(err => console.log("El paquete ya no existe en la nube."));
            }
        });
    }

    alert("🗑️ Recepción eliminada correctamente.");
    
    // 3. Refrescamos la pantalla
    if (typeof renderListaRecepciones === 'function') renderListaRecepciones(); 
    if (typeof actualizarContadorRecepciones === 'function') actualizarContadorRecepciones();
};



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
// ====================================================================
// 📥 CONFIRMAR RECEPCIÓN (CON ESCUDO ANTI-SOBREESCRITURA PB/FB)
// ====================================================================
window.confirmarRecepcion = async function() { 
    try {
        let tIndex = transferencias.findIndex(x => x.id === idTransferenciaActual); 
        if(tIndex === -1) return alert("❌ No se encontró la transferencia actual."); 
        
        let trans = transferencias[tIndex];
        let oriLimpio = trans.origen;

        if(!confirm("📥 ¿Confirmar el ingreso físico a tu inventario?")) return; 
        
        let detallesFaltantes = []; 

        for (let x of carR) { 
            let pO = inv[x.cod] || {};
            if(!pO.stock) pO.stock = {}; 
            
            let cantEnviada = parseFloat(x.can) || 0;
            let cantRecibidaTotal = parseFloat(x.can_rec) || 0;
            let faltante = parseFloat((cantEnviada - cantRecibidaTotal).toFixed(3));

            let stockAntesReal = parseFloat(pO.stock[sucursalActual]) || 0;
            let stockDespuesReal = parseFloat((stockAntesReal + cantRecibidaTotal).toFixed(3));
            
            let stockAntesOrigen = parseFloat(pO.stock[oriLimpio]) || 0;
            let stockDespuesOrigen = parseFloat((stockAntesOrigen + faltante).toFixed(3));

            // Ajuste Local (Memoria pantalla)
            if(cantRecibidaTotal > 0) pO.stock[sucursalActual] = stockDespuesReal; 
            if(faltante > 0) pO.stock[oriLimpio] = stockDespuesOrigen;

            // KARDEX
            if(cantRecibidaTotal > 0 && typeof registrarEnKardex === 'function') {
                registrarEnKardex(x.cod, x.nom, "TRANSFERENCIA (ENTRADA)", cantRecibidaTotal, pO.pv || 0, x.cReal || pO.cos || 0, stockAntesReal, stockDespuesReal);
            }
            if(faltante > 0 && typeof registrarEnKardex === 'function') {
                registrarEnKardex(x.cod, x.nom, "DEVOLUCIÓN DE ENVÍO (FALTANTE)", faltante, pO.pv || 0, x.cReal || pO.cos || 0, stockAntesOrigen, stockDespuesOrigen, oriLimpio);
            }

            // 🌟 ESCUDO ANTI-SOBREESCRITURA (POCKETBASE / FIREBASE)
            if (typeof pb !== 'undefined' && x.cod) {
                try {
                    let pNube = await pb.collection('inventario').getOne(String(x.cod));
                    if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                    
                    if (cantRecibidaTotal > 0) {
                        pNube.inv_sucursales[sucursalActual] = (parseFloat(pNube.inv_sucursales[sucursalActual]) || 0) + cantRecibidaTotal;
                    }
                    if (faltante > 0) {
                        pNube.inv_sucursales[oriLimpio] = (parseFloat(pNube.inv_sucursales[oriLimpio]) || 0) + faltante;
                        detallesFaltantes.push(`- ${faltante} de ${x.nom}`); 
                    }
                    
                    await pb.collection('inventario').update(String(x.cod), pNube);
                } catch (e) { console.error("❌ Error sumando recepción en PB:", e); }

            } else if (typeof db !== 'undefined' && x.cod) {
                try {
                    let docSnap = await db.collection("inventario").doc(String(x.cod)).get();
                    if (docSnap.exists) {
                        let pNube = docSnap.data();
                        if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                        
                        if (cantRecibidaTotal > 0) {
                            pNube.inv_sucursales[sucursalActual] = (parseFloat(pNube.inv_sucursales[sucursalActual]) || 0) + cantRecibidaTotal;
                        }
                        if (faltante > 0) {
                            pNube.inv_sucursales[oriLimpio] = (parseFloat(pNube.inv_sucursales[oriLimpio]) || 0) + faltante;
                            if (typeof pb === 'undefined') detallesFaltantes.push(`- ${faltante} de ${x.nom}`); 
                        }
                        await db.collection("inventario").doc(String(x.cod)).set(pNube);
                    }
                } catch (e) { console.error("❌ Error sumando recepción en FB:", e); }
            }
        } 
        
        trans.estado = 'completada'; 
        let elObs = document.getElementById('r_proc_obs');
        trans.obs = elObs ? elObs.value : ""; 
        trans.items_recibidos = [...carR]; 
        
        if (detallesFaltantes.length > 0) {
            trans.hay_mensaje_origen = true;
            trans.origen_enterado = false;
            trans.mensaje_origen = `⚠️ ATENCIÓN SUCURSAL ${oriLimpio}:\n\nLa sucursal ${sucursalActual} recibió tu envío (Folio: ${trans.id}), pero reportó que FALTÓ lo siguiente:\n${detallesFaltantes.join('\n')}\n\n✅ Este faltante ya fue regresado a tu inventario automáticamente.`;
        }

        try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e){}
        try { localStorage.setItem("pos_transferencias_v6", JSON.stringify(transferencias)); } catch(e){}
        
        if(typeof db !== 'undefined' && db.collection) {
            db.collection("transferencias").doc(String(idTransferenciaActual)).set(trans, { merge: true });
        }

        alert("✅ Recepción completada. El stock recibido se sumó a tu inventario y los faltantes regresaron al origen."); 
        
        if(typeof renderI === 'function') renderI(); 
        if(typeof cerrarModales === 'function') cerrarModales(); 
        else document.querySelectorAll('.modal, .w3-modal').forEach(m => m.style.display = 'none');

        if(typeof actualizarContadorRecepciones === 'function') actualizarContadorRecepciones(); 

    } catch (err) {
        alert("⚠️ Error al confirmar recepción:\n" + err.message);
    }
};

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
            // 1. Descargamos Ventas resguardando tanto la raíz como el objeto data
            let recordsVentas = await pb.collection('ventas').getFullList({ requestKey: null });
            window.ventas = recordsVentas.map(r => {
                let v = r.data || r;
                v.id = v.id || r.id;
                return v;
            }); 

            // 2. Descargamos Movimientos resguardando tanto la raíz como el objeto data (🔥 CORRECCIÓN CRÍTICA)
            let recordsMovs = await pb.collection('movimientos').getFullList({ requestKey: null });
            window.movimientos = recordsMovs.map(r => {
                let m = r.data || r;
                m.id = m.id || r.id;
                return m;
            });
            
            console.log("☁️ Datos sincronizados. Ventas:", window.ventas.length, "Movs:", window.movimientos.length);
        }
    } catch(e) {
        console.warn("Sin internet o error al descargar de PocketBase:", e);
    }
    
    if (btnConfirmar) btnConfirmar.disabled = false;

    // ARMAMOS LA LISTA DE CAJEROS
    let cajerosActivos = new Set();
    if (typeof ventas !== 'undefined' && Array.isArray(ventas)) {
        ventas.forEach(v => { if(v && v.cajero) cajerosActivos.add(v.cajero.trim()); });
    }
    if (typeof movimientos !== 'undefined' && Array.isArray(movimientos)) {
        movimientos.forEach(m => { if(m && m.cajero) cajerosActivos.add(m.cajero.trim()); });
    }
    if (typeof usuarioActual !== 'undefined' && usuarioActual && usuarioActual !== 'Admin') {
        cajerosActivos.add(usuarioActual.trim());
    }

    if(selectMenu) {
        let htmlCajeros = '<option value="">👤 Todos los cajeros</option>';
        [...cajerosActivos].forEach(c => htmlCajeros += `<option value="${c}">${c}</option>`);
        selectMenu.innerHTML = htmlCajeros;
        
        selectMenu.onchange = function() { window.calcularTotalesCorte(); };

        if (typeof usuarioActual !== 'undefined' && usuarioActual && usuarioActual !== 'Admin') {
            selectMenu.value = usuarioActual.trim();
        }
    }

    // FECHA / HORA SUGERIDA POR DEFECTO
    let ahoraMilisegundos = Date.now();
    let inicioSugerido = ahoraMilisegundos;

    let dHOY = new Date(); dHOY.setHours(0,0,0,0);
    let sucReal = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';
    
    let ventasDeHoy = (window.ventas || []).filter(v => Number(v.id) >= dHOY.getTime() && v.sucursal === sucReal && !v.anulada);
    
    if(ventasDeHoy.length > 0) {
        inicioSugerido = Math.min(...ventasDeHoy.map(v => Number(v.id)));
    } else {
        inicioSugerido = dHOY.getTime();
    }

    if(inputInicio && typeof window.formatearParaInput === 'function') inputInicio.value = window.formatearParaInput(inicioSugerido);
    if(inputFin && typeof window.formatearParaInput === 'function') inputFin.value = window.formatearParaInput(ahoraMilisegundos);

    // REFRESCAMOS RENDER CORTE Y CÁLCULOS
    if (typeof window.renderCorte === 'function') window.renderCorte();
    if (typeof window.calcularTotalesCorte === 'function') window.calcularTotalesCorte(); 
    
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
            
            let sucLimpia = String(typeof sucursalActual !== 'undefined' ? sucursalActual : '').replace(/📍/g, '').trim();

let ventasFiltradas = ventas.filter(v => 
    Number(v.id) > ultimoCorteId && 
    (v.cajero && v.cajero.trim() === cajeroSel) && 
    String(v.sucursal || '').replace(/📍/g, '').trim() === sucLimpia && 
    !v.anulada
);
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
        
        // 🛡️ FUSIÓN: Juntamos las ventas de HOY con las DESCAGADAS DE LA NUBE
        let mapaVentas = {};
        (window.ventas || []).forEach(v => { if(v && v.id) mapaVentas[v.id] = v; });
        (window.ventasHistoricasTemporales || []).forEach(v => { if(v && v.id) mapaVentas[v.id] = v; });
        let todasLasVentas = Object.values(mapaVentas);
        
        todasLasVentas.forEach(v => {
            let cumpleCajero = (cajeroSel === "" || (v.cajero && v.cajero.trim() === cajeroSel));
            let cumpleFechas = (Number(v.id) >= msInicio && Number(v.id) <= msFin);
            
            if(!v.anulada && v.sucursal === sucursalActual && cumpleCajero && cumpleFechas) {
                let tVentaTicket = parseFloat(v.total) || 0;
                
                let esAbono = (v.metodo || '').toLowerCase().includes('abono');
                if (!esAbono) totalVentas += tVentaTicket;

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
        let listaIngresosExtra = []; 

        // 🛡️ FUSIÓN: Juntamos los movimientos de HOY con los DESCARGADOS DE LA NUBE
        let mapaMovs = {};
        (window.movimientos || []).forEach(m => { if(m && m.id) mapaMovs[m.id] = m; });
        (window.movsHistoricosTemporales || []).forEach(m => { if(m && m.id) mapaMovs[m.id] = m; });
        let todosLosMovs = Object.values(mapaMovs);

        todosLosMovs.forEach(m => {
            let cumpleCajero = (cajeroSel === "" || (m.cajero && m.cajero.trim() === cajeroSel));
            let cumpleFechas = (Number(m.id) >= msInicio && Number(m.id) <= msFin);

            if(m.sucursal === sucursalActual && cumpleCajero && cumpleFechas) {
                if (m.motivo && m.motivo.includes("RETIRO POR CORTE")) return;

                let montoM = parseFloat(m.monto) || 0;
                if(m.tipo === 'Ingreso') {
                    ing_efectivo += montoM;
                    listaIngresosExtra.push(m);
                } else if(m.tipo === 'Retiro' || m.tipo === 'Gasto') {
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

        let htmlGastos = listaRetirosGastos.map(g => `<tr><td>${g.hora}</td><td>${g.motivo}</td><td style="text-align:right; color:red;">-$${parseFloat(g.monto).toFixed(2)}</td></tr>`).join('');
        if(document.getElementById('cc_lista_gastos')) document.getElementById('cc_lista_gastos').innerHTML = htmlGastos || '<tr><td colspan="3" style="text-align:center; color:#888;">No hubo retiros</td></tr>';
        if(document.getElementById('cc_detalle_gastos')) document.getElementById('cc_detalle_gastos').style.display = 'none'; 

        let htmlIngresos = listaIngresosExtra.map(g => `<tr><td>${g.hora}</td><td>${g.motivo}</td><td style="text-align:right; color:#28a745;">+$${parseFloat(g.monto).toFixed(2)}</td></tr>`).join('');
        if(document.getElementById('cc_lista_ingresos')) document.getElementById('cc_lista_ingresos').innerHTML = htmlIngresos || '<tr><td colspan="3" style="text-align:center; color:#888;">No hubo ingresos extra</td></tr>';
        if(document.getElementById('cc_detalle_ingresos')) document.getElementById('cc_detalle_ingresos').style.display = 'none'; 

        if(document.getElementById('cc_v_efectivo')) document.getElementById('cc_v_efectivo').innerText = "$" + ef.toFixed(2);
        if(document.getElementById('cc_v_ingresos')) document.getElementById('cc_v_ingresos').innerText = "+$" + ing_efectivo.toFixed(2);
        if(document.getElementById('cc_v_retiros')) document.getElementById('cc_v_retiros').innerText = "-$" + ret_efectivo.toFixed(2);
        if(document.getElementById('cc_v_esperado')) document.getElementById('cc_v_esperado').innerText = "$" + efectivoEsperado.toFixed(2);

        document.querySelectorAll('.calc-den').forEach(input => input.value = '');
        if(document.getElementById('cc_fisico')) document.getElementById('cc_fisico').value = '';
        if(document.getElementById('cc_resultado_cuadre')) {
            document.getElementById('cc_resultado_cuadre').innerText = '';
            document.getElementById('cc_resultado_cuadre').style.background = 'transparent';
        }

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
        id: idCorte, 
        doc_id: String(idCorte), // Obligatorio para PocketBase
        fecha: getFechaLocal(), 
        hora: new Date().toLocaleTimeString(), 
        cajero: currentCorteData.cajeroCorte,
        tipo: nombreCorte, 
        sucursal: sucursalActual, 
        ventas_totales: currentCorteData.ventasTotales,
        efectivo_ventas: currentCorteData.efectivoVentas, 
        ingresos: currentCorteData.ingresos,
        gastos: currentCorteData.retiros, 
        efectivo_esperado: esperado, 
        efectivo_real: fisico, 
        diferencia: diferencia
    };
    
    if (typeof historialCortesZ === 'undefined') window.historialCortesZ = [];
    historialCortesZ.push(objetoCorte);
    localStorage.setItem("pos_cortes_z_v1", JSON.stringify(historialCortesZ));

    // ☁️ ¡LA MAGIA! Guardamos los Totales Independientes en PocketBase
    if (typeof db !== 'undefined') {
        db.collection("cortes_z").doc(String(idCorte)).set(objetoCorte)
        .then(() => console.log("☁️ Totales del Corte guardados exitosamente en la nube."))
        .catch(e => console.warn("Error al subir el corte a la nube:", e));
    }

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
    
    // El paquete EXACTO y limpio convirtiendo los pesos a centavos (* 100)
    const paqueteDeCobro = {
        amount: Math.round(parseFloat(montoCobro) * 100), // <-- ¡Aquí está el truco mágico!
        additional_info: {
            print_on_terminal: true,
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
// Variable global para recordar qué compra vamos a anular
let idCompraTemporal = null;

// 1. Esta función solo abre la ventanita con los asteriscos
function anularCompraAdmin(idCompra) {
    idCompraTemporal = idCompra; // Guardamos el ID
    document.getElementById("input_password_anular").value = ""; // Limpiamos la caja de texto
    document.getElementById("modalPasswordAnular").style.display = "flex"; // Mostramos la ventana
}

// 2. Esta función se dispara cuando tecleas la clave y le das a "ANULAR"
async function ejecutarAnulacionCompra() {
    let passwordIngresada = document.getElementById("input_password_anular").value;
    if (passwordIngresada === "") return alert("⚠️ Por favor ingresa una contraseña.");

    if (!usuariosData["Admin"] || usuariosData["Admin"].pin !== passwordIngresada) {
        return alert("❌ Contraseña incorrecta. Operación cancelada.");
    }
    document.getElementById("modalPasswordAnular").style.display = "none";

    try {
        let cIndex = compras.findIndex(c => c.id == idCompraTemporal || c.doc_id == idCompraTemporal);
        if (cIndex === -1) return alert("❌ No se encontró la compra en el sistema.");

        let compraReal = compras[cIndex];
        if (compraReal.anulada) return alert("⚠️ Esta compra ya estaba anulada.");

        // 🌟 SUCURSAL REAL DE LA COMPRA: Usamos la sucursal marcada en el ticket
        let sucursalOrigen = compraReal.sucursal || sucursalActual;

        // 🌟 1. AJUSTE FINANCIERO DEL PROVEEDOR BLINDADO
        let nomProv = compraReal.proveedor || compraReal.prov || "";
        let esCredito = compraReal.es_credito || (compraReal.metodo && String(compraReal.metodo).toLowerCase().includes('cr'));

        if (nomProv && proveedores[nomProv] && esCredito) {
            let dineroARestar = parseFloat(compraReal.monto_credito) || parseFloat(compraReal.total) || 0;
            let saldoActual = parseFloat(proveedores[nomProv].saldo) || 0;
            let nuevoSaldo = parseFloat((Math.max(0, saldoActual - dineroARestar)).toFixed(2));
            
            // Actualizamos en memoria local
            proveedores[nomProv].saldo = nuevoSaldo;
            try { localStorage.setItem("pos_proveedores_v1", JSON.stringify(proveedores)); } catch(e){}
            
            // ☁️ 🚀 DEUDA BLINDADA (Compatible con PB y FB)
            if (typeof pb !== 'undefined') {
                pb.collection('proveedores').getOne(nomProv).then(provNube => {
                    provNube.saldo = (parseFloat(provNube.saldo) || 0) - dineroARestar;
                    pb.collection('proveedores').update(nomProv, provNube).catch(e => console.warn("Error proveedor PB"));
                }).catch(e => console.warn("Error leyendo proveedor en PB"));
            } else if (typeof db !== 'undefined') {
                db.collection("proveedores").doc(nomProv).set({
                    saldo: firebase.firestore.FieldValue.increment(-dineroARestar)
                }, { merge: true }).catch(e => console.error("Error financiero en la nube:", e));
            }
        }

        // 📦 2. DEVOLUCIÓN DE STOCK Y KARDEX BLINDADA
        let listaArticulos = compraReal.items || compraReal.detalles || [];
        listaArticulos.forEach(item => {
            try {
                let pOriginal = inv[item.cod] || {};
                let codMaestro = (pOriginal.grupo && inv[pOriginal.grupo]) ? pOriginal.grupo : item.cod;
                let pMaestro = inv[codMaestro] || pOriginal;

                if (pMaestro && pMaestro.nom) {
                    if (typeof pMaestro.stock !== 'object' || pMaestro.stock === null) {
                        let stockNumerico = parseFloat(pMaestro.stock) || parseFloat(pMaestro.existencia) || parseFloat(pMaestro.can) || 0;
                        pMaestro.stock = {};
                        pMaestro.stock[sucursalOrigen] = stockNumerico;
                    }

                    let stockAntesReal = parseFloat(pMaestro.stock[sucursalOrigen]) || 0;
                    let cantDevuelta = parseFloat(item.can);
                    let stockDespuesReal = parseFloat((stockAntesReal - cantDevuelta).toFixed(3));
                    
                    // Restamos stock localmente
                    pMaestro.stock[sucursalOrigen] = stockDespuesReal;
                    
                    // 🌟 ESCUDO ANTI-SOBREESCRITURA (POCKETBASE / FIREBASE)
                    if (typeof pb !== 'undefined' && codMaestro) { 
                        pb.collection('inventario').getOne(String(codMaestro)).then(pNube => {
                            if (pNube.stock && typeof pNube.stock === 'object') {
                                pNube.stock[sucursalOrigen] = (parseFloat(pNube.stock[sucursalOrigen]) || 0) - cantDevuelta;
                            }
                            if (pNube.inv_sucursales && typeof pNube.inv_sucursales === 'object') {
                                pNube.inv_sucursales[sucursalOrigen] = (parseFloat(pNube.inv_sucursales[sucursalOrigen]) || 0) - cantDevuelta;
                            }
                            if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) {
                                pNube.can -= cantDevuelta;
                            }
                            pb.collection('inventario').update(String(codMaestro), pNube).catch(e => console.warn("Error PB:", e));
                        }).catch(e => console.warn("Error leyendo stock en PB:", e));
                    } else if (typeof db !== 'undefined' && codMaestro) { 
                        db.collection("inventario").doc(String(codMaestro)).get().then(docSnap => {
                            if (docSnap.exists) {
                                let pNube = docSnap.data();
                                if (pNube.stock && typeof pNube.stock === 'object') {
                                    pNube.stock[sucursalOrigen] = (parseFloat(pNube.stock[sucursalOrigen]) || 0) - cantDevuelta;
                                }
                                if (pNube.inv_sucursales && typeof pNube.inv_sucursales === 'object') {
                                    pNube.inv_sucursales[sucursalOrigen] = (parseFloat(pNube.inv_sucursales[sucursalOrigen]) || 0) - cantDevuelta;
                                }
                                if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) {
                                    pNube.can -= cantDevuelta;
                                }
                                db.collection("inventario").doc(String(codMaestro)).set(pNube);
                            }
                        }).catch(e => console.warn("Error FB.", e));
                    }
                    
                    if (typeof registrarEnKardex === 'function') {
                        let nomAnotar = item.nom || pOriginal.nom || pMaestro.nom || "Artículo Desconocido";
                        registrarEnKardex(codMaestro, nomAnotar, "ANULACIÓN COMPRA", -cantDevuelta, 0, item.cos, stockAntesReal, stockDespuesReal, sucursalOrigen);
                    }
                }
            } catch (errItem) {
                console.error(`⚠️ Error al devolver item ${item.cod}:`, errItem);
            }
        });
        
        // 🛡️ PARACAÍDAS DE MEMORIA PARA EL INVENTARIO
        try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e){}

        // 🏷️ 3. SELLAMOS LA COMPRA COMO ANULADA
        compraReal.anulada = true;
        try { 
            localStorage.setItem("pos_compras_local", JSON.stringify(compras)); 
        } catch(e) { 
            console.warn("Memoria local de compras llena, pero se guardará en la nube exitosamente."); 
        }
        
        // ☁️ 🚀 MARCAMOS COMPRA COMO ANULADA EN LA NUBE (PB / FB)
        if (typeof pb !== 'undefined') {
            pb.collection("compras").update(String(compraReal.id), { anulada: true }).catch(e => console.warn("Error marcando compra en PB", e));
        } else if (typeof db !== 'undefined') {
            db.collection("compras").doc(String(compraReal.id)).set({ anulada: true }, { merge: true });
        }

        if (visorComprasIndices && visorComprasIndices[currentVisorCompraPos]) {
            visorComprasIndices[currentVisorCompraPos].anulada = true;
        }

        alert("✅ Compra anulada. Se restó el stock y el saldo del proveedor en su sucursal correspondiente.");
        
        // 🔄 4. REFRESCAMOS PANTALLAS
        if (typeof renderVisorCompraActiva === 'function') renderVisorCompraActiva(); 
        if (typeof renderI === 'function') renderI();
        if (typeof renderProveedores === 'function') renderProveedores();
        if (typeof tabActual !== 'undefined' && tabActual === 'r-tab' && typeof renderCorte === 'function') renderCorte();

    } catch (error) {
        console.error("Error al anular compra:", error);
        alert("❌ Ocurrió un error al intentar anular.");
    }
}
// ======================================================================
// ⚙️ MOTOR DE PAGOS MIXTOS Y SALDOS EN VIVO (ACTUALIZADO)
// ======================================================================

// 1. EL CALCULADOR DE SALDOS (La versión "Todo-Terreno" que no habías puesto)
function calcularCajaFisicaReal(nombreCajero) {
    let saldo = 0;
    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).substring(0, 10);
    let hoyLimpio = String(hoy).trim();
    let cajeroBuscado = String(nombreCajero).trim().toLowerCase();

    if (typeof ventas !== 'undefined') {
        ventas.forEach(v => {
            if (v.anulada === true) return;
            let fVenta = String(v.fecha || "").trim();
            let cVenta = String(v.cajero || "").trim().toLowerCase();

            if (fVenta.includes(hoyLimpio) && cVenta.includes(cajeroBuscado)) {
                if (v.pagos && Array.isArray(v.pagos)) {
                    v.pagos.forEach(p => {
                        let metodo = String(p.metodo || "").toLowerCase();
                        if (metodo.includes("efectivo")) saldo += parseFloat(p.montoAplicado || p.montoEntregado || 0);
                    });
                } else {
                    let metodo = String(v.metodo || "").toLowerCase();
                    if (metodo.includes("efectivo") || metodo.includes("mixto")) saldo += parseFloat(v.efectivo || v.total || v.monto || 0);
                }
            }
        });
    }

    if (typeof movimientos !== 'undefined') {
        movimientos.forEach(m => {
            let fMov = String(m.fecha || "").trim();
            let cMov = String(m.cajero || "").trim().toLowerCase();

            if (fMov.includes(hoyLimpio) && cMov.includes(cajeroBuscado)) {
                let tipoMov = String(m.tipo || "").toLowerCase();
                let montoMov = parseFloat(m.monto || m.total || 0);
                if (tipoMov.includes("ingreso") || tipoMov.includes("entrada")) saldo += montoMov;
                if (tipoMov.includes("retiro") || tipoMov.includes("gasto") || tipoMov.includes("compra")) saldo -= montoMov;
            }
        });
    }
    return saldo;
}

// ======================================================================
// 🎛️ CONTROLADORES DEL PAGO MIXTO MULTI-CAJAS
// ======================================================================

// ======================================================================
// 🎛️ CONTROLADORES DEL PAGO MIXTO MULTI-CAJAS
// ======================================================================

// 1. LLENAMOS LOS DOS MENÚS DESPLEGABLES CON LOS SALDOS REALES
function cargarCajerosEnModal() {
    let select1 = document.getElementById("origen_efectivo_1");
    let select2 = document.getElementById("origen_efectivo_2");
    if (!select1 || !select2) return;

    let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Caja_Actual';
    let opcionesHTML = `<option value="${miNombre}">Mi Caja Actual ($${calcularCajaFisicaReal(miNombre).toFixed(2)})</option>`;

    let cajerosActivos = new Set(["Admin", "Martin"]);
    if (typeof ventas !== 'undefined') ventas.forEach(v => { if (v.cajero) cajerosActivos.add(v.cajero); });
    if (typeof movimientos !== 'undefined') movimientos.forEach(m => { if (m.cajero) cajerosActivos.add(m.cajero); });

    cajerosActivos.forEach(cajero => {
        if (cajero !== miNombre && cajero !== "Caja_Actual") {
            let saldoCajero = calcularCajaFisicaReal(cajero);
            let alerta = saldoCajero < 0 ? " ⚠️" : "";
            opcionesHTML += `<option value="${cajero}">Caja - ${cajero} ($${saldoCajero.toFixed(2)})${alerta}</option>`;
        }
    });

    select1.innerHTML = opcionesHTML;
    select2.innerHTML = `<option value="">-- No usar segunda caja --</option>` + opcionesHTML;
}

// 2. ABRIR VENTANA Y LIMPIAR CAJAS (VERSIÓN NUEVA)
function abrirPagoMixtoCompra(totalCompra) {
    totalCompraAProcesar = parseFloat(totalCompra) || 0;
    
    let modal = document.getElementById("modalPagoMixtoCompra");
    if (!modal) return; 

    document.getElementById("pago_compra_efectivo_1").value = totalCompraAProcesar.toFixed(2);
    document.getElementById("pago_compra_efectivo_2").value = "0.00";
    document.getElementById("pago_compra_tarjeta").value = "0.00";
    document.getElementById("pago_compra_credito").value = "0.00";
    document.getElementById("pago_mixto_compra_total").innerText = totalCompraAProcesar.toFixed(2);

    modal.style.display = "flex";
    calcularRestanteCompra(); 
    cargarCajerosEnModal();

    let hoyLocal = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" }).substring(0, 10);
    pb.collection('ventas').getFullList({ requestKey: null }).then(records => {
        let vNube = records.map(r => r.data).filter(v => String(v.fecha).trim() === hoyLocal);
        let mapaTemp = {};
        if (typeof ventas !== 'undefined') ventas.forEach(v => mapaTemp[v.id] = v);
        vNube.forEach(v => mapaTemp[v.id] = v);
        ventas = Object.values(mapaTemp).sort((a,b) => a.id - b.id);
        cargarCajerosEnModal();
    }).catch(e => console.log("Sincronización de fondo falló", e));
}

// 3. MATEMÁTICAS EN VIVO
function calcularRestanteCompra() {
    let ef1 = parseFloat(document.getElementById("pago_compra_efectivo_1").value) || 0;
    let ef2 = parseFloat(document.getElementById("pago_compra_efectivo_2").value) || 0;
    let tarj = parseFloat(document.getElementById("pago_compra_tarjeta").value) || 0;
    let cred = parseFloat(document.getElementById("pago_compra_credito").value) || 0;
    
    let sumado = ef1 + ef2 + tarj + cred;
    let diferencia = totalCompraAProcesar - sumado;
    
    let alerta = document.getElementById("alerta_restante_compra");
    let btnConfirmar = document.getElementById("btn_confirmar_pago_compra");

    if (Math.abs(diferencia) < 0.01) {
        alerta.style.background = "#d4edda"; alerta.style.color = "#155724";
        alerta.innerText = "✅ ¡Todo cuadra a la perfección!";
        btnConfirmar.disabled = false;
    } else if (diferencia > 0) {
        alerta.style.background = "#fff3cd"; alerta.style.color = "#856404";
        alerta.innerText = `⚠️ Te falta cubrir: $${diferencia.toFixed(2)}`;
        btnConfirmar.disabled = true;
    } else {
        alerta.style.background = "#f8d7da"; alerta.style.color = "#721c24";
        alerta.innerText = `❌ La suma se pasa por: $${Math.abs(diferencia).toFixed(2)}`;
        btnConfirmar.disabled = true;
    }
}

// 4. EL BOTÓN CONFIRMAR FINAL
async function guardarCompraMixtaFinal() {
    let ef1 = parseFloat(document.getElementById("pago_compra_efectivo_1").value) || 0;
    let ori1 = document.getElementById("origen_efectivo_1").value;
    let ef2 = parseFloat(document.getElementById("pago_compra_efectivo_2").value) || 0;
    let ori2 = document.getElementById("origen_efectivo_2").value;
    let tarj = parseFloat(document.getElementById("pago_compra_tarjeta").value) || 0;
    let cred = parseFloat(document.getElementById("pago_compra_credito").value) || 0;

    let provInput = document.getElementById("c_proveedor");
    let proveedor = provInput ? provInput.value.trim() : "";

    if (cred > 0 && proveedor === "") {
        alert("❌ ERROR: Estás dejando una parte A CRÉDITO. Es OBLIGATORIO escribir el nombre del Proveedor en el menú principal para saber a quién le debes.");
        document.getElementById('modalPagoMixtoCompra').style.display = 'none';
        if (provInput) provInput.focus();
        return;
    }

    let distribucionCajas = {};
    if (ef1 > 0 && ori1) distribucionCajas[ori1] = (distribucionCajas[ori1] || 0) + ef1;
    if (ef2 > 0 && ori2) distribucionCajas[ori2] = (distribucionCajas[ori2] || 0) + ef2;
    if (tarj > 0) distribucionCajas["Banco_Directo"] = tarj;

    let metadatosPago = {
        metodo: "Mixto Especial",
        cajas_afectadas: distribucionCajas,
        es_credito: cred > 0,
        monto_credito: cred
    };

    document.getElementById('modalPagoMixtoCompra').style.display = 'none';
    isGuardandoCompra = true;
    
    try {
        await procesarGuardadoEInventario(totalCompraAProcesar, "Mixto", metadatosPago);
        alert("✅ Compra Mixta distribuida y guardada correctamente.");
    } catch (e) {
        console.error(e);
        alert("Hubo un error al guardar.");
    } finally {
        isGuardandoCompra = false;
    }
}
/// ======================================================================
// 🕵️ MÓDULO DE INVENTARIO CIEGO (FASE 2: ADMINISTRADOR)
// ======================================================================
let sesionesPendientesGlobales = [];
let sesionEnRevisionActiva = null; 
let filtroAuditoriaActual = 'faltante'; 
function cargarBorradoresPendientes() {
    try {
        let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");
        sesionesPendientesGlobales = pendientes; 

        let tabla = document.getElementById('tablaAuditoriasAdmin'); 
        if (!tabla) return;

        // Limpiamos la tabla antes de dibujar para evitar duplicados
        tabla.innerHTML = '';

        let listaCajeros = [];
        if (typeof usuariosData !== 'undefined' && usuariosData) {
            for (let nombreUsuario in usuariosData) {
                let datos = usuariosData[nombreUsuario];
                if (datos && datos.sucursales_permitidas && datos.sucursales_permitidas.includes(sucursalActual)) {
                    listaCajeros.push(nombreUsuario);
                }
            }
        }
        if (listaCajeros.length === 0) listaCajeros.push("Admin");

        // Si realmente no hay nada guardado en la memoria
        if (pendientes.length === 0) {
            tabla.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">📋 No hay inventarios pendientes de revisar.</td></tr>';
            return;
        }

        pendientes.forEach(b => {
            if (!b || b.estado === 'Aplicado') return;

            let opcionesCajeros = `<option value="">-- Asignar Revisor --</option>`;
            listaCajeros.forEach(cajero => {
                let selected = b.cajeroAsignado === cajero ? 'selected' : '';
                opcionesCajeros += `<option value="${cajero}" ${selected}>${cajero}</option>`;
            });

            // 🛡️ ESCUDO DE SEGURIDAD ABSOLUTO: Si el conteo no existe, vale 0 y no tumba el sistema
            let totalArticulos = (b.conteo && Array.isArray(b.conteo)) ? b.conteo.length : 0;

            let fila = document.createElement('tr');
            fila.style.borderBottom = '1px solid #f1f3f5';
            
            fila.innerHTML = `
                <td style="cursor:pointer;" onclick="abrirAuditoriaDetalle(${b.id})">${b.fecha || ''} <br> <small>${b.hora || ''}</small></td>
                <td style="cursor:pointer;" onclick="abrirAuditoriaDetalle(${b.id})"><b>${b.cajeroOrigen || b.cajero || 'Desconocido'}</b></td>
                <td style="cursor:pointer;" onclick="abrirAuditoriaDetalle(${b.id})">${totalArticulos} Items</td>
                <td style="cursor:pointer;" onclick="abrirAuditoriaDetalle(${b.id})"><span style="background:#ffc107; color:#856404; padding:3px 8px; border-radius:10px; font-weight:bold; font-size:12px;">${b.estado || 'Pendiente'}</span></td>
                <td>
                    <select id="select_cajero_${b.id}" onchange="asignarRevisor(${b.id}, this.value)" style="padding:5px; border-radius:4px; max-width:150px;" ${b.estado === '2da Revisión Lista' ? 'disabled' : ''}>
                        ${opcionesCajeros}
                    </select>
                </td>
                <td style="text-align:center;">
                    <button onclick="borrarAuditoriaIndividual(${b.id})" style="background:#dc3545; color:white; border:none; padding:5px 8px; border-radius:4px; cursor:pointer;" title="Eliminar reporte">✖</button>
                </td>
            `;
            tabla.appendChild(fila);
        });
    } catch (error) {
        console.error("Error al renderizar el panel de auditorías:", error);
    }
}

function asignarRevisor(idBorrador, cajeroElegido) {
    if (!cajeroElegido) return;
    let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");
    let index = pendientes.findIndex(b => b.id === idBorrador);

    if (index !== -1) {
        pendientes[index].cajeroAsignado = cajeroElegido;
        pendientes[index].estado = 'Asignado'; 
        localStorage.setItem('pos_sesiones_inventario', JSON.stringify(pendientes));
        alert(`🎯 Auditoría asignada a ${cajeroElegido}`);
        cargarBorradoresPendientes();
    }
}

function borrarAuditoriaIndividual(idBorrador) {
    if (!confirm("⚠️ ¿Estás seguro de eliminar este reporte?")) return;
    let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");
    pendientes = pendientes.filter(b => b.id !== idBorrador);
    localStorage.setItem('pos_sesiones_inventario', JSON.stringify(pendientes));

    if (sesionEnRevisionActiva && sesionEnRevisionActiva.id === idBorrador) {
        document.getElementById('panel_detalle_auditoria').style.display = 'none';
    }
    cargarBorradoresPendientes();
}

function limpiarTodasLasAuditorias() {
    if (!confirm("🚨 ¿Borrar todos los reportes pendientes?")) return;
    localStorage.setItem('pos_sesiones_inventario', JSON.stringify([]));
    document.getElementById('panel_detalle_auditoria').style.display = 'none';
    cargarBorradoresPendientes();
}

function abrirAuditoriaDetalle(idSesion) {
    sesionEnRevisionActiva = sesionesPendientesGlobales.find(s => s.id === idSesion);
    if (!sesionEnRevisionActiva) return;

    document.getElementById('titulo_detalle_auditoria').innerText = `Auditoría: ${sesionEnRevisionActiva.cajeroOrigen || 'Cajero'} (${sesionEnRevisionActiva.fecha})`;
    document.getElementById('badge_auditoria_estado').innerText = sesionEnRevisionActiva.estado;
    document.getElementById('panel_detalle_auditoria').style.display = 'block';

    let chkMaster = document.getElementById('chk_audi_master');
    if(chkMaster) chkMaster.checked = false;

    inyectarMatrizAuditoria();
}

function inyectarMatrizAuditoria() {
    let tbody = document.getElementById('tabla_cruce_auditoria');
    let htmlTabla = "";
    let totalImpactoNeto = 0, costoTotalSistema = 0, costoTotalPerdido = 0;
    let exactos = 0, sobrantes = 0, faltantes = 0;

    // Nos aseguramos de que la memoria exista
    if (!window.memoriaFaltantes) window.memoriaFaltantes = new Set();

    sesionEnRevisionActiva.conteo.forEach((item, index) => {
        let prodSistema = inv[item.cod];
        let stockVivoSistema = prodSistema ? ((prodSistema.stock && prodSistema.stock[sucursalActual]) || 0) : 0;
        let costoProd = prodSistema ? (prodSistema.cos || 0) : 0;

        // 📸 Usamos la foto congelada. Si por alguna razón es vieja y no la tiene, usamos el vivo.
        let stockBaseParaAuditoria = item.stock_congelado !== undefined ? item.stock_congelado : stockVivoSistema;

        let cantFisica = parseFloat(item.can_fisica) || 0;
        let diferencia = cantFisica - stockBaseParaAuditoria;
        let impactoDinero = diferencia * costoProd;

        totalImpactoNeto += impactoDinero;
        costoTotalSistema += (stockBaseParaAuditoria * costoProd);

        let tipo = 'exacto';
        if (diferencia < 0) { tipo = 'faltante'; faltantes++; costoTotalPerdido += Math.abs(impactoDinero); }
        else if (diferencia > 0) { tipo = 'sobrante'; sobrantes++; }
        else { exactos++; }

        item.audi_tipo = tipo;

        if (tipo === filtroAuditoriaActual) {
            let colorDif = diferencia === 0 ? '#28a745' : (diferencia < 0 ? '#dc3545' : '#fd7e14');
            let textDif = diferencia > 0 ? `+${diferencia}` : diferencia;
            
            // 🧠 LEEMOS LA MEMORIA: ¿Este código ya estaba seleccionado antes?
            let estaMarcado = window.memoriaFaltantes.has(String(item.cod)) ? "checked" : "";

            // 🔓 DIBUJAMOS LA CASILLA (Sin candados y conectada a la memoria)
            htmlTabla += `
                <tr style="border-bottom:1px solid #eee;">
                    <td style="padding:12px; text-align:center;">
                        <input type="checkbox" class="chk_item_auditoria" data-index="${index}" onchange="toggleSeleccionFaltante('${item.cod}', this)" ${estaMarcado}>
                    </td>
                    <td style="padding:12px;"><b>${item.nom || 'Desconocido'}</b><br><small style="color:#888;">${item.cod}</small></td>
                    <td style="padding:12px; text-align:center; background:#f8f9fa;">${stockBaseParaAuditoria}</td>
                    <td style="padding:12px; text-align:center; font-weight:bold; color:#17a2b8;">${cantFisica}</td>
                    <td style="padding:12px; text-align:center; font-weight:bold; color:${colorDif};">${textDif}</td>
                    <td style="padding:12px; text-align:right; font-weight:bold;">$${impactoDinero.toFixed(2)}</td>
                </tr>`;
        }
    });

    document.getElementById('count_faltantes').innerText = faltantes;
    document.getElementById('count_sobrantes').innerText = sobrantes;
    document.getElementById('count_exactos').innerText = exactos;
    document.getElementById('audi_val_sistema').innerText = `$${costoTotalSistema.toFixed(2)}`;
    document.getElementById('audi_val_perdida').innerText = `$${costoTotalPerdido.toFixed(2)}`;
    document.getElementById('audi_porcentaje_perdida').innerText = `${(costoTotalSistema > 0 ? (costoTotalPerdido / costoTotalSistema) * 100 : 0).toFixed(2)}%`;
    document.getElementById('audi_total_impacto').innerText = `$${totalImpactoNeto.toFixed(2)}`;

    tbody.innerHTML = htmlTabla || `<tr><td colspan="6" style="padding:30px; text-align:center; color:#888;">No hay productos.</td></tr>`;

    let btnRevision = document.getElementById('btn_mandar_revision');
    let btnAprobar = document.getElementById('btn_aprobar_auditoria');
    if (btnRevision) btnRevision.style.display = filtroAuditoriaActual !== 'exacto' && (faltantes > 0 || sobrantes > 0) ? 'inline-block' : 'none';
    if (btnAprobar) btnAprobar.style.display = 'inline-block';
}
function filtrarTablaAuditoria(tipo) {
    filtroAuditoriaActual = tipo;
    ['faltante', 'sobrante', 'exacto'].forEach(t => {
        let btn = document.getElementById(`tab_audi_${t}`);
        if(btn) {
            btn.style.background = t === tipo ? (t === 'faltante' ? '#dc3545' : (t === 'sobrante' ? '#fd7e14' : '#28a745')) : '#f1f3f5';
            btn.style.color = t === tipo ? 'white' : '#495057';
        }
    });
    inyectarMatrizAuditoria();
}

function seleccionarTodosAuditoria(value) {
    document.querySelectorAll('.chk_item_auditoria:not([disabled])').forEach(chk => chk.checked = value);
}

function mandarARevisionSecundaria() {
    let checkboxes = document.querySelectorAll('.chk_item_auditoria:checked');
    if(checkboxes.length === 0) return alert("⚠️ Selecciona las casillas de los productos que deseas mandar a recontar.");

    if(!confirm(`¿Deseas mandar estos ${checkboxes.length} artículos a una segunda revisión?`)) return;

    // 🛡️ REFUERZO DE SEGURIDAD: Jalamos los datos más frescos de la memoria para no borrar al 'cajeroAsignado'
    let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");
    let index = pendientes.findIndex(b => b.id === sesionEnRevisionActiva.id);

    if (index !== -1) {
        checkboxes.forEach(chk => {
            let idx = parseInt(chk.getAttribute('data-index'));
            let itemMalo = sesionEnRevisionActiva.conteo[idx];
            
            // Buscamos el producto exacto dentro del archivo fresco
            let itemEnFresco = pendientes[index].conteo.find(x => x.cod === itemMalo.cod);
            if (itemEnFresco) {
                itemEnFresco.can_fisica = 0;
                itemEnFresco.requiere_reconteo = true; // Colocamos la marca de auditoría
            }
        });

        pendientes[index].estado = "Asignado"; // Mantiene el estado activo para el cajero
        localStorage.setItem("pos_sesiones_inventario", JSON.stringify(pendientes));
        
        // Sincronizamos la memoria del Administrador
        sesionesPendientesGlobales = pendientes;
        sesionEnRevisionActiva = pendientes[index];
    }

    alert("🔍 Productos enviados a revisión secundaria.\nEl borrador se ha devuelto a la sección del cajero.");
    document.getElementById('panel_detalle_auditoria').style.display = 'none';
    cargarBorradoresPendientes();
}

function aprobarYAjustarInventario() {
    if (!sesionEnRevisionActiva) return;

    // Convertimos la función interna a 'async' para poder leer la nube producto por producto
    pedirPinOculto("🔒 Ingrese el PIN de Administrador para guardar:", async function(pass) {
        if (!pass) return; 

        if (!usuariosData || !usuariosData["Admin"] || usuariosData["Admin"].pin !== pass) {
            alert("❌ PIN Incorrecto. Operación cancelada.");
            return;
        }

        if (!confirm("🚨 ¿Está seguro de sobreescribir SÓLO los artículos seleccionados? Los no seleccionados se guardarán para después.")) return;

        let itemsAplicados = [];
        let conteoRestante = []; 

        if (!window.memoriaFaltantes) window.memoriaFaltantes = new Set();
        let casillasVisibles = document.querySelectorAll('.chk_item_auditoria:checked');
        
        casillasVisibles.forEach(casilla => {
            let idx = casilla.getAttribute('data-index');
            if (sesionEnRevisionActiva.conteo[idx]) {
                window.memoriaFaltantes.add(String(sesionEnRevisionActiva.conteo[idx].cod));
            }
        });

        // Usamos 'for..of' en lugar de 'forEach' para que la nube espere su turno correctamente
        for (let item of sesionEnRevisionActiva.conteo) {
            if (window.memoriaFaltantes.has(String(item.cod))) {
                
                let pOriginal = inv[item.cod] || {};
                let codMaestro = (pOriginal.grupo && inv[pOriginal.grupo]) ? pOriginal.grupo : item.cod;
                let prod = inv[codMaestro] || pOriginal;

                if (prod && prod.nom) {
                    let stockActualEnVivo = prod.stock ? (parseFloat(prod.stock[sucursalActual]) || 0) : 0;
                    let stockCongelado = item.stock_congelado !== undefined ? parseFloat(item.stock_congelado) : stockActualEnVivo;
                    let conteoDelCajero = parseFloat(item.can_fisica) || 0;
                    
                    // Esta matemática tuya es oro puro para el escudo
                    let ajusteMatematico = parseFloat((conteoDelCajero - stockCongelado).toFixed(3));
                    let stockFinalCalculado = parseFloat((stockActualEnVivo + ajusteMatematico).toFixed(3));

                    if (!prod.stock) prod.stock = {};
                    prod.stock[sucursalActual] = stockFinalCalculado;
                    prod.updatedAt = Date.now();

                    // 🌟 ESCUDO ANTI-SOBREESCRITURA (PB / FB)
                    try {
                        if (typeof pb !== 'undefined' && codMaestro) {
                            let pNube = await pb.collection('inventario').getOne(String(codMaestro));
                            if (!pNube.stock) pNube.stock = {};
                            if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                            
                            // Sumamos o restamos el ajuste matemático al stock que tenga la nube en ese instante
                            pNube.stock[sucursalActual] = (parseFloat(pNube.stock[sucursalActual]) || 0) + ajusteMatematico;
                            pNube.inv_sucursales[sucursalActual] = (parseFloat(pNube.inv_sucursales[sucursalActual]) || 0) + ajusteMatematico;
                            
                            if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) {
                                pNube.can += ajusteMatematico;
                            }
                            pNube.updatedAt = Date.now();
                            await pb.collection('inventario').update(String(codMaestro), pNube);

                        } else if (typeof db !== 'undefined' && codMaestro) {
                            let docSnap = await db.collection("inventario").doc(String(codMaestro)).get();
                            if (docSnap.exists) {
                                let pNube = docSnap.data();
                                if (!pNube.stock) pNube.stock = {};
                                if (!pNube.inv_sucursales) pNube.inv_sucursales = {};
                                
                                pNube.stock[sucursalActual] = (parseFloat(pNube.stock[sucursalActual]) || 0) + ajusteMatematico;
                                pNube.inv_sucursales[sucursalActual] = (parseFloat(pNube.inv_sucursales[sucursalActual]) || 0) + ajusteMatematico;
                                
                                if (!pNube.stock && !pNube.inv_sucursales && pNube.can !== undefined) {
                                    pNube.can += ajusteMatematico;
                                }
                                pNube.updatedAt = Date.now();
                                await db.collection("inventario").doc(String(codMaestro)).set(pNube);
                            } else {
                                await db.collection("inventario").doc(String(codMaestro)).set(prod);
                            }
                        }
                    } catch(e) {
                        console.error("Error al subir a la nube el código " + codMaestro, e);
                    }

                    if (typeof registrarEnKardex === 'function') {
                        let nomAnotar = item.nom || pOriginal.nom || prod.nom || "Desconocido";
                        registrarEnKardex(codMaestro, nomAnotar, "AUDITORÍA INVENTARIO", ajusteMatematico, prod.pv || 0, prod.cos || 0, stockActualEnVivo, stockFinalCalculado);
                    }

                    itemsAplicados.push({
                        cod: codMaestro, nom: prod.nom || "Desconocido",
                        stock_anterior: stockActualEnVivo, stock_nuevo: stockFinalCalculado, diferencia: ajusteMatematico
                    });
                    
                    window.memoriaFaltantes.delete(String(item.cod));
                }
            } else {
                conteoRestante.push(item);
            }
        }

        if (itemsAplicados.length === 0) return alert("⚠️ No seleccionaste ninguna casilla. El inventario no cambió.");

        let registroHistorico = {
            id_sesion: sesionEnRevisionActiva.id || Date.now(),
            fecha_aplicacion: new Date().toLocaleString(),
            sucursal: sucursalActual,
            usuario_aprobador: "Admin",
            articulos_modificados: itemsAplicados
        };

        if (typeof db !== 'undefined') {
            db.collection("historial_auditorias").doc("AUDIT_PARCIAL_" + Date.now()).set(registroHistorico);
        }

        let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");
        let idxSesion = pendientes.findIndex(b => b.id === sesionEnRevisionActiva.id);
        
        if (idxSesion !== -1) {
            if (conteoRestante.length === 0) {
                pendientes[idxSesion].estado = 'Aplicado';
                pendientes[idxSesion].conteo = [];
                document.getElementById('panel_detalle_auditoria').style.display = 'none';
            } else {
                pendientes[idxSesion].conteo = conteoRestante;
                sesionEnRevisionActiva.conteo = conteoRestante;
            }
            try { localStorage.setItem('pos_sesiones_inventario', JSON.stringify(pendientes)); } catch(e){}
        }

        try { localStorage.setItem("pos_precision_v6", JSON.stringify(inv)); } catch(e){}

        alert(`✅ Éxito. Se actualizaron ${itemsAplicados.length} artículos.\nFaltan ${conteoRestante.length} por revisar.`);
        
        if (typeof cargarBorradoresPendientes === 'function') cargarBorradoresPendientes();
        if (typeof renderI === 'function') renderI(); 
        
        if (conteoRestante.length > 0) document.getElementById('panel_detalle_auditoria').style.display = 'none';
    }); 
}
// ======================================================================
// 📦 MÓDULO DE INVENTARIO CIEGO (FASE 1: CAJERO UNIFICADO MULTI-ESCANER)
// ======================================================================
let idRevisionActivaCajero = null;
let conteoActualCiego = [];
let html5QrcodeScannerCiego = null;
let modoCamaraCiegoActivo = false; // 🧠 Variable memoria: Recuerda si el cajero está usando la cámara

function abrirModalInventarioCiego() {
    document.getElementById('modalInventarioCiego').style.display = 'flex';
    
    conteoActualCiego = [];
    idRevisionActivaCajero = null;
    modoCamaraCiegoActivo = false;

    let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");
    let cajeroSesionActual = usuarioActual ? usuarioActual.trim() : 'Desconocido'; 

    // Buscamos si hay una tarea asignada con tu nombre
    let revisionPendiente = pendientes.find(b => b.cajeroAsignado === cajeroSesionActual && b.estado === 'Asignado');
    let tituloModal = document.getElementById('modalInventarioCiegoTitulo');

    if (revisionPendiente) {
        idRevisionActivaCajero = revisionPendiente.id;
        if (tituloModal) tituloModal.innerText = `📋 Segunda Revisión - Control Asignado`;
        
        // Filtramos y cargamos únicamente los productos que el Admin mandó a auditar
        conteoActualCiego = revisionPendiente.conteo.filter(item => item.requiere_reconteo === true);
        
        alert("🚨 ¡ATENCIÓN! El Administrador te asignó recontar en específico los productos que aparecen en la lista.");
    } else {
        if (tituloModal) tituloModal.innerText = `📦 Escaneo con Celular / Pistola`;
    }
    
    actualizarTablaCiego();
    
    setTimeout(() => {
        let input = document.getElementById('input_escaneo_ciego');
        if(input) { input.value = ''; input.focus(); }
    }, 200);
}

function actualizarTablaCiego() {
    let tbody = document.getElementById('lista_escaneo_ciego');
    if (!tbody) return;

    let html = '';
    conteoActualCiego.forEach((item, index) => {
        // 🛡️ ESCUDO DE PROPIEDADES: Lee de forma segura tanto '.nom' como '.nombre'
        let nombreProducto = item.nom || item.nombre || 'Producto';

        html += `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px; text-align:left;"><b>${nombreProducto}</b><br><small style="color:#888;">${item.cod}</small></td>
                <td style="padding:10px; text-align:center;">
                    <input type="number" 
                           id="cant_ciego_${index}" 
                           value="${item.can_fisica}" 
                           onchange="modificarCantCiego(${index}, this.value)" 
                           onkeydown="regresarAlEscaner(event)"
                           style="width:70px; text-align:center; padding:5px; font-size:16px; font-weight:bold; color:#0d6efd; border:1px solid #ccc; border-radius:4px;">
                </td>
                <td style="padding:10px; text-align:center;">
                    <button onclick="eliminarItemCiego(${index})" style="background:none; border:none; cursor:pointer; color:#dc3545; font-size:16px;">✖</button>
                </td>
            </tr>`;
    });
    tbody.innerHTML = html;
}
// 🪄 FUNCIÓN DEL ENTER DE LA CANTIDAD: Decide a dónde regresar el foco según el modo activo
function regresarAlEscaner(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        
        // 1. Siempre limpiamos y enfocamos el input manual/pistola láser por seguridad
        let inputEscaner = document.getElementById('input_escaneo_ciego');
        if (inputEscaner) { 
            inputEscaner.value = ''; 
            inputEscaner.focus(); 
        }

        // 2. ⚡ LA MAGIA: Si el modo cámara estaba activo, la re-encendemos automáticamente para el siguiente artículo
        if (modoCamaraCiegoActivo) {
            encenderCamaraCiego();
        }
    }
}

// FUNCIÓN UNIFICADA DE BÚSQUEDA: Inserta el producto y brinca el cursor a la cantidad
function ejecutarEscaneoDirecto(cod) {
    cod = String(cod).trim();
    if (!cod) return;

    if (typeof inv === 'undefined' || !inv) {
        alert("❌ Error: Catálogo de productos no disponible.");
        return;
    }

    let productoOriginal = inv[cod]; 
    if (!productoOriginal) {
        alert(`⚠️ El código [${cod}] no existe en tu catálogo.`);
        let input = document.getElementById('input_escaneo_ciego');
        if (input) { input.value = ''; input.focus(); }
        return;
    }

    // 🌟 MAGIA MAESTRO-ESPEJO: Detectar y desviar al Jefe
    let productoFinal = productoOriginal;
    let codFinal = cod;
    
    if (productoOriginal.grupo && inv[productoOriginal.grupo]) {
        let pMaestro = inv[productoOriginal.grupo];
        
        // Avisamos al cajero del desvío
        alert(`⚠️ CÓDIGO DEPENDIENTE DETECTADO\n\n"${productoOriginal.nom}" depende de otro producto.\n\nEl conteo se sumará a su Producto Maestro:\n👉 ${pMaestro.nom}`);
        
        // Hacemos el cambiazo
        productoFinal = pMaestro;
        codFinal = productoOriginal.grupo;
    }

    // Buscamos si el producto (ahora el final) ya estaba en la lista del conteo actual
    let existe = conteoActualCiego.find(item => item.cod === codFinal);
    let indexAEditar;

    if (existe) {
        indexAEditar = conteoActualCiego.indexOf(existe);
    } else {
        conteoActualCiego.push({
            cod: codFinal,
            nom: productoFinal.nom || 'Desconocido',
            can_fisica: 1 // Arranca en 1 por defecto
        });
        indexAEditar = conteoActualCiego.length - 1;
    }

    // Limpiamos la caja de texto para que esté lista para el siguiente escaneo
    let input = document.getElementById('input_escaneo_ciego');
    if (input) { input.value = ''; }

    // Redibujamos la tabla para pintar la nueva fila
    actualizarTablaCiego();

    // Mandamos el cursor directo a la celda de cantidad y seleccionamos el texto para sobreescribir rápido
    setTimeout(() => {
        let inputCantidad = document.getElementById(`cant_ciego_${indexAEditar}`);
        if (inputCantidad) {
            inputCantidad.focus();    
            inputCantidad.select();   
        }
    }, 100); 
}

function actualizarTablaCiego() {
    let tbody = document.getElementById('lista_escaneo_ciego');
    if (!tbody) return;

    let html = '';
    conteoActualCiego.forEach((item, index) => {
        html += `
            <tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px; text-align:left;"><b>${item.nom}</b><br><small style="color:#888;">${item.cod}</small></td>
                <td style="padding:10px; text-align:center;">
                    <input type="number" 
                           id="cant_ciego_${index}" 
                           value="${item.can_fisica}" 
                           onchange="modificarCantCiego(${index}, this.value)" 
                           onkeydown="regresarAlEscaner(event)"
                           style="width:70px; text-align:center; padding:5px; font-size:16px; font-weight:bold; color:#0d6efd; border:1px solid #ccc; border-radius:4px;">
                </td>
                <td style="padding:10px; text-align:center;">
                    <button onclick="eliminarItemCiego(${index})" style="background:none; border:none; cursor:pointer; color:#dc3545; font-size:16px;">✖</button>
                </td>
            </tr>`;
    });
    tbody.innerHTML = html;
}

function agregarProductoCiegoManual(codigo) {
    // Redirige al motor unificado directo
    ejecutarEscaneoDirecto(codigo);
}

function modificarCantCiego(index, val) {
    let cant = parseFloat(val);
    if (isNaN(cant) || cant < 0) cant = 0;
    conteoActualCiego[index].can_fisica = cant;
}

function eliminarItemCiego(index) {
    conteoActualCiego.splice(index, 1);
    actualizarTablaCiego();
}

function enviarInventarioCiego() {
    if (conteoActualCiego.length === 0) return alert("⚠️ No has escaneado ningún producto.");
    let pendientes = JSON.parse(localStorage.getItem('pos_sesiones_inventario') || "[]");

    // 📸 LA MAGIA: Tomamos una "foto" del stock del sistema en este instante exacto
    conteoActualCiego.forEach(item => {
        if (item.stock_congelado === undefined) {
            let prod = inv[item.cod];
            item.stock_congelado = prod && prod.stock ? (prod.stock[sucursalActual] || 0) : 0;
        }
    });

    if (idRevisionActivaCajero) {
        let index = pendientes.findIndex(b => b.id === idRevisionActivaCajero);
        if (index !== -1) {
            // FUSIÓN DE DATOS
            conteoActualCiego.forEach(itemAuditado => {
                let itemOriginal = pendientes[index].conteo.find(x => x.cod === itemAuditado.cod);
                if (itemOriginal) {
                    itemOriginal.can_fisica = itemAuditado.can_fisica;
                    delete itemOriginal.requiere_reconteo; 
                }
            });

            pendientes[index].estado = '2da Revisión Lista';
            localStorage.setItem('pos_sesiones_inventario', JSON.stringify(pendientes));
            alert("✅ ¡Segunda revisión enviada con éxito!");
        }
    } else {
        let cajeroActivo = usuarioActual ? usuarioActual.trim() : 'Desconocido';
        let nuevoBorrador = {
            id: Date.now(),
            cajeroOrigen: cajeroActivo,
            cajeroAsignado: null,
            fecha: new Date().toLocaleDateString(),
            hora: new Date().toLocaleTimeString(),
            estado: 'Pendiente',
            conteo: conteoActualCiego
        };
        pendientes.push(nuevoBorrador);
        localStorage.setItem('pos_sesiones_inventario', JSON.stringify(pendientes));
        alert("✅ ¡Conteo enviado a Auditoría con éxito!");
    }

    cerrarModalInventarioCiego();
}

function cerrarModalInventarioCiego() {
    modoCamaraCiegoActiva = false;
    apagarCamaraCiego();
    document.getElementById('modalInventarioCiego').style.display = 'none';
    conteoActualCiego = [];
    actualizarTablaCiego();
    idRevisionActivaCajero = null;
    if (typeof cargarBorradoresPendientes === 'function') cargarBorradoresPendientes();
}

function encenderCamaraCiego() {
    let contenedorCamara = document.getElementById('lector_camara_ciego');
    if(!contenedorCamara) return;
    contenedorCamara.style.display = 'block';

    modoCamaraCiegoActivo = true; // 🔥 Encendemos el interruptor de memoria

    html5QrcodeScannerCiego = new Html5Qrcode("lector_camara_ciego");
    html5QrcodeScannerCiego.start(
        { facingMode: "environment" }, 
        {
            fps: 20,
            qrbox: { width: 280, height: 130 },
            formatsToSupport: [ 
                Html5QrcodeSupportedFormats.EAN_13, 
                Html5QrcodeSupportedFormats.EAN_8, 
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.UPC_A
            ]
        },
        (codigoDetectado) => {
            if (navigator.vibrate) navigator.vibrate(80);
            
            // Pausamos el lector de video en la pantalla para procesar la celda
            if (html5QrcodeScannerCiego) {
                html5QrcodeScannerCiego.stop().then(() => {
                    document.getElementById('lector_camara_ciego').style.display = 'none';
                    html5QrcodeScannerCiego = null;
                    
                    // Mandamos el código al flujo directo (foco en celda)
                    ejecutarEscaneoDirecto(codigoDetectado);
                }).catch(err => console.error(err));
            }
        },
        (error) => { /* Silenciar errores de lectura */ }
    ).catch(err => console.warn("Camara bloqueada o sin permisos.", err));
}

function apagarCamaraCiego() {
    // Si el usuario da clic al botón rojo "Apagar", cancelamos la memoria de la cámara
    if (arguments.length === 0 || arguments[0] !== 'automatico') {
        modoCamaraCiegoActivo = false;
    }
    if (html5QrcodeScannerCiego) {
        html5QrcodeScannerCiego.stop().then(() => {
            let lector = document.getElementById('lector_camara_ciego');
            if(lector) lector.style.display = 'none';
            html5QrcodeScannerCiego = null;
        }).catch(err => console.error(err));
    }
}

// 🎯 CONTROLADOR BLINDADO RAÍZ DE TECLADO PARA EL INPUT PRINCIPAL
document.addEventListener("DOMContentLoaded", () => { conectarInputCiegoManual(); });
setTimeout(conectarInputCiegoManual, 1200);

function conectarInputCiegoManual() {
    let inputCiego = document.getElementById('input_escaneo_ciego');
    if (inputCiego) {
        // Asignación directa evita duplicaciones
        inputCiego.onkeydown = function(event) {
            if (event.key === 'Enter' || event.keyCode === 13) {
                event.preventDefault(); 
                let codigoEscaneado = this.value.trim();
                if (codigoEscaneado) ejecutarEscaneoDirecto(codigoEscaneado);
            }
        };
    }
}
// Aseguramos la recarga del trigger de pestañas de Admin
let btnAudiTab = document.getElementById('btn_audi-tab');
if(btnAudiTab) { btnAudiTab.addEventListener('click', () => { cargarBorradoresPendientes(); }); }
// 👥 FUNCIÓN CONTROLADORA: Llena el menú de clientes fiados con datos frescos
function actualizarSelectClientesCobro() {
    let selectAbono = document.getElementById('m_cliente_select');
    if (!selectAbono) return;
    
    let selectHtml = '<option value="">-- Selecciona Cliente a Fiar --</option>';
    let count = 0;
    
    Object.keys(clientes).forEach(tel => {
        let c = clientes[tel];
        // Validamos que pertenezca a la sucursal activa
        if (c && (c.sucursal === sucursalActual || (!c.sucursal && sucursalActual === 'Matriz'))) {
            selectHtml += `<option value="${tel}">👤 ${c.nom} (${tel})</option>`;
            count++;
        }
    });
    
    selectAbono.innerHTML = selectHtml;
    console.log(`👥 Buscador de Créditos: ${count} clientes cargados en el menú.`);
}
// ==========================================
// 🛡️ ESCUDO ANTI-CIERRE ACCIDENTAL
// ==========================================
window.addEventListener('beforeunload', function (e) {
    // 1. Verificamos si hay productos en el carrito de ventas
    let hayVentaActiva = (typeof carV !== 'undefined' && carV.length > 0);
    
    // 2. Verificamos si hay productos en tu variable de compras 
    // (Si tu variable de compras se llama diferente a 'carC', cámbiala aquí)
    let hayCompraActiva = (typeof carC !== 'undefined' && carC.length > 0);

    // Si hay algo a medias, activamos la alarma
    if (hayVentaActiva || hayCompraActiva) {
        // Bloquea el cierre o retroceso inmediato
        e.preventDefault();
        // Lanza el mensaje de advertencia del navegador
        e.returnValue = 'Tienes una venta o compra en proceso. ¿Seguro que quieres salir y perder los datos?';
    }
});
function pedirPinOculto(mensaje, callback) {
    // Creamos una pantalla oscura de fondo
    let fondo = document.createElement('div');
    fondo.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center;";

    // Creamos la cajita blanca
    let caja = document.createElement('div');
    caja.style.cssText = "background:white; padding:25px; border-radius:10px; box-shadow:0 4px 15px rgba(0,0,0,0.2); text-align:center; min-width:300px; font-family:sans-serif;";

    // Título
    let titulo = document.createElement('h3');
    titulo.innerText = mensaje;
    titulo.style.cssText = "margin-top:0; color:#333; font-size:16px;";

    // Input de contraseña (aquí está la magia para que salgan asteriscos)
    let input = document.createElement('input');
    input.type = "password"; 
    input.placeholder = "****";
    input.style.cssText = "width:90%; padding:10px; margin:15px 0; border:2px solid #007bff; border-radius:5px; font-size:24px; text-align:center; letter-spacing: 5px;";

    // Botones
    let divBotones = document.createElement('div');
    let btnCancelar = document.createElement('button');
    btnCancelar.innerText = "Cancelar";
    btnCancelar.style.cssText = "padding:10px 15px; margin-right:10px; cursor:pointer; background:#dc3545; color:white; border:none; border-radius:5px; font-weight:bold;";
    
    let btnAceptar = document.createElement('button');
    btnAceptar.innerText = "Confirmar";
    btnAceptar.style.cssText = "padding:10px 15px; cursor:pointer; background:#28a745; color:white; border:none; border-radius:5px; font-weight:bold;";

    // Qué hacen los botones
    btnCancelar.onclick = () => { document.body.removeChild(fondo); callback(null); };
    btnAceptar.onclick = () => { document.body.removeChild(fondo); callback(input.value); };
    input.onkeypress = (e) => { if (e.key === 'Enter') btnAceptar.click(); }; // Permite dar Enter

    divBotones.appendChild(btnCancelar);
    divBotones.appendChild(btnAceptar);
    caja.appendChild(titulo);
    caja.appendChild(input);
    caja.appendChild(divBotones);
    fondo.appendChild(caja);
    document.body.appendChild(fondo);

    // Seleccionamos la caja automáticamente para que puedas escribir de inmediato
    input.focus(); 
}
async function mostrarEstadisticasAuditoria() {
    if (typeof db === 'undefined') {
        return alert("⚠️ La base de datos en la nube no está conectada.");
    }

    let modalId = "modalKPIsAuditoria";
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = "modal";
        modal.style.zIndex = "9999";
        document.body.appendChild(modal);
    }

    modal.innerHTML = `<div class="modal-content" style="width:500px; text-align:center;">
        <h3 style="color:var(--info); margin-top:0;">📊 Analizando Historial...</h3>
        <p>Descargando datos de la nube...</p>
    </div>`;
    modal.style.display = 'block';

    try {
        let snapshot = await db.collection("historial_auditorias").get();
        
        let mesActual = new Date().getMonth();
        let anioActual = new Date().getFullYear();
        
        let totalModificados = 0;
        let auditoriasDelMes = 0;

        // 🧮 Contadores específicos para los porcentajes
        let totalItemsAuditados = 0;
        let cantExactos = 0;
        let cantSobrantes = 0;
        let cantFaltantes = 0;

        snapshot.forEach(doc => {
            let data = typeof doc.data === 'function' ? doc.data() : (doc.data || doc);
            if (!data || Object.keys(data).length === 0) return;

            let idReal = doc.id || doc.doc_id || "";
            let numerosEnId = idReal.match(/\d+/);
            let timestamp = numerosEnId ? parseInt(numerosEnId[0]) : null;
            
            let fechaDoc = null;
            if (timestamp && !isNaN(timestamp) && String(timestamp).length >= 10) {
                fechaDoc = new Date(timestamp);
            } else if (data.fecha_aplicacion) {
                fechaDoc = new Date(data.fecha_aplicacion);
            } else {
                fechaDoc = new Date(); 
            }
            
            if (fechaDoc && !isNaN(fechaDoc.getTime())) {
                if (fechaDoc.getMonth() === mesActual && fechaDoc.getFullYear() === anioActual) {
                    auditoriasDelMes++;
                    if (data.articulos_modificados && Array.isArray(data.articulos_modificados)) {
                        totalModificados += data.articulos_modificados.length;

                        // Clasificamos cada artículo archivado para sacar la estadística real
                        data.articulos_modificados.forEach(item => {
                            totalItemsAuditados++;
                            let dif = parseFloat(item.diferencia) || 0;
                            if (dif < 0) cantFaltantes++;
                            else if (dif > 0) cantSobrantes++;
                            else cantExactos++;
                        });
                    }
                }
            }
        });

        // 🧮 Cálculo matemático de porcentajes %
        let pctExactos = totalItemsAuditados > 0 ? ((cantExactos / totalItemsAuditados) * 100).toFixed(1) : "0.0";
        let pctSobrantes = totalItemsAuditados > 0 ? ((cantSobrantes / totalItemsAuditados) * 100).toFixed(1) : "0.0";
        let pctFaltantes = totalItemsAuditados > 0 ? ((cantFaltantes / totalItemsAuditados) * 100).toFixed(1) : "0.0";

        // HTML final del Dashboard con desglose de porcentajes integrado
        modal.innerHTML = `
        <div class="modal-content" style="width:600px; border-top: 4px solid var(--info); max-height:90vh; overflow-y:auto;">
            <h2 style="margin-top:0; color:#333;">📈 Rendimiento de Inventario</h2>
            <p style="color:#666; font-size:14px; margin-bottom:20px;">Estadísticas globales del mes en curso</p>
            
            <div style="display:flex; justify-content:space-between; gap:15px; margin-bottom:25px;">
                <div style="flex:1; background:#f8f9fa; padding:15px; border-radius:8px; border-left:4px solid #17a2b8;">
                    <h4 style="margin:0; color:#666; font-size:12px; text-transform:uppercase;">Auditorías Realizadas</h4>
                    <span style="font-size:32px; font-weight:bold; color:#333;">${auditoriasDelMes}</span>
                </div>
                <div style="flex:1; background:#f8f9fa; padding:15px; border-radius:8px; border-left:4px solid #dc3545;">
                    <h4 style="margin:0; color:#666; font-size:12px; text-transform:uppercase;">Artículos Asentados</h4>
                    <span style="font-size:32px; font-weight:bold; color:#333;">${totalModificados}</span>
                </div>
            </div>

            <h3 style="margin: 20px 0 10px 0; color:#495057; font-size:16px; text-align:left; border-bottom:1px solid #ddd; padding-bottom:5px;">📊 Composición de Diferencias</h3>
            
            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:25px; text-align:left;">
                
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:bold; color:#28a745; margin-bottom:4px;">
                        <span>✅ Coincidencias Exactas (${cantExactos} pzas)</span>
                        <span>${pctExactos}%</span>
                    </div>
                    <div style="width:100%; background:#e9ecef; height:12px; border-radius:10px; overflow:hidden;">
                        <div style="width:${pctExactos}%; background:#28a745; height:100%; transition:width 0.5s;"></div>
                    </div>
                </div>

                <div>
                    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:bold; color:#fd7e14; margin-bottom:4px;">
                        <span>➕ Artículos Sobrantes (${cantSobrantes} pzas)</span>
                        <span>${pctSobrantes}%</span>
                    </div>
                    <div style="width:100%; background:#e9ecef; height:12px; border-radius:10px; overflow:hidden;">
                        <div style="width:${pctSobrantes}%; background:#fd7e14; height:100%; transition:width 0.5s;"></div>
                    </div>
                </div>

                <div>
                    <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:bold; color:#dc3545; margin-bottom:4px;">
                        <span>❌ Mercancía Faltante (Merma) (${cantFaltantes} pzas)</span>
                        <span>${pctFaltantes}%</span>
                    </div>
                    <div style="width:100%; background:#e9ecef; height:12px; border-radius:10px; overflow:hidden;">
                        <div style="width:${pctFaltantes}%; background:#dc3545; height:100%; transition:width 0.5s;"></div>
                    </div>
                </div>

            </div>

            <div style="background:#fff3cd; border-radius:8px; padding:15px; text-align:left; font-size:13px; color:#856404; border:1px solid #ffeeba;">
                💡 <b>Métrica de Control Operativo:</b> Tu meta ideal es mantener el porcentaje de <b>Coincidencias Exactas</b> por encima del 90%. El porcentaje de faltantes representa pérdida directa en tu anaquel.
            </div>

            <button class="btn-final" style="background:var(--info); width:100%; margin-top:20px; font-size:16px;" onclick="document.getElementById('${modalId}').style.display='none'">CERRAR PANEL</button>
        </div>`;

    } catch (error) {
        console.error("Error al obtener estadísticas: ", error);
        modal.innerHTML = `<div class="modal-content" style="width:400px; text-align:center;">
            <h3 style="color:red;">❌ Error de Conexión</h3>
            <p>No se pudo descargar el historial.</p>
            <button class="btn-final" style="background:#333; margin-top:15px;" onclick="document.getElementById('${modalId}').style.display='none'">Cerrar</button>
        </div>`;
    } 
}


    
// ====================================================================
// === 📖 HISTORIAL DE CLIENTES Y BÚSQUEDA DE TICKETS ===
// ====================================================================
window.abrirHistorialCli = function(tel) {
    let c = clientes[tel]; if(!c) return;
    document.getElementById('hist_cli_nom').innerText = c.nom; 
    document.getElementById('hist_cli_saldo').innerText = (c.saldo || 0).toFixed(2);
    
    let html = (c.historial || []).map(h => {
        let colorMonto = h.tipo === 'Abono' ? 'var(--s)' : 'var(--danger)';
        let signo = h.tipo === 'Abono' ? '-' : '+';
        
        // Botón mágico para ir a buscar el ticket de esta venta
        let btnTicket = h.id_venta ? `<button onclick="window.verTicketDesdeHistorial('${h.id_venta}', this)" style="background:#0d6efd; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:bold;">🧾 Ver Ticket</button>` : '---';

        return `<tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px;">${h.fecha} <br> <small style="color:#888;">${h.hora}</small></td>
            <td><b>${h.tipo}</b></td>
            <td>${h.detalle}</td>
            <td style="text-align:right; font-weight:bold; color:${colorMonto};">${signo}$${(h.monto||0).toFixed(2)}</td>
            <td style="text-align:center;">${btnTicket}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#888;">Este cliente aún no tiene movimientos de crédito.</td></tr>';
    
    document.getElementById('hist_cli_lista').innerHTML = html;
    document.getElementById('modalHistorialCli').style.display = 'block';
   
};

window.verTicketDesdeHistorial = async function(idVenta, btnElement) {
    let indiceLocal = ventas.findIndex(v => String(v.id) === String(idVenta));
    
    if (indiceLocal !== -1) {
        visorIndices = ventas.map((v, idx) => ({...v, indexGlobal: idx})).filter(v => String(v.id) === String(idVenta));
        if(visorIndices.length > 0) {
            currentVisorPos = 0;
            renderVisorActivo();
            document.getElementById('modalHistorialCli').style.display = 'none'; 
            document.getElementById('modalVisor').style.display = 'block'; 
        }
    } else {
        try {
            let textoOriginal = btnElement.innerText;
            btnElement.innerText = "⏳ Buscando...";
            btnElement.disabled = true;

            let record = await pb.collection('ventas').getFirstListItem(`doc_id="${idVenta}"`);
            
            ventas.push(record.data);
            visorIndices = [{ ...record.data, indexGlobal: ventas.length - 1 }];
            currentVisorPos = 0;
            
            renderVisorActivo();
            document.getElementById('modalHistorialCli').style.display = 'none';
            document.getElementById('modalVisor').style.display = 'block';
            
            btnElement.innerText = textoOriginal;
            btnElement.disabled = false;
        } catch (err) {
            alert("❌ No se encontró el ticket en la nube. Puede que haya sido eliminado permanentemente.");
            btnElement.innerText = "Desconocido";
        }
    }
}; // <--- ESTAS TRES LÍNEAS FINALES SON LAS QUE TE FALTABAN PARA QUE EL ARCHIVO NO MARCARA ERROR
// ====================================================================
// === 🏆 MOTOR ANALÍTICO: TOP 10 PRODUCTOS DINÁMICO ===
// ====================================================================
let ultimoHashTopProductos = {}; // Memoria RAM temporal para los cambios de pestaña rápido

window.dibujarTopProductos = function(topProductosHash) {
    // Si nos pasan un hash nuevo, lo guardamos en el almacén, si no, usamos el viejo
    if (topProductosHash) ultimoHashTopProductos = topProductosHash;
    
    let tbody = document.getElementById('kpi_tabla_top_productos');
    if (!tbody) return;

    let lista = Object.values(ultimoHashTopProductos);

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">No hay datos de artículos vendidos en este periodo.</td></tr>`;
        return;
    }

    // 🧮 ORDENAMIENTO FINANCIERO DINÁMICO
    lista.sort((a, b) => {
        if (filtroTopActual === 'ingreso') return b.total - a.total; // Mayor ingreso monetario
        if (filtroTopActual === 'ganancia') return b.ganancia - a.ganancia; // Mayor rentabilidad
        return b.cantidad - a.cantidad; // Mayor rotación de piezas (Por defecto)
    });

    // Tomamos únicamente los mejores 10
    let top10 = lista.slice(0, 10);

    let html = top10.map((p, i) => {
        // Resaltamos visualmente las filas del podio (1, 2 y 3)
        let medalla = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `${i + 1}`));
        let estiloFila = i < 3 ? 'font-weight: bold; background: #fdfbf7;' : '';

        return `<tr style="${estiloFila} border-bottom: 1px solid #f1f3f5;">
            <td style="padding:10px; text-align:center;">${medalla}</td>
            <td style="padding:10px;"><b>${p.nombre}</b></td>
            <td style="padding:10px; text-align:center; color:#0d6efd;">${Math.round(p.cantidad * 100) / 100}</td>
            <td style="padding:10px; text-align:right; color:var(--s); font-weight:bold;">$${(p.total || 0).toFixed(2)}</td>
            <td style="padding:10px; text-align:right; color:#6f42c1; font-weight:bold;">$${(p.ganancia || 0).toFixed(2)}</td>
        </tr>`;
    }).join('');

    tbody.innerHTML = html;
};

window.cambiarFiltroTop = function(nuevoFiltro) {
    filtroTopActual = nuevoFiltro;
    
    // Cambiar estilos de los botones activados
    ['cantidad', 'ingreso', 'ganancia'].forEach(t => {
        let btn = document.getElementById(`btn_top_${t}`);
        if(btn) {
            btn.style.background = t === nuevoFiltro ? 'var(--p)' : 'transparent';
            btn.style.color = t === nuevoFiltro ? 'white' : '#495057';
        }
    });
    
    // Redibujar la tabla con el orden solicitado al momento
    window.dibujarTopProductos();
};
// Variable global para controlar la sesión activa
window.sesionCajaActual = null;



// 2. Función para Abrir Turno / Caja e insertar los 5 datos en PocketBase



window.cargarSesionCajaActiva = async function() {
    try {
        let usrReal = typeof usuarioActual !== 'undefined' ? usuarioActual : '';

        // Si no hay nadie logueado, no cargamos ninguna caja
        if (!usrReal) {
            window.sesionCajaActual = null;
            return;
        }

        // 1. Descargamos TODAS las cajas de la base de datos (sin filtros complejos que puedan fallar)
        let records = [];
        try {
            records = await pb.collection('cajas_sesiones').getFullList({
                sort: '-created',
                requestKey: null
            });
        } catch(errPb) {
            console.error("Error consultando cajas en PocketBase:", errPb);
            return;
        }

        // 🌟 2. FILTRO ESTRICTO EN MEMORIA (100% a prueba de fallos)
        // Solo conservamos la caja si está ABIERTA y le pertenece a ESTE CAJERO
        let misTurnosAbiertos = records.filter(r => 
            r.estado === 'abierta' && 
            r.cajero === usrReal
        );

        if (misTurnosAbiertos.length > 0) {
            let miTurnoPendiente = misTurnosAbiertos[0]; // Tomamos su turno más reciente

            // 3. Revisar si ya lo habíamos cargado en esta máquina para no molestarlo con mensajes
            let sesionLocal = localStorage.getItem("pos_sesion_activa");
            let yaEstabaCargada = false;
            
            if (sesionLocal) {
                try {
                    let parseada = JSON.parse(sesionLocal);
                    // Validamos que el ID de la caja guardada coincida con el de la nube
                    yaEstabaCargada = (parseada.id === miTurnoPendiente.id && parseada.cajero === usrReal);
                } catch(e) {}
            }

            if (yaEstabaCargada) {
                // Carga directa sin preguntar
                window.sesionCajaActual = miTurnoPendiente;
            } else {
                // 🌟 4. PREGUNTA DE CONTINUIDAD (Solo aparece una vez)
                let continuar = confirm(`👋 Hola ${usrReal},\n\nTienes un turno abierto previamente en la sucursal "${miTurnoPendiente.sucursal}".\n\n¿Deseas CONTINUAR operando con este mismo turno?`);
                
                if (continuar) {
                    window.sesionCajaActual = miTurnoPendiente;
                    localStorage.setItem("pos_sesion_activa", JSON.stringify(miTurnoPendiente));
                } else {
                    // Si dice que NO, lo dejamos sin caja para que la pantalla le exija iniciar una nueva
                    window.sesionCajaActual = null;
                    localStorage.removeItem("pos_sesion_activa");
                }
            }
        } else {
            // NINGUN TURNO ABIERTO PERTENECE A ESTE CAJERO (Limpia rastros de otros cajeros)
            window.sesionCajaActual = null;
            localStorage.removeItem("pos_sesion_activa");
        }
    } catch (e) {
        console.error("❌ Error general al sincronizar turno:", e);
        
        // Paracaídas Local: Solo entra si no hay internet Y si la caja pertenece a este usuario
        let usrReal = typeof usuarioActual !== 'undefined' ? usuarioActual : '';
        let sesionGuardada = localStorage.getItem("pos_sesion_activa");
        if (sesionGuardada) {
            try {
                let parseada = JSON.parse(sesionGuardada);
                if (parseada.cajero === usrReal && parseada.estado === 'abierta') {
                    window.sesionCajaActual = parseada;
                } else {
                    window.sesionCajaActual = null;
                }
            } catch(err) { window.sesionCajaActual = null; }
        }
    } finally {
        // Disparamos la actualización visual para poner "ABIERTO 🟢" o "CERRADO 🔴"
        if (typeof window.actualizarIndicadorTurnoUI === 'function') {
            window.actualizarIndicadorTurnoUI();
        }
    }
};

// 2. Interfaz visual (Mantiene los datos mapeados desde la nube o variables)
window.actualizarIndicadorTurnoUI = function() {
    let estaAbierta = window.sesionCajaActual && window.sesionCajaActual.estado === 'abierta';
    
    let idsEstado = ['lbl_estado_turno', 'lbl_estado_turno_inv'];
    let idsInfo = ['lbl_info_turno', 'lbl_info_turno_inv'];
    let idsAbrir = ['btn_abrir_turno', 'btn_abrir_turno_inv'];
    let idsCerrar = ['btn_cerrar_turno', 'btn_cerrar_turno_inv'];

    // Actualizar texto y color
    idsEstado.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            el.innerText = estaAbierta ? "ABIERTO 🟢" : "CERRADO 🔴";
            el.style.color = estaAbierta ? "#28a745" : "#dc3545";
        }
    });

    // Actualizar datos del cajero y la hora
    idsInfo.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            if (estaAbierta) {
                let f = parseFloat(window.sesionCajaActual.monto_inicial) || 0;
                let cajero = window.sesionCajaActual.cajero || "Cajero";
                let fecha = window.sesionCajaActual.fecha_apertura || window.sesionCajaActual.created || "";
                el.innerText = `Cajero: ${cajero} | Apertura: ${fecha} | Fondo Inicial: $${f.toFixed(2)}`;
            } else {
                el.innerText = "No hay una caja abierta actualmente en esta sucursal.";
            }
        }
    });

    // Mostrar/Ocultar botones
    idsAbrir.forEach(id => {
        let el = document.getElementById(id);
        if (el) el.style.display = estaAbierta ? 'none' : 'flex';
    });

    idsCerrar.forEach(id => {
        let el = document.getElementById(id);
        if (el) el.style.display = estaAbierta ? 'flex' : 'none';
    });
};

// 3. Ejecución inicial conectada a la nube
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => { window.cargarSesionCajaActiva(); }, 300);
} else {
    document.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => { window.cargarSesionCajaActiva(); }, 300);
    });
}
window.abrirMontoInicialCaja = async function() {
    let montoInput = prompt("💵 Ingresa el Fondo Inicial de Caja para abrir turno:", "0.00");
    if (montoInput === null) return; 

    let montoInicial = parseFloat(montoInput) || 0;
    
    // 🌟 RESTAURAMOS A TU LÓGICA ORIGINAL
    let sucReal = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();
    let cajeroActual = String(typeof usuarioActual !== 'undefined' ? usuarioActual : "Cajero").trim();

    let datosSesion = {
        sucursal: sucReal, // <-- Vuelve a ser estricto por local
        cajero: cajeroActual,
        estado: 'abierta',
        monto_inicial: montoInicial,
        fecha_apertura: new Date().toISOString(), 
        efectivo_esperado: montoInicial,
        efectivo_contado: 0,
        diferencia_caja: 0
    };

    try {
        let record = await pb.collection('cajas_sesiones').create(datosSesion);
        window.sesionCajaActual = record;
        localStorage.setItem("pos_sesion_activa", JSON.stringify(record));

        alert(`🟢 Turno abierto con éxito.\nFondo Inicial: $${montoInicial.toFixed(2)}`);

        if (typeof window.actualizarIndicadorTurnoUI === 'function') {
            window.actualizarIndicadorTurnoUI();
        }
    } catch (error) {
        console.error("Error al abrir turno:", error);
        alert("❌ No se pudo guardar el turno en PocketBase.");
    }
};

// Variable temporal para recordar el dinero que pidió el sistema
window.efectivoEsperadoTemporal = 0;

// 🔒 1. PREPARAR DATOS Y ABRIR CALCULADORA
window.cerrarTurnoActual = function() {
    if (!window.sesionCajaActual || window.sesionCajaActual.estado !== 'abierta') return alert("⚠️ No hay sesión abierta.");
    
    if (typeof renderCorte === 'function') {
        let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
        let inputInicio = document.getElementById('corte_fecha_inicio');
        let inputFin = document.getElementById('corte_fecha_fin');
        if (inputInicio) inputInicio.value = hoy;
        if (inputFin) inputFin.value = hoy;
        renderCorte();
    }

    let idSesion = window.sesionCajaActual.id;
    let sucTurno = window.sesionCajaActual.sucursal || String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();
    let cajeroTurno = window.sesionCajaActual.cajero;
    let fechaHoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    
    let fondo = parseFloat(window.sesionCajaActual.monto_inicial) || 0;
    
    // 🔥 FUNCION ESCUDO: Verifica la hora exacta para evitar fantasmas
    const perteneceAlTurno = (item) => {
        if (item.id_sesion_caja) return item.id_sesion_caja === idSesion; 
        
        // Si no tiene etiqueta, verificamos que sea de hoy
        let esDeHoy = (item.fecha === fechaHoy && (item.sucursal || "Matriz") === sucTurno);
        if (!esDeHoy) return false;
        
        // ⏰ EL SECRETO: Verificamos si sucedió ANTES de abrir la caja
        if (item.id && !isNaN(item.id) && idSesion && !isNaN(idSesion)) {
            if (Number(item.id) < Number(idSesion)) return false; // Fantasma eliminado 👻🚫
        }
        return true;
    };
    
    // 🧮 1. VENTAS
    let ventasEfectivo = 0, ventasAnuladas = 0;
    if (typeof ventas !== 'undefined' && Array.isArray(ventas)) {
        ventas.forEach(v => {
            let metodo = v.metodo || ""; 
            if (!metodo.includes("Efectivo") || v.cajero !== cajeroTurno) return;
            
            if (!perteneceAlTurno(v)) return; // <-- APLICAMOS EL ESCUDO

            let total = parseFloat(v.total) || 0;
            if (v.anulada === true || v.cancelada === true || v.estado === 'anulado') ventasAnuladas += total;
            else ventasEfectivo += total; 
        });
    }
    
    // 🧮 2. INGRESOS Y GASTOS
    let ingresosExtra = 0, retirosGastos = 0;
    let listaIngresos = [];
    let listaGastos = [];

    if (typeof movimientos !== 'undefined' && Array.isArray(movimientos)) {
        movimientos.forEach(m => {
            let tipo = m.tipo || ""; 
            if (m.anulado === true || m.cancelado === true || m.cajero !== cajeroTurno) return;
            
            if (!perteneceAlTurno(m)) return; // <-- APLICAMOS EL ESCUDO

            let monto = parseFloat(m.monto) || 0;
            if (tipo.includes("Ingreso") || tipo.includes("Entrada")) {
                ingresosExtra += monto;
                listaIngresos.push(m);
            }
            if (tipo.includes("Retiro") || tipo.includes("Gasto")) {
                retirosGastos += monto;
                listaGastos.push(m);
            }
        });
    }

    // 🧮 3. COMPRAS
    let comprasEfectivo = 0, comprasAnuladas = 0;
    if (typeof compras !== 'undefined' && Array.isArray(compras)) {
        compras.forEach(c => {
            let metodo = c.metodo || ""; 
            if (!metodo.includes("Efectivo") || c.cajero !== cajeroTurno) return;
            
            if (!perteneceAlTurno(c)) return; // <-- APLICAMOS EL ESCUDO

            let total = parseFloat(c.total) || 0;
            if (c.anulada === true || c.cancelada === true || c.estado === 'anulado') comprasAnuladas += total;
            else comprasEfectivo += total;
        });
    }

    let efEsperado = fondo + ventasEfectivo + ingresosExtra - retirosGastos - comprasEfectivo;
    window.efectivoEsperadoTemporal = efEsperado; 

    // 📝 CONSTRUCCIÓN DEL TEXTO MATEMÁTICO
    let detalleMatematico = `Fondo Inicial: $${fondo.toFixed(2)}\n(+) Ventas: $${ventasEfectivo.toFixed(2)}`;
    if (ventasAnuladas > 0) detalleMatematico += `\n   *(Omitidas $${ventasAnuladas.toFixed(2)} por anulación)`;
    detalleMatematico += `\n(+) Otros Ingresos: $${ingresosExtra.toFixed(2)}\n(-) Gastos: $${retirosGastos.toFixed(2)}\n(-) Compras: $${comprasEfectivo.toFixed(2)}`;
    if (comprasAnuladas > 0) detalleMatematico += `\n   *(Omitidas $${comprasAnuladas.toFixed(2)} por anulación)`;

    // ====================================================================
    // 🌟 INYECCIÓN DE DETALLES DE MOVIMIENTOS 🌟
    // ====================================================================
    detalleMatematico += `\n\n--- DETALLE DE MOVIMIENTOS ---`;
    
    if (listaIngresos.length > 0) {
        detalleMatematico += `\n\n🟢 OTROS INGRESOS (Abonos, Entradas):`;
        listaIngresos.forEach(m => {
            detalleMatematico += `\n + $${parseFloat(m.monto).toFixed(2)} | ${m.motivo || 'Ingreso'} (${m.hora})`;
        });
    }
    
    if (listaGastos.length > 0) {
        detalleMatematico += `\n\n🔴 GASTOS Y RETIROS (Pagos a Proveedor, etc):`;
        listaGastos.forEach(m => {
            detalleMatematico += `\n - $${parseFloat(m.monto).toFixed(2)} | ${m.motivo || 'Gasto'} (${m.hora})`;
        });
    }

    if (listaIngresos.length === 0 && listaGastos.length === 0) {
        detalleMatematico += `\n\n(No hay ingresos ni gastos extra registrados en este turno)`;
    }
    // ====================================================================

    let divDetalle = document.getElementById('arqueo_detalle');
    if (divDetalle) {
        divDetalle.innerText = detalleMatematico;
        document.getElementById('arqueo_esperado_txt').innerText = efEsperado.toFixed(2);
        document.querySelectorAll('.arq-input').forEach(input => input.value = '');
        document.getElementById('arqueo_total_contado').innerText = "0.00";
        document.getElementById('modalArqueo').style.display = 'flex';
    } else {
        alert("⚠️ No se encontró la ventana de arqueo en el HTML.");
    }
};
// 🧮 2. CALCULADORA EN TIEMPO REAL
window.sumarArqueo = function() {
    let b1000 = (parseInt(document.getElementById('arq_1000').value) || 0) * 1000;
    let b500 = (parseInt(document.getElementById('arq_500').value) || 0) * 500;
    let b200 = (parseInt(document.getElementById('arq_200').value) || 0) * 200;
    let b100 = (parseInt(document.getElementById('arq_100').value) || 0) * 100;
    let b50 = (parseInt(document.getElementById('arq_50').value) || 0) * 50;
    let b20 = (parseInt(document.getElementById('arq_20').value) || 0) * 20;
    
    let m20 = (parseInt(document.getElementById('arq_m20').value) || 0) * 20;
    let m10 = (parseInt(document.getElementById('arq_10').value) || 0) * 10;
    let m5 = (parseInt(document.getElementById('arq_5').value) || 0) * 5;
    let m2 = (parseInt(document.getElementById('arq_2').value) || 0) * 2;
    let m1 = (parseInt(document.getElementById('arq_1').value) || 0) * 1;
    let m05 = (parseInt(document.getElementById('arq_05').value) || 0) * 0.5;

    let extra = parseFloat(document.getElementById('arq_extra').value) || 0;

    let totalCalculado = b1000 + b500 + b200 + b100 + b50 + b20 + m20 + m10 + m5 + m2 + m1 + m05 + extra;
    document.getElementById('arqueo_total_contado').innerText = totalCalculado.toFixed(2);
};

window.confirmarCierreArqueo = async function() {
    // 1. Verificamos que realmente haya un turno abierto
    if (!window.sesionCajaActual || window.sesionCajaActual.estado !== 'abierta') {
        return alert("❌ No hay sesión abierta para cerrar.");
    }

    // 2. Extraemos los valores matemáticos del arqueo
    let esperado = parseFloat(window.efectivoEsperadoTemporal) || 0;
    let contado = parseFloat(document.getElementById('arqueo_total_contado').innerText) || 0;
    let diferencia = parseFloat((contado - esperado).toFixed(2));

    // 3. Confirmación de seguridad
    let msj = `Resumen Final del Turno:\n\nEsperado en Sistema: $${esperado.toFixed(2)}\nFísico en Cajón: $${contado.toFixed(2)}\nDiferencia: $${diferencia.toFixed(2)}\n\n¿Estás seguro de finalizar y guardar este turno?`;
    if (!confirm(msj)) return;

    let ahora = new Date().toISOString();

    // 🌟 4. ACTUALIZAMOS POCKETBASE EN TIEMPO REAL ('cajas_sesiones')
    try {
        if (window.sesionCajaActual && window.sesionCajaActual.id && typeof pb !== 'undefined') {
            await pb.collection('cajas_sesiones').update(window.sesionCajaActual.id, {
                estado: 'cerrada',
                fecha_cierre: ahora,
                efectivo_esperado: esperado,
                efectivo_contado: contado,
                diferencia_caja: diferencia
            });
        }
    } catch (err) {
        console.error("Error al actualizar el cierre en PocketBase:", err);
    }

    // 5. CERRAR OFICIALMENTE LA SESIÓN EN MEMORIA Y DISCO LOCAL
    window.sesionCajaActual = null;
    localStorage.removeItem("pos_sesion_activa");
    localStorage.removeItem("pos_sesion_caja");

    // 🧹 ESCOBA DIGITAL: Limpiamos la basura del turno cerrado
    window.movimientos = [];
    if (typeof ventas !== 'undefined') window.ventas = [];
    if (typeof compras !== 'undefined') window.compras = [];

    try {
        localStorage.removeItem("pos_movimientos_v1");
        localStorage.removeItem("pos_ventas_v1");
        localStorage.removeItem("pos_compras_v1");
    } catch(e) {
        console.warn("No se pudo limpiar la memoria local.");
    }

    // 6. ACTUALIZAR PANTALLA Y OCULTAR MODAL
    let modalArqueo = document.getElementById('modalArqueo');
    if (modalArqueo) modalArqueo.style.display = 'none';
    
    if (typeof window.actualizarIndicadorTurnoUI === 'function') window.actualizarIndicadorTurnoUI();
    if (typeof renderCorte === 'function') renderCorte();

    alert("✅ Turno cerrado exitosamente.");
};
// 🌟 VERIFICADOR AUTOMÁTICO DE TURNO AL ENTRAR AL SISTEMA
window.verificarOAbrirTurnoAlLogin = async function() {
    // 1. Primero sincronizamos con PocketBase para saber el estado real en la nube
    if (typeof window.cargarSesionCajaActiva === 'function') {
        await window.cargarSesionCajaActiva();
    }

    // 2. Si la sesión ya está abierta (en este o en otro dispositivo), solo actualizamos la UI y salimos
    if (window.sesionCajaActual && window.sesionCajaActual.estado === 'abierta') {
        if (typeof actualizarIndicadorTurnoUI === 'function') actualizarIndicadorTurnoUI();
        return;
    }

    // 3. Si la caja realmente está cerrada en la nube, mostramos la invitación para abrir turno
    setTimeout(() => {
        let sucLimpia = String(typeof sucursalActual !== 'undefined' ? sucursalActual : "Matriz").replace(/📍/g, '').trim();
        let confirmApertura = confirm(`🏪 ¡Bienvenido ${usuarioActual || ''}!\n\nLa caja registradora de la sucursal [ ${sucLimpia} ] se encuentra CERRADA.\n\n¿Deseas iniciar turno e ingresar el Fondo Inicial ahora mismo?`);
        
        if (confirmApertura) {
            if (typeof abrirMontoInicialCaja === 'function') {
                abrirMontoInicialCaja();
            }
        } else {
            alert("⚠️ Recuerda que para poder registrar ventas o cortes en este turno deberás iniciar la caja desde el panel superior.");
            if (typeof actualizarIndicadorTurnoUI === 'function') actualizarIndicadorTurnoUI();
        }
    }, 500);
};
// ====================================================================
// 📊 MÓDULO DE HISTORIAL Y ANÁLISIS DE TURNOS CERRADOS
// ====================================================================

window.renderHistorialTurnos = function() {
    let tbody = document.getElementById('r_lista_turnos_cerrados');
    if (!tbody) return;
    
    // Cargar historial de la memoria si está vacío
    if (typeof historialTurnos === 'undefined') {
        try {
            window.historialTurnos = JSON.parse(localStorage.getItem('pos_turnos_v1')) || [];
        } catch(e) { window.historialTurnos = []; }
    }
    
    tbody.innerHTML = '';
    
    if (window.historialTurnos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:15px; color:#999;">No hay turnos cerrados registrados todavía.</td></tr>';
        return;
    }
    
    // Invertimos la lista para mostrar el turno más reciente hasta arriba
    let turnosInvertidos = [...window.historialTurnos].reverse();
    
    turnosInvertidos.forEach((t, i) => {
        let dif = parseFloat(t.diferencia_caja) || 0;
        let colorDiferencia = dif === 0 ? '#28a745' : (dif < 0 ? '#dc3545' : '#fd7e14');
        let txtDiferencia = dif === 0 ? 'Exacto ✅' : (dif < 0 ? `-$${Math.abs(dif).toFixed(2)} ❌` : `+$${dif.toFixed(2)} ⚠️`);
        
        // El índice real nos sirve para saber cuál abrir en la ventana
        let realIndex = window.historialTurnos.length - 1 - i; 
        
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${t.fecha_cierre} <small style="color:#666">(${t.hora_cierre})</small></td>
            <td><b>${t.cajero}</b></td>
            <td>${t.sucursal}</td>
            <td style="text-align:right;">$${parseFloat(t.efectivo_esperado).toFixed(2)}</td>
            <td style="text-align:right;"><b>$${parseFloat(t.efectivo_contado).toFixed(2)}</b></td>
            <td style="color:${colorDiferencia}; font-weight:bold; text-align:right;">${txtDiferencia}</td>
            <td style="text-align:center;">
                <button onclick="verDetalleTurnoHistorial(${realIndex})" style="background:#6f42c1; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:bold;">🔍 VER</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
};

window.verDetalleTurnoHistorial = function(index) {
    let t = window.historialTurnos[index];
    if (!t) return;
    
    let contenido = `==== REPORTE DE CIERRE ====\n`;
    contenido += `ID Sesión: ${t.id_sesion}\n`;
    contenido += `Fecha: ${t.fecha_cierre} a las ${t.hora_cierre}\n`;
    contenido += `Cajero: ${t.cajero}\n`;
    contenido += `Sucursal: ${t.sucursal}\n`;
    contenido += `===========================\n\n`;
    
    contenido += `EFECTIVO ESPERADO: $${parseFloat(t.efectivo_esperado).toFixed(2)}\n`;
    contenido += `EFECTIVO CONTADO:  $${parseFloat(t.efectivo_contado).toFixed(2)}\n`;
    
    let dif = parseFloat(t.diferencia_caja);
    if (dif === 0) contenido += `ESTADO DEL CUADRE: EXACTO ✅\n\n`;
    else if (dif < 0) contenido += `FALTANTE EN CAJA: -$${Math.abs(dif).toFixed(2)} ❌\n\n`;
    else contenido += `SOBRANTE EN CAJA: +$${dif.toFixed(2)} ⚠️\n\n`;
    
    // Inyectamos el chisme completo de ventas y gastos guardado
    contenido += t.detalle_operaciones || "(Sin detalles guardados en esta versión)";
    
    document.getElementById('print_detalle_turno').innerText = contenido;
    document.getElementById('modalDetalleTurno').style.display = 'flex';
};


// ====================================================================
// ⌨️ NAVEGACIÓN RÁPIDA CON 'ENTER' EN LA CALCULADORA DE ARQUEO
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Seleccionamos todos los cuadritos del arqueo basándonos en su clase
    let inputsArqueo = document.querySelectorAll('.arq-input');
    
    inputsArqueo.forEach((input, index) => {
        input.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault(); // Evitamos que la página intente hacer cosas raras
                
                // Buscamos el siguiente cuadrito en la fila
                let siguienteInput = inputsArqueo[index + 1];
                if (siguienteInput) {
                    siguienteInput.focus();
                    siguienteInput.select(); // Resalta el número para que sea fácil sobreescribirlo
                }
            }
        });
    });
});

// ====================================================================
// 💸 MÓDULO DE RECEPCIÓN Y DEVOLUCIÓN DE TRANSFERENCIAS
// ====================================================================

window.transferenciaPendienteActual = null;
window.transferenciaDevueltaActual = null;
window.transferenciasVistas = window.transferenciasVistas || new Set();

window.iniciarRadarTransferencias = function() {
    if (window.intervaloRadar) clearInterval(window.intervaloRadar);
    console.log("🚀 Motor de Radar de Transferencias encendido (Versión JSON)...");

    window.intervaloRadar = setInterval(async () => {
        if (typeof usuarioActual === 'undefined' || !usuarioActual) return; 
        let miNombreLimpio = String(usuarioActual).trim().toLowerCase();

        try {
            let url = `https://sexy-starling.pikapod.net/api/collections/transferencias/records?perPage=20&sort=-created&_t=${Date.now()}`;
            let res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return;
            
            let result = await res.json();
            let lista = result.items || [];

            for (let record of lista) {
                // 🌟 TRUCO CLAVE: Desempaquetar "data" por si PocketBase lo envía como texto
                let payload = record.data || {};
                if (typeof payload === 'string') {
                    try { payload = JSON.parse(payload); } catch(e) {}
                }
                
                let idRecord = record.id; 
                
                // 🌟 PRIORIDAD: Leer el estado desde 'payload' (el bloque JSON que ya arreglamos)
                let estado = String(payload.estado || record.estado || '').toLowerCase();
                
                let claveMemoria = idRecord + "_" + estado;
                
                if (window.transferenciasVistas.has(claveMemoria)) continue;

                let rec = String(payload.receptor || record.receptor || '').trim().toLowerCase();
                let emi = String(payload.emisor || record.emisor || '').trim().toLowerCase();

                // 📥 Dinero recibido
                if (rec === miNombreLimpio && estado === "pendiente") {
                    window.transferenciasVistas.add(claveMemoria);
                    
                    let datosModal = {
                        id_pb: idRecord,
                        emisor: payload.emisor || record.emisor,
                        receptor: payload.receptor || record.receptor,
                        monto: payload.monto || record.monto
                    };
                    
                    if (typeof mostrarNotificacionFlotante === 'function') {
                        mostrarNotificacionFlotante(idRecord, datosModal, 'recibir');
                    }
                }
            }
        } catch (e) {}
    }, 3000);
};

// Auto-iniciar a los 2 segundos
setTimeout(() => { if(typeof iniciarRadarTransferencias === 'function') iniciarRadarTransferencias(); }, 2000);

// ⚡ ARRANQUE AUTOMÁTICO DE SEGURIDAD
setTimeout(() => {
    if (typeof iniciarRadarTransferencias === 'function') {
        iniciarRadarTransferencias();
    }
}, 2000);

// ⚡ ARRANQUE AUTOMÁTICO DE SEGURIDAD (Obliga al radar a prenderse al abrir el sistema)
setTimeout(() => {
    if (typeof iniciarRadarTransferencias === 'function') {
        iniciarRadarTransferencias();
    }
}, 2000);
// 2. MOSTRAR ALERTA DE DINERO NUEVO RECIBIDO
// ==========================================
// 1. ABRIR VENTANA DE RECIBIR DINERO (SIMPLIFICADA)
// ==========================================
// ==========================================
// 1. ABRIR VENTANA DE RECIBIR DINERO
// ==========================================
window.abrirModalTransferencia = function(idRecord, datosModal) {
    // Guardamos los datos de la transferencia temporalmente
    window.transferenciaPendienteActual = { id_pb: idRecord, ...datosModal };

    // Buscamos la ventana y los textos en tu nuevo HTML
    let modal = document.getElementById('modalNotificacionTransferencia');
    let lblEmisor = document.getElementById('lbl_transf_emisor');
    let lblMonto = document.getElementById('lbl_transf_monto');
    let lblSucursal = document.getElementById('lbl_transf_sucursal');

    if (!modal) {
        console.error("No se encontró la ventana del modal en el HTML.");
        return;
    }

    // Rellenamos los datos si encontramos las etiquetas
    if (lblEmisor) lblEmisor.innerText = datosModal.emisor || "Admin";
    if (lblMonto) lblMonto.innerText = parseFloat(datosModal.monto || 0).toFixed(2);
    if (lblSucursal) lblSucursal.innerText = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';

    // Mostramos la ventana (usamos 'flex' para que se centre perfectamente)
    modal.style.display = 'flex';
};
// ==========================================
// 2. ACEPTAR Y GUARDAR DIRECTO A LA CAJA
// ==========================================
window.aceptarTransferencia = async function() {
    let t = window.transferenciaPendienteActual;
    if (!t) return;

    let monto = parseFloat(t.monto) || 0;
    let idSesionTurno = (window.sesionCajaActual ? window.sesionCajaActual.id : null);
    let hoy = typeof getFechaLocal === 'function' ? getFechaLocal() : new Date().toISOString().split('T')[0];
    let hora = new Date().toLocaleTimeString();
    let sucMov = typeof sucursalActual !== 'undefined' ? sucursalActual : 'Matriz';
    let miNombre = typeof usuarioActual !== 'undefined' ? usuarioActual : 'Admin';
    
    // El ID interno de PocketBase (ej. vq2w8oe64fk0bjo)
    let idRegistroPB = t.id_pb || t.id; 

    let nuevoMov = {
        id: Date.now(), 
        id_sesion_caja: idSesionTurno, 
        fecha: hoy, hora: hora, cajero: miNombre, 
        sucursal: sucMov, tipo: "Ingreso", monto: monto,
        motivo: `📥 TRASPASO RECIBIDO: de ${t.emisor}`
    };

    window.movimientos = window.movimientos || [];
    window.movimientos.push(nuevoMov);
    try { localStorage.setItem("pos_movimientos_v1", JSON.stringify(window.movimientos)); } catch (e) {}

    try {
        // 1. Guardamos el movimiento de ingreso localmente en la nube
        if (typeof db !== 'undefined' && db.collection) {
            db.collection("movimientos").doc(String(nuevoMov.id)).set(nuevoMov).catch(e=>{});
        }

        // 2. 🌟 EL TRUCO PARA POCKETBASE: Leemos la columna "data" y la sobreescribimos
        let urlPB = `https://sexy-starling.pikapod.net/api/collections/transferencias/records/${idRegistroPB}`;
        let resGet = await fetch(urlPB, { cache: 'no-store' });
        
        if (resGet.ok) {
            let registroDb = await resGet.json();
            
            // Extraemos el bloque JSON (donde está escondido el estado)
            let datosJson = registroDb.data || {}; 
            
            // Lo cambiamos a aceptada
            datosJson.estado = "aceptada"; 
            
            // Mandamos el JSON completo de vuelta a la columna 'data'
            await fetch(urlPB, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ data: datosJson }) 
            });
        }

        // 3. Silenciamos el radar local de inmediato
        if (window.transferenciasVistas) {
            window.transferenciasVistas.add(idRegistroPB + "_aceptada");
            window.transferenciasVistas.add(idRegistroPB + "_pendiente"); 
        }

    } catch(e) {
        console.error("Error al comunicarse con PocketBase:", e);
    }

    // 4. Cerramos ventana y avisamos
    document.getElementById('modalNotificacionTransferencia').style.display = 'none';
    window.transferenciaPendienteActual = null;
    
    if (typeof renderCorte === 'function') renderCorte();

    if (typeof mostrarAvisoRapido === 'function') {
        mostrarAvisoRapido(`✅ Traspaso aceptado.\n+$${monto.toFixed(2)} a tu caja.`);
    }
};


// 🌟 INICIALIZADOR: Ponemos a funcionar el radar de 2 antenas
setTimeout(() => {
    if(typeof iniciarRadarTransferencias === 'function') iniciarRadarTransferencias();
}, 3000);
window.mostrarNotificacionFlotante = function(idRecord, datosModal, tipo) {
    // 🧹 1. Eliminar cualquier otra burbuja que ya esté en pantalla para que no se encimen
    let burbujasPrevias = document.querySelectorAll('.burbuja-notif-pos');
    burbujasPrevias.forEach(b => b.remove());

    // 2. Crear la nueva burbuja
    let toast = document.createElement('div');
    toast.className = 'burbuja-notif-pos'; // Le ponemos una clase para identificarla
    toast.id = 'toast_' + idRecord;
    
    // Estilos de la burbuja
    toast.style.position = 'fixed';
    toast.style.bottom = '25px';
    toast.style.right = '25px';
    toast.style.backgroundColor = tipo === 'recibir' ? '#28a745' : '#dc3545';
    toast.style.color = '#fff';
    toast.style.padding = '15px 20px';
    toast.style.borderRadius = '10px';
    toast.style.boxShadow = '0px 6px 15px rgba(0,0,0,0.4)';
    toast.style.zIndex = '999999';
    toast.style.cursor = 'pointer';
    toast.style.display = 'flex';
    toast.style.flexDirection = 'column';
    toast.style.gap = '6px';
    toast.style.fontFamily = 'Arial, sans-serif';

    let titulo = tipo === 'recibir' ? '📥 ¡Nueva Transferencia!' : '↩️ Dinero Devuelto';
    let msj = tipo === 'recibir' 
        ? `<b>${datosModal.emisor}</b> te envió <b>$${parseFloat(datosModal.monto).toFixed(2)}</b>`
        : `<b>${datosModal.emisor}</b> rechazó el dinero.`;

    toast.innerHTML = `
        <span style="font-size: 16px; font-weight: bold;">${titulo}</span>
        <span style="font-size: 14px;">${msj}</span>
        <span style="font-size: 12px; text-decoration: underline; margin-top: 4px;">Clic aquí para revisar</span>
    `;

    // Acción al darle clic a la burbujita
    toast.onclick = function() {
        toast.remove(); // Desaparece la burbuja al darle clic
        if (tipo === 'recibir' && typeof abrirModalTransferencia === 'function') {
            abrirModalTransferencia(idRecord, datosModal); 
        } else if (tipo === 'devolucion' && typeof abrirModalDevolucion === 'function') {
            abrirModalDevolucion(idRecord, datosModal);
        }
    };

    document.body.appendChild(toast);
};
// Variable global para controlar el tiempo sin volver loca a la memoria
window.intervaloPromosVentas = null;

window.actualizarTickerPromos = function() {
    let tickerContainer = document.getElementById('contenedor_ticker');
    let tickerTexto = document.getElementById('texto_ticker_promos');
    if (!tickerContainer || !tickerTexto) return;

   // 🛑 DESTRUIMOS EL CSS VIEJO Y LO FORZAMOS AL CENTRO
    tickerTexto.style.cssText = "animation: none !important; transition: none !important; transform: none !important; position: static !important; display: block !important; width: 100% !important; text-align: center !important; white-space: normal !important; margin: 0 !important; padding: 5px !important;";

    let hoy = (typeof getFechaLocal === 'function') ? getFechaLocal() : new Date().toISOString().split('T')[0];
    
    let activas = [];
    if (typeof promociones !== 'undefined' && Array.isArray(promociones)) {
        activas = promociones.filter(p => {
            if (!p) return false;
            let matchSuc = (p.sucursal === 'Todas' || p.sucursal === sucursalActual || (!p.sucursal && sucursalActual === 'Matriz'));
            let matchIni = (!p.fecha_ini || p.fecha_ini === '' || p.fecha_ini <= hoy);
            let matchFin = (!p.fecha_fin || p.fecha_fin === '' || p.fecha_fin >= hoy);
            let matchLim = (!p.limite || p.limite === 0 || (p.usadas || 0) < p.limite);
            return matchSuc && matchIni && matchFin && matchLim;
        });
    }

    tickerContainer.style.setProperty('display', 'block', 'important');

    // Limpiamos el reloj anterior para que no se encimen
    if (window.intervaloPromosVentas) {
        clearInterval(window.intervaloPromosVentas);
    }

    // SI NO HAY PROMOCIONES
    if (activas.length === 0) {
        tickerTexto.innerHTML = `<span style="font-weight: normal;">🌟 ¡BIENVENIDO AL SISTEMA! 🌟</span>`;
        return;
    }

    // ARMAMOS LA LISTA DE MENSAJES
    let mensajes = activas.map(p => {
        let nombreProd = (typeof inv !== 'undefined' && inv[p.cod]) ? inv[p.cod].nom : 'Oferta Especial';
        let descuento = p.tipo === 'nxm' ? `LLEVA ${p.n} PAGA ${p.m}` : `-${p.desc}% OFF`;
        return `<span style="font-weight: bold; font-size: 14px;">🏷️ <span style="color:#ffc107;">${nombreProd.toUpperCase()}</span>: ${descuento}</span>`;
    });

    // 🚀 SISTEMA DE CARRUSEL LIGERO (Cero lag)
    let indicePromo = 0;
    
    // Mostramos la primera de inmediato
    tickerTexto.innerHTML = mensajes[indicePromo];

    // Cambiamos el texto cada 4 segundos
    window.intervaloPromosVentas = setInterval(() => {
        indicePromo++;
        if (indicePromo >= mensajes.length) {
            indicePromo = 0; // Volver a empezar
        }
        tickerTexto.innerHTML = mensajes[indicePromo];
    }, 4000); 
};

// Auto-arranque
setTimeout(() => {
    if (typeof actualizarTickerPromos === 'function') actualizarTickerPromos();
}, 2000);

// Auto-arranque de la barra a los 2 segundos de abrir el sistema
setTimeout(() => {
    if (typeof actualizarTickerPromos === 'function') actualizarTickerPromos();
}, 2000);
