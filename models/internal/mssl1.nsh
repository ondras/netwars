VECTOR MSSL1_vertex[] = {
 { 0, 0, 96 },
 { -24, -24, 24 },
 { 24, -24, 24 },
 { -24, 24, 24 },
 { 24, 24, 24 },
 { -24, -24, -96 },
 { 24, -24, -96 },
 { -24, 24, -96 },
 { 24, 24, -96 },
 { -72, 72, -72 },
 { -24, 24, -48 },
 { 72, 72, -72 },
 { 24, 24, -48 },
 { -72, -72, -72 },
 { -24, -24, -48 },
 { 72, -72, -72 },
 { 24, -24, -48 },
};
SPOLY MSSL1_spoly[] = {
 { 15, 3, { 2, 1, 0,}},
 { 7, 3, { 0, 1, 3,}},
 { 15, 3, { 0, 3, 4,}},
 { 7, 3, { 4, 2, 0,}},
 { 12, 4, { 1, 2, 6, 5,}},
 { 4, 4, { 5, 7, 3, 1,}},
 { 4, 4, { 2, 4, 8, 6,}},
 { 12, 4, { 7, 8, 4, 3,}},
 { 8, 4, { 5, 6, 8, 7,}},
 { 15, 2, { 5, 13, -1,}},
 { 15, 2, { 13, 14, -1,}},
 { 15, 2, { 6, 15, -1,}},
 { 15, 2, { 15, 16, -1,}},
 { 15, 2, { 7, 9, -1,}},
 { 15, 2, { 9, 10, -1,}},
 { 15, 2, { 8, 11, -1,}},
 { 15, 2, { 11, 12, -1,}},
};
SHAPE MSSL1_shape = {
0,17,17,
MSSL1_vertex,
MSSL1_spoly
};