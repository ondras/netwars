VECTOR arrow_vertex[] = {
 { 0, 0, 24 },
 { 0, 0, -24 },
 { -12, 0, 12 },
 { 12, 0, 12 },
};
SPOLY arrow_spoly[] = {
 { 15, 2, { 1, 0, -1,}},
 { 15, 2, { 3, 0, -1,}},
 { 15, 2, { 0, 2, -1,}},
};
SHAPE arrow_shape = {
0,4,3,
arrow_vertex,
arrow_spoly
};

