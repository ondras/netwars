VECTOR house_vertex[] = {
 { 84, -24, 84 },
 { 84, -24, -84 },
 { -84, -24, 84 },
 { -84, -24, -84 },
 { 84, 96, 84 },
 { -84, 96, 84 },
 { -84, 96, -84 },
 { 84, 96, -84 },
 { -96, -24, 96 },
 { 96, -24, 96 },
 { -96, -24, -96 },
 { 96, -24, -96 },
 { 0, -96, 0 },
 { 24, 0, 88 },
 { -24, 0, 88 },
 { 24, 96, 88 },
 { -24, 96, 88 },
};
SPOLY house_spoly[] = {
 { 23, 4, { 4, 5, 6, 7,}},
 { 23, 4, { 10, 11, 9, 8,}},
 { 23, 3, { 12, 8, 9,}},
 { 8, 3, { 12, 9, 11,}},
 { 8, 3, { 10, 8, 12,}},
 { 7, 3, { 11, 10, 12,}},
 { 8, 4, { 4, 7, 1, 0,}},
 { 8, 4, { 2, 3, 6, 5,}},
 { 23, 4, { 0, 2, 5, 4,}},
 { 7, 4, { 7, 6, 3, 1,}},
 { 7, 4, { 16, 15, 13, 14,}},
};
SHAPE house_shape = {
0,17,11,
house_vertex,
house_spoly
};

