VECTOR samsship_vertex[] = {
 { 24, 0, 96 },
 { -24, 0, 96 },
 { -48, -12, 24 },
 { 48, -12, 24 },
 { -48, 0, 24 },
 { 48, 0, 24 },
 { 96, -16, 0 },
 { -96, -16, 0 },
 { 96, 0, 0 },
 { -96, 0, 0 },
 { 96, 0, -24 },
 { -96, 0, -24 },
 { 96, -16, -24 },
 { -96, -16, -24 },
 { 24, 0, -60 },
 { -24, 0, -60 },
 { 24, -8, -60 },
 { -24, -8, -60 },
 { 48, 0, -96 },
 { -48, 0, -96 },
 { 48, -24, -96 },
 { -48, -24, -96 },
 { 24, -16, -24 },
 { -24, -16, -24 },
 { 24, -16, 0 },
 { -24, -16, 0 },
 { 16, -24, -16 },
 { 16, -24, -8 },
 { -16, -24, -16 },
 { -16, -24, -8 },
};
SPOLY samsship_spoly[] = {
 { 1, 4, { 3, 2, 1, 0,}},
 { 1, 4, { 0, 1, 4, 5,}},
 { 2, 3, { 1, 2, 4,}},
 { 2, 3, { 5, 3, 0,}},
 { 2, 4, { 4, 2, 7, 9,}},
 { 2, 4, { 8, 6, 3, 5,}},
 { 1, 4, { 2, 3, 6, 7,}},
 { 1, 4, { 5, 4, 9, 8,}},
 { 2, 4, { 6, 12, 13, 7,}},
 { 2, 4, { 11, 10, 8, 9,}},
 { 2, 4, { 13, 11, 9, 7,}},
 { 2, 4, { 6, 8, 10, 12,}},
 { 1, 4, { 12, 16, 17, 13,}},
 { 1, 4, { 15, 14, 10, 11,}},
 { 20, 4, { 18, 19, 21, 20,}},
 { 1, 4, { 20, 21, 17, 16,}},
 { 1, 4, { 19, 18, 14, 15,}},
 { 2, 4, { 15, 17, 21, 19,}},
 { 2, 4, { 16, 14, 18, 20,}},
 { 2, 4, { 28, 29, 27, 26,}},
 { 2, 4, { 28, 23, 25, 29,}},
 { 2, 4, { 24, 22, 26, 27,}},
 { 11, 4, { 28, 26, 22, 23,}},
 { 11, 4, { 25, 24, 27, 29,}},
 { 2, 4, { 17, 15, 11, 13,}},
 { 2, 4, { 12, 10, 14, 16,}},
};
SHAPE samsship_shape = {
0,30,26,
samsship_vertex,
samsship_spoly
};

