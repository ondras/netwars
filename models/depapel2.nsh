VECTOR depapel2_vertex[] = {
 { 0, 0, 96 },
 { 12, 0, -88 },
 { 72, 0, -96 },
 { -12, 0, -88 },
 { -72, 0, -96 },
 { 0, 48, -88 },
 { 80, 0, -48 },
 { -80, 0, -48 },
 { -8, 4, -16 },
 { -4, 20, 16 },
 { 8, 4, -16 },
 { 4, 20, 16 },
};
SPOLY depapel2_spoly[] = {
 { 15, 4, { 2, 1, 0, 6,}},
 { 15, 4, { 0, 3, 4, 7,}},
 { 31, 3, { 1, 5, 0,}},
 { 31, 3, { 5, 3, 0,}},
 { 31, 3, { 8, 9, 0,}},
 { 31, 3, { 11, 10, 0,}},
 { 31, 3, { 0, 7, 8,}},
 { 31, 3, { 0, 10, 6,}},
 { 15, 4, { 0, 1, 2, 6,}},
 { 15, 4, { 7, 4, 3, 0,}},
 { 15, 3, { 5, 1, 0,}},
 { 15, 3, { 0, 3, 5,}},
 { 8, 2, { 0, 8, -1,}},
 { 8, 2, { 0, 10, -1,}},
 { 31, 2, { 8, 3, -1,}},
 { 31, 2, { 10, 1, -1,}},
};
SHAPE depapel2_shape = {
0,12,16,
depapel2_vertex,
depapel2_spoly
};

