VECTOR TURRET3_vertex[] = {
 { -48, 0, 0 },
 { -72, 72, -24 },
 { -72, 72, 24 },
 { 48, 0, 0 },
 { 72, 72, -24 },
 { 72, 72, 24 },
 { -24, 72, -72 },
 { 24, 72, -72 },
 { -24, 72, 72 },
 { 24, 72, 72 },
};
SPOLY TURRET3_spoly[] = {
 { 15, 2, { 0, 1, -1,}},
 { 15, 2, { 0, 2, -1,}},
 { 15, 2, { 1, 2, -1,}},
 { 15, 2, { 3, 4, -1,}},
 { 15, 2, { 3, 5, -1,}},
 { 15, 2, { 4, 5, -1,}},
 { 15, 2, { 2, 8, -1,}},
 { 15, 2, { 5, 9, -1,}},
 { 15, 2, { 4, 7, -1,}},
 { 15, 2, { 1, 6, -1,}},
 { 15, 2, { 6, 7, -1,}},
 { 15, 2, { 8, 9, -1,}},
};
SHAPE TURRET3_shape = {
0,10,12,
TURRET3_vertex,
TURRET3_spoly
};
