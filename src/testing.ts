/* Test helpers (not used by the game) */
import { vi } from "vitest";

/** public/models/internal/pod1.nsh: bounding radius 0.96 m */
export const POD_MODEL = `VECTOR POD1_vertex[] = {
 { 0, 0, 72 }, { -72, 0, 0 }, { 0, 0, -72 }, { 72, 0, 0 }, { 0, -72, 0 }, { 0, 72, 0 },
 { 0, 0, 96 }, { -96, 0, 0 }, { 0, 0, -96 }, { 96, 0, 0 }, { 0, -96, 0 }, { 0, 96, 0 },
};
SPOLY POD1_spoly[] = {
 { 13, 3, { 4, 1, 0,}}, { 29, 3, { 4, 2, 1,}}, { 13, 3, { 4, 3, 2,}}, { 29, 3, { 4, 0, 3,}},
 { 5, 3, { 0, 1, 5,}}, { 21, 3, { 1, 2, 5,}}, { 5, 3, { 2, 3, 5,}}, { 21, 3, { 3, 0, 5,}},
 { 15, 2, { 0, 6, -1,}}, { 15, 2, { 1, 7, -1,}}, { 15, 2, { 2, 8, -1,}},
 { 15, 2, { 3, 9, -1,}}, { 15, 2, { 4, 10, -1,}}, { 15, 2, { 5, 11, -1,}},
};
SHAPE POD1_shape = {
0,12,14,
POD1_vertex,
POD1_spoly
};
`;

/** Serve POD_MODEL for every model request */
export function stubModels(): void {
	vi.stubGlobal("fetch", async () => new Response(POD_MODEL));
}

/** Let pending model loads finish */
export function settle(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}
