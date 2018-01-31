VECTOR turret_vertex[] = {
 { -12, -12, 48 },
 { 12, -12, 48 },
 { -12, 12, 48 },
 { 12, 12, 48 },
 { -60, -36, -24 },
 { 60, -36, -24 },
 { -60, 36, -24 },
 { 60, 36, -24 },
 { 0, 0, -48 },
 { -12, -12, 96 },
 { 12, -12, 96 },
 { -12, 12, 96 },
 { 12, 12, 96 },
};
SPOLY turret_spoly[] = {
 { 4, 4, { 2, 3, 1, 0,}},
 { 24, 4, { 0, 1, 5, 4,}},
 { 7, 4, { 4, 6, 2, 0,}},
 { 7, 4, { 1, 3, 7, 5,}},
 { 24, 4, { 6, 7, 3, 2,}},
 { 7, 3, { 4, 5, 8,}},
 { 24, 3, { 8, 6, 4,}},
 { 24, 3, { 5, 7, 8,}},
 { 7, 3, { 8, 7, 6,}},
 { 15, 2, { 0, 9,}},
 { 15, 2, { 1, 10,}},
 { 15, 2, { 2, 11,}},
 { 15, 2, { 3, 12,}},
 { 15, 2, { 9, 10,}},
 { 15, 2, { 9, 11,}},
 { 15, 2, { 10, 12,}},
 { 15, 2, { 11, 12,}},
};
SHAPE turret_shape = {
0,13,17,
turret_vertex,
turret_spoly
};