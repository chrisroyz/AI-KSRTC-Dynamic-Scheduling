// AI Pathfinding & Dynamic Rerouting Engine (A* / Dijkstra)

class PathfindingEngine {
    constructor() {
        this.blockedEdges = new Set(); // Stores edge keys "minNode-maxNode"
        this.edgeTrafficWeights = new Map(); // Maps edge key to weight multiplier (1.0 = normal, 3.0 = heavy traffic)
    }

    // Toggle a roadblock on segment (u, v)
    toggleRoadblock(u, v) {
        const key = getEdgeKey(u, v);
        if (this.blockedEdges.has(key)) {
            this.blockedEdges.delete(key);
            return false; // Removed
        } else {
            this.blockedEdges.add(key);
            return true; // Added
        }
    }

    isEdgeBlocked(u, v) {
        return this.blockedEdges.has(getEdgeKey(u, v));
    }

    setEdgeTraffic(u, v, multiplier) {
        const key = getEdgeKey(u, v);
        this.edgeTrafficWeights.set(key, Math.max(1.0, multiplier));
    }

    getEdgeCost(u, v, baseDist) {
        const key = getEdgeKey(u, v);
        if (this.blockedEdges.has(key)) {
            return Infinity;
        }
        const trafficMult = this.edgeTrafficWeights.get(key) || 1.0;
        return baseDist * trafficMult;
    }

    // Heuristic function for A* (Euclidean Distance to target)
    heuristic(nodeId, targetId) {
        const n = NODES[nodeId];
        const target = NODES[targetId];
        if (!n || !target) return 0;
        const dx = n.x - target.x;
        const dy = n.y - target.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // A* Pathfinding from startId to targetId
    findPath(startId, targetId, options = {}) {
        const avoidEdgeKey = options.avoidEdgeKey || null;

        if (!NODES[startId] || !NODES[targetId]) return null;
        if (startId === targetId) return { path: [startId], totalDist: 0, roadNames: [] };

        const openSet = new Set([startId]);
        const gScore = {};
        const fScore = {};
        const cameFrom = {};

        Object.keys(NODES).forEach(id => {
            const numId = Number(id);
            gScore[numId] = Infinity;
            fScore[numId] = Infinity;
        });

        gScore[startId] = 0;
        fScore[startId] = this.heuristic(startId, targetId);

        while (openSet.size > 0) {
            // Get node in openSet with lowest fScore
            let current = null;
            let lowestF = Infinity;
            openSet.forEach(id => {
                if (fScore[id] < lowestF) {
                    lowestF = fScore[id];
                    current = id;
                }
            });

            if (current === targetId) {
                // Reconstruct Path
                const path = [current];
                const roadNames = [];
                let currTrack = current;
                while (cameFrom[currTrack] !== undefined) {
                    const prevTrack = cameFrom[currTrack];
                    path.unshift(prevTrack);
                    
                    // Find road name for this segment
                    const neighbors = ROAD_GRAPH[prevTrack] || [];
                    const edgeData = neighbors.find(e => e.to === currTrack);
                    if (edgeData) roadNames.unshift(edgeData.roadName);

                    currTrack = prevTrack;
                }
                return {
                    path: path,
                    totalDist: gScore[targetId],
                    roadNames: roadNames
                };
            }

            openSet.delete(current);

            const neighbors = ROAD_GRAPH[current] || [];
            for (let edge of neighbors) {
                const neighbor = edge.to;
                const edgeKey = getEdgeKey(current, neighbor);

                // Skip if this edge is globally blocked or requested to be avoided
                if (this.blockedEdges.has(edgeKey) || edgeKey === avoidEdgeKey) {
                    continue;
                }

                const cost = this.getEdgeCost(current, neighbor, edge.dist);
                if (cost === Infinity) continue;

                const tentativeG = gScore[current] + cost;

                if (tentativeG < gScore[neighbor]) {
                    cameFrom[neighbor] = current;
                    gScore[neighbor] = tentativeG;
                    fScore[neighbor] = tentativeG + this.heuristic(neighbor, targetId);
                    openSet.add(neighbor);
                }
            }
        }

        // Return null if no path exists
        return null;
    }

    // Calculates multi-stop route sequence
    findMultiStopRoute(stopIds) {
        if (!stopIds || stopIds.length < 2) return null;

        let fullPath = [];
        let totalDistance = 0;
        let roadNames = [];

        for (let i = 0; i < stopIds.length - 1; i++) {
            const start = stopIds[i];
            const end = stopIds[i + 1];
            const segment = this.findPath(start, end);

            if (!segment) {
                return null; // Route disconnected due to roadblocks
            }

            if (i === 0) {
                fullPath.push(...segment.path);
            } else {
                fullPath.push(...segment.path.slice(1));
            }
            totalDistance += segment.totalDist;
            roadNames.push(...segment.roadNames);
        }

        return {
            path: fullPath,
            totalDist: totalDistance,
            roadNames: Array.from(new Set(roadNames))
        };
    }
}

// Global Pathfinding Instance
const aiEngine = new PathfindingEngine();
