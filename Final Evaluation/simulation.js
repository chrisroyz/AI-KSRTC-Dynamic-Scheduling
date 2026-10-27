// ─────────────────────────────────────────────────────────────────────────────
// simulation.js  —  Completely rebuilt, minimal, bullet-proof bus loop logic
// ─────────────────────────────────────────────────────────────────────────────

// ── Base Vehicle ──────────────────────────────────────────────────────────────
class Vehicle {
    constructor(id, type, color, speed) {
        this.id      = id;
        this.type    = type;
        this.color   = color;
        this.speed   = speed;

        // Waypoints: [{x, y, nodeFrom, nodeTo}, ...]  built from a node-path
        this.waypoints = [];
        this.wpIdx     = 0;      // current sub-segment start index
        this.progress  = 0;      // 0→1 along waypoints[wpIdx]→waypoints[wpIdx+1]

        this.x       = 0;
        this.y       = 0;
        this.heading = 0;

        this.status  = "Normal";
        this.stuck   = false;
    }

    // Build fine-grained waypoints from a node-path using the road graph
    _buildWaypoints(nodePath) {
        if (!nodePath || nodePath.length < 2) return [];
        const pts = [];
        for (let i = 0; i < nodePath.length - 1; i++) {
            const uId = nodePath[i];
            const vId = nodePath[i + 1];
            const edgeData = (ROAD_GRAPH[uId] || []).find(e => e.to === vId);
            const wps = edgeData && edgeData.waypoints && edgeData.waypoints.length
                ? edgeData.waypoints
                : [[NODES[uId].x, NODES[uId].y], [NODES[vId].x, NODES[vId].y]];

            wps.forEach((pt, pIdx) => {
                if (pIdx === 0 && pts.length > 0) return; // skip duplicate
                pts.push({ x: pt[0], y: pt[1], nodeFrom: uId, nodeTo: vId });
            });
        }
        return pts;
    }

    // Load a new node-path, rebuilding the fine waypoints
    loadPath(nodePath) {
        this.waypoints = this._buildWaypoints(nodePath);
        this.wpIdx     = 0;
        this.progress  = 0;
        this.stuck     = this.waypoints.length < 2;
        if (this.waypoints.length > 0) {
            this.x = this.waypoints[0].x;
            this.y = this.waypoints[0].y;
        }
    }

    // Returns which road-edge the vehicle is currently on
    currentEdge() {
        if (!this.waypoints.length || this.wpIdx >= this.waypoints.length - 1) return null;
        return { u: this.waypoints[this.wpIdx].nodeFrom, v: this.waypoints[this.wpIdx].nodeTo };
    }

    // Called by subclass when vehicle reaches the LAST waypoint
    onArrived() {}

    // Called by subclass when a blocked edge is detected ahead
    onBlocked(pathfinder) {}

    update(dt, pathfinder) {
        if (this.stuck) return;

        // ── Blocked edge check ──────────────────────────────────────────────
        const edge = this.currentEdge();
        if (edge && pathfinder.isEdgeBlocked(edge.u, edge.v)) {
            this.onBlocked(pathfinder);
            return;
        }

        // ── Nothing more to traverse ────────────────────────────────────────
        if (this.waypoints.length < 2 || this.wpIdx >= this.waypoints.length - 1) {
            this.onArrived();
            return;
        }

        // ── Move along current sub-segment ──────────────────────────────────
        const A = this.waypoints[this.wpIdx];
        const B = this.waypoints[this.wpIdx + 1];
        const dx = B.x - A.x, dy = B.y - A.y;
        const segLen = Math.hypot(dx, dy);

        if (segLen === 0) { this.wpIdx++; return; }

        this.heading  = Math.atan2(dy, dx);
        this.progress += (this.speed * dt * 35) / segLen;

        if (this.progress >= 1) {
            this.progress = 0;
            this.wpIdx++;
            if (this.wpIdx < this.waypoints.length) {
                this.x = this.waypoints[this.wpIdx].x;
                this.y = this.waypoints[this.wpIdx].y;
            }
            // Finished last sub-segment → arrived
            if (this.wpIdx >= this.waypoints.length - 1) {
                this.onArrived();
            }
        } else {
            this.x = A.x + dx * this.progress;
            this.y = A.y + dy * this.progress;
        }
    }
}

