VECTOR arrow_vertex[] = {
 { 0, 0, 96 },
 { -96, 0, 0 },
 { 96, 0, 0 },
 { -48, 0, 24 },
 { 48, 0, 24 },
 { -48, 0, -96 },
 { 48, 0, -96 },
};
SPOLY arrow_spoly[] = {
 { 12, 3, { 2, 1, 0,}},
 { 12, 4, { 3, 4, 6, 5,}},
};
SHAPE arrow_shape = {
0,7,2,
arrow_vertex,
arrow_spoly
};
