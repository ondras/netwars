VECTOR fighter2_vertex[] = {
 { 0, 0, 96 },
 { -24, -12, 0 },
 { 24, -12, 0 },
 { -48, 12, -24 },
 { 48, 12, -24 },
 { -96, 36, -72 },
 { 96, 36, -72 },
 { -12, -48, -72 },
 { 12, -48, -72 },
 { -36, -12, -96 },
 { 36, -12, -96 },
 { -48, 12, -96 },
 { 48, 12, -96 },
 { 0, 12, -96 },
 { -96, 36, -48 },
 { 96, 36, -48 },
};
SPOLY fighter2_spoly[] = {
 { 7, 3, { 2, 1, 0,}},
 { 15, 3, { 0, 1, 3,}},
 { 15, 3, { 4, 2, 0,}},
 { 8, 3, { 0, 3, 4,}},
 { 10, 3, { 1, 7, 9,}},
 { 10, 3, { 10, 8, 2,}},
 { 15, 4, { 7, 8, 10, 9,}},
 { 2, 3, { 9, 3, 1,}},
 { 2, 3, { 2, 4, 10,}},
 { 7, 3, { 3, 9, 11,}},
 { 7, 3, { 12, 10, 4,}},
 { 4, 3, { 13, 11, 9,}},
 { 4, 3, { 10, 12, 13,}},
 { 8, 4, { 11, 12, 4, 3,}},
 { 7, 3, { 9, 10, 13,}},
 { 2, 4, { 1, 2, 8, 7,}},
 { 2, 4, { 3, 11, 5, 14,}},
 { 2, 4, { 14, 5, 11, 3,}},
 { 2, 4, { 4, 12, 6, 15,}},
 { 2, 4, { 15, 6, 12, 4,}},
};
SHAPE fighter2_shape = {
0,16,20,
fighter2_vertex,
fighter2_spoly
};