// ── Bus ───────────────────────────────────────────────────────────────────────
class Bus extends Vehicle {
    constructor(preset) {
        super(preset.id, "bus", preset.color, preset.speed);
        this.name        = preset.name;
        this.stops       = preset.stops;  // [nodeId, ...]  — circular, no repeat
        this.stopCount   = this.stops.length;
        this.passengers  = preset.passengers || 40;
        this.rerouteCount = 0;

        // Which stop are we departing from / arriving at
        const off = (preset.startOffset || 0) % this.stopCount;
        this.fromIdx = off;
        this.toIdx   = (off + 1) % this.stopCount;

        // Wait-frame counter (> 0 means "paused at a stop")
        this._waitFrames = 0;

        this._loadNextSegment(aiEngine);
    }

    get fromStop() { return this.stops[this.fromIdx]; }
    get toStop()   { return this.stops[this.toIdx]; }

    // Alias used by inspector / fleet table
    get nextTargetStopId() { return this.toStop; }

    _loadNextSegment(pathfinder) {
        const res = pathfinder.findPath(this.fromStop, this.toStop);
        if (res && res.path && res.path.length >= 2) {
            this.loadPath(res.path);
            this.stuck  = false;
            if (this.status !== "At Stop") this.status = "Normal";
            return true;
        }
        // No path found
        this.stuck  = true;
        this.status = "Blocked";
        if (window.addLog) window.addLog(
            `[AI Alert] ${this.id}: no path ${this.fromStop}→${this.toStop}!`, "danger");
        return false;
    }

    // Called when we finish the current segment (arrived at toStop)
    onArrived() {
        if (this._waitFrames > 0) return;   // already waiting

        // Advance stop indices
        this.fromIdx = this.toIdx;
        this.toIdx   = (this.toIdx + 1) % this.stopCount;

        this.status       = "At Stop";
        this._waitFrames  = 90;              // ~3 sec at 30fps equivalent
        this.passengers   = Math.max(10, Math.min(80,
            this.passengers + Math.floor(Math.random() * 11) - 5));

        const stopName = NODES[this.fromStop]?.stopName || `Node ${this.fromStop}`;
        if (window.addLog) window.addLog(
            `[Stop] ${this.id} arrived at ${stopName}. Pax: ${this.passengers}`, "info");
    }

    // Called when there's a roadblock on the current edge
    onBlocked(pathfinder) {
        this.status = "Rerouting";
        this.rerouteCount++;

        const edge    = this.currentEdge();
        const avoidKey = edge ? getEdgeKey(edge.u, edge.v) : null;
        const fromNode = edge ? edge.u : this.fromStop;

        const res = pathfinder.findPath(fromNode, this.toStop, { avoidEdgeKey: avoidKey });
        if (res && res.path && res.path.length >= 2) {
            this.loadPath(res.path);
            this.stuck  = false;
            const via = res.roadNames?.[0] || "alternate road";
            if (window.addLog) window.addLog(
                `[AI Reroute] ${this.id} detoured via ${via}.`, "warning");
        } else {
            this.stuck  = true;
            this.status = "Blocked";
            if (window.addLog) window.addLog(
                `[AI Alert] ${this.id} fully blocked!`, "danger");
        }
    }

    // Re-plan from current position (called on roadblock clear or global reroute)
    recalculateRoute(pathfinder) {
        const edge     = this.currentEdge();
        const fromNode = edge ? edge.u : this.fromStop;
        const res      = pathfinder.findPath(fromNode, this.toStop);
        if (res && res.path && res.path.length >= 2) {
            this.loadPath(res.path);
            this.stuck  = false;
            if (this.status !== "At Stop") this.status = "Normal";
        }
    }

    update(dt, pathfinder) {
        // ── Waiting at stop ─────────────────────────────────────────────────
        if (this._waitFrames > 0) {
            this._waitFrames--;
            if (this._waitFrames === 0) {
                this.status = "Normal";
                this._loadNextSegment(pathfinder); // load path to next stop
            }
            return;
        }
        super.update(dt, pathfinder);
    }
}

// ── Ambient Vehicle (car / auto / ambulance) ──────────────────────────────────
class AmbientVehicle extends Vehicle {
    constructor(id, type, startNodeId, endNodeId, color, speed) {
        super(id, type, color, speed);
        this.startNode = startNodeId;
        this.endNode   = endNodeId;
        this._loadPath(aiEngine);
    }

    _loadPath(pathfinder) {
        const res = pathfinder.findPath(this.startNode, this.endNode);
        if (res && res.path && res.path.length >= 2) {
            this.loadPath(res.path);
        }
    }

