VECTOR shield_vertex[] = {
 { -96, 0, 0 },
 { -24, -48, -48 },
 { -24, 48, -48 },
 { -24, -48, 48 },
 { -24, 48, 48 },
 { 96, 0, 0 },
 { 24, -48, -48 },
 { 24, 48, -48 },
 { 24, -48, 48 },
 { 24, 48, 48 },
};
SPOLY shield_spoly[] = {
 { 15, 3, { 0, 1, 2,}},
 { 7, 3, { 3, 1, 0,}},
 { 15, 3, { 4, 3, 0,}},
 { 7, 3, { 0, 2, 4,}},
 { 15, 3, { 7, 6, 5,}},
 { 7, 3, { 5, 6, 8,}},
 { 15, 3, { 5, 8, 9,}},
 { 7, 3, { 9, 7, 5,}},
 { 12, 4, { 6, 7, 2, 1,}},
 { 4, 4, { 1, 3, 8, 6,}},
 { 12, 4, { 3, 4, 9, 8,}},
 { 4, 4, { 7, 9, 4, 2,}},
};
SHAPE shield_shape = {
0,10,12,
shield_vertex,
shield_spoly
};
