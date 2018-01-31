VECTOR fighter4_vertex[] = {
 { -24, 0, 96 },
 { 24, 0, 96 },
 { -48, -24, 24 },
 { 48, -24, 24 },
 { -12, -36, 36 },
 { 12, -36, 36 },
 { -48, -24, 0 },
 { 48, -24, 0 },
 { -12, -36, -12 },
 { 12, -36, -12 },
 { -36, 12, 12 },
 { 36, 12, 12 },
 { -96, 24, -24 },
 { 96, 24, -24 },
 { -96, 24, -72 },
 { 96, 24, -72 },
 { -36, 12, -96 },
 { 36, 12, -96 },
 { -48, -24, -96 },
 { 48, -24, -96 },
 { 0, -24, -96 },
};
SPOLY fighter4_spoly[] = {
 { 7, 4, { 0, 1, 5, 4,}},
 { 15, 3, { 4, 2, 0,}},
 { 15, 3, { 1, 3, 5,}},
 { 9, 4, { 2, 4, 8, 6,}},
 { 9, 4, { 7, 9, 5, 3,}},
 { 1, 4, { 4, 5, 9, 8,}},
 { 8, 4, { 10, 11, 1, 0,}},
 { 7, 3, { 0, 2, 10,}},
 { 7, 3, { 11, 3, 1,}},
 { 9, 3, { 12, 10, 2,}},
 { 9, 3, { 3, 11, 13,}},
 { 8, 4, { 16, 17, 11, 10,}},
 { 7, 4, { 10, 12, 14, 16,}},
 { 7, 4, { 17, 15, 13, 11,}},
 { 1, 3, { 2, 6, 12,}},
 { 1, 3, { 13, 7, 3,}},
 { 7, 4, { 8, 9, 19, 18,}},
 { 15, 3, { 6, 8, 18,}},
 { 15, 3, { 19, 9, 7,}},
 { 7, 4, { 18, 14, 12, 6,}},
 { 7, 4, { 7, 13, 15, 19,}},
 { 15, 3, { 18, 16, 14,}},
 { 15, 3, { 15, 17, 19,}},
 { 4, 3, { 16, 18, 20,}},
 { 4, 3, { 20, 19, 17,}},
 { 7, 3, { 20, 17, 16,}},
};
SHAPE fighter4_shape = {
0,21,26,
fighter4_vertex,
fighter4_spoly
};