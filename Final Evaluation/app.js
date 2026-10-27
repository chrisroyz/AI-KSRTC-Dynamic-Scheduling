// ─────────────────────────────────────────────────────────────────────────────
// app.js  —  Canvas Renderer & UI Controller
// ─────────────────────────────────────────────────────────────────────────────

const canvas = document.getElementById("mapCanvas");
const ctx    = canvas.getContext("2d");

// Satellite image
const mapImage  = new Image();
mapImage.src    = "map.jpg";
let imageLoaded = false;
mapImage.onload = () => { imageLoaded = true; };

// ── UI State ──────────────────────────────────────────────────────────────────
let activeMode     = "select"; // "select" | "roadblock"
let hoverEdge      = null;
let selectedEntity = null;

// ── Log Feed ──────────────────────────────────────────────────────────────────
const logs = [];
function addLog(msg, type = "info") {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    logs.unshift({ ts, msg, type });
    if (logs.length > 50) logs.pop();
    _renderLog();
}
window.addLog = addLog;

function _renderLog() {
    const el = document.getElementById("logFeed");
    if (!el) return;
    el.innerHTML = logs.map(l => {
        let cls = "bg-blue-500/20 text-blue-400 border-blue-500/30";
        if (l.type === "warning") cls = "bg-amber-500/20 text-amber-400 border-amber-500/30";
        if (l.type === "danger")  cls = "bg-red-500/20 text-red-400 border-red-500/30";
        if (l.type === "success") cls = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
        return `<div class="p-2 rounded bg-slate-900/60 border border-slate-800/80 text-xs font-mono space-y-1">
            <div class="flex items-center justify-between text-[10px] text-slate-400">
                <span>${l.ts}</span>
                <span class="px-1.5 py-0.5 rounded border ${cls} text-[9px] uppercase font-bold">${l.type}</span>
            </div>
            <div class="text-slate-200 leading-snug">${l.msg}</div>
        </div>`;
    }).join("");
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function _ptSegDist(px, py, x1, y1, x2, y2) {
    const l2 = (x2-x1)**2 + (y2-y1)**2;
    if (l2 === 0) return Math.hypot(px-x1, py-y1);
    const t = Math.max(0, Math.min(1, ((px-x1)*(x2-x1) + (py-y1)*(y2-y1)) / l2));
    return Math.hypot(px - (x1+t*(x2-x1)), py - (y1+t*(y2-y1)));
}

function getNearestEdge(mx, my, thresh = 18) {
    let best = null, bestD = Infinity;
    EDGES.forEach(e => {
        const pts = e.waypoints;
        if (!pts || pts.length < 2) return;
        for (let i = 0; i < pts.length - 1; i++) {
            const d = _ptSegDist(mx, my, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
            if (d < thresh && d < bestD) { bestD = d; best = e; }
        }
    });
    return best;
}

function getNearestNode(mx, my, thresh = 22) {
    let best = null, bestD = Infinity;
    Object.values(NODES).forEach(n => {
        const d = Math.hypot(mx - n.x, my - n.y);
        if (d < thresh && d < bestD) { bestD = d; best = n; }
    });
    return best;
}

// ── Canvas Mouse Events ───────────────────────────────────────────────────────
function _canvasCoords(e) {
    const r  = canvas.getBoundingClientRect();
    return {
        mx: (e.clientX - r.left) * (canvas.width  / r.width),
        my: (e.clientY - r.top)  * (canvas.height / r.height),
    };
}

canvas.addEventListener("mousemove", e => {
    const { mx, my } = _canvasCoords(e);
    if (activeMode === "roadblock") {
        hoverEdge = getNearestEdge(mx, my);
        canvas.style.cursor = hoverEdge ? "pointer" : "crosshair";
    } else {
        hoverEdge = null;
        canvas.style.cursor = getNearestNode(mx, my) ? "pointer" : "default";
    }
});

canvas.addEventListener("click", e => {
    const { mx, my } = _canvasCoords(e);
    if (activeMode === "roadblock") {
        const edge = getNearestEdge(mx, my);
        if (edge) {
            const blocked = aiEngine.toggleRoadblock(edge.u, edge.v);
            simManager.onRoadblockToggled(edge.u, edge.v, blocked);
            _updateUI();
        }
    } else {
        // Check vehicles
        let hit = null;
        [...simManager.buses, ...simManager.vehicles].forEach(v => {
            if (Math.hypot(mx - v.x, my - v.y) < 18) hit = v;
        });
        if (!hit) hit = getNearestNode(mx, my);
        selectedEntity = hit || null;
        _updateInspector();
    }
});

// ── Main Render Loop ──────────────────────────────────────────────────────────
let lastTime = performance.now();

function render() {
    const now = performance.now();
    const dt  = Math.min((now - lastTime) / 1000, 0.1);
    lastTime  = now;

    simManager.update(dt);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Satellite background
    if (simManager.showSatellite && imageLoaded) {
        ctx.drawImage(mapImage, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(15,23,42,0.22)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = "#0F172A";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. Road network overlay (curved waypoints)
    if (simManager.showRoadOverlay) {
        EDGES.forEach(edge => {
            const pts     = edge.waypoints;
            if (!pts || pts.length < 2) return;
            const blocked = aiEngine.isEdgeBlocked(edge.u, edge.v);

            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);

            if (blocked) {
                ctx.strokeStyle = "#EF4444";
                ctx.lineWidth   = 7;
                ctx.shadowColor = "#EF4444";
                ctx.shadowBlur  = 10;
                ctx.stroke();

                ctx.setLineDash([8, 8]);
                ctx.strokeStyle = "#FEF08A";
                ctx.lineWidth   = 2;
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.shadowBlur = 0;

                // Barrier icon
                const mid = pts[Math.floor(pts.length / 2)];
                ctx.fillStyle = "#EF4444";
                ctx.beginPath();
                ctx.arc(mid[0], mid[1], 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#FFF";
                ctx.font = "bold 10px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("✕", mid[0], mid[1]);
            } else {
                ctx.strokeStyle = "rgba(148,163,184,0.45)";
                ctx.lineWidth   = 4;
                ctx.shadowBlur  = 0;
                ctx.stroke();
            }
        });
    }

    // 3. Hover edge highlight (roadblock mode)
    if (hoverEdge && activeMode === "roadblock") {
        const pts = hoverEdge.waypoints;
        if (pts && pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.strokeStyle = "#F59E0B";
            ctx.lineWidth   = 8;
            ctx.shadowColor = "#F59E0B";
            ctx.shadowBlur  = 12;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
    }

    // 4. Bus route polylines ahead-of-vehicle
    if (simManager.showBusRoutes) {
        simManager.buses.forEach(bus => {
            const wps = bus.waypoints;
            if (!wps || wps.length < 2 || bus.wpIdx >= wps.length) return;
            ctx.beginPath();
            ctx.moveTo(bus.x, bus.y);
            for (let i = bus.wpIdx + 1; i < wps.length; i++) ctx.lineTo(wps[i].x, wps[i].y);
            ctx.strokeStyle = bus.color;
            ctx.lineWidth   = 3.5;
            ctx.shadowColor = bus.color;
            ctx.shadowBlur  = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
        });
    }

    // 5. Nodes & bus stops
    Object.values(NODES).forEach(node => {
        const isStop = node.type === "stop";
        ctx.beginPath();
        ctx.arc(node.x, node.y, isStop ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isStop ? "#38BDF8" : "rgba(226,232,240,0.8)";
        ctx.fill();
        if (isStop) {
            ctx.strokeStyle = "#0284C7";
            ctx.lineWidth   = 2;
            ctx.stroke();
        }
        if (simManager.showNodeLabels) {
            ctx.fillStyle = isStop ? "#38BDF8" : "#94A3B8";
            ctx.font      = isStop ? "bold 11px sans-serif" : "9px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(
                isStop ? `🚏 ${node.stopName || node.name}` : `${node.id}`,
                node.x, node.y - (isStop ? 12 : 8)
            );
        }
    });

    // 6. Ambient vehicles
    simManager.vehicles.forEach(v => {
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.heading);
        if (v.type === "ambulance") {
            ctx.fillStyle = "#FFF";
            ctx.fillRect(-8, -4, 16, 8);
            ctx.fillStyle = "#EF4444";
            ctx.fillRect(-2, -4, 4, 8);
            ctx.fillRect(-6, -1, 12, 2);
            const flash = Math.floor(now / 200) % 2 === 0;
            ctx.fillStyle = flash ? "#3B82F6" : "#EF4444";
            ctx.beginPath();
            ctx.arc(0, 0, 3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = v.color;
            ctx.fillRect(-6, -3, 12, 6);
            ctx.fillStyle = "#334155";
            ctx.fillRect(-4, -2, 4, 4);
        }
        ctx.restore();
    });

    // 7. Buses
    simManager.buses.forEach(bus => {
        ctx.save();
        ctx.translate(bus.x, bus.y);
        ctx.rotate(bus.heading);

        ctx.fillStyle   = bus.color;
        ctx.shadowColor = bus.color;
        ctx.shadowBlur  = bus.status === "Rerouting" ? 16 : 6;
        ctx.beginPath();
        ctx.roundRect(-13, -7, 26, 14, 3);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = "#FFF";
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        // Windshield
        ctx.fillStyle = "#0F172A";
        ctx.fillRect(5, -6, 5, 12);

        ctx.restore();

        // Label tag
        ctx.fillStyle = "rgba(15,23,42,0.88)";
        ctx.beginPath();
        ctx.roundRect(bus.x - 24, bus.y - 26, 48, 16, 4);
        ctx.fill();
        ctx.strokeStyle = bus.color;
        ctx.lineWidth   = 1;
        ctx.stroke();

        ctx.fillStyle    = "#FFF";
        ctx.font         = "bold 9px sans-serif";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(bus.id, bus.x, bus.y - 18);

        // Rerouting badge
        if (bus.status === "Rerouting") {
            ctx.fillStyle = "#F59E0B";
            ctx.beginPath();
            ctx.arc(bus.x + 20, bus.y - 24, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle    = "#000";
            ctx.font         = "bold 8px sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText("⚡", bus.x + 20, bus.y - 24);
        }

        // At-stop badge
        if (bus.status === "At Stop") {
            ctx.fillStyle = "#38BDF8";
            ctx.beginPath();
            ctx.arc(bus.x + 20, bus.y - 24, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle    = "#000";
            ctx.font         = "bold 7px sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText("🚏", bus.x + 20, bus.y - 24);
        }
    });

    // 8. Selection ring
    if (selectedEntity) {
        ctx.beginPath();
        ctx.arc(selectedEntity.x, selectedEntity.y, 24, 0, Math.PI * 2);
        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _updateStats();
    requestAnimationFrame(render);
}

// ── Dashboard helpers ─────────────────────────────────────────────────────────
function _updateStats() {
    const el1 = document.getElementById("statActiveBuses");
    const el2 = document.getElementById("statRoadblocks");
    const el3 = document.getElementById("statReroutes");
    if (el1) el1.innerText = simManager.buses.length;
    if (el2) el2.innerText = aiEngine.blockedEdges.size;
    if (el3) el3.innerText = simManager.buses.reduce((a, b) => a + b.rerouteCount, 0);
    _updateFleetTable();
}

function _updateFleetTable() {
    const tbody = document.getElementById("fleetTableBody");
    if (!tbody) return;
    tbody.innerHTML = simManager.buses.map(b => {
        let badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Normal</span>`;
        if (b.status === "Rerouting") badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">⚡ Rerouting</span>`;
        if (b.status === "Blocked")   badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">🛑 Blocked</span>`;
        if (b.status === "At Stop")   badge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">🚏 At Stop</span>`;

        const nextName = NODES[b.toStop]?.stopName || `Node ${b.toStop}`;
        return `<tr class="border-b border-slate-800/60 hover:bg-slate-800/40 text-xs transition-colors">
            <td class="py-2.5 px-3 font-semibold flex items-center space-x-2">
                <span class="w-2.5 h-2.5 rounded-full inline-block" style="background-color:${b.color}"></span>
                <span>${b.id}</span>
            </td>
            <td class="py-2.5 px-3 text-slate-300 truncate max-w-[110px]">${b.name}</td>
            <td class="py-2.5 px-3 text-slate-300 text-[11px]">${nextName}</td>
            <td class="py-2.5 px-3">${badge}</td>
            <td class="py-2.5 px-3 text-right font-mono text-slate-400">${b.rerouteCount}</td>
            <td class="py-2.5 px-3 text-right">
                <button onclick="trackBus('${b.id}')" class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] border border-slate-700">Track</button>
            </td>
        </tr>`;
    }).join("");
}

function _updateInspector() {
    const el = document.getElementById("inspectorContent");
    if (!el) return;
    if (!selectedEntity) {
        el.innerHTML = `<div class="text-slate-500 text-xs text-center py-6">Click any bus, vehicle, or node on the map.</div>`;
        return;
    }
    if (selectedEntity.stops) {
        // Bus
        const b = selectedEntity;
        el.innerHTML = `<div class="space-y-3">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                    <span class="w-3 h-3 rounded-full" style="background-color:${b.color}"></span>
                    <span class="font-bold text-sm">${b.id}</span>
                </div>
                <span class="text-xs text-slate-400">${b.passengers} pax</span>
            </div>
            <div class="text-xs text-slate-300">${b.name}</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
                <div class="p-2 rounded bg-slate-900 border border-slate-800">
                    <div class="text-[10px] text-slate-500">Status</div>
                    <div class="font-semibold text-slate-200 mt-0.5">${b.status}</div>
                </div>
                <div class="p-2 rounded bg-slate-900 border border-slate-800">
                    <div class="text-[10px] text-slate-500">Reroutes</div>
                    <div class="font-semibold text-amber-400 mt-0.5">${b.rerouteCount}</div>
                </div>
            </div>
            <div class="text-[10px] text-slate-500 mb-1">Circular Route:</div>
            <div class="space-y-1">
                ${b.stops.map((sId, idx) => `
                <div class="flex items-center justify-between px-2 py-1 rounded bg-slate-900/80 text-[11px]">
                    <span class="text-slate-300">Stop ${idx+1}: ${NODES[sId]?.stopName || 'Node '+sId}</span>
                    ${sId === b.toStop ? '<span class="text-sky-400 font-bold text-[9px]">▶ NEXT</span>' : ''}
                </div>`).join("")}
            </div>
        </div>`;
    } else if (selectedEntity.type) {
        // Node
        const n = selectedEntity;
        el.innerHTML = `<div class="space-y-2">
            <div class="font-bold text-sm">${n.stopName || n.name}</div>
            <div class="text-xs text-slate-400 font-mono">Node ${n.id} • (${n.x}, ${n.y})</div>
            <div class="text-xs text-slate-400 capitalize">Type: ${n.type}</div>
        </div>`;
    }
}

function _updateUI() { _updateStats(); _updateInspector(); }

// ── Global Controls ───────────────────────────────────────────────────────────
window.setMode = function(mode) {
    activeMode = mode;
    document.getElementById("btnModeSelect").classList.toggle("bg-sky-500/30",   mode === "select");
    document.getElementById("btnModeSelect").classList.toggle("border-sky-500",  mode === "select");
    document.getElementById("btnModeSelect").classList.toggle("text-sky-300",    mode === "select");
    document.getElementById("btnModeBlock").classList.toggle("bg-red-500/30",   mode === "roadblock");
    document.getElementById("btnModeBlock").classList.toggle("border-red-500",  mode === "roadblock");
    document.getElementById("btnModeBlock").classList.toggle("text-red-300",    mode === "roadblock");
    if (mode === "roadblock")
        addLog("[Mode] Roadblock mode ON — click any road to block/unblock.", "warning");
};

window.clearAllRoadblocks = function() {
    aiEngine.blockedEdges.clear();
    simManager.buses.forEach(b => b.recalculateRoute(aiEngine));
    addLog("[Cleared] All roadblocks removed.", "success");
    _updateUI();
};

window.spawnBus = function() { simManager.addRandomBus(); };
window.spawnAmbulance = function() { simManager.addEmergencyVehicle(); };

window.togglePause = function() {
    simManager.isPaused = !simManager.isPaused;
    const btn = document.getElementById("btnPause");
    if (btn) btn.innerText = simManager.isPaused ? "▶ Resume" : "⏸ Pause";
};

window.setSpeed = function(f) {
    simManager.speedFactor = f;
    addLog(`[Sim] Speed set to ${f}x.`, "info");
};

window.trackBus = function(busId) {
    const b = simManager.buses.find(b => b.id === busId);
    if (b) { selectedEntity = b; _updateInspector(); }
};

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    addLog("[Init] Plammoodu/Canal AI Bus Rerouting System started.", "success");
    addLog("[Routes] BUS-101: South Loop  |  BUS-202: North Corridor  |  BUS-303: East-West Cross", "info");
    render();
});
