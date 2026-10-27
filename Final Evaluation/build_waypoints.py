import cv2
import numpy as np
import json

mask = cv2.imread(r'd:\code\ai-bus-rerouting\road_mask.png', cv2.IMREAD_GRAYSCALE)

nodes = {
    1: (65, 35), 2: (65, 230), 3: (65, 480), 4: (65, 680), 5: (65, 850),
    6: (150, 850), 7: (230, 750), 8: (150, 690), 9: (240, 685), 10: (330, 690),
    11: (460, 890), 12: (630, 890), 13: (880, 890), 14: (180, 500), 15: (260, 480),
    16: (380, 520), 17: (270, 600), 18: (340, 600), 19: (500, 605), 20: (660, 610),
    21: (750, 660), 22: (830, 615), 23: (880, 520), 24: (980, 520), 25: (170, 230),
    26: (280, 260), 27: (380, 210), 28: (480, 215), 29: (620, 210), 30: (770, 210),
    31: (960, 210), 32: (200, 20), 33: (380, 20), 34: (490, 20), 35: (660, 20),
    36: (820, 20), 37: (960, 20), 38: (270, 360), 39: (470, 340), 40: (640, 310),
    41: (780, 330), 42: (960, 330), 43: (780, 770), 44: (960, 770)
}

edges_raw = [
    (1, 2, 'Highway West'), (2, 3, 'Highway West'), (3, 4, 'Highway West'), (4, 5, 'Highway West'),
    (5, 6, 'Plammoodu Main Rd'), (6, 7, 'Plammoodu East Ave'), (4, 8, 'South Link 1'), (8, 9, 'South Link 2'),
    (9, 10, 'South Main St'), (7, 9, 'Plammoodu Connector'), (6, 11, 'South Bypass'), (11, 12, 'South Bypass'),
    (12, 13, 'SE Hub Connector'), (3, 14, 'Canal West Feeder'), (14, 15, 'Canal Road'), (15, 16, 'Canal Road'),
    (14, 17, 'Canal South Cut'), (17, 18, 'Canal South Cut'), (8, 17, 'South Canal Cross'), (9, 18, 'Central Connector'),
    (10, 19, 'South East Main'), (16, 19, 'Canal East Cross'), (19, 20, 'East Central Rd'), (20, 21, 'Curved Loop Rd'),
    (21, 22, 'Curved Loop Rd'), (20, 22, 'Loop Shortcut'), (22, 23, 'East Market Rd'), (23, 24, 'Far East Rd'),
    (12, 43, 'SE Neighborhood Link'), (43, 44, 'SE Outer Link'), (22, 43, 'Loop South Link'), (15, 38, 'Canal North Cut'),
    (2, 25, 'NW Suburb Link'), (25, 26, 'NW Cross Rd'), (26, 38, 'NW Mid Connector'), (16, 39, 'Central North Ave'),
    (39, 28, 'North Hub Link'), (38, 27, 'NW North Link'), (27, 28, 'North Main Rd'), (28, 29, 'North Main Rd'),
    (29, 30, 'NE Main Rd'), (30, 31, 'NE Main Rd'), (20, 40, 'Center East Cut'), (40, 29, 'NE Cross Link'),
    (23, 41, 'East Market North'), (41, 30, 'NE Feeder Link'), (24, 42, 'Far East North Link'), (42, 31, 'NE Outer Link'),
    (25, 32, 'North Exit 1 Link'), (27, 33, 'North Exit 2 Link'), (28, 34, 'North Exit 3 Link'), (29, 35, 'North Exit 4 Link'),
    (30, 36, 'North Exit 5 Link'), (31, 37, 'North Exit 6 Link')
]

def get_snapped_waypoints(u_id, v_id):
    p1 = nodes[u_id]
    p2 = nodes[v_id]
    dist = np.hypot(p2[0]-p1[0], p2[1]-p1[1])
    n_pts = max(2, int(round(dist / 20)))
    
    pts = []
    for i, t in enumerate(np.linspace(0, 1, n_pts)):
        if i == 0:
            pts.append([float(p1[0]), float(p1[1])])
            continue
        if i == n_pts - 1:
            pts.append([float(p2[0]), float(p2[1])])
            continue

        cx = int(round(p1[0] + t * (p2[0] - p1[0])))
        cy = int(round(p1[1] + t * (p2[1] - p1[1])))
        
        win = mask[max(0, cy-10):min(mask.shape[0], cy+11), max(0, cx-10):min(mask.shape[1], cx+11)]
        if np.sum(win) > 0:
            indices = np.argwhere(win > 0)
            avg_y = cy - 10 + np.mean(indices[:, 0])
            avg_x = cx - 10 + np.mean(indices[:, 1])
            pts.append([round(float(avg_x), 1), round(float(avg_y), 1)])
        else:
            pts.append([float(cx), float(cy)])
    return pts

