VECTOR fighter1_vertex[] = {
 { -24, 0, 96 },
 { 24, 0, 96 },
 { -60, 12, 24 },
 { 60, 12, 24 },
 { -16, -24, 12 },
 { 16, -24, 12 },
 { -60, 12, -96 },
 { 60, 12, -96 },
 { -16, -24, -96 },
 { 16, -24, -96 },
 { -16, -24, -12 },
 { 16, -24, -12 },
 { -60, 12, -24 },
 { 60, 12, -24 },
 { -96, 36, -72 },
 { -96, 36, -48 },
 { 96, 36, -72 },
 { 96, 36, -48 },
 { 0, 12, -96 },
};
SPOLY fighter1_spoly[] = {
 { 4, 3, { 6, 8, 18,}},
 { 4, 3, { 18, 9, 7,}},
 { 7, 4, { 0, 1, 5, 4,}},
 { 15, 3, { 4, 2, 0,}},
 { 15, 3, { 1, 3, 5,}},
 { 8, 4, { 2, 3, 1, 0,}},
 { 10, 4, { 2, 4, 10, 12,}},
 { 10, 4, { 13, 11, 5, 3,}},
 { 2, 4, { 4, 5, 11, 10,}},
 { 15, 4, { 12, 10, 8, 6,}},
 { 15, 4, { 7, 9, 11, 13,}},
 { 7, 4, { 10, 11, 9, 8,}},
 { 2, 4, { 12, 13, 3, 2,}},
 { 8, 4, { 6, 7, 13, 12,}},
 { 7, 4, { 6, 12, 15, 14,}},
 { 7, 4, { 14, 15, 12, 6,}},
 { 7, 4, { 7, 13, 17, 16,}},
 { 7, 4, { 16, 17, 13, 7,}},
 { 8, 3, { 8, 9, 18,}},
};
SHAPE 	fighter1_shape = {
0,19,19,
fighter1_vertex,
fighter1_spoly
};