    onArrived() {
        // Bounce: swap endpoints
        const tmp      = this.startNode;
        this.startNode = this.endNode;
        this.endNode   = tmp;
        this._loadPath(aiEngine);
    }

    onBlocked(pathfinder) {
        const edge     = this.currentEdge();
        const fromNode = edge ? edge.u : this.startNode;
        const res      = pathfinder.findPath(fromNode, this.endNode);
        if (res && res.path && res.path.length >= 2) {
            this.loadPath(res.path);
        } else {
            // Swap and try reverse
            const tmp      = this.startNode;
            this.startNode = this.endNode;
            this.endNode   = tmp;
            this._loadPath(pathfinder);
        }
    }
}

// ── Simulation Manager ────────────────────────────────────────────────────────
class SimulationManager {
    constructor() {
        this.buses    = [];
        this.vehicles = [];

        this.speedFactor     = 1.0;
        this.isPaused        = false;
        this.showSatellite   = true;
        this.showRoadOverlay = true;
        this.showNodeLabels  = true;
        this.showBusRoutes   = true;

        this._initFleet();
        this._initAmbient();
    }

    _initFleet() {
        this.buses = PRESET_BUS_ROUTES.map(p => new Bus(p));
    }

    _initAmbient() {
        // Keep ambient vehicles on well-connected interior nodes
        this.vehicles = [
            new AmbientVehicle("CAR-1",       "car",       9,  19, "#F59E0B", 2.0),
            new AmbientVehicle("CAR-2",       "car",       18, 23, "#8B5CF6", 1.9),
            new AmbientVehicle("AUTO-1",      "auto",      16, 10, "#EC4899", 1.4),
            new AmbientVehicle("AMBULANCE-1", "ambulance", 28, 14, "#EF4444", 2.8),
            new AmbientVehicle("CAR-3",       "car",       22, 18, "#10B981", 1.7),
        ];
    }

    addRandomBus() {
        const nextId    = `BUS-${Math.floor(100 + Math.random() * 900)}`;
        const colors    = ["#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#14B8A6"];
        const allStops  = [5, 14, 18, 23, 28, 13];
        const shuffled  = [...allStops].sort(() => 0.5 - Math.random());
        const selected  = shuffled.slice(0, 3 + Math.floor(Math.random() * 2));
        const newPreset = {
            id: nextId,
            name: `Route ${nextId.replace("BUS-", "")} - Custom`,
            color: colors[Math.floor(Math.random() * colors.length)],
            stops: selected,
            speed: 1.4 + Math.random() * 0.8,
            passengers: Math.floor(20 + Math.random() * 40),
        };
        const bus = new Bus(newPreset);
        this.buses.push(bus);
        if (window.addLog) window.addLog(`[Fleet] Deployed ${bus.id} on custom route.`, "info");
        return bus;
    }

    addEmergencyVehicle() {
        const id    = `AMB-${Math.floor(10 + Math.random() * 90)}`;
        const pairs = [[28,5],[14,23],[18,13]];
        const [s, e] = pairs[Math.floor(Math.random() * pairs.length)];
        const amb = new AmbientVehicle(id, "ambulance", s, e, "#EF4444", 3.0);
        this.vehicles.push(amb);
        if (window.addLog) window.addLog(`[Emergency] Dispatch ${id} launched.`, "danger");
    }

    onRoadblockToggled(u, v, isBlocked) {
        const key      = getEdgeKey(u, v);
        const roadName = (ROAD_GRAPH[u] || []).find(e => e.to === v)?.roadName || "Road Segment";

        if (isBlocked) {
            if (window.addLog) window.addLog(`[Roadblock] Blocked: ${roadName} (${u}↔${v}).`, "danger");
        } else {
            if (window.addLog) window.addLog(`[Cleared] Opened: ${roadName} (${u}↔${v}).`, "success");
        }

        // Recalculate for every bus whose path contains the toggled edge
        this.buses.forEach(bus => {
            const affected = bus.waypoints.some(wp =>
                getEdgeKey(wp.nodeFrom, wp.nodeTo) === key);
            if (affected || !isBlocked) bus.recalculateRoute(aiEngine);
        });
        this.vehicles.forEach(v => v.onBlocked(aiEngine));
    }

    update(dt) {
        if (this.isPaused) return;
        const eff = dt * this.speedFactor;
        this.buses.forEach(b => b.update(eff, aiEngine));
        this.vehicles.forEach(v => v.update(eff, aiEngine));
    }
}

const simManager = new SimulationManager();