edges_processed = []
for u, v, rname in edges_raw:
    wpts = get_snapped_waypoints(u, v)
    edges_processed.append({'u': u, 'v': v, 'roadName': rname, 'waypoints': wpts})

js_code = '''// Map Data & Road Network Graph for Plammoodu / Canal Area
// Image dimensions: 1024 x 897

const MAP_WIDTH = 1024;
const MAP_HEIGHT = 897;

// Intersection & Junction Nodes
const NODES = {
'''

for nid, (nx, ny) in nodes.items():
    ntype = 'stop' if nid in [5, 13, 14, 18, 23, 28] else 'junction'
    sname = ''
    if nid == 5: sname = 'Plammoodu Terminal'
    elif nid == 13: sname = 'SE Hub Depot'
    elif nid == 14: sname = 'Canal West Stop'
    elif nid == 18: sname = 'Central Plaza'
    elif nid == 23: sname = 'East Market Terminal'
    elif nid == 28: sname = 'North Interchange Hub'
    
    stop_attr = f', stopName: "{sname}"' if sname else ''
    js_code += f'    {nid}: {{ id: {nid}, name: "Node {nid}", x: {nx}, y: {ny}, type: "{ntype}"{stop_attr} }},\n'

js_code += '''};

// Edges connecting nodes with detailed road curve waypoints
const EDGES = ''' + json.dumps(edges_processed, indent=4) + ''';

// Helper to calculate Euclidean distance between two nodes
function getNodeDistance(nodeA, nodeB) {
    const dx = nodeA.x - nodeB.x;
    const dy = nodeA.y - nodeB.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Build adjacency graph with calculated distances & waypoints
const ROAD_GRAPH = {};
Object.keys(NODES).forEach(id => {
    ROAD_GRAPH[id] = [];
});

EDGES.forEach(edge => {
    const u = NODES[edge.u];
    const v = NODES[edge.v];
    const dist = Math.round(getNodeDistance(u, v));
    const edgeKey1 = `${edge.u}-${edge.v}`;
    const edgeKey2 = `${edge.v}-${edge.u}`;

    ROAD_GRAPH[edge.u].push({
        to: edge.v,
        dist: dist,
        roadName: edge.roadName,
        edgeKey: edgeKey1,
        u: edge.u,
        v: edge.v,
        waypoints: edge.waypoints
    });

    // Reverse waypoints for v -> u
    const revWaypoints = [...edge.waypoints].reverse();

    ROAD_GRAPH[edge.v].push({
        to: edge.u,
        dist: dist,
        roadName: edge.roadName,
        edgeKey: edgeKey2,
        u: edge.v,
        v: edge.u,
        waypoints: revWaypoints
    });
});

// Helper to get normalized edge key regardless of order
function getEdgeKey(u, v) {
    const min = Math.min(u, v);
    const max = Math.max(u, v);
    return `${min}-${max}`;
}

// Default Bus Line Presets
const PRESET_BUS_ROUTES = [
    {
        id: "BUS-101",
        name: "Route 101 - Plammoodu Circular",
        color: "#EF4444", // Red
        stops: [5, 14, 18, 23, 28, 5],
        speed: 1.8,
        passengers: 42
    },
    {
        id: "BUS-202",
        name: "Route 202 - Canal and SE Feeder",
        color: "#3B82F6", // Blue
        stops: [13, 18, 14, 28, 23, 13],
        speed: 1.6,
        passengers: 35
    },
    {
        id: "BUS-303",
        name: "Route 303 - North Express",
        color: "#10B981", // Emerald
        stops: [5, 3, 28, 30, 23, 13, 5],
        speed: 2.2,
        passengers: 58
    }
];
'''

with open(r'd:\code\ai-bus-rerouting\map-data.js', 'w') as f:
    f.write(js_code)

print('Updated map-data.js with precision road curve waypoints!')
