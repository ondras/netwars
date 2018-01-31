VECTOR cargof_vertex[] = {
 { 0, 0, 96 },
 { 72, 0, -24 },
 { -72, 0, -24 },
 { 24, -48, -48 },
 { -24, -48, -48 },
 { 24, 48, -48 },
 { -24, 48, -48 },
 { 48, 0, -72 },
 { -48, 0, -72 },
 { 0, 0, -96 },
};
SPOLY cargof_spoly[] = {
 { 15, 3, { 0, 3, 4,}},
 { 31, 3, { 0, 1, 3,}},
 { 31, 3, { 4, 2, 0,}},
 { 7, 3, { 5, 1, 0,}},
 { 24, 3, { 6, 5, 0,}},
 { 7, 3, { 0, 2, 6,}},
 { 7, 3, { 9, 4, 3,}},
 { 8, 3, { 3, 7, 9,}},
 { 8, 3, { 9, 8, 4,}},
 { 7, 3, { 7, 3, 1,}},
 { 7, 3, { 2, 4, 8,}},
 { 8, 3, { 5, 6, 9,}},
 { 23, 3, { 9, 7, 5,}},
 { 23, 3, { 6, 8, 9,}},
 { 24, 3, { 1, 5, 7,}},
 { 24, 3, { 8, 6, 2,}},
};
SHAPE cargof_shape = {
0,10,16,
cargof_vertex,
cargof_spoly
};